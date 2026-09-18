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

import type { OpenShellClient } from '@nvidia/openshell-sdk';
import type { FileSystemWatcher, InferenceProviderConnection } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { FilesystemMonitoring } from '/@/plugin/filesystem-monitoring.js';
import type { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import type { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import type { ProviderImpl } from '/@/plugin/provider-impl.js';
import type { ProviderRegistry } from '/@/plugin/provider-registry.js';
import type { SafeStorageRegistry } from '/@/plugin/safe-storage/safe-storage-registry.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

import { DefaultProviderFactory } from './default-provider-factory.js';
import { GcloudAdcProviderFactory } from './gcloud-adc-provider-factory.js';
import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';
import { SecretManager } from './secret-manager.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));

let manager: SecretManager;

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};
const ipcHandle: IPCHandle = vi.fn();

const mockRaw = {
  createProvider: vi.fn(),
  listProviders: vi.fn(),
  deleteProvider: vi.fn(),
  listProviderProfiles: vi.fn(),
};
const mockClient = { raw: mockRaw } as unknown as OpenShellClient;
const sdkClientManager = new OpenshellSdkClientManager(undefined!, undefined!);
const openshellAdapter = new OpenshellSecretAdapter(
  sdkClientManager,
  [new GcloudAdcProviderFactory()],
  new DefaultProviderFactory(),
);

let gatewayStartCallback: (() => void) | undefined;

const providerRegistry = {
  getInferenceConnection: vi.fn(),
  getProvider: vi.fn(),
} as unknown as ProviderRegistry;

const extensionStorageMock = {
  get: vi.fn(),
} as unknown as ReturnType<SafeStorageRegistry['getExtensionStorage']>;

const configurationRegistry = {
  getConfiguration: vi.fn(),
  getConfigurationProperties: vi.fn(),
} as unknown as IConfigurationRegistry;

const safeStorageRegistry = {
  getExtensionStorage: vi.fn().mockReturnValue(extensionStorageMock),
} as unknown as SafeStorageRegistry;

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
  vi.mocked(safeStorageRegistry.getExtensionStorage).mockReturnValue(extensionStorageMock);
  vi.mocked(openshellGatewayStateManager.whenReady).mockResolvedValue(undefined);
  vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
    { name: 'kaiden', endpoint: 'http://localhost' },
  ]);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient);
  manager = new SecretManager(
    apiSender,
    ipcHandle,
    openshellAdapter,
    providerRegistry,
    configurationRegistry,
    safeStorageRegistry,
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
        GH_TOKEN: 'ghp_abc123',
      },
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
    gatewayStartCallback = undefined;
    vi.mocked(filesystemMonitoring.createFileSystemWatcher).mockReturnValue(mockWatcher);
    vi.mocked(safeStorageRegistry.getExtensionStorage).mockReturnValue(extensionStorageMock);
    vi.mocked(openshellGatewayStateManager.whenReady).mockResolvedValue(undefined);
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      { name: 'kaiden', endpoint: 'http://localhost' },
    ]);
    vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient);
    manager = new SecretManager(
      apiSender,
      ipcHandle,
      openshellAdapter,
      providerRegistry,
      configurationRegistry,
      safeStorageRegistry,
      openshellGateway,
      openshellGatewayStateManager,
    );
    manager.init();
  });

  test('delegates create to openshellAdapter', async () => {
    mockRaw.createProvider.mockResolvedValue({});

    const result = await manager.create(defaultOptions);

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'my-secret' },
        type: 'github',
        credentials: { GH_TOKEN: 'ghp_abc123' },
        config: {},
      },
      workspace: '',
    });
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('delegates list to openshellAdapter', async () => {
    mockRaw.listProviders.mockResolvedValue({
      providers: [
        { metadata: { name: 'my-openai' }, type: 'openai' },
        { metadata: { name: 'my-anthropic' }, type: 'anthropic' },
      ],
    });

    const result = await manager.list();

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('kaiden');
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['my-openai', 'my-anthropic']);
  });

  test('lists providers from every gateway and records their owning gateway', async () => {
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      { name: 'local', endpoint: 'http://local' },
      { name: 'remote', endpoint: 'http://remote' },
    ]);
    mockRaw.listProviders.mockResolvedValue({
      providers: [{ metadata: { name: 'shared-provider' }, type: 'openai' }],
    });

    const result = await manager.list();

    expect(result).toContainEqual({ name: 'shared-provider', type: 'openai', gateway: 'local' });
    expect(sdkClientManager.getClient).toHaveBeenCalledWith('local');
    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('lists providers only from the requested gateway', async () => {
    mockRaw.listProviders.mockResolvedValue({
      providers: [{ metadata: { name: 'remote-provider' }, type: 'openai' }],
    });

    await expect(manager.list('remote')).resolves.toEqual([
      { name: 'remote-provider', type: 'openai', gateway: 'remote' },
    ]);
    expect(openshellGatewayStateManager.whenReady).not.toHaveBeenCalled();
    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('keeps providers from reachable gateways when another gateway fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      { name: 'offline', endpoint: 'http://offline' },
      { name: 'online', endpoint: 'http://online' },
    ]);
    mockRaw.listProviders
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ providers: [{ metadata: { name: 'available-provider' }, type: 'openai' }] });

    await expect(manager.list()).resolves.toEqual([{ name: 'available-provider', type: 'openai', gateway: 'online' }]);
  });

  test('delegates remove to openshellAdapter', async () => {
    mockRaw.deleteProvider.mockResolvedValue({});

    const result = await manager.remove('my-openai');

    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({ name: 'my-openai', workspace: '' });
    expect(result).toEqual({ name: 'my-openai' });
  });

  test('removes a provider from its owning gateway', async () => {
    mockRaw.deleteProvider.mockResolvedValue({});

    await manager.remove('my-openai', 'remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('listServices delegates to openshellAdapter', async () => {
    mockRaw.listProviderProfiles.mockResolvedValue({
      profiles: [{ id: 'openai', displayName: 'OpenAI', description: 'OpenAI API provider', credentials: [] }],
    });

    const result = await manager.listServices();

    expect(result).toEqual([
      { id: 'openai', display_name: 'OpenAI', description: 'OpenAI API provider', credentials: [] },
    ]);
  });

  test('skips file watching', () => {
    expect(filesystemMonitoring.createFileSystemWatcher).not.toHaveBeenCalled();
  });

  test('still emits secret-manager-update on create', async () => {
    mockRaw.createProvider.mockResolvedValue({});

    await manager.create(defaultOptions);

    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });

  test('still emits secret-manager-update on remove', async () => {
    mockRaw.deleteProvider.mockResolvedValue({});

    await manager.remove('my-openai');

    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });
});

