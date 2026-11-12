#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import { listAgents } from "./list-agents.js";
import type { AgentResult } from "./schema.js";

const help = `agent-helper — 列出本地 AI agent CLI

用法：
  agent-helper list [--all] [--json]
  agent-helper [--help | --version]

命令：
  list             列出 PATH 中检测到的 agent

选项：
  -a, --all        同时显示未检测到的 agent（仅用于 list）
      --json       输出 JSON 数组（仅用于 list）
  -h, --help       显示帮助，支持 list --help
  -v, --version    显示 agent-helper 版本

示例：
  agent-helper list
  agent-helper list --all
  agent-helper list --json
  agent-helper list --all --json

检测范围：Claude Code、Codex、Gemini CLI、OpenCode、Aider、GitHub Copilot。
仅查找 PATH 中的可执行入口，不启动 agent，不检查登录状态或版本。`;

const cliOptionsSchema = z.object({
  all: z.boolean().default(false),
  json: z.boolean().default(false),
  help: z.boolean().default(false),
  version: z.boolean().default(false),
});

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
    },
    allowPositionals: true,
    strict: true,
  });
  const options = cliOptionsSchema.parse(values);
  if (positionals.length > 1 || (positionals[0] !== undefined && positionals[0] !== "list")) {
    throw new Error(`未知命令：${positionals.join(" ")}。使用 agent-helper --help 查看帮助。`);
  }
  if (options.help) {
    console.log(help);
    return;
  }
  if (options.version) {
    const metadata = z.object({ version: z.string().min(1) }).parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));
    console.log(metadata.version);
    return;
  }
  if (positionals.length === 0) {
    if (options.all || options.json) throw new Error("--all 和 --json 需要与 list 命令一起使用。");
    console.log(help);
    return;
  }
  const agents = await listAgents({ includeMissing: options.all });
  if (options.json) console.log(JSON.stringify(agents, null, 2));
  else printTable(agents);
}

main().catch((error: unknown) => {
  console.error(`agent-helper: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
