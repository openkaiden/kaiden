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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import * as inferenceConnectionSummariesStore from '/@/kaiden/stores/inference-connection-summaries';
import * as modelCatalogStore from '/@/kaiden/stores/model-catalog';
import * as modelsStore from '/@/kaiden/stores/models';
import * as configurationPropertiesStore from '/@/stores/configurationProperties';
import * as providersStore from '/@/stores/providers';
import type { AgentInfo } from '/@api/agent-info';
import type { CatalogModelInfo, InferenceConnectionSummary } from '/@api/model-registry-info';
import type { ProviderInfo } from '/@api/provider-info';

import CodingAgentDetail from './CodingAgentDetail.svelte';

vi.mock(import('/@/kaiden/stores/models'));
vi.mock(import('/@/kaiden/stores/model-catalog'));
vi.mock(import('/@/stores/providers'));
vi.mock(import('/@/kaiden/stores/inference-connection-summaries'));
vi.mock(import('/@/stores/configurationProperties'));

const mockAgentInfo: AgentInfo = {
  id: 'opencode',
  name: 'OpenCode',
  description: 'Open-source coding agent.',
  command: 'opencode',
  tags: ['Recommended', 'Cloud'],
  destinationSkillsFolder: '/home/test/.opencode/skills',
  supportedModelTypes: [{ name: 'anthropic' }, { name: 'ollama' }],
};

const mockAnthropicModel: CatalogModelInfo = {
  providerId: 'claude',
  providerName: 'Anthropic',
  connectionId: 'conn-0',
  connectionName: 'Anthropic Cloud',
  type: 'cloud',
  llmMetadata: { name: 'anthropic' },
  label: 'claude-sonnet-4',
  connectionStatus: 'started',
};

const mockOllamaModel: CatalogModelInfo = {
  providerId: 'ollama',
  providerName: 'Ollama',
  connectionId: 'conn-1',
  connectionName: 'Ollama Local',
  type: 'local',
  llmMetadata: { name: 'ollama' },
  label: 'llama3.2:3b',
  connectionStatus: 'started',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([]);
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([]);
  vi.mocked(inferenceConnectionSummariesStore).inferenceConnectionSummariesData = writable<
    Readonly<InferenceConnectionSummary[]>
  >([]);
  vi.mocked(configurationPropertiesStore).configurationProperties = writable([]);
  vi.mocked(modelCatalogStore.modelSelectionKey).mockImplementation(
    (providerId: string, connectionId: string, label: string): string => `${providerId}::${connectionId}::${label}`,
  );
  vi.mocked(window.getConfigurationValue).mockResolvedValue(undefined);
  vi.mocked(window.updateConfigurationValue).mockResolvedValue(undefined);
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
});

test('renders agent name and description', () => {
  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  expect(screen.getByText('OpenCode')).toBeInTheDocument();
  expect(screen.getByText('Open-source coding agent.')).toBeInTheDocument();
});

test('renders agent tags', () => {
  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  expect(screen.getByText('Recommended · Cloud')).toBeInTheDocument();
});

test('shows empty state when no models and no unconfigured connections', () => {
  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  expect(screen.getByTestId('no-providers-available')).toBeInTheDocument();
});

test('auto-selects single provider and shows form immediately', () => {
  vi.mocked(inferenceConnectionSummariesStore).inferenceConnectionSummariesData = writable<
    Readonly<InferenceConnectionSummary[]>
  >([
    {
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
    },
  ]);
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([
    {
      id: 'claude',
      name: 'Anthropic',
      internalId: 'claude-internal',
      status: 'not-started',
    } as unknown as ProviderInfo,
  ]);

  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  expect(screen.getByTestId('no-models-create-connection')).toBeInTheDocument();
  expect(screen.getByTestId('inline-connection-form')).toBeInTheDocument();
});

test('shows model selection table when compatible models exist', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([mockAnthropicModel, mockOllamaModel]);

  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
});

test('shows provider picker when multiple unconfigured connections', () => {
  vi.mocked(inferenceConnectionSummariesStore).inferenceConnectionSummariesData = writable<
    Readonly<InferenceConnectionSummary[]>
  >([
    {
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
    },
    {
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
    },
  ]);
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([
    {
      id: 'claude',
      name: 'Anthropic',
      internalId: 'claude-internal',
      status: 'not-started',
    } as unknown as ProviderInfo,
    { id: 'ollama', name: 'Ollama', internalId: 'ollama-internal', status: 'not-started' } as unknown as ProviderInfo,
  ]);

  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  expect(screen.getByTestId('provider-picker')).toBeInTheDocument();
  expect(screen.getByLabelText('Select Anthropic')).toBeInTheDocument();
  expect(screen.getByLabelText('Select Ollama')).toBeInTheDocument();
});

test('save button disabled when no changes', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([mockAnthropicModel]);

  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  const saveBtn = screen.getByRole('button', { name: 'Save' });
  expect(saveBtn).toBeDisabled();
});

test('selecting model enables save', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([mockAnthropicModel]);

  render(CodingAgentDetail, { props: { agentInfo: mockAgentInfo } });

  const radio = screen.getByRole('radio', { name: 'Use claude-sonnet-4' });
  await fireEvent.click(radio);

  const saveBtn = screen.getByRole('button', { name: 'Save' });
  expect(saveBtn).toBeEnabled();
});
