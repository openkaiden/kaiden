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

import { existsSync } from 'node:fs';

import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { Directories } from '/@/plugin/directories.js';
import type { IConfigurationRegistry } from '/@api/configuration/models.js';

import type { OpenshellCli } from './openshell-cli.js';
import { OpenshellGatewayStateManager } from './openshell-gateway-state-manager.js';

vi.mock(import('node:fs'));

const openshellCli = {
  listGateways: vi.fn(),
  getGatewayInfo: vi.fn(),
} as unknown as OpenshellCli;

const directories = {
  getDataDirectory: vi.fn(() => '/mock-data-dir'),
} as unknown as Directories;
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
  pollInterval = 5;
  configurationChangeCallback = undefined;
  vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
    get: vi.fn(() => pollInterval),
  } as unknown as ReturnType<IConfigurationRegistry['getConfiguration']>);
  vi.mocked(configurationRegistry.onDidChangeConfiguration).mockImplementation(callback => {
    configurationChangeCallback = callback as (event: { key: string }) => void;
    return { dispose: vi.fn() };
  });
  vi.mocked(existsSync).mockReturnValue(false);
  manager = new OpenshellGatewayStateManager(openshellCli, configurationRegistry, directories);
});

afterEach(() => {
  manager.dispose();
  vi.useRealTimers();
});

test('builds a cached snapshot from registrations and runtime information', async () => {
  vi.mocked(openshellCli.listGateways).mockResolvedValue([
    { name: 'local', endpoint: 'http://127.0.0.1:17670', active: true },
    { name: 'remote', endpoint: 'https://gateway.example.com', active: false },
  ]);
  vi.mocked(openshellCli.getGatewayInfo)
    .mockResolvedValueOnce({ status: 'healthy', compute_drivers: [] })
    .mockResolvedValueOnce({ status: 'degraded', compute_drivers: [] });

  await manager.refresh();

  expect(openshellCli.getGatewayInfo).toHaveBeenCalledWith('local');
  expect(openshellCli.getGatewayInfo).toHaveBeenCalledWith('remote');
  expect(manager.listGateways()).toEqual([
    {
      name: 'local',
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy' },
    },
    {
      name: 'remote',
      endpoint: 'https://gateway.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'degraded' },
    },
  ]);
});

test('marks a gateway unreachable when runtime information cannot be retrieved', async () => {
  vi.mocked(openshellCli.listGateways).mockResolvedValue([{ name: 'stopped', endpoint: 'http://127.0.0.1:17671' }]);
  vi.mocked(openshellCli.getGatewayInfo).mockRejectedValue(new Error('connection refused'));

  await manager.refresh();

  expect(manager.listGateways()).toEqual([
    {
      name: 'stopped',
      endpoint: 'http://127.0.0.1:17671',
      gatewayState: { reachable: false, health: 'unknown' },
    },
  ]);
});

