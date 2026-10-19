import type { ModelInfo } from '/@api/model-registry-info';

export type { CatalogModelInfo, InferenceConnectionSummary, ModelInfo } from '/@api/model-registry-info';

export function getModelId(model: ModelInfo): string {
  return `${model.llmMetadata?.name ?? ''}::${model.label}::${model.endpoint ?? ''}`;
}
