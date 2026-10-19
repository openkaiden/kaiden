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
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import * as agentsStore from '/@/kaiden/stores/agents';
import * as inferenceConnectionSummariesStore from '/@/kaiden/stores/inference-connection-summaries';
import * as modelCatalogStore from '/@/kaiden/stores/model-catalog';
import * as modelsStore from '/@/kaiden/stores/models';
import * as configurationPropertiesStore from '/@/stores/configurationProperties';
import * as providersStore from '/@/stores/providers';
import type { AgentInfo } from '/@api/agent-info';
import type { CatalogModelInfo, InferenceConnectionSummary } from '/@api/model-registry-info';
import type { ProviderInfo } from '/@api/provider-info';

import AgentWorkspaceCreateStepAgentModel from './AgentWorkspaceCreateStepAgentModel.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/kaiden/stores/agents'));
vi.mock(import('/@/stores/providers'));
vi.mock(import('/@/kaiden/stores/model-catalog'));
vi.mock(import('/@/kaiden/stores/models'));
vi.mock(import('/@/kaiden/stores/inference-connection-summaries'));
vi.mock(import('/@/stores/configurationProperties'));

function buildCatalogModels(providers: ProviderInfo[]): CatalogModelInfo[] {
  const result: CatalogModelInfo[] = [];
  for (const provider of providers) {
    for (const connection of provider.inferenceConnections ?? []) {
      for (const model of connection.models) {
        result.push({
          providerId: provider.id,
          providerName: provider.name,
          connectionId: connection.id,
          connectionName: connection.name,
          type: connection.type,
          llmMetadata: connection.llmMetadata,
          endpoint: connection.endpoint,
          label: model.label,
          connectionStatus: connection.status,
        } as CatalogModelInfo);
      }
    }
  }
  return result;
}

function setProviders(providers: ProviderInfo[]): void {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>(providers);
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(buildCatalogModels(providers));
}
const mockAgentInfos: AgentInfo[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'Open-source agent.',
    command: 'opencode',
    tags: ['Recommended'],
    destinationSkillsFolder: '/home/test/.opencode/skills',
    supportedModelTypes: [{ name: 'anthropic' }, { name: 'openai' }, { name: 'ollama' }, { name: 'gemini' }],
  },
  {
    id: 'claude',
    name: 'Claude Code',
    description: 'Anthropic Claude.',
    command: 'claude',
    tags: ['Cloud'],
    destinationSkillsFolder: '/home/test/.claude/skills',
    supportedModelTypes: [{ name: 'anthropic' }],
  },
  {
    id: 'claude-vertex',
    name: 'Claude on Vertex AI',
    description: 'Claude via Vertex AI.',
    command: 'claude',
    destinationSkillsFolder: '/home/test/.claude/skills',
    supportedModelTypes: [{ name: 'vertexai' }],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    description: 'AI code editor.',
    command: 'cursor',
    destinationSkillsFolder: '/home/test/.cursor/skills',
    supportedModelTypes: [{ name: 'anthropic' }, { name: 'openai' }, { name: 'ollama' }, { name: 'gemini' }],
  },
  {
    id: 'goose',
    name: 'Goose',
    description: 'Autonomous coding agent.',
    command: 'goose',
    destinationSkillsFolder: '/home/test/.agents/skills',
    supportedModelTypes: [{ name: 'anthropic' }, { name: 'openai' }, { name: 'ollama' }, { name: 'gemini' }],
  },
];

