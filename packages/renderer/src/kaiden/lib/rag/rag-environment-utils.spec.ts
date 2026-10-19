/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { expect, test } from 'vitest';

import type { ProviderInfo } from '/@api/provider-info';
import type { RagEnvironment } from '/@api/rag/rag-environment';

import {
  buildDialogFilters,
  type ChunkProviderFileFilterSource,
  formatSupportedExtensionsLabel,
  getChunkProviderName,
  getChunkProviderSupportedExtensions,
  getDatabaseName,
} from './rag-environment-utils';

function createMockChunkProviderConnection(
  overrides: ChunkProviderFileFilterSource = {},
): ChunkProviderFileFilterSource {
  return { ...overrides };
}

const mockProviderInfos = [
  {
    id: 'chroma-1',
    name: 'ChromaDB',
    ragConnections: [
      { name: 'chroma-connection', id: 'conn-1' },
      { name: 'another-connection', id: 'conn-2' },
    ],
    chunkConnections: [
      { id: 'chunker-1', name: 'Docling Chunker', supportedExtensions: ['pdf', 'txt', 'md'] },
      { id: 'chunker-2', name: 'Simple Chunker' },
    ],
  },
  {
    id: 'milvus-1',
    name: 'Milvus',
    ragConnections: [{ name: 'milvus-connection', id: 'conn-3' }],
    chunkConnections: [{ id: 'chunker-3', name: 'Milvus Chunker' }],
  },
] as unknown as ProviderInfo[];

// --- getDatabaseName tests ---

test('getDatabaseName returns formatted name when ragEnvironment has valid ragConnection', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  const result = getDatabaseName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('chroma-connection (ChromaDB)');
});

test('getDatabaseName returns N/A when ragEnvironment is undefined', () => {
  const result = getDatabaseName(mockProviderInfos, undefined);

  expect(result).toBe('N/A');
});

test('getDatabaseName returns N/A when ragEnvironment.ragConnection is undefined', () => {
  const ragEnvironment = {
    name: 'test-env',
    ragConnection: undefined,
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  } as unknown as RagEnvironment;

  const result = getDatabaseName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('N/A');
});

test('getDatabaseName returns N/A when provider is not found', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'unknown-connection', providerId: 'unknown-provider' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  const result = getDatabaseName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('N/A');
});

test('getDatabaseName returns N/A when connection name does not match', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'non-existent-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  const result = getDatabaseName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('N/A');
});

test('getDatabaseName works with second provider in list', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'milvus-connection', providerId: 'milvus-1' },
    chunkerConnection: { id: 'chunker-3', providerId: 'milvus-1' },
    files: [],
  };

  const result = getDatabaseName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('milvus-connection (Milvus)');
});

test('getDatabaseName returns N/A when providerInfos is empty', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  const result = getDatabaseName([], ragEnvironment);

  expect(result).toBe('N/A');
});

// --- getChunkProviderName tests ---

test('getChunkProviderName returns formatted name when ragEnvironment has valid chunkerConnection', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  const result = getChunkProviderName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('Docling Chunker (ChromaDB)');
});

test('getChunkProviderName returns N/A when ragEnvironment is undefined', () => {
  const result = getChunkProviderName(mockProviderInfos, undefined);

  expect(result).toBe('N/A');
});

test('getChunkProviderName returns N/A when ragEnvironment.chunkerConnection is undefined', () => {
  const ragEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: undefined,
    files: [],
  } as unknown as RagEnvironment;

  const result = getChunkProviderName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('N/A');
});

test('getChunkProviderName returns N/A when provider is not found', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'unknown-provider' },
    files: [],
  };

  const result = getChunkProviderName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('N/A');
});

test('getChunkProviderName returns N/A when chunker connection id does not match', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'non-existent-chunker', providerId: 'chroma-1' },
    files: [],
  };

  const result = getChunkProviderName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('N/A');
});

test('getChunkProviderName works with second chunker in provider', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-2', providerId: 'chroma-1' },
    files: [],
  };

  const result = getChunkProviderName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('Simple Chunker (ChromaDB)');
});

test('getChunkProviderName works with different provider', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'milvus-connection', providerId: 'milvus-1' },
    chunkerConnection: { id: 'chunker-3', providerId: 'milvus-1' },
    files: [],
  };

  const result = getChunkProviderName(mockProviderInfos, ragEnvironment);

  expect(result).toBe('Milvus Chunker (Milvus)');
});

test('getChunkProviderName returns N/A when providerInfos is empty', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  const result = getChunkProviderName([], ragEnvironment);

  expect(result).toBe('N/A');
});

// --- Edge case: both connections undefined ---

test('getDatabaseName and getChunkProviderName both return N/A when both connections are undefined', () => {
  const ragEnvironment = {
    name: 'test-env',
    ragConnection: undefined,
    chunkerConnection: undefined,
    files: [],
  } as unknown as RagEnvironment;

  expect(getDatabaseName(mockProviderInfos, ragEnvironment)).toBe('N/A');
  expect(getChunkProviderName(mockProviderInfos, ragEnvironment)).toBe('N/A');
});

// --- getChunkProviderSupportedExtensions tests ---

test('getChunkProviderSupportedExtensions returns supportedExtensions from chunk connection', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
    files: [],
  };

  expect(getChunkProviderSupportedExtensions(mockProviderInfos, ragEnvironment)).toEqual(['pdf', 'txt', 'md']);
});

test('getChunkProviderSupportedExtensions returns undefined when chunker has no supportedExtensions', () => {
  const ragEnvironment: RagEnvironment = {
    name: 'test-env',
    ragConnection: { name: 'chroma-connection', providerId: 'chroma-1' },
    chunkerConnection: { id: 'chunker-2', providerId: 'chroma-1' },
    files: [],
  };

  expect(getChunkProviderSupportedExtensions(mockProviderInfos, ragEnvironment)).toBeUndefined();
});

// --- buildDialogFilters tests ---

test('file picker filters are derived from chunker supportedExtensions', () => {
  const connection = createMockChunkProviderConnection({
    supportedExtensions: ['pdf', 'docx', 'csv'],
  });
  const filters = buildDialogFilters(connection);
  const extensions = filters.flatMap(filter => filter.extensions);
  expect(extensions).toContain('pdf');
  expect(extensions).toContain('docx');
  expect(extensions).not.toContain('txt');
});

test('falls back gracefully when supportedExtensions is undefined', () => {
  const connection = createMockChunkProviderConnection({});
  const filters = buildDialogFilters(connection);
  expect(filters.length).toBeGreaterThan(0);
  expect(filters[0]).toEqual({ name: 'All Files', extensions: ['*'] });
});

test('buildDialogFilters returns sorted unique extensions', () => {
  expect(buildDialogFilters({ supportedExtensions: ['PDF', 'txt', 'pdf', 'md'] })).toEqual([
    { name: 'Supported documents', extensions: ['md', 'pdf', 'txt'] },
  ]);
});

// --- formatSupportedExtensionsLabel tests ---

test('formatSupportedExtensionsLabel truncates long extension lists', () => {
  expect(formatSupportedExtensionsLabel(['pdf', 'txt', 'md', 'markdown', 'html'])).toBe(
    'PDF, TXT, MD, MARKDOWN, and more',
  );
});

test('formatSupportedExtensionsLabel returns All file types for empty list', () => {
  expect(formatSupportedExtensionsLabel([])).toBe('All file types');
});
