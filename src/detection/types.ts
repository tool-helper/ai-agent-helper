import type { AgentDefinition } from "../schema.js";
import type { NpmAgentInstaller } from "../installation/types.js";

export interface DetectionContext {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  cwd: string;
}

export interface AgentProvider {
  definition: AgentDefinition;
  detect(context: DetectionContext): Promise<string | null>;
  installer?: NpmAgentInstaller;
}
