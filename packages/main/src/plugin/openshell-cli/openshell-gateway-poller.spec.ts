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

import { assert, beforeEach, expect, test, vi } from 'vitest';

import type { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

import { type GatewayPollOptions, OpenshellGatewayPoller } from './openshell-gateway-poller.js';

const reachableGateway: GatewayInfo = {
  canStop: false,
  canStart: false,
  name: 'kaiden',
  endpoint: 'http://localhost',
  gatewayState: { reachable: true, health: 'healthy', compatible: true },
};
const unreachableGateway: GatewayInfo = {
  ...reachableGateway,
  name: 'remote',
  gatewayState: { reachable: false, health: 'unknown', compatible: false },
};

const gatewayStateManager = {
  onDidPoll: vi.fn(),
} as unknown as OpenshellGatewayStateManager;

const options = {
  label: 'things',
  list: vi.fn(),
  serialize: JSON.stringify,
  onChange: vi.fn(),
} satisfies GatewayPollOptions<string[]>;

const never = (): Promise<never> => new Promise<never>(() => {});

let pollCallback: ((gateways: readonly GatewayInfo[]) => void) | undefined;
let poller: OpenshellGatewayPoller;

beforeEach(() => {
  vi.resetAllMocks();
  console.warn = vi.fn();
  pollCallback = undefined;
  vi.mocked(gatewayStateManager.onDidPoll).mockImplementation(cb => {
    pollCallback = cb;
    return { dispose: vi.fn() };
  });
  poller = new OpenshellGatewayPoller(gatewayStateManager);
  poller.watch(options);
});

// Triggers a poll tick and lets it settle (the mocks resolve as microtasks), so ticks never overlap.
async function poll(gateways: readonly GatewayInfo[]): Promise<void> {
  assert(pollCallback);
  pollCallback(gateways);
  await new Promise(resolve => setImmediate(resolve));
}

test('calls onChange when the listing changes', async () => {
  options.list.mockResolvedValue([]);
  await poll([reachableGateway]);
  await vi.waitFor(() => expect(options.onChange).toHaveBeenCalledOnce());

  options.list.mockResolvedValue(['a']);
  await poll([reachableGateway]);

  await vi.waitFor(() => expect(options.onChange).toHaveBeenCalledTimes(2));
});

test('does not call onChange when the listing is unchanged', async () => {
  options.list.mockResolvedValue(['a']);
  await poll([reachableGateway]);
  await poll([reachableGateway]);

  expect(options.onChange).toHaveBeenCalledOnce();
});

test('keeps the last listing when listing fails on a reachable gateway', async () => {
  options.list.mockResolvedValue(['a']);
  await poll([reachableGateway]);
  await vi.waitFor(() => expect(options.onChange).toHaveBeenCalledOnce());

  options.list.mockRejectedValue(new Error('connection refused'));
  await poll([reachableGateway]);
  expect(options.onChange).toHaveBeenCalledOnce();

  options.list.mockResolvedValue(['a']);
  await poll([reachableGateway]);

  expect(options.onChange).toHaveBeenCalledOnce();
});

test('logs a failing gateway once until it recovers', async () => {
  options.list.mockRejectedValue(new Error('connection refused'));
  await poll([reachableGateway]);
  await poll([reachableGateway]);
  expect(console.warn).toHaveBeenCalledOnce();
  expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('things of gateway kaiden'), expect.any(Error));

  options.list.mockResolvedValue([]);
  await poll([reachableGateway]);
  options.list.mockRejectedValue(new Error('connection refused'));
  await poll([reachableGateway]);

  expect(console.warn).toHaveBeenCalledTimes(2);
});

test('keeps polling other gateways when one fails', async () => {
  const otherGateway: GatewayInfo = { ...reachableGateway, name: 'other' };
  options.list.mockRejectedValueOnce(new Error('connection refused')).mockResolvedValueOnce(['a']);

  await poll([reachableGateway, otherGateway]);

  await vi.waitFor(() => expect(options.onChange).toHaveBeenCalledOnce());
  expect(options.list).toHaveBeenCalledWith(otherGateway);
});

test('does not list unreachable gateways', async () => {
  options.list.mockResolvedValue([]);

  await poll([reachableGateway, unreachableGateway]);

  await vi.waitFor(() => expect(options.list).toHaveBeenCalledWith(reachableGateway));
  expect(options.list).not.toHaveBeenCalledWith(unreachableGateway);
});

test('calls onChange once when a gateway becomes unreachable, then stops listing it', async () => {
  options.list.mockResolvedValue(['a']);
  await poll([reachableGateway]);

  const unreachable: GatewayInfo = { ...unreachableGateway, name: reachableGateway.name };
  await poll([unreachable]);
  await poll([unreachable]);

  expect(options.onChange).toHaveBeenCalledTimes(2);
  expect(options.list).toHaveBeenCalledOnce();
});

test('skips a tick while the previous poll is still running', async () => {
  options.list.mockReturnValue(never());

  await poll([reachableGateway]);
  await poll([reachableGateway]);

  expect(options.list).toHaveBeenCalledOnce();
});

test('releases the poll after a hung gateway times out', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    options.list.mockReturnValue(never());
    await poll([reachableGateway]);

    await vi.advanceTimersByTimeAsync(10_000);
    await poll([reachableGateway]);

    expect(options.list).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledExactlyOnceWith(
      `[OpenshellGatewayPoller] unable to poll things of gateway ${reachableGateway.name}:`,
      new Error(`listing things of gateway ${reachableGateway.name} timed out after 10000ms`),
    );
  } finally {
    vi.useRealTimers();
  }
});

test('lists other gateways while one is hung', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const otherGateway: GatewayInfo = { ...reachableGateway, name: 'other' };
    options.list.mockImplementation(gateway =>
      gateway.name === reachableGateway.name ? never() : Promise.resolve(['a']),
    );

    await poll([reachableGateway, otherGateway]);
    expect(options.list).toHaveBeenCalledWith(otherGateway);
    expect(options.onChange).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000);

    expect(options.onChange).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

test('stops listening to the gateway poll when disposed', () => {
  const disposable = poller.watch(options);
  const subscription = vi.mocked(gatewayStateManager.onDidPoll).mock.results[1];
  assert(subscription?.type === 'return');

  disposable.dispose();

  expect(subscription.value.dispose).toHaveBeenCalledOnce();
});

test('does not call onChange for a listing that resolves after dispose', async () => {
  const listing = Promise.withResolvers<string[]>();
  options.list.mockReturnValue(listing.promise);
  const disposable = poller.watch(options);
  const watchCallback = vi.mocked(gatewayStateManager.onDidPoll).mock.calls[1]?.[0];
  assert(watchCallback);

  watchCallback([reachableGateway]);
  disposable.dispose();
  listing.resolve(['a']);
  await new Promise(resolve => setImmediate(resolve));

  expect(options.list).toHaveBeenCalledOnce();
  expect(options.onChange).not.toHaveBeenCalled();
});
