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
import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import type { SandboxInfoUI } from '/@/lib/agent-workspaces/SandboxInfoUI';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import { allOpenshellSandboxes, openshellSandboxes } from '/@/stores/openshell-sandboxes';

import SandboxActions from './SandboxActions.svelte';

vi.mock(import('/@/lib/dialogs/messagebox-utils'));

const sandbox: SandboxInfoUI = {
  id: 'sandbox-1',
  name: 'shared-name',
  phase: 'Ready',
  gatewayName: 'remote-gateway',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(withConfirmation).mockImplementation(action => action());
  vi.mocked(window.deleteOpenshellSandbox).mockResolvedValue(undefined);
  openshellSandboxes.set([
    {
      gateway: { name: 'remote-gateway', endpoint: 'http://localhost:18080' },
      sandboxes: [{ id: 'sandbox-1', name: 'shared-name', phase: 'Ready' }],
    },
  ]);
});

test('deletes the sandbox from its gateway', async () => {
  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));

  expect(window.deleteOpenshellSandbox).toHaveBeenCalledWith('shared-name', 'remote-gateway');
});

test('should display error message when actionError is set on the object', async () => {
  const sandboxWithError: SandboxInfoUI = { ...sandbox, actionError: 'network timeout' };

  render(SandboxActions, { object: sandboxWithError });

  const tooltipTrigger = screen.getByTestId('tooltip-trigger');
  await fireEvent.mouseEnter(tooltipTrigger);

  const error = await screen.findByText('network timeout');
  expect(error).toBeInTheDocument();
});

test('should set actionError via store when deleteOpenshellSandbox fails', async () => {
  vi.mocked(window.deleteOpenshellSandbox).mockRejectedValue(new Error('sandbox is busy'));

  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));

  await waitFor(() => {
    expect(window.deleteOpenshellSandbox).toHaveBeenCalledWith('shared-name', 'remote-gateway');
  });

  await vi.advanceTimersByTimeAsync(100);

  const sandboxes = get(allOpenshellSandboxes);
  const failedSandbox = sandboxes.find(s => s.id === sandbox.id);
  expect(failedSandbox?.actionError).toBe('Error: sandbox is busy');
});
