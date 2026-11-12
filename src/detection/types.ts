import type { AgentDefinition } from "../schema.js";

export interface DetectionContext {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  cwd: string;
}

export interface AgentProvider {
  definition: AgentDefinition;
  detect(context: DetectionContext): Promise<string | null>;
}
