import { isCancel, select } from "@clack/prompts";
import type { Readable, Writable } from "node:stream";
import { desktopDownloads, installableAgents } from "../agents/index.js";

type TerminalInput = Readable & { isTTY?: boolean };
type TerminalOutput = Writable & { isTTY?: boolean };

export async function selectInstallAgent(
  input: TerminalInput = process.stdin,
  output: TerminalOutput = process.stdout,
): Promise<string | null> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error("交互选择需要终端；非交互环境请指定 agent，例如 agent-helper install codex 或 agent-helper install dsh。");
  }
  if (input.readableEnded || input.destroyed) return null;
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort();
  input.once("end", cancel);
  input.once("close", cancel);
  try {
    const selected = await select<string | null>({
      message: "请选择要安装的 agent（↑/↓ 选择，回车确认）",
      options: [
        ...installableAgents.map((provider) => ({
          value: provider.definition.id,
          label: `${provider.definition.name} CLI (${provider.definition.id})`,
          hint: provider.installer!.packageName,
        })),
        ...desktopDownloads.map((desktop) => ({
          value: desktop.id,
          label: `${desktop.name} (${desktop.id})`,
          hint: "显示官方安装页面",
        })),
        { value: null, label: "取消安装" },
      ],
      input,
      output,
      signal: cancellation.signal,
      showInstructions: false,
    });
    return isCancel(selected) ? null : selected;
  } finally {
    input.off("end", cancel);
    input.off("close", cancel);
  }
}
