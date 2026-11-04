import { matchesAllTokens } from '/@/stores/search-util';
import type { CatalogModelInfo, InferenceConnectionSummary, ModelInfo } from '/@api/model-registry-info';
import type { SemanticRouterInfo } from '/@api/semantic-router-info';

export type { CatalogModelInfo, InferenceConnectionSummary, ModelInfo } from '/@api/model-registry-info';

export function getModelId(model: ModelInfo): string {
  return `${model.llmMetadata?.name ?? ''}::${model.label}::${model.endpoint ?? ''}`;
}

/**
 * Concatenates every field a model can be searched by: label, provider id,
 * provider name and connection name.
 */
export function searchableModelText(model: CatalogModelInfo): string {
  return [model.label, model.providerId, model.providerName, model.connectionName].filter(Boolean).join(' ');
}

/**
 * Keeps the models whose searchable text contains every token of the query.
 */
export function filterModelsBySearch(models: CatalogModelInfo[], term: string): CatalogModelInfo[] {
  return models.filter(model => matchesAllTokens(searchableModelText(model), term));
}

/**
 * Concatenates every field a connection can be searched by: provider name and
 * connection type.
 */
export function searchableConnectionText(connection: InferenceConnectionSummary): string {
  return [connection.providerName, connection.connectionType].filter(Boolean).join(' ');
}

/**
 * Concatenates every field a semantic router can be searched by: name,
 * description, keyword group names, decision names and model ref labels.
 */
export function searchableRouterText(router: SemanticRouterInfo): string {
  const keywords = router.routing.keywords.map(keyword => keyword.name);
  const decisionLabels = router.routing.decisions.flatMap(decision => [
    decision.name,
    ...decision.rules.flatMap(rule => rule.modelRefs.map(modelRef => modelRef.label)),
  ]);
  return [router.name, router.description, ...keywords, ...decisionLabels].filter(Boolean).join(' ');
}
