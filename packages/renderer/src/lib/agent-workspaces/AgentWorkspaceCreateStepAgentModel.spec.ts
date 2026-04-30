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

import * as modelCatalogStore from '/@/stores/model-catalog';
import * as providersStore from '/@/stores/providers';
import type { ProviderInfo } from '/@api/provider-info';

import AgentWorkspaceCreateStepAgentModel from './AgentWorkspaceCreateStepAgentModel.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/stores/providers'));
vi.mock(import('/@/stores/model-catalog'));

const mockAnthropicProvider: ProviderInfo = {
  id: 'claude',
  name: 'Anthropic',
  internalId: 'claude-internal',
  status: 'started',
  inferenceConnections: [
    {
      name: 'Anthropic Cloud',
      type: 'cloud',
      status: 'started',
      models: [{ label: 'claude-sonnet-4' }, { label: 'claude-opus-4' }],
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
      name: 'Ollama Local',
      type: 'local',
      status: 'started',
      models: [{ label: 'llama3.2:3b' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([]);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set());
  vi.mocked(modelCatalogStore.isModelEnabled).mockImplementation(
    (disabled: Set<string>, providerId: string, label: string): boolean => !disabled.has(`${providerId}::${label}`),
  );
  vi.mocked(modelCatalogStore.modelKey).mockImplementation(
    (providerId: string, label: string): string => `${providerId}::${label}`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

test('renders all four agent tiles', () => {
  render(AgentWorkspaceCreateStepAgentModel);

  expect(screen.getByRole('option', { name: /OpenCode/i })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Claude/i })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Cursor/i })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /Goose/i })).toBeInTheDocument();
});

test('OpenCode tile has Recommended badge', () => {
  render(AgentWorkspaceCreateStepAgentModel);

  expect(screen.getByText('Recommended')).toBeInTheDocument();
});

test('model catalog hidden when no agent selected', () => {
  render(AgentWorkspaceCreateStepAgentModel);

  expect(screen.queryByText('Model for this workspace')).not.toBeInTheDocument();
});

test('model catalog shown after agent selection', async () => {
  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  expect(screen.getByText('Model for this workspace')).toBeInTheDocument();
});

test('shows empty state when no providers configured', async () => {
  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  expect(screen.getByText(/No model sources match/i)).toBeInTheDocument();
});

test('shows cloud models under Cloud category', async () => {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  expect(screen.getByText('Cloud · LLM providers')).toBeInTheDocument();
  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.getByText('claude-opus-4')).toBeInTheDocument();
});

test('shows local models under Local category', async () => {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  expect(screen.getByText('Local · Ollama & Ramalama')).toBeInTheDocument();
  expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
});

test('Claude agent filters to Anthropic models only', async () => {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([mockAnthropicProvider, mockOllamaProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /Claude/i }));

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('llama3.2:3b')).not.toBeInTheDocument();
});

test('search filters model list', async () => {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  const searchInput = screen.getByPlaceholderText('Filter models…');
  await fireEvent.input(searchInput, { target: { value: 'sonnet' } });

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('claude-opus-4')).not.toBeInTheDocument();
});

test('selecting agent clears model selection', async () => {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([mockAnthropicProvider]);

  render(AgentWorkspaceCreateStepAgentModel, {
    selectedAgent: 'opencode',
    selectedModel: 'claude::claude-sonnet-4',
  });

  const initiallySelected = screen.getByRole('radio', { name: 'Use claude-sonnet-4' });
  expect(initiallySelected).toBeChecked();

  // Switching agent resets model selection — all radios unchecked
  await fireEvent.click(screen.getByRole('option', { name: /Claude/i }));

  const radios = screen.queryAllByRole('radio');
  for (const r of radios) {
    expect(r).not.toBeChecked();
  }
});

test('disabled models are hidden from selection list', async () => {
  vi.mocked(providersStore).providerInfos = writable<ProviderInfo[]>([mockAnthropicProvider]);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set(['claude::claude-opus-4']));

  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('claude-opus-4')).not.toBeInTheDocument();
});

test('Open Models catalog link visible when agent selected', async () => {
  render(AgentWorkspaceCreateStepAgentModel);

  await fireEvent.click(screen.getByRole('option', { name: /OpenCode/i }));

  expect(screen.getByText('Open Models catalog')).toBeInTheDocument();
});
