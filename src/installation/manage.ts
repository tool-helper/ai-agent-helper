import { access, lstat, readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { z } from "zod";
import { builtInAgents, installableAgentIds } from "../agents/index.js";
import type { Config } from "../config/schema.js";
import type { DetectionContext } from "../detection/types.js";
import { installationEnvironment, redact } from "../proxy/environment.js";
import { npmRunner, type NpmRunner } from "./process.js";

export const npmRegistry = "https://registry.npmjs.org/";
const registryArgument = `--registry=${npmRegistry}`;
const versionSchema = z.string().refine((value) => semver.valid(value) !== null, "无效的包版本");
const metadataSchema = z.object({ name: z.string(), version: versionSchema });
const releaseSchema = z.object({ version: versionSchema, engines: z.object({ node: z.string().optional() }).optional() });
export const selfRoot = dirname(fileURLToPath(new URL("../../package.json", import.meta.url)));

export interface ManageOptions {
  target: "self" | string;
  action: "install" | "update";
  config: Config;
  dryRun?: boolean;
  proxy?: string;
  reinstall?: boolean;
}

export interface InstallRuntime {
  context: DetectionContext;
  selfRoot: string;
  runNpm: NpmRunner;
  nodeVersion?: string;
}

export interface InstallResult {
  status: "planned" | "skipped" | "installed" | "updated";
  target: string;
  packageName: string;
  from: string | null;
  to: string;
  prefix: string;
  proxy: string | null;
  args: string[];
  message: string;
}

async function metadata(directory: string, expectedName: string) {
  let text: string;
  try { text = await readFile(join(directory, "package.json"), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`无法读取已安装的包信息：${directory}`);
  }
  let value;
  try { value = metadataSchema.parse(JSON.parse(text)); }
  catch { throw new Error(`已安装的包信息无效：${directory}`); }
  if (value.name !== expectedName) throw new Error(`安装位置的包名称不匹配：${directory}`);
  return value;
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  return platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b);
}

