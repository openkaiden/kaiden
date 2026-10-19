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

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import * as agentsStore from '/@/kaiden/stores/agents';
import * as inferenceConnectionSummariesStore from '/@/kaiden/stores/inference-connection-summaries';
import * as modelCatalogStore from '/@/kaiden/stores/model-catalog';
import * as modelsStore from '/@/kaiden/stores/models';
import * as configurationPropertiesStore from '/@/stores/configurationProperties';
import * as providersStore from '/@/stores/providers';
import type { AgentInfo } from '/@api/agent-info';
import type { CatalogModelInfo, InferenceConnectionSummary } from '/@api/model-registry-info';
import type { ProviderInfo } from '/@api/provider-info';

import type { OnboardingState } from './guided-setup-steps';
import GuidedSetupPage from './GuidedSetupPage.svelte';

vi.mock(import('/@/kaiden/stores/agents'));
vi.mock(import('/@/stores/providers'));
vi.mock(import('/@/kaiden/stores/model-catalog'));
vi.mock(import('/@/kaiden/stores/models'));
vi.mock(import('/@/kaiden/stores/inference-connection-summaries'));
vi.mock(import('/@/stores/configurationProperties'));
vi.mock(import('/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte'));

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
    id: 'goose',
    name: 'Goose',
    description: 'Autonomous coding agent.',
    command: 'goose',
    destinationSkillsFolder: '/home/test/.agents/skills',
    supportedModelTypes: [{ name: 'ollama' }],
  },
];

const mockAnthropicProviderNoModels: ProviderInfo = {
  id: 'claude',
  name: 'Anthropic',
  internalId: 'claude-internal',
  status: 'started',
  inferenceConnections: [],
  inferenceProviderConnectionCreation: true,
  inferenceProviderConnectionCreationTypes: ['cloud'],
  inferenceProviderConnectionCreationLLMMetadata: { name: 'anthropic' },
  inferenceProviderConnectionCreationDisplayName: 'Anthropic',
} as unknown as ProviderInfo;