const mockAnthropicProvider: ProviderInfo = {
  id: 'claude',
  name: 'Anthropic',
  internalId: 'claude-internal',
  status: 'started',
  inferenceConnections: [
    {
      id: 'conn-0',
      name: 'Anthropic Cloud',
      type: 'cloud',
      status: 'started',
      llmMetadata: { name: 'anthropic' },
      models: [{ label: 'claude-sonnet-4' }, { label: 'claude-opus-4' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

const mockVertexProvider: ProviderInfo = {
  id: 'vertex-ai',
  name: 'Vertex AI',
  internalId: 'vertex-ai-internal',
  status: 'started',
  inferenceConnections: [
    {
      id: 'conn-1',
      name: 'Vertex AI',
      type: 'cloud',
      status: 'started',
      llmMetadata: { name: 'vertexai' },
      models: [{ label: 'claude-sonnet-4' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

const mockOllamaProvider: ProviderInfo = {
  id: 'ollama',
  name: 'Ollama',
  internalId: 'ollama-internal',
  status: 'started',
  inferenceConnections: [
    {
      id: 'conn-2',
      name: 'Ollama Local',
      type: 'local',
      status: 'started',
      llmMetadata: { name: 'ollama' },
      models: [{ label: 'llama3.2:3b' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  vi.mocked(agentsStore).agentInfos = writable<AgentInfo[]>(mockAgentInfos);
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([]);
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([]);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set());
  vi.mocked(inferenceConnectionSummariesStore).inferenceConnectionSummariesData = writable<
    Readonly<InferenceConnectionSummary[]>
  >([]);
  vi.mocked(configurationPropertiesStore).configurationProperties = writable([]);
  vi.mocked(modelCatalogStore.isModelEnabled).mockImplementation(
    (disabled: Set<string>, providerId: string, label: string): boolean => !disabled.has(`${providerId}::${label}`),
  );
  vi.mocked(modelCatalogStore.modelKey).mockImplementation(
    (providerId: string, label: string): string => `${providerId}::${label}`,
  );
  vi.mocked(modelCatalogStore.modelSelectionKey).mockImplementation(
    (providerId: string, connectionId: string, label: string): string => `${providerId}::${connectionId}::${label}`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('renders all agent tiles from registry', () => {
  render(AgentWorkspaceCreateStepAgentModel);

  expect(screen.getByText('OpenCode')).toBeInTheDocument();
  expect(screen.getByText('Claude Code')).toBeInTheDocument();
  expect(screen.getByText('Claude on Vertex AI')).toBeInTheDocument();
  expect(screen.getByText('Cursor')).toBeInTheDocument();
  expect(screen.getByText('Goose')).toBeInTheDocument();
});

test('OpenCode tile has Recommended badge', () => {
  render(AgentWorkspaceCreateStepAgentModel);

  expect(screen.getByText('Recommended')).toBeInTheDocument();
});

test('model catalog hidden when no agent selected', () => {
  render(AgentWorkspaceCreateStepAgentModel);

  expect(screen.queryByText('Model for workspace')).not.toBeInTheDocument();
});

test('model catalog shown after agent selection', async () => {
  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByText('Model for workspace')).toBeInTheDocument();
});

test('shows empty state when no providers configured', async () => {
  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByTestId('no-providers-available')).toBeInTheDocument();
});

test('shows cloud models under Cloud category', async () => {
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByText('Cloud · LLM providers')).toBeInTheDocument();
  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.getByText('claude-opus-4')).toBeInTheDocument();
});

test('shows local models under Local category', async () => {
  setProviders([mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByText('Local · Ollama & Ramalama')).toBeInTheDocument();
  expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
});

test('Claude agent filters to Anthropic models only', async () => {
  setProviders([mockAnthropicProvider, mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('Claude Code'));

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('llama3.2:3b')).not.toBeInTheDocument();
});

test('search filters model list', async () => {
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  const searchInput = screen.getByPlaceholderText('Filter models…');
  await fireEvent.input(searchInput, { target: { value: 'sonnet' } });

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('claude-opus-4')).not.toBeInTheDocument();
});

test('switching agent keeps model if still compatible', async () => {
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel, {
    selectedAgent: 'opencode',
    selectedModel: {
      providerId: 'claude',
      connectionId: 'conn-0',
      connectionName: 'Anthropic Cloud',
      type: 'cloud',
      label: 'claude-opus-4',
    },
  });

  const initiallySelected = screen.getByRole('radio', { name: 'Use claude-opus-4' });
  screen.debug(undefined, 16384);
  expect(initiallySelected).toBeChecked();

  // Switching to Claude Code — claude-opus-4 is Anthropic, still compatible
  await fireEvent.click(screen.getByText('Claude Code'));

  expect(screen.getByRole('radio', { name: 'Use claude-opus-4' })).toBeChecked();
});

test('auto-selects first model when no model pre-selected', async () => {
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel, {
    selectedAgent: 'opencode',
    selectedModel: undefined,
  });

  const firstRadio = screen.getByRole('radio', { name: 'Use claude-sonnet-4' });
  expect(firstRadio).toBeChecked();
});

test('auto-selects first model when agent filters remove current selection', async () => {
  setProviders([mockAnthropicProvider, mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel, {
    selectedAgent: 'opencode',
    selectedModel: {
      providerId: 'ollama',
      connectionId: 'conn-2',
      connectionName: 'Ollama',
      type: 'local',
      label: 'llama3.2:3b',
    },
  });

  // Switching to Claude filters out Ollama models, should auto-select first Anthropic model
  await fireEvent.click(screen.getByText('Claude Code'));

  const firstRadio = screen.getByRole('radio', { name: 'Use claude-sonnet-4' });
  expect(firstRadio).toBeChecked();
});

test('disabled models are hidden from selection list', async () => {
  setProviders([mockAnthropicProvider]);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set(['claude::claude-opus-4']));

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('claude-opus-4')).not.toBeInTheDocument();
});

test('Open Models catalog link visible when agent selected', async () => {
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByText('Open Models catalog')).toBeInTheDocument();
});

test('OpenCode excludes Vertex AI models', async () => {
  setProviders([mockAnthropicProvider, mockVertexProvider, mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('OpenCode'));

  expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
  expect(screen.getByText('claude-opus-4')).toBeInTheDocument();
  // Vertex AI claude-sonnet-4 excluded, only Anthropic claude-sonnet-4 shown
  expect(screen.getAllByText('claude-sonnet-4')).toHaveLength(1);
  // No Vertex AI provider column
  const providerCells = screen.getAllByText('Anthropic');
  expect(providerCells.length).toBeGreaterThan(0);
  expect(screen.queryAllByText('Vertex AI').filter(el => el.tagName === 'TD')).toHaveLength(0);
});

test('Claude on Vertex AI shows only Vertex AI models', async () => {
  setProviders([mockAnthropicProvider, mockVertexProvider, mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByText('Claude on Vertex AI'));

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('llama3.2:3b')).not.toBeInTheDocument();
  expect(screen.queryByText('claude-opus-4')).not.toBeInTheDocument();
});

test('recommended agent is sorted first regardless of other tags', () => {
  const agents: AgentInfo[] = [
    {
      id: 'cloud',
      name: 'Cloud Agent',
      description: 'Cloud tag.',
      command: 'cloud',
      tags: ['Cloud'],
      destinationSkillsFolder: '/home/test/.cloud/skills',
    },
    {
      id: 'no-tag',
      name: 'No Tag Agent',
      description: 'No tags.',
      command: 'no-tag',
      destinationSkillsFolder: '/home/test/.no-tag/skills',
    },
    {
      id: 'recommended',
      name: 'Recommended Agent',
      description: 'Recommended.',
      command: 'recommended',
      tags: ['Recommended'],
      destinationSkillsFolder: '/home/test/.recommended/skills',
    },
  ];
  vi.mocked(agentsStore).agentInfos = writable<AgentInfo[]>(agents);

  render(AgentWorkspaceCreateStepAgentModel);

  const options = screen.getAllByRole('option');
  expect(options[0]).toHaveTextContent('Recommended Agent');
  expect(options[1]).toHaveTextContent('Cloud Agent');
  expect(options[2]).toHaveTextContent('No Tag Agent');
});
