import type { ProviderInfo } from '/@api/provider-info';
import type { ChunkProviderInfo } from '/@api/rag/chunk-provider-info';
import type { RagEnvironment } from '/@api/rag/rag-environment';

export function getDatabaseName(providerInfos: ProviderInfo[], ragEnvironment: RagEnvironment | undefined): string {
  // Extract database name from connection ID or show the ID
  const ragProvider = providerInfos.find(provider => provider.id === ragEnvironment?.ragConnection.providerId);
  const ragConnection = ragProvider?.ragConnections.find(
    connection => connection.name === ragEnvironment?.ragConnection.name,
  );
  return ragConnection?.name ? `${ragConnection.name} (${ragProvider?.name})` : 'N/A';
}

export function getChunkProviderName(
  chunkProviders: ChunkProviderInfo[],
  ragEnvironment: RagEnvironment | undefined,
): string {
  const chunkProvider = chunkProviders.find(provider => provider.id === ragEnvironment?.chunkerId);
  return chunkProvider?.name ?? 'N/A';
}