const mockOllamaProvider: ProviderInfo = {
  id: 'ollama',
  name: 'Ollama',
  internalId: 'ollama-internal',
  status: 'started',
  inferenceConnections: [
    {
      id: 'conn-0',
      name: 'Ollama Local',
      type: 'local',
      status: 'started',
      llmMetadata: { name: 'ollama' },
      models: [{ label: 'llama3.2:3b' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

let providerInfosWritable = writable<ProviderInfo[]>([]);
let catalogModelsWritable = writable<CatalogModelInfo[]>([]);
let connectionSummariesWritable = writable<InferenceConnectionSummary[]>([]);

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

function buildConnectionSummaries(providers: ProviderInfo[]): InferenceConnectionSummary[] {
  const result: InferenceConnectionSummary[] = [];
  for (const provider of providers) {
    if ((provider.inferenceConnections?.length ?? 0) > 0) {
      for (const connection of provider.inferenceConnections ?? []) {
        result.push({
          providerName: provider.name,
          providerId: provider.id,
          providerInternalId: provider.internalId,
          connectionId: connection.id,
          connectionType: connection.type,
          llmMetadata: connection.llmMetadata,
          status: connection.status,
          modelCount: connection.models.length,
          creationDisplayName: provider.inferenceProviderConnectionCreationDisplayName ?? provider.name,
          configurable: provider.inferenceProviderConnectionCreation ?? false,
        });
      }
      continue;
    }

    if (!(provider.inferenceProviderConnectionCreation ?? false)) continue;
    for (const connectionType of provider.inferenceProviderConnectionCreationTypes ?? ['cloud']) {
      result.push({
        providerName: provider.name,
        providerId: provider.id,
        providerInternalId: provider.internalId,
        connectionId: '',
        connectionType,
        llmMetadata: provider.inferenceProviderConnectionCreationLLMMetadata,
        status: 'not-configured',
        modelCount: 0,
        creationDisplayName: provider.inferenceProviderConnectionCreationDisplayName ?? provider.name,
        configurable: true,
      });
    }
  }
  return result;
}

function setProviders(providers: ProviderInfo[]): void {
  providerInfosWritable.set(providers);
  catalogModelsWritable.set(buildCatalogModels(providers));
  connectionSummariesWritable.set(buildConnectionSummaries(providers));
}

function renderPage(onboarding: OnboardingState): void {
  render(GuidedSetupPage, {
    stepId: 'guided-setup',
    title: 'Choose your coding agent',
    description: 'Pick your agent and model.',
    onboarding,
  });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  providerInfosWritable = writable([]);
  catalogModelsWritable = writable([]);
  connectionSummariesWritable = writable([]);
  vi.mocked(agentsStore).agentInfos = writable(mockAgentInfos);
  vi.mocked(configurationPropertiesStore).configurationProperties = writable([]);
  vi.mocked(modelCatalogStore).disabledModels = writable(new Set<string>());
  vi.mocked(providersStore).providerInfos = providerInfosWritable;
  vi.mocked(modelsStore).catalogModels = catalogModelsWritable;
  vi.mocked(inferenceConnectionSummariesStore).inferenceConnectionSummariesData = connectionSummariesWritable;
  vi.mocked(modelCatalogStore.isModelEnabled).mockImplementation(
    (disabled: Set<string>, providerId: string, label: string): boolean => !disabled.has(`${providerId}::${label}`),
  );
  vi.mocked(modelCatalogStore.modelSelectionKey).mockImplementation(
    (providerId: string, connectionId: string, label: string): string => `${providerId}::${connectionId}::${label}`,
  );
  setProviders([]);
});

test('shows inline connection creation when the selected agent has no compatible models', async () => {
  setProviders([mockAnthropicProviderNoModels]);

  const onboarding: OnboardingState = {
    agent: 'claude',
    workspaceSetting: {},
  };

  renderPage(onboarding);

  await waitFor(() => {
    expect(screen.getByTestId('no-models-create-connection')).toBeInTheDocument();
    expect(screen.getByTestId('inline-connection-form')).toBeInTheDocument();
  });
});

test('auto-selects the first compatible model for the default agent', async () => {
  setProviders([mockOllamaProvider]);

  const onboarding: OnboardingState = {
    agent: 'opencode',
    workspaceSetting: {},
  };

  renderPage(onboarding);

  await waitFor(() => {
    expect(onboarding.model).toEqual({
      providerId: 'ollama',
      connectionId: 'conn-0',
      label: 'llama3.2:3b',
    });
  });
});

test('keeps the validation error visible when no compatible model exists', async () => {
  setProviders([mockAnthropicProviderNoModels]);

  const onboarding: OnboardingState = {
    agent: 'claude',
    workspaceSetting: {},
  };

  renderPage(onboarding);

  await waitFor(() => {
    expect(onboarding.beforeAdvance).toBeDefined();
  });

  await expect(onboarding.beforeAdvance?.()).resolves.toBe(false);

  expect(
    screen.getByText('Create or select a compatible model for Claude Code before continuing.'),
  ).toBeInTheDocument();
});

test('clears the validation error after auto-recovering a compatible model', async () => {
  const onboarding: OnboardingState = {
    agent: 'opencode',
    workspaceSetting: {},
  };

  renderPage(onboarding);

  await waitFor(() => {
    expect(onboarding.beforeAdvance).toBeDefined();
  });

  await expect(onboarding.beforeAdvance?.()).resolves.toBe(false);

  expect(screen.getByText('Create or select a compatible model for OpenCode before continuing.')).toBeInTheDocument();

  setProviders([mockOllamaProvider]);

  await waitFor(() => {
    expect(onboarding.model).toEqual({
      providerId: 'ollama',
      connectionId: 'conn-0',
      label: 'llama3.2:3b',
    });
    expect(
      screen.queryByText('Create or select a compatible model for OpenCode before continuing.'),
    ).not.toBeInTheDocument();
  });
});

test('switching agents updates the onboarding selection and blocks continue until a model exists', async () => {
  setProviders([mockAnthropicProviderNoModels]);

  const onboarding: OnboardingState = {
    agent: 'opencode',
    workspaceSetting: {},
  };

  renderPage(onboarding);
  await fireEvent.click(screen.getByRole('option', { name: 'Claude Code' }));

  await waitFor(() => {
    expect(onboarding.agent).toBe('claude');
    expect(onboarding.model).toBeUndefined();
  });

  await expect(onboarding.beforeAdvance?.()).resolves.toBe(false);
});

test('renders agent selection above the model section inside a compact step card', async () => {
  setProviders([mockOllamaProvider]);
  const onboarding: OnboardingState = { agent: 'opencode', workspaceSetting: {} };

  renderPage(onboarding);

  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Choose your coding agent' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Default model' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'OpenCode' })).toBeInTheDocument();
  });
});

test('renders all shared-store agents', async () => {
  const onboarding: OnboardingState = {
    agent: 'opencode',
    workspaceSetting: {},
  };

  renderPage(onboarding);

  await waitFor(() => {
    expect(screen.getByRole('option', { name: 'OpenCode' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude Code' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Goose' })).toBeInTheDocument();
  });
});

test('allows selecting an agent that exists in the shared agent store', async () => {
  vi.mocked(agentsStore).agentInfos = writable([
    ...mockAgentInfos,
    {
      id: 'custom-agent',
      name: 'Custom Agent',
      description: 'Custom agent from the shared store.',
      command: 'custom-agent',
      destinationSkillsFolder: '/home/test/.custom-agent/skills',
      supportedModelTypes: [{ name: 'anthropic' }],
    },
  ]);

  const onboarding: OnboardingState = {
    agent: 'opencode',
    workspaceSetting: {},
  };

  renderPage(onboarding);
  await fireEvent.click(screen.getByRole('option', { name: 'Custom Agent' }));

  await waitFor(() => {
    expect(onboarding.agent).toBe('custom-agent');
  });
});
