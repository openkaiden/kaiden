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

import { GatewayAction } from './gateway-action.svelte';

let action: GatewayAction;

beforeEach(() => {
  vi.resetAllMocks();
  action = new GatewayAction(name => window.stopOpenshellGateway(name));
});

test('deduplicates pending requests while allowing different gateways to run', async () => {
  const pending = Promise.withResolvers<void>();
  vi.mocked(window.stopOpenshellGateway).mockReturnValue(pending.promise);
  const first = action.run('first');
  await action.run('first');
  const second = action.run('second');
  expect(action.pendingGateways).toEqual(['first', 'second']);
  expect(window.stopOpenshellGateway).toHaveBeenCalledTimes(2);
  pending.resolve();
  await Promise.all([first, second]);
  expect(action.pendingGateways).toEqual([]);
  expect([...action.errors]).toEqual([]);
});

test.each([new Error('Denied'), 'Denied'])('clears pending state after failure and permits retry: %s', async error => {
  vi.mocked(window.stopOpenshellGateway).mockRejectedValueOnce(error);
  await action.run('local');
  expect(action.errors.get('local')).toBe('Denied');
  expect(action.pendingGateways).toEqual([]);
  vi.mocked(window.stopOpenshellGateway).mockResolvedValue(undefined);
  await action.run('local');
  expect([...action.errors]).toEqual([]);
  expect(action.pendingGateways).toEqual([]);
  expect(window.stopOpenshellGateway).toHaveBeenCalledTimes(2);
});

test('keeps gateway failures when running another gateway and clears only the retried gateway error', async () => {
  vi.mocked(window.stopOpenshellGateway).mockRejectedValueOnce(new Error('First gateway failed'));
  await action.run('first');

  const second = Promise.withResolvers<void>();
  vi.mocked(window.stopOpenshellGateway).mockReturnValueOnce(second.promise);
  const runningSecond = action.run('second');
  expect([...action.errors]).toEqual([['first', 'First gateway failed']]);
  second.reject(new Error('Second gateway failed'));
  await runningSecond;
  expect([...action.errors]).toEqual([
    ['first', 'First gateway failed'],
    ['second', 'Second gateway failed'],
  ]);

  const retry = Promise.withResolvers<void>();
  vi.mocked(window.stopOpenshellGateway).mockReturnValueOnce(retry.promise);
  const retryingFirst = action.run('first');
  expect([...action.errors]).toEqual([['second', 'Second gateway failed']]);
  retry.resolve();
  await retryingFirst;
  expect([...action.errors]).toEqual([['second', 'Second gateway failed']]);
  expect(action.pendingGateways).toEqual([]);
});
