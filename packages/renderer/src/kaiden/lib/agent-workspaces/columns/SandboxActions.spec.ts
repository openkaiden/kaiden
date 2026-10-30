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

import {
  allOpenshellSandboxes,
  clearSandboxActionError,
  openshellSandboxes,
  type SandboxInfoWithGateway,
  setSandboxActionError,
} from '/@/kaiden/stores/openshell-sandboxes';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';

import SandboxActions from './SandboxActions.svelte';

vi.mock(import('/@/lib/dialogs/messagebox-utils'));

const sandbox: SandboxInfoWithGateway = {
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
  clearSandboxActionError(sandbox.id);
  openshellSandboxes.set([
    {
      gateway: { name: 'remote-gateway', endpoint: 'http://localhost:18080', canStop: false },
      sandboxes: [{ id: 'sandbox-1', name: 'shared-name', phase: 'Ready' }],
    },
  ]);
});

test('deletes the sandbox from its gateway', async () => {
  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));

  expect(window.deleteOpenshellSandbox).toHaveBeenCalledWith('shared-name', 'remote-gateway');
});

test('displays error message when actionError is set on the object', async () => {
  render(SandboxActions, { object: { ...sandbox, actionError: 'sandbox is busy' } });

  await fireEvent.mouseEnter(screen.getByTestId('tooltip-trigger'));

  expect(await screen.findByText('sandbox is busy')).toBeInTheDocument();
});

test('sets actionError via store when delete fails', async () => {
  vi.mocked(window.deleteOpenshellSandbox).mockRejectedValue(new Error('sandbox is busy'));
  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));

  await waitFor(() =>
    expect(get(allOpenshellSandboxes).find(s => s.id === sandbox.id)?.actionError).toBe('Error: sandbox is busy'),
  );
});

test('clears previous actionError before deleting again', async () => {
  setSandboxActionError(sandbox.id, 'Error: sandbox is busy');
  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));

  await waitFor(() => expect(window.deleteOpenshellSandbox).toHaveBeenCalledWith('shared-name', 'remote-gateway'));
  expect(get(allOpenshellSandboxes).find(s => s.id === sandbox.id)?.actionError).toBeUndefined();
});
