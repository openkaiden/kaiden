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
import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import { openshellSandboxes, type SandboxInfoWithGateway } from '/@/stores/openshell-sandboxes';

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
});

test('deletes the sandbox from its gateway', async () => {
  openshellSandboxes.set([{ gateway: { name: 'remote-gateway', endpoint: 'http://gateway' }, sandboxes: [sandbox] }]);
  let resolveDelete!: () => void;
  vi.mocked(window.deleteOpenshellSandbox).mockReturnValue(new Promise(resolve => (resolveDelete = resolve)));
  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));

  expect(window.deleteOpenshellSandbox).toHaveBeenCalledWith('shared-name', 'remote-gateway');
  expect(get(openshellSandboxes)[0]?.sandboxes[0]?.phase).toBe('Deleting');
  resolveDelete();
});

test('restores the previous phase when deletion fails', async () => {
  openshellSandboxes.set([{ gateway: { name: 'remote-gateway', endpoint: 'http://gateway' }, sandboxes: [sandbox] }]);
  vi.mocked(window.deleteOpenshellSandbox).mockRejectedValue(new Error('delete failed'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  render(SandboxActions, { object: sandbox });

  await fireEvent.click(screen.getByRole('button', { name: 'Remove workspace' }));
  await vi.waitFor(() => expect(get(openshellSandboxes)[0]?.sandboxes[0]?.phase).toBe('Ready'));
});
