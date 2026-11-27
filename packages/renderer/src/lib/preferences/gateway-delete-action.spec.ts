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

import { beforeEach, expect, test, vi } from 'vitest';

import { GatewayDeleteAction } from './gateway-delete-action.svelte';

let action: GatewayDeleteAction;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  action = new GatewayDeleteAction();
});

test.each([
  { source: 'user', expected: true },
  { source: undefined, expected: true },
  { source: 'system', expected: false },
])('reports a $source gateway as deletable: $expected', ({ source, expected }) => {
  expect(
    action.canDelete({ name: 'gw', endpoint: 'http://localhost:1', canStop: false, canStart: false, source }),
  ).toBe(expected);
});

test('asks for confirmation with an irreversible-delete warning before deleting', async () => {
  await action.delete('local-dev');

  expect(window.showMessageBox).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      title: 'Delete gateway',
      type: 'warning',
      message: 'Delete gateway "local-dev"?',
      detail: expect.stringContaining('This cannot be undone.'),
      buttons: ['Delete', 'Cancel'],
      cancelId: 1,
    }),
  );
  expect(window.deleteOpenshellGateway).toHaveBeenCalledExactlyOnceWith('local-dev');
  expect(action.deletingGateways).toEqual([]);
  expect([...action.errors]).toEqual([]);
});

test('tells the user kaiden-local is recreated on the next start', async () => {
  await action.delete('kaiden-local');

  expect(window.showMessageBox).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      detail: expect.stringContaining(
        'A new kaiden-local gateway may be created automatically the next time the application starts.',
      ),
    }),
  );
});

test('does not show the kaiden-local note for other gateways', async () => {
  await action.delete('local-dev');

  expect(window.showMessageBox).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ detail: expect.not.stringContaining('kaiden-local') }),
  );
});

test.each([1, undefined])('does not delete when the confirmation response is %s', async response => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response });

  await action.delete('local-dev');

  expect(window.deleteOpenshellGateway).not.toHaveBeenCalled();
  expect(action.deletingGateways).toEqual([]);
});

test('deduplicates pending requests while allowing different gateways to be deleted', async () => {
  const pending = Promise.withResolvers<void>();
  vi.mocked(window.deleteOpenshellGateway).mockReturnValue(pending.promise);
  const first = action.delete('first');
  await vi.waitFor(() => expect(action.deletingGateways).toEqual(['first']));
  await action.delete('first');
  const second = action.delete('second');
  await vi.waitFor(() => expect(action.deletingGateways).toEqual(['first', 'second']));
  expect(window.showMessageBox).toHaveBeenCalledTimes(2);
  expect(window.deleteOpenshellGateway).toHaveBeenCalledTimes(2);
  pending.resolve();
  await Promise.all([first, second]);
  expect(action.deletingGateways).toEqual([]);
});

test('deletes once when the same gateway is confirmed twice before deletion starts', async () => {
  const confirmations = [Promise.withResolvers<{ response: number }>(), Promise.withResolvers<{ response: number }>()];
  vi.mocked(window.showMessageBox)
    .mockReturnValueOnce(confirmations[0].promise)
    .mockReturnValueOnce(confirmations[1].promise);
  const first = action.delete('local-dev');
  const second = action.delete('local-dev');
  confirmations[0].resolve({ response: 0 });
  confirmations[1].resolve({ response: 0 });
  await Promise.all([first, second]);

  expect(window.deleteOpenshellGateway).toHaveBeenCalledOnce();
});

test.each([new Error('Denied'), 'Denied'])('clears pending state after failure and permits retry: %s', async error => {
  vi.mocked(window.deleteOpenshellGateway).mockRejectedValueOnce(error);
  await action.delete('local');
  expect(action.errors.get('local')).toBe('Denied');
  expect(action.deletingGateways).toEqual([]);
  vi.mocked(window.deleteOpenshellGateway).mockResolvedValue(undefined);
  await action.delete('local');
  expect([...action.errors]).toEqual([]);
  expect(action.deletingGateways).toEqual([]);
  expect(window.deleteOpenshellGateway).toHaveBeenCalledTimes(2);
});
