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
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import * as modelCatalogStore from '/@/kaiden/stores/model-catalog';
import * as modelsStore from '/@/kaiden/stores/models';
import { resetRouterDraft } from '/@/kaiden/stores/semantic-router-create-draft.svelte';

import SemanticRouterCreate from './SemanticRouterCreate.svelte';

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
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  resetRouterDraft();
  vi.mocked(window.createSemanticRouter).mockResolvedValue({
    name: 'test-router',
    listeners: [{ address: '0.0.0.0', port: 8899 }],
    routing: { keywords: [], decisions: [] },
  });
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

describe('basic setup step', () => {
  test('renders the form title', () => {
    render(SemanticRouterCreate);

    screen.getByText('Configure a Semantic Router');
  });

  test('renders all form fields', () => {
    render(SemanticRouterCreate);

    screen.getByLabelText('Router name');
    screen.getByLabelText('Description');
    screen.getByLabelText('Listener address');
    screen.getByLabelText('Listener port');
    screen.getByLabelText('Timeout');
  });

  test('next button is disabled when name is empty', () => {
    render(SemanticRouterCreate);

    const nextBtn = screen.getByRole('button', { name: 'Continue' });
    expect(nextBtn).toBeDisabled();
  });

  test('next button is enabled when name is provided', async () => {
    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    const nextBtn = screen.getByRole('button', { name: 'Continue' });
    expect(nextBtn).toBeEnabled();
  });
});

describe('model selection step', () => {
  test('advances to model selection step when clicking next', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText(/Select one or more models/)).toBeInTheDocument();
  });

  test('continue is disabled when no models are selected', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
  });

  test('continue is enabled when a model is selected', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));

    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeEnabled();
  });

  test('back button returns to basic setup step', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText(/Select one or more models/)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Router name')).toBeInTheDocument();
  });
});

describe('step navigation', () => {
  test('navigates to signals step from models step', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    screen.getByText('Signals');
    screen.getByText('Decisions');
  });

  test('shows Create button on last step', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    screen.getByRole('button', { name: 'Create' });
  });

  test('step counter updates as steps change', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    screen.getByText('Step 1 of 3');

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    screen.getByText('Step 2 of 3');

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    screen.getByText('Step 3 of 3');
  });

  test('back button is not shown on step 1', () => {
    render(SemanticRouterCreate);

    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });
});

describe('create flow', () => {
  test('calls createSemanticRouter with selected models on final step', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const createBtn = screen.getByRole('button', { name: 'Create' });
    await fireEvent.click(createBtn);
    await vi.advanceTimersToNextTimerAsync();

    expect(window.createSemanticRouter).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-router',
        listeners: expect.arrayContaining([expect.objectContaining({ port: 8899 })]),
        routing: expect.objectContaining({
          keywords: [],
          decisions: [
            {
              name: 'default',
              priority: 0,
              rules: [
                {
                  operator: 'OR',
                  conditions: [],
                  modelRefs: [
                    { providerId: 'claude', connectionId: 'conn-0', label: 'claude-sonnet-4', useReasoning: false },
                  ],
                },
              ],
            },
          ],
          defaultModelRef: {
            providerId: 'claude',
            connectionId: 'conn-0',
            label: 'claude-sonnet-4',
            useReasoning: false,
          },
        }),
      }),
    );
  });

  test('navigates to semantic routers page after creation', async () => {
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const createBtn = screen.getByRole('button', { name: 'Create' });
    await fireEvent.click(createBtn);
    await vi.advanceTimersToNextTimerAsync();

    const { handleNavigation } = await import('/@/navigation');
    await waitFor(() => {
      expect(handleNavigation).toHaveBeenCalledWith({ page: 'semantic-routers' });
    });
  });

  test('displays error when createSemanticRouter fails', async () => {
    vi.mocked(window.createSemanticRouter).mockRejectedValueOnce(new Error('duplicate name'));
    vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(mockCloudModels);

    render(SemanticRouterCreate);

    const nameInput = screen.getByLabelText('Router name');
    await fireEvent.input(nameInput, { target: { value: 'my-router' } });

    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Use claude-sonnet-4' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    const createBtn = screen.getByRole('button', { name: 'Create' });
    await fireEvent.click(createBtn);
    await vi.advanceTimersToNextTimerAsync();

    await waitFor(() => {
      screen.getByText('Error: duplicate name');
    });
  });

  test('navigates to semantic routers page on cancel', async () => {
    render(SemanticRouterCreate);

    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await fireEvent.click(cancelBtn);

    const { handleNavigation } = await import('/@/navigation');
    expect(handleNavigation).toHaveBeenCalledWith({ page: 'semantic-routers' });
  });
});

test('shows step counter', () => {
  render(SemanticRouterCreate);

  expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
});
