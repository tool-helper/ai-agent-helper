import { builtInAgents } from "./agents/index.js";
import type { DetectionContext } from "./detection/types.js";
import { agentListSchema, type AgentResult } from "./schema.js";

export interface ListAgentsOptions extends Partial<DetectionContext> {
  includeMissing?: boolean;
}

export async function listAgents(options: ListAgentsOptions = {}): Promise<AgentResult[]> {
  const context: DetectionContext = {
    env: options.env ?? process.env,
    platform: options.platform ?? process.platform,
    cwd: options.cwd ?? process.cwd(),
  };
  const results = await Promise.all(builtInAgents.map(async (provider) => {
    const path = await provider.detect(context);
    return { ...provider.definition, installed: path !== null, path };
  }));
  return agentListSchema.parse(results).filter((agent) => options.includeMissing || agent.installed);
}
