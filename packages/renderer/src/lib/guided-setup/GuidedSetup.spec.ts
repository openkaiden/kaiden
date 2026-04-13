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

import { faBrain, faCheckCircle, faRobot } from '@fortawesome/free-solid-svg-icons';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { GuidedSetupStep } from './guided-setup-steps';
import GuidedSetup from './GuidedSetup.svelte';

vi.mock(import('./guided-setup-steps'), async importOriginal => {
  const orig = await importOriginal();
  return {
    ...orig,
    guidedSetupSteps: [
      {
        id: 'step-a',
        title: 'Step A',
        description: 'First test step.',
        icon: faBrain,
        component: (await import('./StubStep.svelte')).default,
        isComplete: (): boolean => false,
        isSkippable: true,
      },
      {
        id: 'step-b',
        title: 'Step B',
        description: 'Second test step.',
        icon: faRobot,
        component: (await import('./StubStep.svelte')).default,
        isComplete: (): boolean => false,
        isSkippable: true,
      },
      {
        id: 'step-c',
        title: 'Step C',
        description: 'Last test step.',
        icon: faCheckCircle,
        component: (await import('./StubStep.svelte')).default,
        isComplete: (): boolean => false,
        isSkippable: false,
      },
    ] satisfies GuidedSetupStep[],
  };
});

const closeMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('renders stepper with all step labels', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.getByRole('button', { name: 'Step A step' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Step B step' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Step C step' })).toBeInTheDocument();
});

test('renders the dialog with Guided Setup label', () => {
  render(GuidedSetup, { onclose: closeMock });

  expect(screen.getByRole('dialog', { name: 'Guided Setup' })).toBeInTheDocument();
});

test('first step is active on mount', () => {
  render(GuidedSetup, { onclose: closeMock });

  const firstStepButton = screen.getByRole('button', { name: 'Step A step' });
  expect(firstStepButton).toHaveAttribute('aria-current', 'step');
});

test('"Continue" advances to next step', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const continueButton = screen.getByRole('button', { name: 'Continue' });
  await fireEvent.click(continueButton);

  const secondStepButton = screen.getByRole('button', { name: 'Step B step' });
  expect(secondStepButton).toHaveAttribute('aria-current', 'step');
});

test('"Skip" advances to next step', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const skipButton = screen.getByRole('button', { name: 'Skip' });
  await fireEvent.click(skipButton);

  const secondStepButton = screen.getByRole('button', { name: 'Step B step' });
  expect(secondStepButton).toHaveAttribute('aria-current', 'step');
});

test('completed steps are tracked after Continue', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const continueButton = screen.getByRole('button', { name: 'Continue' });
  await fireEvent.click(continueButton);

  const firstStepButton = screen.getByRole('button', { name: 'Step A step' });
  expect(firstStepButton).not.toHaveAttribute('aria-current', 'step');
  expect(firstStepButton).toBeEnabled();
});

test('skipped steps are not marked completed', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const skipButton = screen.getByRole('button', { name: 'Skip' });
  await fireEvent.click(skipButton);

  const firstStepButton = screen.getByRole('button', { name: 'Step A step' });
  expect(firstStepButton).toBeDisabled();
});

test('last step shows "Go to Dashboard" instead of "Continue"', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Go to Dashboard' })).toBeInTheDocument();
});

test('dispatches close event when finishing on last step', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  const dashboardButton = screen.getByRole('button', { name: 'Go to Dashboard' });
  await fireEvent.click(dashboardButton);

  expect(closeMock).toHaveBeenCalled();
});

test('clicking on completed step navigates back to it', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  const firstStepButton = screen.getByRole('button', { name: 'Step A step' });
  await fireEvent.click(firstStepButton);

  expect(firstStepButton).toHaveAttribute('aria-current', 'step');
});

test('clicking on upcoming (not yet reached) step does nothing', async () => {
  render(GuidedSetup, { onclose: closeMock });

  const thirdStepButton = screen.getByRole('button', { name: 'Step C step' });
  await fireEvent.click(thirdStepButton);

  const firstStepButton = screen.getByRole('button', { name: 'Step A step' });
  expect(firstStepButton).toHaveAttribute('aria-current', 'step');
});

test('stepper progress bar has correct number of connector lines', () => {
  render(GuidedSetup, { onclose: closeMock });

  const nav = screen.getByRole('navigation', { name: 'Setup progress' });
  const connectors = nav.querySelectorAll('[aria-hidden="true"]');
  expect(connectors.length).toBe(2);
});

test('Skip button is not shown for non-skippable steps', async () => {
  render(GuidedSetup, { onclose: closeMock });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
});
