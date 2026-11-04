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

import { GatewayStartAction } from './gateway-start-action.svelte';

let action: GatewayStartAction;

beforeEach(() => {
  vi.resetAllMocks();
  action = new GatewayStartAction();
});

test('deduplicates pending requests while allowing different gateways to start', async () => {
  const pending = Promise.withResolvers<void>();
  vi.mocked(window.startOpenshellGateway).mockReturnValue(pending.promise);
  const first = action.start('first');
  await action.start('first');
  const second = action.start('second');
  expect(action.startingGateways).toEqual(['first', 'second']);
  expect(window.startOpenshellGateway).toHaveBeenCalledTimes(2);
  pending.resolve();
  await Promise.all([first, second]);
  expect(action.startingGateways).toEqual([]);
  expect([...action.errors]).toEqual([]);
});

test.each([
  new Error('Port busy'),
  'Port busy',
])('clears pending state after failure and permits retry: %s', async error => {
  vi.mocked(window.startOpenshellGateway).mockRejectedValueOnce(error);
  await action.start('local');
  expect(action.errors.get('local')).toBe('Port busy');
  expect(action.startingGateways).toEqual([]);
  vi.mocked(window.startOpenshellGateway).mockResolvedValue(undefined);
  await action.start('local');
  expect([...action.errors]).toEqual([]);
  expect(action.startingGateways).toEqual([]);
  expect(window.startOpenshellGateway).toHaveBeenCalledTimes(2);
});

test('keeps other gateway failures and clears only the retried gateway error', async () => {
  vi.mocked(window.startOpenshellGateway).mockRejectedValueOnce(new Error('First gateway failed'));
  await action.start('first');
  vi.mocked(window.startOpenshellGateway).mockRejectedValueOnce(new Error('Second gateway failed'));
  await action.start('second');
  vi.mocked(window.startOpenshellGateway).mockResolvedValueOnce(undefined);
  await action.start('first');
  expect([...action.errors]).toEqual([['second', 'Second gateway failed']]);
});