describe('inference connection lifecycle', () => {
  const mockConnection: InferenceProviderConnection = {
    id: 'conn-123',
    name: 'test-connection',
    type: 'cloud',
    sdk: {} as InferenceProviderConnection['sdk'],
    status: () => 'started',
    models: [{ label: 'model-1' }],
    credentials: () => ({ token: 'secret-token' }),
  };

  test('getSecretForModel returns SecretInfo matching by name', async () => {
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: mockConnection,
      providerId: 'kaiden.cursor',
    });
    mockRaw.listProviders.mockResolvedValue({
      providers: [
        { metadata: { name: 'other-provider' }, type: 'other' },
        { metadata: { name: 'kaiden.cursor-conn-123' }, type: 'cursor' },
      ],
    });

    const secret = await manager.getSecretForModel('cursor::model-1::', 'remote');
    expect(secret).toEqual({ name: 'kaiden.cursor-conn-123', type: 'cursor' });
    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('getSecretForModel returns undefined for unknown model', async () => {
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue(undefined);

    const secret = await manager.getSecretForModel('unknown::model::');
    expect(secret).toBeUndefined();
  });

  test('getSecretForModel returns correct type for vertex-ai provider', async () => {
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: mockConnection,
      providerId: 'kaiden.vertex-ai',
    });
    mockRaw.listProviders.mockResolvedValue({
      providers: [{ metadata: { name: 'kaiden.vertex-ai-conn-123' }, type: 'vertex-ai' }],
    });

    const secret = await manager.getSecretForModel('vertexai::model-1::');
    expect(secret).toEqual({ name: 'kaiden.vertex-ai-conn-123', type: 'vertex-ai' });
  });
});

