import type { InferenceProviderConnectionType, ProviderConnectionStatus } from '@openkaiden/api';

import type { ModelInfo } from '/@/lib/chat/components/model-info';
import type { ProviderInfo } from '/@api/provider-info';

export interface CatalogModelInfo extends ModelInfo {
  connectionStatus: ProviderConnectionStatus;
  providerName: string;
}

export interface InferenceConnectionSummary {
  providerName: string;
  providerId: string;
  providerInternalId: string;
  connectionName: string;
  connectionType?: InferenceProviderConnectionType;
  status: ProviderConnectionStatus | 'not-configured';
  modelCount: number;
  creationDisplayName: string;
}

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

function isCloudLike(type: InferenceProviderConnectionType | undefined): boolean {
  return type === 'cloud' || type === 'self-hosted' || !type;
}

export function getCloudCatalogModels(providerInfos: ProviderInfo[]): CatalogModelInfo[] {
  return getCatalogModels(providerInfos).filter(m => isCloudLike(m.type));
}

export function getLocalCatalogModels(providerInfos: ProviderInfo[]): CatalogModelInfo[] {
  return getCatalogModels(providerInfos).filter(m => m.type === 'local');
}

export function getCatalogModels(providerInfos: ProviderInfo[]): CatalogModelInfo[] {
  const result: CatalogModelInfo[] = [];
  for (const provider of providerInfos) {
    for (const connection of provider.inferenceConnections) {
      for (const model of connection.models) {
        result.push({
          providerId: provider.id,
          providerName: provider.name,
          connectionName: connection.name,
          type: connection.type,
          label: model.label,
          connectionStatus: connection.status,
        });
      }
    }
  }
  return result;
}

export function getCloudConnectionSummaries(providerInfos: ProviderInfo[]): InferenceConnectionSummary[] {
  return getInferenceConnectionSummaries(providerInfos).filter(c => isCloudLike(c.connectionType));
}

export function getLocalConnectionSummaries(providerInfos: ProviderInfo[]): InferenceConnectionSummary[] {
  return getInferenceConnectionSummaries(providerInfos).filter(c => c.connectionType === 'local');
}

export function getInferenceConnectionSummaries(providerInfos: ProviderInfo[]): InferenceConnectionSummary[] {
  const result: InferenceConnectionSummary[] = [];
  for (const provider of providerInfos) {
    if (provider.inferenceConnections.length > 0) {
      for (const connection of provider.inferenceConnections) {
        result.push({
          providerName: provider.name,
          providerId: provider.id,
          providerInternalId: provider.internalId,
          connectionName: connection.name,
          connectionType: connection.type,
          status: connection.status,
          modelCount: connection.models.length,
          creationDisplayName: provider.inferenceProviderConnectionCreationDisplayName ?? provider.name,
        });
      }
    } else if (provider.inferenceProviderConnectionCreation) {
      result.push({
        providerName: provider.name,
        providerId: provider.id,
        providerInternalId: provider.internalId,
        connectionName: '',
        status: 'not-configured',
        modelCount: 0,
        creationDisplayName: provider.inferenceProviderConnectionCreationDisplayName ?? provider.name,
      });
    }
  }
  return result;
}
