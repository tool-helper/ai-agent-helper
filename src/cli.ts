#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { configPath, formatConfig, parseAssignments, readConfig, writeConfig } from "./config/store.js";
import { configKeySchema } from "./config/schema.js";
import { managePackage, resolveUpdateTarget, type InstallResult } from "./installation/manage.js";
import { selectInstallAgent } from "./installation/select-agent.js";
import { desktopDownloads, installableAgents, installableAgentIds, installTargetIds } from "./agents/index.js";
import { redact } from "./proxy/environment.js";
import { listAgents } from "./list-agents.js";
import type { AgentResult } from "./schema.js";

const supportedAgents = installableAgentIds.join("、");
const supportedInstallTargets = installTargetIds.join("、");
const help = `agent-helper — 管理本地 AI agent CLI

用法：
  agent-helper list [--all] [--json]
  agent-helper config [set <key=value> ... | unset <key>]
  agent-helper install [agent] [--proxy <url>] [--dry-run] [--reinstall]
  agent-helper update [--self | --agent <agent> | --all-agents] [--proxy <url>] [--dry-run]
  agent-helper [--help | --version]

命令：
  list             列出 PATH 中检测到的 agent
  config           查看所有配置，或设置/删除配置项
  install [agent]  安装 CLI 或显示桌面版安装页面，省略 agent 时交互选择
  update           默认更新工具自身；--agent 指定 agent

选项：
  -a, --all        同时显示未检测到的 agent（仅用于 list）
      --json       输出 JSON 数组（仅用于 list）
  -h, --help       显示帮助，支持 list --help
  -v, --version    显示 agent-helper 版本
      --self       更新工具自身（update 的默认目标）
      --agent      指定要更新的 agent，目前支持 ${supportedAgents}
      --all-agents 更新所有已安装且支持更新的 agent
      --proxy      本次安装/更新使用的 HTTP/HTTPS 代理，覆盖 agent 默认规则
      --dry-run    本地预览，不联网查询版本，不执行安装
      --reinstall  重新安装已存在的 npm agent（仅用于 install）

示例：
  agent-helper list
  agent-helper list --all
  agent-helper list --json
  agent-helper list --all --json
  agent-helper config set proxy=http://127.0.0.1:7890
  agent-helper config set no_proxy=localhost,127.0.0.1,::1
  agent-helper config unset proxy
  agent-helper install
  agent-helper install codex
  agent-helper install dsh
  agent-helper install dsh-desktop
  agent-helper install chatgpt-desktop
  agent-helper update
  agent-helper update --agent codex
  agent-helper update --agent dsh

检测范围：Claude Code、Codex、Gemini CLI、OpenCode、Aider、GitHub Copilot、DeepSeek Harness。
list 只查找 PATH 中的入口；安装/更新支持 ${supportedAgents} 的 npm CLI 和 npm 全局安装的工具自身。
默认代理：Codex 使用保存的 proxy；DSH 和工具自身沿用 npm/终端原有设置。
配置文件：~/.ai-agent-helper/config.toml；配置只作用于安装/更新子进程。`;

const commandHelp: Record<string, string> = {
  config: `用法：
  agent-helper config
  agent-helper config set <key=value> [key=value ...]
  agent-helper config unset <key>

可写项：proxy（HTTP/HTTPS URL）；no_proxy（逗号分隔的非空规则）。
配置文件：~/.ai-agent-helper/config.toml；省略 proxy 时继承安装工具原有配置。
示例：agent-helper config set proxy=http://127.0.0.1:7890 no_proxy=localhost,127.0.0.1
version 由工具管理；未知键、重复键和无效值会报错，修改保留原有注释。`,
  install: `用法：agent-helper install [agent] [--proxy <url>] [--dry-run] [--reinstall]
支持 ${supportedInstallTargets}。
省略 agent 时显示选择菜单，使用 ↑/↓ 选择、回车确认；可选择“取消安装”，或按 Esc / Ctrl+C 取消。
非交互环境须显式指定 agent，例如 agent-helper install codex。
codex：@openai/codex；dsh：@deepseek-ai/dsh（CLI，启动 Web 界面）。
CLI 安装目标为当前 npm 全局目录；dsh-desktop、chatgpt-desktop 仅显示官方安装页面地址。
安装前检查目标包 engines.node；dsh 当前要求 Node.js >=24.9.0。
Codex 默认使用 config 中的 proxy；DSH 默认不套用 helper 的代理。--proxy 可临时覆盖。
未选择 helper 代理时保留 npm/终端原有网络设置，不自动判断地域。
--dry-run 只做本地检查；不会联网查询、下载或修改安装。
示例：agent-helper install dsh --proxy http://127.0.0.1:7890`,
  update: `用法：agent-helper update [--self | --agent <agent> | --all-agents] [--proxy <url>] [--dry-run]
不指定目标时等同于 --self；三个目标参数互斥。
--agent 支持 ${supportedAgents}；--all-agents 逐个更新已检测到且支持的 agent，失败后继续并汇总。
只支持普通 npm 全局安装；源码、npm link、npx 或其他安装渠道请通过原方式更新。
Codex 默认使用保存的代理；DSH 和工具自身默认沿用 npm 原有网络设置，--proxy 可覆盖。
--dry-run 不联网、不安装；实际更新先查询 latest，再安装该具体版本。
示例：agent-helper update --agent dsh --dry-run`,
};

