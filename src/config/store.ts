import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { stringify } from "smol-toml";
import { getStaticTOMLValue, parseForESLint } from "toml-eslint-parser";
import { configKeySchema, configSchema, type Config, type ConfigKey } from "./schema.js";

export function configPath(home = homedir()): string {
  return join(home, ".ai-agent-helper", "config.toml");
}

async function readOptional(path: string): Promise<string | undefined> {
  try { return await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new Error(`无法读取配置文件：${path}`);
  }
}

function validate(value: unknown): Config {
  const result = configSchema.safeParse(value);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join(".") || "根节点/未知字段"))];
    throw new Error(`配置校验失败（${fields.join("、")}），请检查字段、类型、代理 URL 和格式版本。`);
  }
  return result.data;
}

function parseConfig(source: string): Config {
  let value: unknown;
  try { value = getStaticTOMLValue(parseForESLint(source, { tomlVersion: "1.0" }).ast); }
  catch { throw new Error("TOML 语法错误，请检查引号、重复键和数组格式。"); }
  return validate(value);
}

export async function readConfig(path = configPath()): Promise<Config> {
  const source = await readOptional(path);
  try { return parseConfig(source ?? ""); }
  catch (error) { throw new Error(`${path}：${(error as Error).message}`); }
}

export type ConfigChanges = Map<ConfigKey, string | string[] | undefined>;

/** Split on the first equals sign: credentials may themselves contain '='. */
export function parseAssignments(assignments: string[]): ConfigChanges {
  if (assignments.length === 0) throw new Error("用法：config set <key=value> [key=value ...]");
  const changes: ConfigChanges = new Map();
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) throw new Error("配置格式应为 key=value。");
    const keyResult = configKeySchema.safeParse(assignment.slice(0, separator));
    if (!keyResult.success) throw new Error("可写配置项仅支持 proxy、no_proxy。");
    const key = keyResult.data;
    if (changes.has(key)) throw new Error(`配置项重复：${key}`);
    const value = assignment.slice(separator + 1);
    changes.set(key, key === "no_proxy" ? value.split(",") : value);
  }
  const candidate = Object.fromEntries(changes);
  validate(candidate);
  return changes;
}

/** Edit only AST value ranges, leaving comments, whitespace and key order intact. */
export function editConfig(source: string, changes: ConfigChanges): string {
  const current = parseConfig(source);
  const candidate: Record<string, unknown> = { ...current };
  for (const [key, value] of changes) {
    configKeySchema.parse(key);
    if (value === undefined) delete candidate[key];
    else candidate[key] = value;
  }
  validate(candidate);
  const { ast } = parseForESLint(source, { tomlVersion: "1.0" });
  const patches: { start: number; end: number; value: string }[] = [];
  const additions: string[] = [];
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const nodes = ast.body[0].body.filter((node) => node.type === "TOMLKeyValue");
  if (!nodes.some((node) => getStaticTOMLValue(node.key)[0] === "version")) additions.push("version = 1");
  for (const [key, value] of changes) {
    const node = nodes.find((node) => getStaticTOMLValue(node.key)[0] === key);
    const innerComments = node ? ast.comments
      .filter((comment) => comment.range[0] >= node.value.range[0] && comment.range[1] <= node.value.range[1])
      .map((comment) => source.slice(comment.range[0], comment.range[1])) : [];
    if (value === undefined) {
      if (node) patches.push({ start: node.range[0], end: node.range[1], value: innerComments.join(newline) });
      continue;
    }
    // Let the TOML serializer escape strings instead of treating CLI input as TOML code.
    const encoded = stringify({ value }).trim().slice("value = ".length);
    if (node) patches.push({ start: node.value.range[0], end: node.value.range[1], value: encoded.replace(/\n/g, newline) + (innerComments.length ? newline + innerComments.join(newline) : "") });
    else additions.push(`${key} = ${encoded.replace(/\n/g, newline)}`);
  }
  let output = source;
  for (const patch of patches.sort((a, b) => b.start - a.start)) {
    output = output.slice(0, patch.start) + patch.value + output.slice(patch.end);
  }
  if (additions.length) output += (output && !output.endsWith("\n") ? newline : "") + additions.join(newline) + newline;
  parseConfig(output);
  return output;
}

export async function writeConfig(changes: ConfigChanges, path = configPath()): Promise<void> {
  const original = await readOptional(path);
  const updated = editConfig(original ?? "", changes);
  // Unsetting a missing key must not create a new configuration file.
  if (original === undefined && [...changes.values()].every((value) => value === undefined)) return;
  if (original === updated) return;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch { throw new Error(`无法锁定配置文件，请确认没有其他写入进程：${lockPath}`); }
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    if ((await readOptional(path)) !== original) throw new Error("配置文件已被其他进程修改，请重试。");
    if (original !== undefined && (await lstat(path)).isSymbolicLink()) throw new Error("配置文件是符号链接，请直接编辑其目标文件。");
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(updated, "utf8"); await file.sync(); }
    finally { await file.close(); }
    if ((await readOptional(path)) !== original) throw new Error("配置文件已被其他进程修改，请重试。");
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

export function formatConfig(config: Config): string {
  const copy = { ...config };
  if (copy.proxy) {
    const url = new URL(copy.proxy);
    if (url.username || url.password) {
      url.username = "REDACTED";
      url.password = "REDACTED";
      copy.proxy = url.toString();
    }
  }
  return stringify(copy);
}
