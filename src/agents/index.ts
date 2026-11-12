import { aider } from "./aider.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { chatgptDesktop } from "./chatgpt-desktop.js";
import { dsh } from "./dsh.js";
import { dshDesktop } from "./dsh-desktop.js";
import { gemini } from "./gemini.js";
import { githubCopilot } from "./github-copilot.js";
import { opencode } from "./opencode.js";
import type { AgentProvider } from "../detection/types.js";
import type { DesktopDownload } from "../installation/types.js";

export const builtInAgents: readonly AgentProvider[] = [claudeCode, codex, gemini, opencode, aider, githubCopilot, dsh];

export const installableAgents = builtInAgents.filter((provider) => provider.installer !== undefined);
export const installableAgentIds = installableAgents.map((provider) => provider.definition.id);
export const desktopDownloads: readonly DesktopDownload[] = [dshDesktop, chatgptDesktop];
export const installTargetIds = [...installableAgentIds, ...desktopDownloads.map((desktop) => desktop.id)];
