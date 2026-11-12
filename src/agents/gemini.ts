import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const gemini: AgentProvider = {
  definition: { id: "gemini", name: "Gemini CLI", command: "gemini" },
  async detect(context) {
    return findExecutable("gemini", context);
  },
};
