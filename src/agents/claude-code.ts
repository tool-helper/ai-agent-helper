import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const claudeCode: AgentProvider = {
  definition: { id: "claude-code", name: "Claude Code", command: "claude" },
  async detect(context) {
    return findExecutable("claude", context);
  },
};