export async function managePackage(options: ManageOptions, suppliedRuntime?: InstallRuntime): Promise<InstallResult> {
  const isSelf = options.target === "self";
  const provider = builtInAgents.find((provider) => provider.definition.id === options.target);
  if (!isSelf && !provider?.installer) throw new Error(`当前支持安装和更新：${installableAgentIds.join("、")}。其他 agent 暂时只支持 list 检测。`);
  if (isSelf && options.action === "install") throw new Error("工具自身请使用 update 或 update --self。");
  const selectedProxy = options.proxy ?? (provider?.installer?.useDefaultProxy ? options.config.proxy : undefined);
  const env = installationEnvironment({ version: options.config.version, no_proxy: options.config.no_proxy }, selectedProxy);
  const runtime = suppliedRuntime ?? {
    context: { env, cwd: process.cwd(), platform: process.platform },
    selfRoot, runNpm: npmRunner(env),
  };
  const packageName = isSelf ? "ai-agent-helper" : provider!.installer!.packageName;
  const entryPoint = isSelf ? "dist/cli.js" : provider!.installer!.entryPoint;
  const displayName = provider?.definition.name ?? "agent-helper";
  const [root, prefix] = await Promise.all([runtime.runNpm(["root", "--global"]), runtime.runNpm(["prefix", "--global"])]);
  if (!root || !prefix) throw new Error("无法确定 npm 全局安装位置。");
  const directory = join(root, ...packageName.split("/"));
  const installed = await metadata(directory, packageName);
  const detected = isSelf ? null : await provider!.detect(runtime.context);
  const command = provider?.definition.command ?? "agent-helper";
  const expectedBin = runtime.context.platform === "win32" ? prefix : join(prefix, "bin");
  const executableNames = runtime.context.platform === "win32" ? [command, `${command}.cmd`, `${command}.ps1`] : [command];
  let detectedInPrefix = detected === null || executableNames
    .some((name) => samePath(detected, join(expectedBin, name), runtime.context.platform));
  if (detected !== null && detectedInPrefix && installed && runtime.context.platform !== "win32") {
    // npm's POSIX entry is a symlink. A same-directory Homebrew/standalone link is a different install.
    try { detectedInPrefix = samePath(await realpath(detected), await realpath(join(directory, entryPoint)), runtime.context.platform); }
    catch { detectedInPrefix = false; }
  }
  const linked = installed !== null && (await lstat(directory)).isSymbolicLink();
  let blocked: string | undefined;
  if (isSelf) {
    if (!installed || linked || !samePath(await realpath(directory), await realpath(runtime.selfRoot), runtime.context.platform)) {
      blocked = "当前 helper 不是此 npm 全局目录中的普通安装（可能是源码、npm link、npx 或其他 prefix），请通过原安装方式更新。";
    }
  } else if (linked || !detectedInPrefix || (detected !== null && installed === null)) {
    blocked = `${displayName} 来自其他目录、安装渠道（例如桌面版）或 npm link，请使用原安装方式更新，避免产生重复安装。`;
  }
  const base = {
    target: options.target, packageName, from: installed?.version ?? null, to: "latest", prefix,
    proxy: selectedProxy === undefined ? null : redact(selectedProxy),
    args: ["install", "--global", `${packageName}@latest`, "--prefix", prefix, registryArgument],
  };
  if (options.action === "install" && !options.reinstall && (installed || detected)) {
    return { ...base, status: "skipped", message: blocked ?? "已安装，跳过；需要重新安装时使用 --reinstall。" };
  }
  if (!isSelf && options.action === "update" && !installed && !detected) throw new Error(`${displayName} 尚未安装，请先运行 agent-helper install ${options.target}。`);
  if (options.dryRun) return { ...base, status: "planned", message: blocked ?? "仅预览；未联网查询版本，未执行安装。执行时解析 latest 并固定版本。" };
  if (blocked) throw new Error(blocked);
  const response = await runtime.runNpm(["view", `${packageName}@latest`, "version", "engines", "--json", registryArgument]);
  let release: z.infer<typeof releaseSchema>;
  try {
    const parsed: unknown = JSON.parse(response);
    // npm collapses multi-field output to a string if only version exists.
    release = typeof parsed === "string" ? { version: versionSchema.parse(parsed) } : releaseSchema.parse(parsed);
  }
  catch { throw new Error("npm 返回的 latest 版本或运行环境信息无效。"); }
  const latest = release.version;
  const args = ["install", "--global", `${packageName}@${latest}`, "--prefix", prefix, registryArgument];
  if (options.action === "update" && installed && semver.gte(installed.version, latest)) {
    return { ...base, args, to: latest, status: "skipped", message: "当前版本已是最新版或更新的版本。" };
  }
  const requirement = release.engines?.node;
  if (requirement !== undefined && (!semver.validRange(requirement) || !semver.satisfies(runtime.nodeVersion ?? process.versions.node, requirement))) {
    throw new Error(`${displayName} ${latest} 要求 Node.js ${requirement}，当前为 ${runtime.nodeVersion ?? process.versions.node}；请先升级 Node.js。`);
  }
  // npm also checks dependency engines instead of silently completing an incompatible install.
  args.push("--engine-strict");
  await runtime.runNpm(args, true);
  const after = await metadata(directory, packageName);
  if (after?.version !== latest) throw new Error("npm 已退出，但目标目录的包版本验证失败。");
  try { await access(join(directory, entryPoint)); }
  catch { throw new Error("包版本已写入，但命令入口缺失，安装验证失败。"); }
  const message = isSelf ? "工具已更新，请重新运行 agent-helper。"
    : detected === null ? `安装已完成；命令目录为 ${expectedBin}，请确认它在 PATH 中并重新打开终端。` : `${displayName} 包版本及命令入口验证通过。`;
  return { ...base, args, to: latest, status: options.action === "install" ? "installed" : "updated", message };
}

export type UpdateTarget = { kind: "self" } | { kind: "agent"; id: string } | { kind: "all-agents" };

export function resolveUpdateTarget(options: { self?: boolean; agent?: string; allAgents?: boolean }): UpdateTarget {
  if (Number(options.self === true) + Number(options.agent !== undefined) + Number(options.allAgents === true) > 1) {
    throw new Error("--self、--agent、--all-agents 不能同时使用。");
  }
  if (options.agent !== undefined) {
    if (!installableAgentIds.includes(options.agent)) throw new Error(`当前支持更新：${installableAgentIds.join("、")}。`);
    return { kind: "agent", id: options.agent };
  }
  return options.allAgents ? { kind: "all-agents" } : { kind: "self" };
}
