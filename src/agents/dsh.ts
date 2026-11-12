import { findExecutable } from "../detection/find-executable.js";
import type { AgentProvider } from "../detection/types.js";

export const dsh: AgentProvider = {
  definition: { id: "dsh", name: "DeepSeek Harness", command: "dsh" },
  installer: { packageName: "@deepseek-ai/dsh", entryPoint: "lib/bin.js", useDefaultProxy: false },
  async detect(context) {
    return findExecutable("dsh", context);
  },
};