function printResult(result: InstallResult): void {
  console.log(`${result.target}: ${result.status} (${result.from ?? "无 npm 全局版本"} → ${result.to})`);
  console.log(`代理：${result.proxy ?? "继承 npm 原有配置"}`);
  console.log(`命令：npm ${result.args.map((argument) => JSON.stringify(argument)).join(" ")}`);
  console.log(result.message);
}

function printTable(agents: AgentResult[]): void {
  if (agents.length === 0) {
    console.log("未在 PATH 中检测到支持的 agent。使用 agent-helper list --all 查看检测范围。");
    return;
  }
  const rows = [["AGENT", "COMMAND", "STATUS", "PATH"], ...agents.map((agent) => [
    agent.name, agent.command, agent.installed ? "found" : "not found", agent.path ?? "-",
  ])];
  const widths = [0, 1, 2].map((column) => Math.max(...rows.map((row) => row[column]!.length)));
  console.log(rows.map((row) => row.map((value, column) => column < 3 ? value.padEnd(widths[column]! + 2) : value).join("")).join("\n"));
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      all: { type: "boolean", short: "a" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      self: { type: "boolean" },
      agent: { type: "string" },
      "all-agents": { type: "boolean" },
      proxy: { type: "string" },
      "dry-run": { type: "boolean" },
      reinstall: { type: "boolean" },
    },
    allowPositionals: true,
    strict: true,
  });
  const command = positionals[0];
  if (command !== undefined && !["list", "config", "install", "update"].includes(command)) {
    throw new Error("未知命令。使用 agent-helper --help 查看帮助。");
  }
  if (values.help) {
    console.log(command === undefined ? help : commandHelp[command] ?? help);
    return;
  }
  const allowed: Record<string, string[]> = {
    root: ["version"], list: ["all", "json"], config: [],
    install: ["proxy", "dry-run", "reinstall"],
    update: ["self", "agent", "all-agents", "proxy", "dry-run"],
  };
  for (const key of Object.keys(values)) {
    if (!allowed[command ?? "root"]!.includes(key)) throw new Error(`当前命令不支持 --${key}。使用 --help 查看帮助。`);
  }
  if (values.version) {
    const metadata = z.object({ version: z.string().min(1) }).parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));
    console.log(metadata.version);
    return;
  }
  if (command === undefined) {
    console.log(help);
    return;
  }
  if (command === "list") {
    if (positionals.length !== 1) throw new Error("list 不接受额外位置参数。");
    const agents = await listAgents({ includeMissing: values.all ?? false });
    if (values.json) console.log(JSON.stringify(agents, null, 2));
    else printTable(agents);
    return;
  }
  if (command === "config") {
    const action = positionals[1];
    if (action === undefined) console.log(`# ${configPath()}\n${formatConfig(await readConfig())}`);
    else if (action === "set") {
      await writeConfig(parseAssignments(positionals.slice(2)));
      console.log(`配置已保存：${configPath()}`);
    } else if (action === "unset" && positionals.length === 3) {
      const key = configKeySchema.safeParse(positionals[2]);
      if (!key.success) throw new Error("可删除配置项仅支持 proxy、no_proxy。");
      await writeConfig(new Map([[key.data, undefined]]));
      console.log(`配置项已恢复默认：${key.data}`);
    } else throw new Error("用法：config [set <key=value> ... | unset <key>]");
    return;
  }
  const options = { dryRun: values["dry-run"] ?? false, ...(values.proxy === undefined ? {} : { proxy: values.proxy }) };
  if (command === "install") {
    if (positionals.length > 2 || (positionals[1] !== undefined && !installTargetIds.includes(positionals[1]))) throw new Error(`用法：install [agent]。目前支持 ${supportedInstallTargets}。`);
    const agent = positionals[1] ?? await selectInstallAgent();
    if (agent === null) { console.log("已取消安装。"); return; }
    const desktop = desktopDownloads.find((desktop) => desktop.id === agent);
    if (desktop) { console.log(`${desktop.name} 官方安装页面：\n${desktop.url}`); return; }
    printResult(await managePackage({ ...options, config: await readConfig(), target: agent, action: "install", reinstall: values.reinstall ?? false }));
    return;
  }
  const common = { ...options, config: await readConfig() };
  if (positionals.length !== 1) throw new Error("update 不接受位置参数，请使用 --agent <agent>。");
  const target = resolveUpdateTarget({
    ...(values.self === undefined ? {} : { self: values.self }),
    ...(values.agent === undefined ? {} : { agent: values.agent }),
    ...(values["all-agents"] === undefined ? {} : { allAgents: values["all-agents"] }),
  });
  if (target.kind === "all-agents") {
    let detected = 0;
    let failed = 0;
    for (const provider of installableAgents) {
      try {
        const installed = await provider.detect({ env: process.env, platform: process.platform, cwd: process.cwd() });
        if (!installed) continue;
        detected++;
        printResult(await managePackage({ ...common, target: provider.definition.id, action: "update" }));
      } catch (error) {
        failed++;
        console.error(`${provider.definition.id}: ${redact(error instanceof Error ? error.message : String(error))}`);
      }
    }
    console.log(`批量更新：检测到 ${detected} 个受支持的 agent，失败 ${failed} 个。`);
    if (failed) process.exitCode = 1;
    return;
  }
  printResult(await managePackage({ ...common, target: target.kind === "self" ? "self" : target.id, action: "update" }));
}

main().catch((error: unknown) => {
  console.error(`agent-helper: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
