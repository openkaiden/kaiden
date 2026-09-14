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

import type { FileSystemWatcher } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { FilesystemMonitoring } from '/@/plugin/filesystem-monitoring.js';
import { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import type { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import type { Exec } from '/@/plugin/util/exec.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';
import { SecretManager } from './secret-manager.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-cli.js'));

let manager: SecretManager;

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};
const ipcHandle: IPCHandle = vi.fn();
const openshellCli = new OpenshellCli({} as Exec, {} as CliToolRegistry);
const openshellAdapter = new OpenshellSecretAdapter(openshellCli);

let gatewayStartCallback: (() => void) | undefined;

const configurationRegistry = {
  getConfiguration: vi.fn(),
  getConfigurationProperties: vi.fn(),
} as unknown as IConfigurationRegistry;

const openshellGateway = {
  onDidGatewayStart: vi.fn((cb: () => void) => {
    gatewayStartCallback = cb;
    return { dispose: vi.fn() };
  }),
} as unknown as OpenshellGateway;

const openshellGatewayStateManager = {
  whenReady: vi.fn().mockResolvedValue(undefined),
  listGateways: vi.fn().mockReturnValue([{ name: 'kaiden', endpoint: 'http://localhost' }]),
} as unknown as OpenshellGatewayStateManager;

const mockWatcher = {
  onDidChange: vi.fn(),
  onDidCreate: vi.fn(),
  onDidDelete: vi.fn(),
  dispose: vi.fn(),
} as unknown as FileSystemWatcher;
const filesystemMonitoring = {
  createFileSystemWatcher: vi.fn().mockReturnValue(mockWatcher),
} as unknown as FilesystemMonitoring;

beforeEach(() => {
  vi.resetAllMocks();
  gatewayStartCallback = undefined;
  vi.mocked(filesystemMonitoring.createFileSystemWatcher).mockReturnValue(mockWatcher);
  vi.mocked(openshellGatewayStateManager.whenReady).mockResolvedValue(undefined);
  vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
    { name: 'kaiden', endpoint: 'http://localhost' },
  ]);
  manager = new SecretManager(
    apiSender,
    ipcHandle,
    openshellAdapter,
    configurationRegistry,
    openshellGateway,
    openshellGatewayStateManager,
  );
  manager.init();
});

describe('init', () => {
  test('registers IPC handler for create', () => {
    expect(ipcHandle).toHaveBeenCalledWith('secret-manager:create', expect.any(Function));
  });

  test('registers IPC handler for list', () => {
    expect(ipcHandle).toHaveBeenCalledWith('secret-manager:list', expect.any(Function));
  });

  test('registers IPC handler for remove', () => {
    expect(ipcHandle).toHaveBeenCalledWith('secret-manager:remove', expect.any(Function));
  });

  test('subscribes to gateway start event', () => {
    expect(openshellGateway.onDidGatewayStart).toHaveBeenCalled();
  });

  test('sends secret-manager-update when gateway starts', () => {
    gatewayStartCallback!();
    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });
});

