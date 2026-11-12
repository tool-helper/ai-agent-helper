import { z } from "zod";

export const agentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  command: z.string().min(1),
});

export const agentResultSchema = z.discriminatedUnion("installed", [
  agentDefinitionSchema.extend({ installed: z.literal(true), path: z.string().min(1) }),
  agentDefinitionSchema.extend({ installed: z.literal(false), path: z.null() }),
]);

export const agentListSchema = z.array(agentResultSchema);
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;
export type AgentResult = z.infer<typeof agentResultSchema>;
