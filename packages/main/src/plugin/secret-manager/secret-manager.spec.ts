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

import { randomUUID } from 'node:crypto';

import { create } from '@bufbuild/protobuf';
import type { OpenShellClient } from '@nvidia/openshell-sdk';
import { ProviderProfileSchema } from '@nvidia/openshell-sdk/raw';
import type { FileSystemWatcher, InferenceProviderConnection } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { FilesystemMonitoring } from '/@/plugin/filesystem-monitoring.js';
import type { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import type { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { OpenshellNetworkPolicy } from '/@/plugin/openshell-cli/openshell-network-policy.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { DEFAULT_WORKSPACE, DEFAULT_WORKSPACE_SCOPE } from '/@/plugin/openshell-cli/openshell-utils.js';
import { OpenShellRegistry } from '/@/plugin/openshell-registry.js';
import type { ProviderImpl } from '/@/plugin/provider-impl.js';
import type { ProviderRegistry } from '/@/plugin/provider-registry.js';
import type { SafeStorageRegistry } from '/@/plugin/safe-storage/safe-storage-registry.js';
import { Properties } from '/@/plugin/util/properties.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { SecretCreateOptions } from '/@api/secret-info.js';

import { DefaultProviderFactory } from './default-provider-factory.js';
import { GcloudAdcProviderFactory } from './gcloud-adc-provider-factory.js';
import { OpenshellSecretAdapter } from './openshell-secret-adapter.js';
import { SecretManager } from './secret-manager.js';

vi.mock(import('node:crypto'));

vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));
vi.mock(import('/@/plugin/openshell-registry.js'));

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
  importProviderProfiles: vi.fn(),
  deleteProviderProfile: vi.fn(),
};
const mockClient = { raw: mockRaw } as unknown as OpenShellClient;
const sdkClientManager = new OpenshellSdkClientManager(undefined!, undefined!);
const openshellNetworkPolicy = new OpenshellNetworkPolicy();
const openshellRegistry = new OpenShellRegistry(apiSender, new Properties());
const openshellAdapter = new OpenshellSecretAdapter(
  sdkClientManager,
  [new GcloudAdcProviderFactory()],
  new DefaultProviderFactory(),
  openshellNetworkPolicy,
  openshellRegistry,
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
  listGateways: vi.fn().mockReturnValue([{ canStop: false, name: 'kaiden', endpoint: 'http://localhost' }]),
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
    { canStop: false, name: 'kaiden', endpoint: 'http://localhost' },
  ]);
  vi.mocked(sdkClientManager.getClient).mockResolvedValue(mockClient);
  vi.mocked(randomUUID).mockReturnValue('00-01-02-03-04');
  manager = new SecretManager(
    apiSender,
    ipcHandle,
    openshellAdapter,
    providerRegistry,
    configurationRegistry,
    safeStorageRegistry,
    openshellGateway,
    openshellGatewayStateManager,
    openshellNetworkPolicy,
    openshellRegistry,
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
      { canStop: false, name: 'kaiden', endpoint: 'http://localhost' },
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
      openshellNetworkPolicy,
      openshellRegistry,
    );
    manager.init();
  });

  test('delegates create to openshellAdapter', async () => {
    mockRaw.createProvider.mockResolvedValue({});

    const result = await manager.create(defaultOptions);

    expect(mockRaw.createProvider).toHaveBeenCalledWith({
      provider: {
        metadata: { name: 'my-secret' },
        profileWorkspace: DEFAULT_WORKSPACE,
        type: 'github',
        credentials: { GH_TOKEN: 'ghp_abc123' },
        config: {},
      },
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
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
      { canStop: false, name: 'local', endpoint: 'http://local' },
      { canStop: false, name: 'remote', endpoint: 'http://remote' },
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
      { canStop: false, name: 'offline', endpoint: 'http://offline' },
      { canStop: false, name: 'online', endpoint: 'http://online' },
    ]);
    mockRaw.listProviders
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ providers: [{ metadata: { name: 'available-provider' }, type: 'openai' }] });

    await expect(manager.list()).resolves.toEqual([{ name: 'available-provider', type: 'openai', gateway: 'online' }]);
  });

  test('delegates remove to openshellAdapter', async () => {
    mockRaw.deleteProvider.mockResolvedValue({});

    const result = await manager.remove('my-openai');

    expect(mockRaw.deleteProvider).toHaveBeenCalledWith({
      name: 'my-openai',
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
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

describe('ensureSecretForSandbox', () => {
  const mockConnection: InferenceProviderConnection = {
    id: 'conn-sandbox',
    name: 'test-connection',
    type: 'cloud',
    sdk: {} as InferenceProviderConnection['sdk'],
    status: () => 'started',
    models: [{ label: 'model-1' }],
    credentials: () => ({ token: 'secret-token' }),
  };

  test('creates sandbox-named secret when none exists', async () => {
    mockRaw.listProviders.mockResolvedValue({ providers: [] });
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: mockConnection,
      providerId: 'kaiden.openai',
    });
    vi.mocked(providerRegistry.getProvider).mockReturnValue({
      extensionId: 'kaiden.openai',
    } as unknown as ProviderImpl);
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [] }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const properties = {
      'openai.connection._type': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.openai' },
      },
      'openai.connection.token': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.openai' },
        format: 'password',
      },
    } as Record<string, Record<string, unknown>>;
    vi.mocked(configurationRegistry.getConfigurationProperties).mockReturnValue(
      properties as unknown as ReturnType<typeof configurationRegistry.getConfigurationProperties>,
    );
    vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === 'openai.connection._type') return 'openai';
        if (key === 'openai.connection.token') return 'openai:conn-sandbox:token';
        return undefined;
      }),
      has: vi.fn(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof configurationRegistry.getConfiguration>);
    vi.mocked(extensionStorageMock.get).mockResolvedValue('actual-api-key');
    mockRaw.createProvider.mockResolvedValue({});

    const result = await manager.ensureSecretForSandbox('my-sandbox', 'openai::gpt-4::', 'claude', 'kaiden');

    expect(result).toEqual({ secretName: 'my-sandbox-00-01-02-03-04', clonedProfile: 'my-sandbox-00-01-02-03-04' });
    expect(mockRaw.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          metadata: { name: 'my-sandbox-00-01-02-03-04' },
          type: 'my-sandbox-00-01-02-03-04',
        }),
      }),
    );
  });

  test('profile rollbacked if create secret fails', async () => {
    mockRaw.listProviders.mockResolvedValue({ providers: [] });
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: mockConnection,
      providerId: 'kaiden.openai',
    });
    vi.mocked(providerRegistry.getProvider).mockReturnValue({
      extensionId: 'kaiden.openai',
    } as unknown as ProviderImpl);
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [] }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const properties = {
      'openai.connection._type': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.openai' },
      },
      'openai.connection.token': {
        scope: 'InferenceProviderConnection',
        extension: { id: 'kaiden.openai' },
        format: 'password',
      },
    } as Record<string, Record<string, unknown>>;
    vi.mocked(configurationRegistry.getConfigurationProperties).mockReturnValue(
      properties as unknown as ReturnType<typeof configurationRegistry.getConfigurationProperties>,
    );
    vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
      get: vi.fn((key: string) => {
        if (key === 'openai.connection._type') return 'openai';
        if (key === 'openai.connection.token') return 'openai:conn-sandbox:token';
        return undefined;
      }),
      has: vi.fn(),
      update: vi.fn(),
    } as unknown as ReturnType<typeof configurationRegistry.getConfiguration>);
    vi.mocked(extensionStorageMock.get).mockResolvedValue('actual-api-key');
    mockRaw.createProvider.mockRejectedValue(new Error(`Can't create provider`));

    await expect(manager.ensureSecretForSandbox('my-sandbox', 'openai::gpt-4::', 'claude', 'kaiden')).rejects.toThrow(
      /Can't create provider/,
    );

    expect(mockRaw.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: expect.objectContaining({
          metadata: { name: 'my-sandbox-00-01-02-03-04' },
          type: 'my-sandbox-00-01-02-03-04',
        }),
      }),
    );
    expect(mockRaw.deleteProviderProfile).toHaveBeenCalledWith({
      id: 'my-sandbox-00-01-02-03-04',
      allowMissing: true,
      workspaceScope: DEFAULT_WORKSPACE_SCOPE,
    });
  });

  test('returns undefined when no inference connection exists', async () => {
    mockRaw.listProviders.mockResolvedValue({ providers: [] });
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue(undefined);

    const result = await manager.ensureSecretForSandbox('my-sandbox', 'unknown::model::', 'claude');

    expect(result).toBeUndefined();
  });
});

