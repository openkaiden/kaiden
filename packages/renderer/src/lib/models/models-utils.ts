import type { ModelInfo } from '/@/lib/chat/components/model-info';
import type { ProviderInfo } from '/@api/provider-info';

export function getModels(providerInfos: ProviderInfo[]): ModelInfo[] {
  return providerInfos.reduce(
    (accumulator, current) => {
      if (current.inferenceConnections.length > 0) {
        for (const { name, type, llmMetadata, endpoint, models } of current.inferenceConnections) {
          accumulator.push(
            ...models.map((model: { label: string }) => ({
              providerId: current.id,
              connectionName: name,
              type,
              llmMetadata: llmMetadata,
              endpoint,
              label: model.label,
            })),
          );
        }
      }
      return accumulator;
    },
    [] as Array<ModelInfo>,
  );
}
