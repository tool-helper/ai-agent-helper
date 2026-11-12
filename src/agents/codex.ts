import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const codex: AgentProvider = {
  definition: { id: "codex", name: "Codex", command: "codex" },
  installer: { packageName: "@openai/codex", entryPoint: "bin/codex.js", useDefaultProxy: true },
  async detect(context) {
    return findExecutable("codex", context);
  },
};
