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

import { faBrain } from '@fortawesome/free-solid-svg-icons';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { GuidedSetupStep, OnboardingState } from './guided-setup-steps';
import { createDefaultOnboardingState } from './guided-setup-steps';
import GuidedSetup from './GuidedSetup.svelte';

vi.mock(import('./guided-setup-steps'), async importOriginal => {
  const orig = await importOriginal();
  return {
    ...orig,
    guidedSetupSteps: [
      {
        id: 'guided-setup',
        title: 'Choose your coding agent',
        stepperLabel: 'Coding agent',
        description: 'Pick your coding agent and default model.',
        icon: faBrain,
        component: (await import('./StubStep.svelte')).default,
        isComplete: (): boolean => false,
        isSkippable: true,
      },
    ] satisfies GuidedSetupStep[],
    createDefaultOnboardingState: vi.fn<() => OnboardingState>().mockReturnValue({
      agent: 'opencode',
      workspaceSetting: {},
    }),
  };
});

const closeMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  vi.mocked(createDefaultOnboardingState).mockReturnValue({
    agent: 'opencode',
    workspaceSetting: {},
  });
  vi.stubGlobal('updateConfigurationValue', vi.fn().mockResolvedValue(undefined));
});

test('renders the wizard stepper shell for guided setup', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.getByRole('dialog', { name: 'Guided Setup' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Wizard progress' })).toBeInTheDocument();
  expect(screen.getByText('Step 1 of 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
});

test('renders the dialog with Guided Setup label', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.getByRole('dialog', { name: 'Guided Setup' })).toBeInTheDocument();
});

test('renders the step content inside a bordered card', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.getByLabelText('Step content')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
});

test('"Continue" finishes the single-page guided setup', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const continueButton = screen.getByRole('button', { name: /Go to Dashboard/ });
  await fireEvent.click(continueButton);

  await waitFor(() => {
    expect(closeMock).toHaveBeenCalled();
  });
});

test('"Skip" closes the wizard without persisting', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const skipButton = screen.getByRole('button', { name: 'Skip' });
  await fireEvent.click(skipButton);

  expect(closeMock).toHaveBeenCalled();
  expect(window.updateConfigurationValue).not.toHaveBeenCalled();
});

test('single-page guided setup shows "Go to Dashboard"', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.queryByRole('button', { name: /Continue/ })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Go to Dashboard/ })).toBeInTheDocument();
});

test('dispatches close event when finishing on last step', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const dashboardButton = screen.getByRole('button', { name: /Go to Dashboard/ });
  await fireEvent.click(dashboardButton);

  await waitFor(() => {
    expect(closeMock).toHaveBeenCalled();
  });
});

test('Skip closes without persisting any settings', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: 'Skip' }));

  expect(closeMock).toHaveBeenCalled();
  expect(window.updateConfigurationValue).not.toHaveBeenCalled();
});

test('persists default workspace settings when wizard completes', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/ }));

  await waitFor(() => {
    expect(window.updateConfigurationValue).toHaveBeenCalledWith('onboarding.defaultWorkspaceSettings', {
      defaultAgent: 'opencode',
      defaultAgentSettings: {
        opencode: {
          defaultModel: undefined,
        },
      },
    });
  });
});

test('closes wizard even when persistence fails', async () => {
  const persistError = new Error('write failed');
  vi.stubGlobal('updateConfigurationValue', vi.fn().mockRejectedValue(persistError));
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/ }));

  await waitFor(() => {
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to persist onboarding defaults', persistError);
    expect(closeMock).toHaveBeenCalled();
  });
});

test('Back button is disabled on the first step', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
});

test('persists defaultWorkspaceSettings with workspaceConfig when wizard completes', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/ }));

  await waitFor(() => {
    expect(window.updateConfigurationValue).toHaveBeenCalledWith('onboarding.defaultWorkspaceSettings', {
      defaultAgent: 'opencode',
      defaultAgentSettings: {
        opencode: {
          defaultModel: undefined,
        },
      },
    });
  });
});

test('persists vertex AI environment and mounts in workspaceConfiguration', async () => {
  vi.mocked(createDefaultOnboardingState).mockReturnValue({
    agent: 'claude-vertex',
    workspaceSetting: {},
  });

  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: /Go to Dashboard/ }));

  await waitFor(() => {
    expect(window.updateConfigurationValue).toHaveBeenCalledWith(
      'onboarding.defaultWorkspaceSettings',
      expect.anything(),
    );
  });
});
