import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const githubCopilot: AgentProvider = {
  definition: { id: "github-copilot", name: "GitHub Copilot", command: "copilot" },
  async detect(context) {
    return findExecutable("copilot", context);
  },
};
