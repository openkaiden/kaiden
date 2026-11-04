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

import { inc } from 'semver';
import { afterEach, assert, beforeEach, expect, test, vi } from 'vitest';

import type { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { GatewayMetadata, ListedGateway } from '/@api/openshell-gateway-info.js';
import { MIN_GATEWAY_VERSION } from '/@api/openshell-gateway-info.js';

import { OpenshellGateway } from './openshell-gateway.js';
import type { OpenshellGatewayManager } from './openshell-gateway-manager.js';
import { OpenshellGatewayStateManager } from './openshell-gateway-state-manager.js';

function listed(name: string, endpoint: string, overrides: Partial<GatewayMetadata> = {}): ListedGateway {
  return {
    metadata: { name, gateway_endpoint: endpoint, is_remote: false, gateway_port: 0, ...overrides },
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
  vi.mocked(openshellGateway.canStartGateway).mockResolvedValue(false);
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

test.each([
  { reachable: false, pid: undefined, canStartGateway: true, expected: true },
  { reachable: true, pid: undefined, canStartGateway: true, expected: false },
  { reachable: false, pid: 1234, canStartGateway: true, expected: false },
  { reachable: false, pid: undefined, canStartGateway: false, expected: false },
])('offers start only for stopped managed gateways: %o', async ({ reachable, pid, canStartGateway, expected }) => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://localhost:17670')]);
  if (reachable) {
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });
  } else {
    vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('unreachable'));
  }
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(pid);
  vi.mocked(openshellGateway.canStartGateway).mockResolvedValue(canStartGateway);
  await manager.refresh();
  const [gateway] = manager.listGateways();
  assert(gateway);
  expect(gateway.canStart).toBe(expected);
});

test('withholds start and reports an unknown process when the PID cannot be read', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://localhost:17670')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('unreachable'));
  vi.mocked(openshellGateway.getGatewayPid).mockRejectedValue(new Error('EACCES: permission denied'));
  vi.mocked(openshellGateway.canStartGateway).mockResolvedValue(true);

  await manager.refresh();
  await manager.refresh();

  const [gateway] = manager.listGateways();
  assert(gateway);
  expect(gateway.canStart).toBe(false);
  expect(gateway.gatewayState?.process).toEqual({ status: 'unknown' });
  expect(warn).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith(
    '[openshell-gateway-state] cannot verify whether gateway "local" is running: EACCES: permission denied',
  );
});

test('offers start again once the PID can be read', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local', 'http://localhost:17670')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('unreachable'));
  vi.mocked(openshellGateway.getGatewayPid).mockRejectedValueOnce(new Error('EACCES: permission denied'));
  vi.mocked(openshellGateway.canStartGateway).mockResolvedValue(true);

  await manager.refresh();
  await manager.refresh();

  expect(openshellGateway.canStartGateway).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'local', endpoint: 'http://localhost:17670', is_remote: false }),
  );
  expect(manager.listGateways()).toEqual([
    expect.objectContaining({
      canStart: true,
      gatewayState: expect.objectContaining({ process: { status: 'not-running' } }),
    }),
  ]);
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
      canStart: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      type: 'local',
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: true, health: 'healthy', compatible: false },
    },
    {
      name: 'remote',
      canStop: false,
      canStart: false,
      endpoint: 'https://gateway.example.com',
      active: false,
      type: 'local',
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: true, health: 'degraded', compatible: false },
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
  expect(gw.gatewayState?.compatible).toBe(false);
});

const aboveMin = inc(MIN_GATEWAY_VERSION, 'patch');
assert(aboveMin);

test.each([
  { label: 'undefined', version: undefined, expected: false },
  { label: 'equal to minimum', version: MIN_GATEWAY_VERSION, expected: true },
  { label: 'above minimum', version: aboveMin, expected: true },
  { label: 'below minimum', version: '0.0.1', expected: false },
  { label: 'v-prefixed and compatible', version: `v${MIN_GATEWAY_VERSION}`, expected: true },
  { label: 'v-prefixed and incompatible', version: 'v0.0.1', expected: false },
  { label: 'prerelease of minimum', version: `${MIN_GATEWAY_VERSION}-rc.1`, expected: false },
  { label: 'prerelease above minimum', version: `${aboveMin}-rc.1`, expected: true },
  { label: 'unparseable', version: 'not-a-version', expected: false },
])('compatible is $expected when version is $label', async ({ version, expected }) => {
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

test('warns once per gateway when the reported version is unparseable', async () => {
  const originalConsoleWarn = console.warn;
  console.warn = vi.fn();
  try {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('gw-local', 'http://127.0.0.1:17670'),
      listed('gw-remote', 'https://gateway.example.com'),
    ]);
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      gateway_version: 'not-a-version',
      compute_drivers: [],
    });

    await manager.refresh();
    await manager.refresh();

    expect(console.warn).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      '[openshell-gateway-state] gateway "gw-local" reported unparseable version: not-a-version',
    );
    expect(console.warn).toHaveBeenCalledWith(
      '[openshell-gateway-state] gateway "gw-remote" reported unparseable version: not-a-version',
    );
  } finally {
    console.warn = originalConsoleWarn;
  }
});

test('marks a gateway unreachable when runtime information cannot be retrieved', async () => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('stopped', 'http://127.0.0.1:17671')]);
  vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('connection refused'));

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'stopped',
      canStop: false,
      canStart: false,
      endpoint: 'http://127.0.0.1:17671',
      active: false,
      type: 'local',
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
    },
  ]);
});

test.each([
  { expected: 'local', metadata: {} },
  { expected: 'remote', metadata: { is_remote: true } },
  { expected: 'cloud', metadata: { is_remote: true, auth_mode: 'cloudflare_jwt' } },
])('reports the $expected gateway type from the registration metadata', async ({ expected, metadata }) => {
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('gw', 'https://127.0.0.1:17670', metadata)]);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();

  expect(manager.listGateways()).toEqual([expect.objectContaining({ name: 'gw', type: expected })]);
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
    .mockResolvedValueOnce({ status: 'healthy', gateway_version: MIN_GATEWAY_VERSION, compute_drivers: [] })
    .mockResolvedValueOnce({ status: 'unhealthy', gateway_version: MIN_GATEWAY_VERSION, compute_drivers: [] });

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
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
    status: 'healthy',
    gateway_version: MIN_GATEWAY_VERSION,
    compute_drivers: [],
  });
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(12345);

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'local',
      canStop: false,
      canStart: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      type: 'local',
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      version: MIN_GATEWAY_VERSION,
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
      canStart: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      type: 'local',
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
      canStart: false,
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      type: 'local',
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
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
    status: 'healthy',
    gateway_version: MIN_GATEWAY_VERSION,
    compute_drivers: [],
  });
  vi.mocked(openshellGateway.getGatewayPid).mockResolvedValue(undefined);
  vi.mocked(openshellGateway.canStopGateway).mockReturnValue(false);

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'remote',
      canStop: false,
      canStart: false,
      endpoint: 'https://gateway.example.com',
      active: true,
      type: 'local',
      source: 'user',
      is_remote: false,
      remote_host: undefined,
      resolved_host: undefined,
      version: MIN_GATEWAY_VERSION,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
});