describe('openshellAdapter', () => {
  const defaultOptions: SecretCreateOptions = {
    name: 'my-secret',
    type: 'github',
    value: {
      credentials: {
        GH_TOKEN: 'ghp_...',
      },
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    gatewayStartCallback = undefined;
    vi.mocked(filesystemMonitoring.createFileSystemWatcher).mockReturnValue(mockWatcher);
    vi.mocked(openshellGatewayStateManager.whenReady).mockResolvedValue(undefined);
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      { name: 'kaiden', endpoint: 'http://localhost' },
    ]);
    manager = new SecretManager(
      apiSender,
      ipcHandle,
      openshellAdapter,
      configurationRegistry,
      openshellGateway,
      openshellGatewayStateManager,
    );
    manager.init();
  });

  test('delegates create to openshellAdapter', async () => {
    vi.mocked(openshellCli.createProvider).mockResolvedValue(undefined);

    const result = await manager.create(defaultOptions);

    expect(openshellCli.createProvider).toHaveBeenCalledWith(
      {
        name: 'my-secret',
        type: 'github',
        credentials: { GH_TOKEN: 'ghp_...' },
      },
      undefined,
    );
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('delegates list to openshellAdapter', async () => {
    vi.mocked(openshellCli.listProviders).mockResolvedValue([
      { name: 'my-openai', type: 'openai' },
      { name: 'my-anthropic', type: 'anthropic' },
    ]);

    const result = await manager.list();

    expect(openshellCli.listProviders).toHaveBeenCalledWith('kaiden');
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['my-openai', 'my-anthropic']);
  });

  test('lists providers from every gateway and records their owning gateway', async () => {
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      { name: 'local', endpoint: 'http://local' },
      { name: 'remote', endpoint: 'http://remote' },
    ]);
    vi.mocked(openshellCli.listProviders).mockImplementation(async gateway => {
      return gateway === 'local'
        ? [{ name: 'shared-provider', type: 'openai' }]
        : [{ name: 'shared-provider', type: 'anthropic' }];
    });

    await expect(manager.list()).resolves.toEqual([
      { name: 'shared-provider', type: 'openai', gateway: 'local' },
      { name: 'shared-provider', type: 'anthropic', gateway: 'remote' },
    ]);
    expect(openshellCli.listProviders).toHaveBeenNthCalledWith(1, 'local');
    expect(openshellCli.listProviders).toHaveBeenNthCalledWith(2, 'remote');
  });

  test('lists providers only from the requested gateway', async () => {
    vi.mocked(openshellCli.listProviders).mockResolvedValue([{ name: 'remote-provider', type: 'openai' }]);

    await expect(manager.list('remote')).resolves.toEqual([
      { name: 'remote-provider', type: 'openai', gateway: 'remote' },
    ]);
    expect(openshellGatewayStateManager.whenReady).not.toHaveBeenCalled();
    expect(openshellCli.listProviders).toHaveBeenCalledWith('remote');
  });

  test('keeps providers from reachable gateways when another gateway fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      { name: 'offline', endpoint: 'http://offline' },
      { name: 'online', endpoint: 'http://online' },
    ]);
    vi.mocked(openshellCli.listProviders)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce([{ name: 'available-provider', type: 'openai' }]);

    await expect(manager.list()).resolves.toEqual([{ name: 'available-provider', type: 'openai', gateway: 'online' }]);
  });

  test('delegates remove to openshellAdapter', async () => {
    vi.mocked(openshellCli.deleteProvider).mockResolvedValue(undefined);

    const result = await manager.remove('my-openai');

    expect(openshellCli.deleteProvider).toHaveBeenCalledWith('my-openai', undefined);
    expect(result).toEqual({ name: 'my-openai' });
  });

  test('removes a provider from its owning gateway', async () => {
    vi.mocked(openshellCli.deleteProvider).mockResolvedValue(undefined);

    await manager.remove('my-openai', 'remote');

    expect(openshellCli.deleteProvider).toHaveBeenCalledWith('my-openai', 'remote');
  });

  test('listServices delegates to openshellAdapter', async () => {
    const profiles = [{ id: 'openai', display_name: 'OpenAI', description: 'OpenAI API provider' }];
    vi.mocked(openshellCli.listProfiles).mockResolvedValue(profiles);

    const result = await manager.listServices();

    expect(result).toEqual(profiles);
  });

  test('skips file watching', () => {
    expect(filesystemMonitoring.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  test('still emits secret-manager-update on create', async () => {
    vi.mocked(openshellCli.createProvider).mockResolvedValue(undefined);

    await manager.create(defaultOptions);

    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });

  test('still emits secret-manager-update on remove', async () => {
    vi.mocked(openshellCli.deleteProvider).mockResolvedValue(undefined);

    await manager.remove('my-openai');

    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });
});
