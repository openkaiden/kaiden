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
import { beforeEach, expect, test, vi } from 'vitest';

import CodingAgentStep from './CodingAgentStep.svelte';
import type { OnboardingState } from './guided-setup-steps';
import { createDefaultOnboardingState } from './guided-setup-steps';

let onboarding: OnboardingState;

function stubLocalInference(hasConnection: boolean): void {
  const providers = hasConnection
    ? [{ id: 'ollama', inferenceConnections: [{ type: 'local', status: 'started' }] }]
    : [{ id: 'ollama', inferenceConnections: [] }];
  (window as unknown as Record<string, unknown>).getProviderInfos = vi.fn().mockResolvedValue(providers);
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  onboarding = createDefaultOnboardingState();
  vi.stubGlobal(
    'getCliInfo',
    vi.fn().mockResolvedValue({ version: '0.1.0', agents: ['opencode'], runtimes: ['podman'] }),
  );
  stubLocalInference(false);
});

function renderStep(overrides: Partial<OnboardingState> = {}): void {
  Object.assign(onboarding, overrides);
  render(CodingAgentStep, {
    stepId: 'coding-agent',
    title: 'Choose your coding agent',
    description: 'Pick one runtime for kdn.',
    onboarding,
  });
}

test('renders the OpenCode agent tile', () => {
  renderStep();

  expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument();
});

test('OpenCode is selected by default', () => {
  renderStep();

  const tile = screen.getByRole('button', { name: 'OpenCode' });
  expect(tile.className).toContain('border-[var(--pd-content-card-border-selected)]');
});

test('shows Recommended badge on OpenCode', () => {
  renderStep();

  expect(screen.getByText('Recommended')).toBeInTheDocument();
});

test('shows local runtime panel when OpenCode is selected', () => {
  renderStep();

  expect(screen.getByTestId('opencode-panel')).toBeInTheDocument();
  expect(screen.getByText('Local Runtime')).toBeInTheDocument();
});

test('shows probe checking state on mount with OpenCode selected', async () => {
  (window as unknown as Record<string, unknown>).getProviderInfos = vi.fn().mockReturnValue(new Promise(() => {}));

  renderStep();

  await waitFor(() => {
    expect(screen.getByTestId('probe-checking')).toBeInTheDocument();
  });
});

test('shows detected state when a local inference connection exists', async () => {
  stubLocalInference(true);

  renderStep();

  await waitFor(() => {
    expect(screen.getByTestId('probe-detected')).toBeInTheDocument();
  });
});

test('shows not-found state when no local inference connections exist', async () => {
  renderStep();

  await waitFor(() => {
    expect(screen.getByTestId('probe-not-found')).toBeInTheDocument();
  });
});

test('Check again button retries the probe', async () => {
  renderStep();

  await waitFor(() => {
    expect(screen.getByTestId('probe-not-found')).toBeInTheDocument();
  });

  stubLocalInference(true);

  await fireEvent.click(screen.getByRole('button', { name: 'Check again' }));

  await waitFor(() => {
    expect(screen.getByTestId('probe-detected')).toBeInTheDocument();
  });
});

test('step title and description are rendered', () => {
  renderStep();

  expect(screen.getByText('Choose your coding agent')).toBeInTheDocument();
  expect(screen.getByText('Pick one runtime for kdn.')).toBeInTheDocument();
});

test('card selector region has correct aria-label', () => {
  renderStep();

  expect(screen.getByRole('region', { name: 'Coding agent' })).toBeInTheDocument();
});

test('falls back to all registry entries when getCliInfo fails', async () => {
  vi.stubGlobal('getCliInfo', vi.fn().mockRejectedValue(new Error('kdn not found')));

  renderStep();

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'OpenCode' })).toBeInTheDocument();
  });
});
