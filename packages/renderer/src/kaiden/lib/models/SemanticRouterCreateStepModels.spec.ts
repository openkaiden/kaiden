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

import * as modelCatalogStore from '/@/kaiden/stores/model-catalog';
import * as modelsStore from '/@/kaiden/stores/models';
import type { CatalogModelInfo } from '/@api/model-registry-info';

import SemanticRouterCreateStepModels from './SemanticRouterCreateStepModels.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/kaiden/stores/model-catalog'));
vi.mock(import('/@/kaiden/stores/models'));

const mockCloudModels: CatalogModelInfo[] = [
  {
    providerId: 'claude',
    providerName: 'Anthropic',
    connectionId: 'conn-0',
    connectionName: 'Anthropic Cloud',
    type: 'cloud',
    llmMetadata: { name: 'anthropic' },
    label: 'claude-sonnet-4',
    connectionStatus: 'started',
  } as CatalogModelInfo,
  {
    providerId: 'gemini',
    providerName: 'Gemini',
    connectionId: 'conn-1',
    connectionName: 'Gemini Cloud',
    type: 'cloud',
    llmMetadata: { name: 'gemini' },
    label: 'gemini-2.5-pro',
    connectionStatus: 'started',
  } as CatalogModelInfo,
];

const mockLocalModel: CatalogModelInfo = {
  providerId: 'ollama',
  providerName: 'Ollama',
  connectionId: 'conn-2',
  connectionName: 'Ollama Local',
  type: 'local',
  llmMetadata: { name: 'ollama' },
  label: 'llama3.2:3b',
  connectionStatus: 'started',
} as CatalogModelInfo;

const mockSemanticRouterModel: CatalogModelInfo = {
  providerId: 'router-provider',
  providerName: 'Router',
  connectionId: 'conn-3',
  connectionName: 'Router Conn',
  type: 'cloud',
  llmMetadata: { name: 'router', semanticRouter: 'coding-router' },
  label: 'router-model',
  connectionStatus: 'started',
} as CatalogModelInfo;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([]);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set());
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

test('renders heading and description', () => {
  render(SemanticRouterCreateStepModels);

  expect(screen.getByText('Backend models')).toBeInTheDocument();
  expect(screen.getByText(/Select one or more models/)).toBeInTheDocument();
});

test('shows empty state when no models available', () => {
  render(SemanticRouterCreateStepModels);

  expect(screen.getByTestId('no-models')).toBeInTheDocument();
});

test('shows cloud models under Cloud category', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  expect(screen.getByText('Cloud · LLM providers')).toBeInTheDocument();
  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
});

test('shows local models under Local category', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([mockLocalModel]);

  render(SemanticRouterCreateStepModels);

  expect(screen.getByText('Local · Ollama & Ramalama')).toBeInTheDocument();
  expect(screen.getByText('llama3.2:3b')).toBeInTheDocument();
});

test('filters out models with llmMetadata.semanticRouter defined', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([...mockCloudModels, mockSemanticRouterModel]);

  render(SemanticRouterCreateStepModels);

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.getByText('gemini-2.5-pro')).toBeInTheDocument();
  expect(screen.queryByText('router-model')).not.toBeInTheDocument();
});

test('toggles model selection via checkbox', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  const checkbox = screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' });
  expect(checkbox).not.toBeChecked();

  await fireEvent.click(checkbox);

  expect(checkbox).toBeChecked();
  expect(screen.getByTestId('selected-count')).toHaveTextContent('1 model selected');
});

test('toggles model selection via row click', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  const row = screen.getByTestId('model-row-claude-sonnet-4');
  await fireEvent.click(row);

  const checkbox = screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' });
  expect(checkbox).toBeChecked();
});

test('allows selecting multiple models', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use gemini-2.5-pro' }));

  expect(screen.getByTestId('selected-count')).toHaveTextContent('2 models selected');
});

test('deselecting a model updates the count', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use gemini-2.5-pro' }));

  expect(screen.getByTestId('selected-count')).toHaveTextContent('2 models selected');

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));

  expect(screen.getByTestId('selected-count')).toHaveTextContent('1 model selected');
});

test('search filters model list', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  const searchInput = screen.getByPlaceholderText('Filter models…');
  await fireEvent.input(searchInput, { target: { value: 'sonnet' } });

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('gemini-2.5-pro')).not.toBeInTheDocument();
});

test('disabled models are hidden from selection list', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set(['gemini::gemini-2.5-pro']));

  render(SemanticRouterCreateStepModels);

  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument();
  expect(screen.queryByText('gemini-2.5-pro')).not.toBeInTheDocument();
});

test('Open Models catalog link is visible', () => {
  render(SemanticRouterCreateStepModels);

  expect(screen.getByText('Open Models catalog')).toBeInTheDocument();
});

test('no selected count shown when nothing selected', () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  expect(screen.queryByTestId('selected-count')).not.toBeInTheDocument();
});

test('shows Default column header once a model is selected', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  expect(screen.queryByText('Default')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));

  expect(screen.getByText('Default')).toBeInTheDocument();
});

test('default checkbox is disabled for unselected models', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));

  const defaultCheckbox = screen.getByRole('checkbox', { name: 'Set gemini-2.5-pro as default' });
  expect(defaultCheckbox).toBeDisabled();
});

test('first selected model is automatically the default', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));

  const defaultCheckbox = screen.getByRole('checkbox', { name: 'Set claude-sonnet-4 as default' });
  expect(defaultCheckbox).toBeChecked();
});

test('user can change default model via default checkbox', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

  render(SemanticRouterCreateStepModels);

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use gemini-2.5-pro' }));

  const geminiDefault = screen.getByRole('checkbox', { name: 'Set gemini-2.5-pro as default' });
  await fireEvent.click(geminiDefault);

  expect(geminiDefault).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Set claude-sonnet-4 as default' })).not.toBeChecked();
});

test('deselecting the default model promotes the next model', async () => {
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([...mockCloudModels, mockLocalModel]);

  render(SemanticRouterCreateStepModels);

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use gemini-2.5-pro' }));
  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use llama3.2:3b' }));

  expect(screen.getByRole('checkbox', { name: 'Set claude-sonnet-4 as default' })).toBeChecked();

  await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));

  const geminiDefault = screen.getByRole('checkbox', { name: 'Set gemini-2.5-pro as default' });
  expect(geminiDefault).toBeChecked();
});
