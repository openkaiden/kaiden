import type { FlowGenerationParameters } from '/@api/inference/flow-generation-parameters-schema';
import type { ModelInfo } from '/@api/model-registry-info';

export interface FlowCreationData extends FlowGenerationParameters {
  model: ModelInfo;
  tools: Record<string, string[]>;
  chatId: string;
}

/**
 * A state to temporarily hold the data for a new flow
 * when navigating from a chat session to the creation page.
 * It's set to `undefined` after being read to prevent stale data.
 */
export const flowCreationData = $state<{ value: FlowCreationData | undefined }>({ value: undefined });
