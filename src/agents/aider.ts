import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const aider: AgentProvider = {
  definition: { id: "aider", name: "Aider", command: "aider" },
  async detect(context) {
    return findExecutable("aider", context);
  },
};
