import { z } from 'zod';

export const MessageConfigSchema = z.object({
  tools: z.record(z.string(), z.array(z.string())).optional(),
  modelId: z.string(),
  connectionName: z.string(),
  providerId: z.string(),
  type: z.enum(['cloud', 'local', 'self-hosted']).optional(),
  endpoint: z.string().optional(),
});

export type MessageConfig = z.output<typeof MessageConfigSchema>;