describe('resolveProfileForAgent', () => {
  test('clones profile when no binaries field (absence means no binary authorised)', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, { id: 'openai', displayName: 'OpenAI', credentials: [] }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBe('test-sandbox-test-uuid-1234');
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              id: 'test-sandbox-test-uuid-1234',
              binaries: [expect.objectContaining({ path: '/**/claude' })],
            }),
          }),
        ],
        workspaceScope: DEFAULT_WORKSPACE_SCOPE,
      }),
    );
  });

  test('clones profile when binaries is empty (no binary authorised)', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [] }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBe('test-sandbox-test-uuid-1234');
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              id: 'test-sandbox-test-uuid-1234',
              binaries: [expect.objectContaining({ path: '/**/claude' })],
            }),
          }),
        ],
        workspaceScope: DEFAULT_WORKSPACE_SCOPE,
      }),
    );
  });

  test('clones profile with existing binaries when agent command already matches', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, {
        id: 'openai',
        displayName: 'OpenAI',
        credentials: [],
        binaries: [{ path: '**/claude' }, { path: '/usr/bin/node' }],
      }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: '/usr/local/bin/claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBe('test-sandbox-test-uuid-1234');
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              id: 'test-sandbox-test-uuid-1234',
              binaries: [
                expect.objectContaining({ path: '**/claude' }),
                expect.objectContaining({ path: '/usr/bin/node' }),
              ],
            }),
          }),
        ],
      }),
    );
  });

  test('clones profile when agent command is not in binaries', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, {
        id: 'openai',
        displayName: 'OpenAI',
        credentials: [],
        binaries: [{ path: '/usr/bin/node' }],
      }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBe('test-sandbox-test-uuid-1234');
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              id: 'test-sandbox-test-uuid-1234',
              binaries: [
                expect.objectContaining({ path: '/usr/bin/node' }),
                expect.objectContaining({ path: '/**/claude' }),
              ],
            }),
          }),
        ],
        workspaceScope: DEFAULT_WORKSPACE_SCOPE,
      }),
    );
  });

  test('clones profile with absolute agent command', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, {
        id: 'openai',
        displayName: 'OpenAI',
        credentials: [],
        binaries: [{ path: '/usr/bin/node' }],
      }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: '/usr/local/bin/claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBe('test-sandbox-test-uuid-1234');
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              id: 'test-sandbox-test-uuid-1234',
              binaries: [
                expect.objectContaining({ path: '/usr/bin/node' }),
                expect.objectContaining({ path: '/usr/local/bin/claude' }),
              ],
            }),
          }),
        ],
        workspaceScope: DEFAULT_WORKSPACE_SCOPE,
      }),
    );
  });

  test('passes gateway when cloning profile', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, {
        id: 'openai',
        displayName: 'OpenAI',
        credentials: [],
        binaries: [{ path: '/usr/bin/node' }],
      }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
      gateway: 'remote-gw',
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              id: 'test-sandbox-test-uuid-1234',
              binaries: [
                expect.objectContaining({ path: '/usr/bin/node' }),
                expect.objectContaining({ path: '/**/claude' }),
              ],
            }),
          }),
        ],
        workspaceScope: DEFAULT_WORKSPACE_SCOPE,
      }),
    );
  });

  test('uses sandbox name in cloned profile name regardless of endpoint', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [] }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const endpoint = 'http://localhost:11434/v1';
    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'my-sandbox',
      uuid: 'test-uuid-1234',
      endpoint,
    });

    expect(result).toBe('my-sandbox-test-uuid-1234');
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({ id: 'my-sandbox-test-uuid-1234' }),
          }),
        ],
      }),
    );
  });

  test('uses sandbox name without endpoint', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, { id: 'openai', displayName: 'OpenAI', credentials: [], binaries: [] }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBe('test-sandbox-test-uuid-1234');
  });

  test('passes endpoint to createProfile when cloning', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, {
        id: 'openai',
        displayName: 'OpenAI',
        credentials: [],
        binaries: [],
        endpoints: [],
      }),
    ]);
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const endpoint = 'http://localhost:11434/v1';
    await manager.resolveProfileForAgent({
      profileId: 'openai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
      endpoint,
    });

    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: expect.objectContaining({
              endpoints: expect.arrayContaining([
                expect.objectContaining({
                  host: 'host.openshell.internal',
                  port: 11434,
                }),
              ]),
            }),
          }),
        ],
      }),
    );
  });

  test('returns undefined without cloning for google-vertex-ai profile', async () => {
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([
      create(ProviderProfileSchema, {
        id: 'google-vertex-ai',
        displayName: 'Google Vertex AI',
        credentials: [],
        binaries: [{ path: '/**' }],
      }),
    ]);
    mockRaw.listProviderProfiles.mockResolvedValue({
      profiles: [{ id: 'google-vertex-ai' }],
    });

    const result = await manager.resolveProfileForAgent({
      profileId: 'google-vertex-ai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBeUndefined();
    expect(mockRaw.importProviderProfiles).not.toHaveBeenCalled();
  });

  test('imports google-vertex-ai profile to gateway when not present', async () => {
    const registryProfile = create(ProviderProfileSchema, {
      id: 'google-vertex-ai',
      displayName: 'Google Vertex AI',
      credentials: [],
      binaries: [{ path: '/**' }],
    });
    vi.mocked(openshellRegistry.getProfiles).mockReturnValue([registryProfile]);
    mockRaw.listProviderProfiles.mockResolvedValue({ profiles: [] });
    mockRaw.importProviderProfiles.mockResolvedValue({ imported: true, diagnostics: [] });

    const result = await manager.resolveProfileForAgent({
      profileId: 'google-vertex-ai',
      agentCommand: 'claude',
      sandboxName: 'test-sandbox',
      uuid: 'test-uuid-1234',
    });

    expect(result).toBeUndefined();
    expect(mockRaw.importProviderProfiles).toHaveBeenCalledWith(
      expect.objectContaining({
        profiles: [
          expect.objectContaining({
            profile: registryProfile,
            source: 'imported from registry',
          }),
        ],
      }),
    );
  });
});
