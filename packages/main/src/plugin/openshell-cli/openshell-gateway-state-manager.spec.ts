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

import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest';

import type { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { ListedGateway } from '/@api/openshell-gateway-info.js';

import { OpenshellGateway } from './openshell-gateway.js';
import type { OpenshellGatewayManager } from './openshell-gateway-manager.js';
import { OpenshellGatewayStateManager } from './openshell-gateway-state-manager.js';

function listed(name: string, endpoint: string): ListedGateway {
  return {
    metadata: { name, gateway_endpoint: endpoint, is_remote: false, gateway_port: 0 },
    source: 'user',
  };
}

const gatewayManager = {
  listGateways: vi.fn(),
  getGatewayInfo: vi.fn(),
  getActiveGateway: vi.fn(),
} as unknown as OpenshellGatewayManager;
vi.mock(import('./openshell-gateway.js'));
let openshellGateway: OpenshellGateway;
let pollInterval = 5;
let configurationChangeCallback: ((event: { key: string }) => void) | undefined;
const configurationRegistry = {
  getConfiguration: vi.fn(() => ({ get: vi.fn(() => pollInterval) })),
  onDidChangeConfiguration: vi.fn((callback: (event: { key: string }) => void) => {
    configurationChangeCallback = callback;
    return { dispose: vi.fn() };
  }),
} as unknown as IConfigurationRegistry;

let manager: OpenshellGatewayStateManager;

beforeEach(() => {
  vi.resetAllMocks();
  openshellGateway = OpenshellGateway.prototype;
  pollInterval = 5;
  configurationChangeCallback = undefined;
  vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
    get: vi.fn(() => pollInterval),
  } as unknown as ReturnType<IConfigurationRegistry['getConfiguration']>);
  vi.mocked(configurationRegistry.onDidChangeConfiguration).mockImplementation(callback => {
    configurationChangeCallback = callback as (event: { key: string }) => void;
    return { dispose: vi.fn() };
  });
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(undefined);
  vi.mocked(openshellGateway.canStopGateway).mockReturnValue(false);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue(undefined);
  manager = new OpenshellGatewayStateManager(gatewayManager, configurationRegistry, openshellGateway);
});

afterEach(() => {
  manager.dispose();
  vi.useRealTimers();
});

test('publishes stop capability changes independently of gateway health', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://localhost:17670')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('unreachable'));
  vi.mocked(openshellGateway.canStopGateway).mockReturnValue(true);
  await manager.refresh();
  expect(manager.listGateways()).toEqual([expect.objectContaining({ canStop: true })]);
  vi.mocked(openshellGateway.canStopGateway).mockReturnValue(false);
  await manager.refresh();
  expect(manager.listGateways()).toEqual([expect.objectContaining({ canStop: false })]);
});

test('builds a cached snapshot from registrations and runtime information', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([
    listed('local', 'http://127.0.0.1:17670'),
    listed('remote', 'https://gateway.example.com'),
  ]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local');
  vi.mocked(gatewayManager.getGatewayInfo)
    .mockResolvedValueOnce({ status: 'healthy', compute_drivers: [] })
    .mockResolvedValueOnce({ status: 'degraded', compute_drivers: [] });

  await manager.refresh();

  expect(gatewayManager.getGatewayInfo).toHaveBeenCalledWith('local');
  expect(gatewayManager.getGatewayInfo).toHaveBeenCalledWith('remote');
  expect(manager.listGateways()).toEqual([
    {
      name: 'local',
      canStop: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      name: 'remote',
      canStop: false,
      endpoint: 'https://gateway.example.com',
      active: false,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: true, health: 'degraded', compatible: true },
    },
  ]);
});

test('extracts version from runtime info when present', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValueOnce({
    status: 'healthy',
    gateway_version: '1.2.0',
    compute_drivers: [],
  });

  await manager.refresh();

  const [gw] = manager.listGateways();
  assert(gw);
  expect(gw.version).toBe('1.2.0');
  expect(gw.gatewayState?.compatible).toBe(true);
});

test('omits version from gateway when runtime info does not include it', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValueOnce({
    status: 'healthy',
    compute_drivers: [],
  });

  await manager.refresh();

  const [gw] = manager.listGateways();
  assert(gw);
  expect(gw).not.toHaveProperty('version');
  expect(gw.gatewayState?.compatible).toBe(true);
});

test.each([
  ['undefined', undefined, true],
  ['equal to minimum', '0.0.116', true],
  ['above minimum', '1.0.0', true],
  ['below minimum', '0.0.100', false],
  ['v-prefixed and compatible', 'v0.0.116', true],
  ['v-prefixed and incompatible', 'v0.0.100', false],
  ['prerelease of minimum', '0.0.116-rc.1', false],
  ['prerelease above minimum', '0.0.117-rc.1', true],
  ['unparseable', 'not-a-version', true],
])('marks gateway compatible=%s when version is %s', async (_label, version, expected) => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValueOnce({
    status: 'healthy',
    ...(version !== undefined ? { gateway_version: version } : {}),
    compute_drivers: [],
  });

  await manager.refresh();

  const [gw] = manager.listGateways();
  assert(gw);
  expect(gw.gatewayState?.compatible).toBe(expected);
});

test('marks a gateway unreachable when runtime information cannot be retrieved', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('stopped', 'http://127.0.0.1:17671')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('connection refused'));

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'stopped',
      canStop: false,
      endpoint: 'http://127.0.0.1:17671',
      active: false,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
    },
  ]);
});

