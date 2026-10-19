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

import { describe, expect, test } from 'vitest';

import type { CatalogModelInfo, InferenceConnectionSummary } from '/@api/model-registry-info';

import { getCompatibleModels, getCompatibleUnconfiguredConnections } from './compatible-connections';

const anthropicSummary: InferenceConnectionSummary = {
  providerName: 'Anthropic',
  providerId: 'claude',
  providerInternalId: 'claude-internal',
  connectionId: '',
  connectionType: 'cloud',
  llmMetadata: { name: 'anthropic' },
  status: 'not-configured',
  modelCount: 0,
  creationDisplayName: 'Create Anthropic connection',
  configurable: true,
};

const ollamaSummary: InferenceConnectionSummary = {
  providerName: 'Ollama',
  providerId: 'ollama',
  providerInternalId: 'ollama-internal',
  connectionId: '',
  connectionType: 'local',
  llmMetadata: { name: 'ollama' },
  status: 'not-configured',
  modelCount: 0,
  creationDisplayName: 'Create Ollama connection',
  configurable: true,
};

const connectedSummary: InferenceConnectionSummary = {
  providerName: 'OpenAI',
  providerId: 'openai',
  providerInternalId: 'openai-internal',
  connectionId: 'conn-1',
  connectionType: 'cloud',
  llmMetadata: { name: 'openai' },
  status: 'started',
  modelCount: 3,
  creationDisplayName: 'Create OpenAI connection',
  configurable: true,
};

const nonConfigurableSummary: InferenceConnectionSummary = {
  providerName: 'Custom',
  providerId: 'custom',
  providerInternalId: 'custom-internal',
  connectionId: '',
  connectionType: 'cloud',
  llmMetadata: { name: 'anthropic' },
  status: 'not-configured',
  modelCount: 0,
  creationDisplayName: '',
  configurable: false,
};

describe('getCompatibleUnconfiguredConnections', () => {
  test('returns empty when supportedModelTypes is undefined', () => {
    const result = getCompatibleUnconfiguredConnections([anthropicSummary, ollamaSummary], undefined);
    expect(result).toEqual([]);
  });

  test('returns empty when supportedModelTypes is empty', () => {
    const result = getCompatibleUnconfiguredConnections([anthropicSummary, ollamaSummary], []);
    expect(result).toEqual([]);
  });

  test('filters to matching unconfigured connections', () => {
    const result = getCompatibleUnconfiguredConnections(
      [anthropicSummary, ollamaSummary, connectedSummary],
      [{ name: 'anthropic' }],
    );
    expect(result).toEqual([anthropicSummary]);
  });

  test('excludes already connected providers', () => {
    const result = getCompatibleUnconfiguredConnections([connectedSummary], [{ name: 'openai' }]);
    expect(result).toEqual([]);
  });

  test('excludes non-configurable providers', () => {
    const result = getCompatibleUnconfiguredConnections([nonConfigurableSummary], [{ name: 'anthropic' }]);
    expect(result).toEqual([]);
  });

  test('returns multiple matching connections', () => {
    const result = getCompatibleUnconfiguredConnections(
      [anthropicSummary, ollamaSummary],
      [{ name: 'anthropic' }, { name: 'ollama' }],
    );
    expect(result).toEqual([anthropicSummary, ollamaSummary]);
  });

  test('excludes connections with undefined llmMetadata', () => {
    const noMetadata: InferenceConnectionSummary = {
      ...anthropicSummary,
      llmMetadata: undefined,
    };
    const result = getCompatibleUnconfiguredConnections([noMetadata], [{ name: 'anthropic' }]);
    expect(result).toEqual([]);
  });
});

describe('getCompatibleModels', () => {
  const anthropicModel: CatalogModelInfo = {
    providerId: 'claude',
    providerName: 'Anthropic',
    connectionId: 'conn-0',
    connectionName: 'Anthropic Cloud',
    type: 'cloud',
    llmMetadata: { name: 'anthropic' },
    label: 'claude-sonnet-4',
    connectionStatus: 'started',
  };

  const ollamaModel: CatalogModelInfo = {
    providerId: 'ollama',
    providerName: 'Ollama',
    connectionId: 'conn-1',
    connectionName: 'Ollama Local',
    type: 'local',
    llmMetadata: { name: 'ollama' },
    label: 'llama3.2:3b',
    connectionStatus: 'started',
  };

  test('returns all models when supportedModelTypes is undefined', () => {
    const result = getCompatibleModels([anthropicModel, ollamaModel], undefined);
    expect(result).toEqual([anthropicModel, ollamaModel]);
  });

  test('returns empty when supportedModelTypes is empty', () => {
    const result = getCompatibleModels([anthropicModel, ollamaModel], []);
    expect(result).toEqual([]);
  });

  test('filters to matching models', () => {
    const result = getCompatibleModels([anthropicModel, ollamaModel], [{ name: 'anthropic' }]);
    expect(result).toEqual([anthropicModel]);
  });

  test('excludes models with undefined llmMetadata', () => {
    const noMetadata = { ...anthropicModel, llmMetadata: undefined };
    const result = getCompatibleModels([noMetadata], [{ name: 'anthropic' }]);
    expect(result).toEqual([]);
  });
});
