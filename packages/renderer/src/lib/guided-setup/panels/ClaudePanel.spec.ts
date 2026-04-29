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

import { faClaude } from '@fortawesome/free-brands-svg-icons';
import { render, screen } from '@testing-library/svelte';
import type { Writable } from 'svelte/store';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { fetchProviders, providerInfos } from '/@/stores/providers';
import type { ProviderInfo } from '/@api/provider-info';

import type { AgentDefinition } from '../agent-registry';
import type { OnboardingState } from '../guided-setup-steps';
import ClaudePanel from './ClaudePanel.svelte';

vi.mock(import('/@/stores/providers'), async () => {
  const { writable } = await import('svelte/store');
  return {
    providerInfos: writable<ProviderInfo[]>([]),
    fetchProviders: vi.fn().mockResolvedValue([]),
  };
});

const claudeDefinition: AgentDefinition = {
  cliName: 'claude',
  title: 'Claude Code',
  description: 'Cloud agent',
  badge: 'Cloud',
  icon: faClaude,
  extensionId: 'claude',
  secretType: 'anthropic',
};

function stubClaudeProvider(options?: { withModels?: boolean }): void {
  const models = options?.withModels ? [{ label: 'claude-sonnet-4-20250514' }] : [];
  const providers = [
    {
      id: 'claude',
      internalId: 'claude-internal-1',
      inferenceConnections: models.length > 0 ? [{ type: 'cloud', status: 'started', models }] : [],
      inferenceProviderConnectionCreation: true,
    },
  ];
  (providerInfos as Writable<ProviderInfo[]>).set(providers as unknown as ProviderInfo[]);
}

function stubNoProvider(): void {
  (providerInfos as Writable<ProviderInfo[]>).set([]);
}

let onboarding: OnboardingState;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  onboarding = { agent: 'claude' };
  vi.stubGlobal('createSecret', vi.fn().mockResolvedValue({ name: 'anthropic' }));
  vi.stubGlobal('createInferenceProviderConnection', vi.fn().mockResolvedValue(undefined));
  stubClaudeProvider();
});

function renderPanel(definition: AgentDefinition = claudeDefinition): void {
  render(ClaudePanel, { definition, onboarding });
}

describe('rendering', () => {
  test('renders the Claude panel with API Key heading', () => {
    renderPanel();

    expect(screen.getByTestId('claude-panel')).toBeInTheDocument();
    expect(screen.getByText('API Key')).toBeInTheDocument();
  });

  test('shows the API key input form', () => {
    renderPanel();

    expect(screen.getByTestId('claude-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Anthropic API key')).toBeInTheDocument();
  });

  test('shows warning when Claude provider extension is not detected', () => {
    stubNoProvider();
    renderPanel();

    expect(screen.getByTestId('claude-provider-missing')).toBeInTheDocument();
    expect(screen.getByLabelText('Anthropic API key')).toBeDisabled();
  });

  test('does not show error message initially', () => {
    renderPanel();

    expect(screen.queryByText(/Please enter your Anthropic API key/)).not.toBeInTheDocument();
  });
});

describe('beforeAdvance callback', () => {
  test('registers beforeAdvance on onboarding state', () => {
    renderPanel();

    expect(onboarding.beforeAdvance).toBeDefined();
    expect(typeof onboarding.beforeAdvance).toBe('function');
  });

  test('returns false and shows error when API key is empty', async () => {
    renderPanel();

    const result = await onboarding.beforeAdvance!();

    expect(result).toBe(false);
    expect(screen.getByText(/Please enter your Anthropic API key/)).toBeInTheDocument();
  });

  test('returns false when provider is not available', async () => {
    stubNoProvider();
    renderPanel();

    // Simulate user typing a key via the onboarding's beforeAdvance
    // The input is disabled when provider is missing, but test the validation path
    const result = await onboarding.beforeAdvance!();

    expect(result).toBe(false);
  });

  test('creates secret and inference connection when API key is provided', async () => {
    vi.mocked(fetchProviders).mockImplementation(async () => {
      stubClaudeProvider({ withModels: true });
      return [] as ProviderInfo[];
    });

    renderPanel();

    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    // Svelte 5 bind:value reads from the input's value property
    Object.defineProperty(input, 'value', { value: 'sk-ant-test-key', writable: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const result = await onboarding.beforeAdvance!();

    expect(result).toBe(true);
    expect(window.createSecret).toHaveBeenCalledWith({
      name: 'anthropic',
      type: 'anthropic',
      value: 'sk-ant-test-key',
    });
    expect(window.createInferenceProviderConnection).toHaveBeenCalledWith(
      'claude-internal-1',
      { 'claude.factory.apiKey': 'sk-ant-test-key' },
      expect.any(Symbol),
      expect.any(Function),
      undefined,
      undefined,
    );
  });

  test('continues if secret already exists', async () => {
    vi.mocked(window.createSecret).mockRejectedValue(new Error('secret already exists: anthropic'));
    vi.mocked(fetchProviders).mockImplementation(async () => {
      stubClaudeProvider({ withModels: true });
      return [] as ProviderInfo[];
    });

    renderPanel();

    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    Object.defineProperty(input, 'value', { value: 'sk-ant-test-key', writable: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const result = await onboarding.beforeAdvance!();

    expect(result).toBe(true);
  });

  test('returns false and shows error when inference connection fails', async () => {
    vi.mocked(window.createInferenceProviderConnection).mockRejectedValue(new Error('invalid apiKey'));

    renderPanel();

    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    Object.defineProperty(input, 'value', { value: 'bad-key', writable: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const result = await onboarding.beforeAdvance!();

    expect(result).toBe(false);
    expect(screen.getByText('invalid apiKey')).toBeInTheDocument();
  });

  test('returns false and shows error when secret creation fails', async () => {
    vi.mocked(window.createSecret).mockRejectedValue(new Error('vault locked'));

    renderPanel();

    const input = screen.getByLabelText('Anthropic API key') as HTMLInputElement;
    Object.defineProperty(input, 'value', { value: 'sk-ant-test-key', writable: true });
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const result = await onboarding.beforeAdvance!();

    expect(result).toBe(false);
    expect(screen.getByText(/vault locked/)).toBeInTheDocument();
  });
});

describe('cleanup', () => {
  test('clears beforeAdvance when component is destroyed', () => {
    const { unmount } = render(ClaudePanel, { definition: claudeDefinition, onboarding });

    expect(onboarding.beforeAdvance).toBeDefined();

    unmount();

    expect(onboarding.beforeAdvance).toBeUndefined();
  });
});
