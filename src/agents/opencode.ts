import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const opencode: AgentProvider = {
  definition: { id: "opencode", name: "OpenCode", command: "opencode" },
  async detect(context) {
    return findExecutable("opencode", context);
  },
};
