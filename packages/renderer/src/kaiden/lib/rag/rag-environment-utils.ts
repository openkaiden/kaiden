import type { OpenDialogOptions } from '@openkaiden/api';

import type { ProviderInfo } from '/@api/provider-info';
import type { RagEnvironment } from '/@api/rag/rag-environment';

export type ChunkProviderFileFilterSource = {
  supportedExtensions?: string[];
};

export function buildDialogFilters(
  connection: ChunkProviderFileFilterSource,
): NonNullable<OpenDialogOptions['filters']> {
  if (connection.supportedExtensions?.length) {
    const uniqueExtensions = [
      ...new Set(connection.supportedExtensions.map(extension => extension.toLowerCase())),
    ].sort((a, b) => a.localeCompare(b));
    return [{ name: 'Supported documents', extensions: uniqueExtensions }];
  }

  return [{ name: 'All Files', extensions: ['*'] }];
}

export function formatSupportedExtensionsLabel(extensions: string[]): string {
  if (extensions.length === 0) {
    return 'All file types';
  }

  const displayExtensions = extensions.slice(0, 4).map(extension => extension.toUpperCase());
  const label = displayExtensions.join(', ');
  return extensions.length > 4 ? `${label}, and more` : label;
}

export function getDatabaseName(providerInfos: ProviderInfo[], ragEnvironment: RagEnvironment | undefined): string {
  const ragProvider = providerInfos.find(provider => provider.id === ragEnvironment?.ragConnection?.providerId);
  const ragConnection = ragProvider?.ragConnections.find(
    connection => connection.name === ragEnvironment?.ragConnection?.name,
  );
  return ragConnection?.name ? `${ragConnection.name} (${ragProvider?.name})` : 'N/A';
}

export function getChunkProviderName(
  providerInfos: ProviderInfo[],
  ragEnvironment: RagEnvironment | undefined,
): string {
  if (!ragEnvironment?.chunkerConnection) return 'N/A';
  const provider = providerInfos.find(p => p.id === ragEnvironment.chunkerConnection.providerId);
  const connection = provider?.chunkConnections.find(c => c.id === ragEnvironment.chunkerConnection.id);
  return connection ? `${connection.name} (${provider?.name})` : 'N/A';
}

export function getChunkProviderSupportedExtensions(
  providerInfos: ProviderInfo[],
  ragEnvironment: RagEnvironment | undefined,
): string[] | undefined {
  if (!ragEnvironment?.chunkerConnection) return undefined;

  const provider = providerInfos.find(p => p.id === ragEnvironment.chunkerConnection.providerId);
  const connection = provider?.chunkConnections.find(c => c.id === ragEnvironment.chunkerConnection.id);
  return connection?.supportedExtensions;
}
