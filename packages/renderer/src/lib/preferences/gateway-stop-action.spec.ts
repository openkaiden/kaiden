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

import { GatewayStopAction } from './gateway-stop-action.svelte';

let action: GatewayStopAction;

beforeEach(() => {
  vi.resetAllMocks();
  action = new GatewayStopAction();
});

test('deduplicates pending requests while allowing different gateways to stop', async () => {
  const pending = Promise.withResolvers<void>();
  vi.mocked(window.stopOpenshellGateway).mockReturnValue(pending.promise);
  const first = action.stop('first');
  await action.stop('first');
  const second = action.stop('second');
  expect(action.stoppingGateways).toEqual(['first', 'second']);
  expect(window.stopOpenshellGateway).toHaveBeenCalledTimes(2);
  pending.resolve();
  await Promise.all([first, second]);
  expect(action.stoppingGateways).toEqual([]);
  expect(action.error).toBe('');
});

test.each([new Error('Denied'), 'Denied'])('clears pending state after failure and permits retry: %s', async error => {
  vi.mocked(window.stopOpenshellGateway).mockRejectedValueOnce(error);
  await action.stop('local');
  expect(action.error).toBe('Failed to stop gateway "local": Denied');
  expect(action.stoppingGateways).toEqual([]);
  vi.mocked(window.stopOpenshellGateway).mockResolvedValue(undefined);
  await action.stop('local');
  expect(action.error).toBe('');
  expect(action.stoppingGateways).toEqual([]);
  expect(window.stopOpenshellGateway).toHaveBeenCalledTimes(2);
});

test('stops directly without asking for confirmation', async () => {
  await action.stop('kaiden-local');
  expect(window.showMessageBox).not.toHaveBeenCalled();
  expect(window.stopOpenshellGateway).toHaveBeenCalledExactlyOnceWith('kaiden-local');
  expect(action.stoppingGateways).toEqual([]);
  expect(action.error).toBe('');
});
