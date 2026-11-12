import { aider } from "./aider.js";
import { claudeCode } from "./claude-code.js";
import { codex } from "./codex.js";
import { gemini } from "./gemini.js";
import { githubCopilot } from "./github-copilot.js";
import { opencode } from "./opencode.js";
import type { AgentProvider } from "../detection/types.js";

export const builtInAgents: readonly AgentProvider[] = [claudeCode, codex, gemini, opencode, aider, githubCopilot];