test('fires an update when a registration is removed by the CLI', async () => {
  const listener = vi.fn();
  manager.onDidUpdateGateways(listener);
  vi.mocked(openshellCli.listGateways)
    .mockResolvedValueOnce([{ name: 'local', endpoint: 'http://127.0.0.1:17670' }])
    .mockResolvedValueOnce([]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

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
  vi.mocked(openshellCli.listGateways).mockResolvedValue([
    { name: 'local', endpoint: 'http://127.0.0.1:17670', active: true },
  ]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();
  listener.mockClear();
  await manager.refresh();

  expect(listener).not.toHaveBeenCalled();
});

test('runs a trailing refresh when another refresh is requested while one is active', async () => {
  let resolveFirstRefresh: (gateways: [{ name: string; endpoint: string }]) => void;
  vi.mocked(openshellCli.listGateways)
    .mockReturnValueOnce(
      new Promise(resolve => {
        resolveFirstRefresh = resolve;
      }),
    )
    .mockResolvedValueOnce([{ name: 'new', endpoint: 'http://127.0.0.1:17671' }]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  const activeRefresh = manager.refresh();
  const queuedRefresh = manager.refresh();
  resolveFirstRefresh!([{ name: 'old', endpoint: 'http://127.0.0.1:17670' }]);

  await Promise.all([activeRefresh, queuedRefresh]);

  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);
  expect(manager.listGateways()).toEqual([
    {
      name: 'new',
      endpoint: 'http://127.0.0.1:17671',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
});

test('fires an update when active selection or gateway state changes', async () => {
  const listener = vi.fn();
  manager.onDidUpdateGateways(listener);
  vi.mocked(openshellCli.listGateways)
    .mockResolvedValueOnce([{ name: 'local', endpoint: 'http://127.0.0.1:17670', active: false }])
    .mockResolvedValueOnce([{ name: 'local', endpoint: 'http://127.0.0.1:17670', active: true }]);
  vi.mocked(openshellCli.getGatewayInfo)
    .mockResolvedValueOnce({ status: 'healthy', compute_drivers: [] })
    .mockResolvedValueOnce({ status: 'unhealthy', compute_drivers: [] });

  await manager.refresh();
  listener.mockClear();
  await manager.refresh();

  expect(listener).toHaveBeenCalledOnce();
  expect(manager.listGateways()[0]).toEqual(
    expect.objectContaining({
      active: true,
      gatewayState: { reachable: true, health: 'unhealthy' },
    }),
  );
});

test('polls gateways and stops polling when disposed', async () => {
  vi.useFakeTimers();
  vi.mocked(openshellCli.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(0);
  expect(openshellCli.listGateways).toHaveBeenCalledOnce();

  await vi.advanceTimersByTimeAsync(5000);
  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);

  manager.dispose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);
});

test('waits for the initial refresh before becoming ready', async () => {
  let resolveListGateways: (gateways: []) => void;
  vi.mocked(openshellCli.listGateways).mockReturnValue(
    new Promise(resolve => {
      resolveListGateways = resolve;
    }),
  );

  manager.init();
  const ready = manager.whenReady();

  expect(manager.listGateways()).toEqual([]);
  resolveListGateways!([]);
  await ready;
  expect(openshellCli.listGateways).toHaveBeenCalledOnce();
});

test('becomes ready after the initial refresh fails and a later refresh succeeds', async () => {
  vi.mocked(openshellCli.listGateways)
    .mockRejectedValueOnce(new Error('temporary startup failure'))
    .mockResolvedValue([]);

  manager.init();

  await expect(manager.whenReady()).rejects.toThrow('temporary startup failure');
  await manager.refresh();
  await expect(manager.whenReady()).resolves.toBeUndefined();
  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);
});

test('reschedules polling when the configured interval changes', async () => {
  vi.useFakeTimers();
  vi.mocked(openshellCli.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(0);
  expect(openshellCli.listGateways).toHaveBeenCalledOnce();

  pollInterval = 1;
  configurationChangeCallback?.({ key: 'openshell.gateway.pollInterval' });

  await vi.advanceTimersByTimeAsync(999);
  expect(openshellCli.listGateways).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);
});

test('clamps polling intervals below one second', async () => {
  vi.useFakeTimers();
  pollInterval = 0;
  vi.mocked(openshellCli.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(999);
  expect(openshellCli.listGateways).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);
});

test('sets source to kaiden for the default kaiden-local gateway', async () => {
  vi.mocked(openshellCli.listGateways).mockResolvedValue([
    { name: 'kaiden-local', endpoint: 'http://127.0.0.1:17670', active: true },
  ]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();

  expect(manager.listGateways()[0]).toEqual(expect.objectContaining({ name: 'kaiden-local', source: 'kaiden' }));
});

test('sets source to kaiden for a created gateway with gateway.toml', async () => {
  vi.mocked(existsSync).mockImplementation(
    p => String(p) === '/mock-data-dir/openshell-gateways/my-gateway/gateway.toml',
  );
  vi.mocked(openshellCli.listGateways).mockResolvedValue([
    { name: 'my-gateway', endpoint: 'http://127.0.0.1:17675', active: true },
  ]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();

  expect(manager.listGateways()[0]).toEqual(expect.objectContaining({ name: 'my-gateway', source: 'kaiden' }));
});

test('does not set source for a gateway without gateway.toml', async () => {
  vi.mocked(openshellCli.listGateways).mockResolvedValue([
    { name: 'external-gw', endpoint: 'https://gateway.example.com', active: false },
  ]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

  await manager.refresh();

  expect(manager.listGateways()[0]).not.toHaveProperty('source');
});

test('sets source to kaiden for unreachable kaiden-managed gateway', async () => {
  vi.mocked(existsSync).mockImplementation(
    p => String(p) === '/mock-data-dir/openshell-gateways/my-gateway/gateway.toml',
  );
  vi.mocked(openshellCli.listGateways).mockResolvedValue([
    { name: 'my-gateway', endpoint: 'http://127.0.0.1:17675', active: true },
  ]);
  vi.mocked(openshellCli.getGatewayInfo).mockRejectedValue(new Error('connection refused'));

  await manager.refresh();

  expect(manager.listGateways()[0]).toEqual(
    expect.objectContaining({
      name: 'my-gateway',
      source: 'kaiden',
      gatewayState: { reachable: false, health: 'unknown' },
    }),
  );
});

test('clamps polling intervals above one hour', async () => {
  vi.useFakeTimers();
  pollInterval = 3601;
  vi.mocked(openshellCli.listGateways).mockResolvedValue([]);

  manager.init();
  await vi.advanceTimersByTimeAsync(3_599_999);
  expect(openshellCli.listGateways).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(openshellCli.listGateways).toHaveBeenCalledTimes(2);
});