test('fires an update when a registration is removed', async () => {
  const listener = vi.fn();
  manager.onDidUpdateGateways(listener);
  vi.mocked(gatewayManager.listGateways)
    .mockResolvedValueOnce([listed('local', 'http://127.0.0.1:17670')])
    .mockResolvedValueOnce([]);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();
  listener.mockClear();
  await manager.refresh();

  expect(listener).toHaveBeenCalledOnce();
  expect(listener).toHaveBeenCalledWith([]);
  expect(manager.listGateways()).toEqual([]);
});

test('does not fire an update when the gateway snapshot is unchanged', async () => {
  const listener = vi.fn();
  manager.onDidUpdateGateways(listener);
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local');
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();
  listener.mockClear();
  await manager.refresh();

  expect(listener).not.toHaveBeenCalled();
});

test('runs a trailing refresh when another refresh is requested while one is active', async () => {
  let resolveFirstRefresh: (gateways: ListedGateway[]) => void;
  vi.mocked(gatewayManager.listGateways)
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveFirstRefresh = resolve;
      }),
    )
    .mockResolvedValueOnce([listed('new', 'http://127.0.0.1:17671')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  const activeRefresh = manager.refresh();
  const queuedRefresh = manager.refresh();
  resolveFirstRefresh!([listed('old', 'http://127.0.0.1:17670')]);

  await Promise.all([activeRefresh, queuedRefresh]);

  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);
  expect(manager.listGateways()[0]!.name).toBe('new');
});

test('fires an update when active selection or gateway state changes', async () => {
  const listener = vi.fn();
  manager.onDidUpdateGateways(listener);
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValueOnce(undefined).mockResolvedValueOnce('local');
  vi.mocked(gatewayManager.getGatewayInfo)
    .mockResolvedValueOnce({ status: 'healthy', compute_drivers: [] })
    .mockResolvedValueOnce({ status: 'unhealthy', compute_drivers: [] });

  await manager.refresh();
  listener.mockClear();
  await manager.refresh();

  expect(listener).toHaveBeenCalledOnce();
  expect(manager.listGateways()[0]).toEqual(
    expect.objectContaining({
      active: true,
      gatewayState: { reachable: true, health: 'unhealthy', compatible: true },
    }),
  );
});

test('polls gateways and stops polling when disposed', async () => {
  vi.useFakeTimers();
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(0);
  expect(gatewayManager.listGateways).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(5000);
  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);

  manager.dispose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);
});

test('waits for the initial refresh before becoming ready', async () => {
  let resolveListGateways: (gateways: []) => void;
  vi.mocked(gatewayManager.listGateways).mockReturnValue(
    new Promise(resolve => {
      resolveListGateways = resolve;
    }),
  );

  manager.init();
  const ready = manager.whenReady();

  expect(manager.listGateways()).toEqual([]);
  resolveListGateways!([]);
  await ready;
  expect(gatewayManager.listGateways).toHaveBeenCalledOnce();
});

test('becomes ready after the initial refresh fails and a later refresh succeeds', async () => {
  vi.mocked(gatewayManager.listGateways)
    .mockRejectedValueOnce(new Error('temporary startup failure'))
    .mockResolvedValue([]);

  manager.init();

  await expect(manager.whenReady()).rejects.toThrow('temporary startup failure');
  await manager.refresh();
  await expect(manager.whenReady()).resolves.toBeUndefined();
  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);
});

test('reschedules polling when the configured interval changes', async () => {
  vi.useFakeTimers();
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(0);
  expect(gatewayManager.listGateways).toHaveBeenCalledOnce();

  pollInterval = 1;
  configurationChangeCallback?.({ key: 'openshell.gateway.pollInterval' });

  await vi.advanceTimersByTimeAsync(999);
  expect(gatewayManager.listGateways).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);
});

test('clamps polling intervals below one second', async () => {
  vi.useFakeTimers();
  pollInterval = 0;
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(999);
  expect(gatewayManager.listGateways).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);
});

test('clamps polling intervals above one hour', async () => {
  vi.useFakeTimers();
  pollInterval = 3601;
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(3_599_999);
  expect(gatewayManager.listGateways).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(gatewayManager.listGateways).toHaveBeenCalledTimes(2);
});

test('includes process state with running pid when gateway is reachable', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local');
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(12345);

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'local',
      canStop: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: {
        reachable: true,
        health: 'healthy',
        compatible: true,
        process: { pid: 12345, status: 'running' },
      },
    },
  ]);
});

test('includes process state with running pid when gateway is unreachable', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local');
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('connection refused'));
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(12345);

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'local',
      canStop: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: {
        reachable: false,
        health: 'unknown',
        compatible: true,
        process: { pid: 12345, status: 'running' },
      },
    },
  ]);
});

test('includes not-running process state when gateway is unreachable and no pid', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://127.0.0.1:17670')]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local');
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('connection refused'));
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(undefined);
  vi.mocked(openshellGateway.canStopGateway).mockReturnValue(false);

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'local',
      canStop: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
    },
  ]);
});

test('omits process state when gateway is reachable and no pid', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('remote', 'https://gateway.example.com')]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('remote');
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(undefined);
  vi.mocked(openshellGateway.canStopGateway).mockReturnValue(false);

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'remote',
      canStop: false,
      endpoint: 'https://gateway.example.com',
      active: true,
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
});
