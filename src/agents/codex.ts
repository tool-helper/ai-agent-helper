import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const codex: AgentProvider = {
  definition: { id: "codex", name: "Codex", command: "codex" },
  async detect(context) {
    return findExecutable("codex", context);
  },
};