describe('createSecretForConnection', () => {
  const mockConnection: InferenceProviderConnection = {
    id: 'conn-456',
    name: 'test-connection',
    type: 'cloud',
    sdk: {} as InferenceProviderConnection['sdk'],
    status: () => 'started',
    models: [{ label: 'model-1' }],
    credentials: () => ({ token: 'secret-token' }),
  };

  function setupConfigMocksForCreate(secretType: string): void {
    const properties = {
      'cursor.connection._type': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.cursor' },
        title: 'Cursor',
        parentId: 'cursor',
      },
      'cursor.connection.token': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.cursor' },
        format: 'password',
        title: 'Cursor',
        parentId: 'cursor',
      },
    } as Record<string, Record<string, unknown>>;

    vi.mocked(configurationRegistry.getConfigurationProperties).mockReturnValue(
      properties as unknown as ReturnType<typeof configurationRegistry.getConfigurationProperties>,
    );
    vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === 'cursor.connection._type') return secretType;
        if (key === 'cursor.connection.token') return 'cursor:conn-456:token';
        return undefined;
      }),
      has: vi.fn(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof configurationRegistry.getConfiguration>);

    vi.mocked(extensionStorageMock.get).mockResolvedValue('actual-api-key');
    mockRaw.listProviders.mockResolvedValue({ providers: [] });
    mockRaw.createProvider.mockResolvedValue({});
    vi.mocked(providerRegistry.getProvider).mockReturnValue({
      extensionId: 'kaiden.cursor',
    } as unknown as ProviderImpl);
  }

  test('creates secret and returns SecretInfo when none exists', async () => {
    setupConfigMocksForCreate('cursor');

    const result = await manager.createSecretForConnection('kaiden.cursor', mockConnection);

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'kaiden.cursor-conn-456' },
        type: 'cursor',
        credentials: { token: 'actual-api-key' },
        config: {},
      },
      workspace: '',
    });
    expect(result).toEqual({ name: 'kaiden.cursor-conn-456', type: 'cursor' });
  });

  test('returns undefined when _type is not configured', async () => {
    vi.mocked(configurationRegistry.getConfigurationProperties).mockReturnValue({});
    vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
      get: vi.fn(() => undefined),
      has: vi.fn(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof configurationRegistry.getConfiguration>);
    vi.mocked(providerRegistry.getProvider).mockReturnValue({
      extensionId: 'kaiden.cursor',
    } as unknown as ProviderImpl);

    const result = await manager.createSecretForConnection('kaiden.cursor', mockConnection);

    expect(result).toBeUndefined();
    expect(mockRaw.createProvider).not.toHaveBeenCalled();
  });
});

describe('ensureSecretForModel', () => {
  const mockConnection: InferenceProviderConnection = {
    id: 'conn-789',
    name: 'test-connection',
    type: 'cloud',
    sdk: {} as InferenceProviderConnection['sdk'],
    status: () => 'started',
    models: [{ label: 'model-1' }],
    credentials: () => ({ token: 'secret-token' }),
  };

  test('returns existing secret without creating', async () => {
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: mockConnection,
      providerId: 'kaiden.cursor',
    });
    mockRaw.listProviders.mockResolvedValue({
      providers: [{ metadata: { name: 'kaiden.cursor-conn-789' }, type: 'cursor' }],
    });

    const result = await manager.ensureSecretForModel('cursor::model-1::', 'remote');

    expect(result).toEqual({ name: 'kaiden.cursor-conn-789', type: 'cursor' });
    expect(mockRaw.createProvider).not.toHaveBeenCalled();
    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
  });

  test('creates and returns secret when missing but connection exists', async () => {
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: mockConnection,
      providerId: 'kaiden.cursor',
    });
    mockRaw.listProviders.mockResolvedValue({ providers: [] });
    mockRaw.createProvider.mockResolvedValue({});
    vi.mocked(providerRegistry.getProvider).mockReturnValue({
      extensionId: 'kaiden.cursor',
    } as unknown as ProviderImpl);

    const properties = {
      'cursor.connection._type': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.cursor' },
        title: 'Cursor',
        parentId: 'cursor',
      },
      'cursor.connection.token': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.cursor' },
        format: 'password',
        title: 'Cursor',
        parentId: 'cursor',
      },
    } as Record<string, Record<string, unknown>>;
    vi.mocked(configurationRegistry.getConfigurationProperties).mockReturnValue(
      properties as unknown as ReturnType<typeof configurationRegistry.getConfigurationProperties>,
    );
    vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === 'cursor.connection._type') return 'cursor';
        if (key === 'cursor.connection.token') return 'cursor:conn-789:token';
        return undefined;
      }),
      has: vi.fn(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof configurationRegistry.getConfiguration>);
    vi.mocked(extensionStorageMock.get).mockResolvedValue('actual-api-key');

    const result = await manager.ensureSecretForModel('cursor::model-1::', 'remote');

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'kaiden.cursor-conn-789' },
        type: 'cursor',
        credentials: { token: 'actual-api-key' },
        config: {},
      },
      workspace: '',
    });
    expect(result).toEqual({ name: 'kaiden.cursor-conn-789', type: 'cursor' });
  });

  test('returns undefined when no inference connection found', async () => {
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue(undefined);

    const result = await manager.ensureSecretForModel('unknown::model::');

    expect(result).toBeUndefined();
    expect(mockRaw.createProvider).not.toHaveBeenCalled();
  });
});
