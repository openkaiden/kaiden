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
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import type { Configuration, InferenceProviderConnection, SemanticRouterFactory } from '@openkaiden/api';
import { beforeEach, expect, test, vi } from 'vitest';
import { parse } from 'yaml';

import type { IPCHandle } from '/@/plugin/api.js';
import type { Directories } from '/@/plugin/directories.js';
import type { ProviderImpl } from '/@/plugin/provider-impl.js';
import type { ProviderRegistry } from '/@/plugin/provider-registry.js';
import type { SafeStorageRegistry } from '/@/plugin/safe-storage/safe-storage-registry.js';
import type { SecretManager } from '/@/plugin/secret-manager/secret-manager.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { SemanticRouterConfigInfo } from '/@api/semantic-router-info.js';

import { SemanticRouterManager } from './semantic-router-manager.js';

vi.mock('node:fs');
vi.mock('node:fs/promises');

const ROUTERS_DIR = resolve('/test/semantic-routers');

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
};

const ipcHandle: IPCHandle = vi.fn();

const directories = {
  getSemanticRoutersDirectory: vi.fn().mockReturnValue(ROUTERS_DIR),
} as unknown as Directories;

let onDidSetSemanticRouterConnectionFactoryListener: (() => void) | undefined;

const providerRegistry = {
  getSemanticRouterFactory: vi.fn().mockReturnValue(undefined),
  getInferenceConnection: vi.fn().mockReturnValue({
    endpoint: 'http://localhost:8000',
    llmMetadata: { name: 'openai' },
  }),
  getProvider: vi.fn().mockReturnValue({ extensionId: 'test-ext' }),
  deleteInferenceConnectionBySemanticRouter: vi.fn().mockResolvedValue(undefined),
  onDidSetSemanticRouterConnectionFactory: vi.fn().mockImplementation((listener: () => void) => {
    onDidSetSemanticRouterConnectionFactoryListener = listener;
    return { dispose: vi.fn() };
  }),
} as unknown as ProviderRegistry;

const secretManager = {
  getConnectionProperties: vi.fn().mockReturnValue({
    config: { get: vi.fn().mockReturnValue(undefined) },
    connectionProperties: [],
  }),
} as unknown as SecretManager;

const safeStorageRegistry = {
  getExtensionStorage: vi.fn().mockReturnValue({ get: vi.fn().mockReturnValue(undefined) }),
} as unknown as SafeStorageRegistry;

function createManager(): SemanticRouterManager {
  return new SemanticRouterManager(
    apiSender,
    ipcHandle,
    directories,
    providerRegistry,
    secretManager,
    safeStorageRegistry,
  );
}

const sampleConfig: SemanticRouterConfigInfo = {
  name: 'my-router',
  description: 'A test router',
  listeners: [{ address: '0.0.0.0', port: 8080 }],
  routing: {
    keywords: [
      {
        name: 'code-keywords',
        operator: 'OR',
        keywords: ['function', 'class', 'import'],
        caseSensitive: false,
      },
    ],
    decisions: [
      {
        name: 'code-decision',
        description: 'Route code queries',
        priority: 1,
        rules: [
          {
            operator: 'AND',
            conditions: [{ type: 'keyword', name: 'code-keywords' }],
            modelRefs: [
              {
                providerId: 'openai',
                connectionId: 'conn-1',
                label: 'GPT-4',
                useReasoning: true,
              },
            ],
          },
        ],
      },
    ],
  },
};

function mockEmptyDir(): void {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdir).mockResolvedValue([] as never);
}

function mockDirWithConfigs(...configs: SemanticRouterConfigInfo[]): void {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdir).mockResolvedValue(configs.map(c => `${c.name}.json`) as never);
  vi.mocked(readFile).mockImplementation(async (path: unknown) => {
    const config = configs.find(c => (path as string).includes(c.name));
    if (config) {
      return JSON.stringify(config);
    }
    throw new Error(`File not found: ${path}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  onDidSetSemanticRouterConnectionFactoryListener = undefined;
  vi.mocked(directories.getSemanticRoutersDirectory).mockReturnValue(ROUTERS_DIR);
  vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
    id: 'conn-123',
    name: 'conn-123,',
    type: 'cloud',
    sdk: {} as InferenceProviderConnection['sdk'],
    endpoint: 'http://localhost:8000',
    llmMetadata: { name: 'openai' },
    status: () => 'started',
    models: [{ label: 'model-1' }],
    credentials: () => ({ token: 'secret-token' }),
  });
  vi.mocked(providerRegistry.getProvider).mockReturnValue({ extensionId: 'test-ext' } as ProviderImpl);
  vi.mocked(secretManager.getConnectionProperties).mockReturnValue({
    config: {} as Configuration,
    connectionProperties: [],
  });
  vi.mocked(providerRegistry.onDidSetSemanticRouterConnectionFactory).mockImplementation((listener: () => void) => {
    onDidSetSemanticRouterConnectionFactoryListener = listener;
    return { dispose: vi.fn() };
  });
});

test('init creates directory if it does not exist', async () => {
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readdir).mockResolvedValue([] as never);
  const manager = createManager();

  await manager.init();

  expect(mkdir).toHaveBeenCalledWith(ROUTERS_DIR, { recursive: true });
});

test('init does not create directory if it already exists', async () => {
  mockEmptyDir();
  const manager = createManager();

  await manager.init();

  expect(mkdir).not.toHaveBeenCalled();
});

test('init registers all IPC handlers', async () => {
  mockEmptyDir();
  const manager = createManager();

  await manager.init();

  expect(ipcHandle).toHaveBeenCalledWith('semantic-router-manager:list', expect.any(Function));
  expect(ipcHandle).toHaveBeenCalledWith('semantic-router-manager:findByName', expect.any(Function));
  expect(ipcHandle).toHaveBeenCalledWith('semantic-router-manager:create', expect.any(Function));
  expect(ipcHandle).toHaveBeenCalledWith('semantic-router-manager:remove', expect.any(Function));
});

test('init loads configs from disk into cache', async () => {
  const config2: SemanticRouterConfigInfo = {
    ...sampleConfig,
    name: 'second-router',
  };
  mockDirWithConfigs(sampleConfig, config2);
  const manager = createManager();

  await manager.init();

  const result = manager.list();
  expect(result).toHaveLength(2);
  expect(result.find(c => c.name === 'my-router')).toBeDefined();
  expect(result.find(c => c.name === 'second-router')).toBeDefined();
});

test('init skips non-JSON files when loading from disk', async () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdir).mockResolvedValue(['my-router.json', 'readme.txt'] as never);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify(sampleConfig));

  const manager = createManager();
  await manager.init();

  expect(readFile).toHaveBeenCalledTimes(1);
  expect(readFile).not.toHaveBeenCalledWith(join(ROUTERS_DIR, 'readme.txt'), 'utf-8');
});

test('init skips invalid JSON files gracefully', async () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdir).mockResolvedValue(['bad.json', 'my-router.json'] as never);
  vi.mocked(readFile).mockImplementation(async (path: unknown) => {
    if ((path as string).includes('bad')) {
      return '{ not valid json }';
    }
    return JSON.stringify(sampleConfig);
  });

  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const manager = createManager();
  await manager.init();

  expect(consoleSpy).toHaveBeenCalledWith(
    expect.stringContaining('Failed to load semantic router configuration file "bad.json"'),
    expect.anything(),
  );
  expect(manager.list()).toHaveLength(1);
});

test('init skips files that fail Zod validation', async () => {
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readdir).mockResolvedValue(['invalid.json'] as never);
  vi.mocked(readFile).mockResolvedValue(JSON.stringify({ name: 'invalid' }));

  const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const manager = createManager();
  await manager.init();

  expect(consoleSpy).toHaveBeenCalled();
  expect(manager.list()).toHaveLength(0);
});

test('list returns empty array when no configs loaded', async () => {
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(readdir).mockResolvedValue([] as never);
  const manager = createManager();
  await manager.init();

  expect(manager.list()).toEqual([]);
});

test('list returns cached configs without reading from disk', async () => {
  mockDirWithConfigs(sampleConfig);
  const manager = createManager();
  await manager.init();

  vi.mocked(readFile).mockClear();

  const result = manager.list();

  expect(result).toHaveLength(1);
  expect(readFile).not.toHaveBeenCalled();
});

test('findByName returns config when found', async () => {
  mockDirWithConfigs(sampleConfig);
  const manager = createManager();
  await manager.init();

  const result = manager.findByName('my-router');

  expect(result).toBeDefined();
  expect(result!.name).toBe('my-router');
});

test('findByName returns undefined when not found', async () => {
  mockEmptyDir();
  const manager = createManager();
  await manager.init();

  const result = manager.findByName('nonexistent');

  expect(result).toBeUndefined();
});

test('create writes file, updates cache, and sends event', async () => {
  mockEmptyDir();
  const manager = createManager();
  await manager.init();

  const result = await manager.create(sampleConfig);

  expect(result.name).toBe('my-router');
  expect(writeFile).toHaveBeenCalledWith(join(ROUTERS_DIR, 'my-router.json'), expect.any(String), 'utf-8');
  expect(apiSender.send).toHaveBeenCalledWith('semantic-router-update');
  expect(manager.findByName('my-router')).toEqual(result);
});

test('create throws when name already exists', async () => {
  mockDirWithConfigs(sampleConfig);
  const manager = createManager();
  await manager.init();

  await expect(manager.create(sampleConfig)).rejects.toThrow('Semantic router "my-router" already exists');
});

test('create validates config with Zod schema', async () => {
  mockEmptyDir();
  const manager = createManager();
  await manager.init();

  const invalidConfig = { name: 'bad' } as unknown as SemanticRouterConfigInfo;

  await expect(manager.create(invalidConfig)).rejects.toThrow();
});

test('remove deletes file, removes from cache, and sends event', async () => {
  mockDirWithConfigs(sampleConfig);
  const manager = createManager();
  await manager.init();

  await manager.remove('my-router');

  expect(rm).toHaveBeenCalledWith(join(ROUTERS_DIR, 'my-router.json'));
  expect(apiSender.send).toHaveBeenCalledWith('semantic-router-update');
  expect(manager.list()).toEqual([]);
});

test('remove throws when name not found', async () => {
  mockEmptyDir();
  const manager = createManager();
  await manager.init();

  await expect(manager.remove('nonexistent')).rejects.toThrow('Semantic router "nonexistent" not found');
});

test('remove calls deleteInferenceConnectionBySemanticRouter with the router name', async () => {
  mockDirWithConfigs(sampleConfig);
  const manager = createManager();
  await manager.init();

  await manager.remove('my-router');

  expect(providerRegistry.deleteInferenceConnectionBySemanticRouter).toHaveBeenCalledWith('my-router');
});

test('create sends update event after factory.create succeeds', async () => {
  mockEmptyDir();
  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockResolvedValue({ connectionId: 'conn-1' }),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  const manager = createManager();
  await manager.init();

  await manager.create(sampleConfig);

  const createOrder = vi.mocked(factory.create).mock.invocationCallOrder[0]!;
  const sendOrder = vi.mocked(apiSender.send).mock.invocationCallOrder[0]!;
  expect(createOrder).toBeLessThan(sendOrder);
});

test('create rolls back on factory.create failure', async () => {
  mockEmptyDir();
  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockRejectedValue(new Error('factory failed')),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  const manager = createManager();
  await manager.init();

  await expect(manager.create(sampleConfig)).rejects.toThrow('factory failed');

  expect(manager.findByName('my-router')).toBeUndefined();
  expect(rm).toHaveBeenCalledWith(join(ROUTERS_DIR, 'my-router.json'));
  expect(apiSender.send).not.toHaveBeenCalled();
});

test('create calls semantic router factory with YAML config', async () => {
  mockEmptyDir();
  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockResolvedValue({ connectionId: 'connId' }),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  const manager = createManager();
  await manager.init();

  await manager.create(sampleConfig);

  expect(factory.create).toHaveBeenCalledWith({
    name: 'my-router',
    config: expect.any(String),
  });
  const callArgs = vi.mocked(factory.create).mock.calls[0]!;
  const yamlConfig = parse(callArgs[0].config) as Record<string, unknown>;
  expect(yamlConfig).toMatchObject({
    version: 'v0.3',
    listeners: [{ name: 'http-8080', address: '0.0.0.0', port: 8080 }],
    providers: {
      models: [
        {
          name: 'openai::conn-1::GPT-4',
          provider_model_id: 'GPT-4',
          backend_refs: [{ name: 'primary', endpoint: 'localhost:8000', protocol: 'http', weight: 100 }],
        },
      ],
      defaults: {},
    },
    routing: {
      signals: {
        keywords: [
          { name: 'code-keywords', operator: 'OR', keywords: ['function', 'class', 'import'], case_sensitive: false },
        ],
      },
      modelCards: [{ name: 'openai::conn-1::GPT-4' }],
      decisions: [
        {
          name: 'code-decision',
          description: 'Route code queries',
          priority: 1,
          rules: { operator: 'AND', conditions: [{ type: 'keyword', name: 'code-keywords' }] },
          modelRefs: [{ model: 'openai::conn-1::GPT-4', use_reasoning: true }],
        },
      ],
    },
    global: {
      services: { router_replay: { enabled: true, store_backend: 'memory' } },
    },
  });
  expect(providerRegistry.getInferenceConnection).toHaveBeenCalledWith('openai', 'conn-1');
});

test('create succeeds when no provider has a semantic router factory', async () => {
  mockEmptyDir();
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue(undefined);

  const manager = createManager();
  await manager.init();

  const result = await manager.create(sampleConfig);

  expect(result.name).toBe('my-router');
  expect(writeFile).toHaveBeenCalled();
});

test('create persists defaultModelRef when provided', async () => {
  mockEmptyDir();
  const configWithDefault: SemanticRouterConfigInfo = {
    ...sampleConfig,
    routing: {
      ...sampleConfig.routing,
      defaultModelRef: { providerId: 'openai', connectionId: 'conn-1', label: 'GPT-4', useReasoning: false },
    },
  };

  const manager = createManager();
  await manager.init();

  const result = await manager.create(configWithDefault);

  expect(result.routing.defaultModelRef).toEqual({
    providerId: 'openai',
    connectionId: 'conn-1',
    label: 'GPT-4',
    useReasoning: false,
  });
  const written = vi.mocked(writeFile).mock.calls[0]![1] as string;
  expect(JSON.parse(written).routing.defaultModelRef).toBeDefined();
});

test('create works without defaultModelRef for backward compatibility', async () => {
  mockEmptyDir();
  const manager = createManager();
  await manager.init();

  const result = await manager.create(sampleConfig);

  expect(result.routing.defaultModelRef).toBeUndefined();
});

test('loadFromDisk loads configs with defaultModelRef', async () => {
  const configWithDefault: SemanticRouterConfigInfo = {
    ...sampleConfig,
    routing: {
      ...sampleConfig.routing,
      defaultModelRef: { providerId: 'openai', connectionId: 'conn-1', label: 'GPT-4', useReasoning: false },
    },
  };
  mockDirWithConfigs(configWithDefault);

  const manager = createManager();
  await manager.init();

  const result = manager.findByName('my-router');
  expect(result?.routing.defaultModelRef).toEqual({
    providerId: 'openai',
    connectionId: 'conn-1',
    label: 'GPT-4',
    useReasoning: false,
  });
});

test('init subscribes to semantic router factory events', async () => {
  mockEmptyDir();
  const manager = createManager();

  await manager.init();

  expect(providerRegistry.onDidSetSemanticRouterConnectionFactory).toHaveBeenCalledWith(expect.any(Function));
});

test('processUninstantiatedConfigs creates instances for configs without factory at creation time', async () => {
  mockEmptyDir();
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue(undefined);

  const manager = createManager();
  await manager.init();

  await manager.create(sampleConfig);

  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockResolvedValue({ connectionId: 'con-1' }),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  await manager.processUninstantiatedConfigs();

  expect(factory.create).toHaveBeenCalledWith({
    name: 'my-router',
    config: expect.any(String),
  });
});

test('processUninstantiatedConfigs skips already instantiated configs', async () => {
  mockEmptyDir();
  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockResolvedValue({ connectionId: 'con-1' }),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  const manager = createManager();
  await manager.init();

  await manager.create(sampleConfig);
  expect(factory.create).toHaveBeenCalledTimes(1);

  await manager.processUninstantiatedConfigs();

  expect(factory.create).toHaveBeenCalledTimes(1);
});

test('factory event triggers processUninstantiatedConfigs for disk-loaded configs', async () => {
  mockDirWithConfigs(sampleConfig);
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue(undefined);

  const manager = createManager();
  await manager.init();

  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  onDidSetSemanticRouterConnectionFactoryListener!();
  await vi.waitFor(() => {
    expect(factory.create).toHaveBeenCalledWith({
      name: 'my-router',
      config: expect.any(String),
    });
  });
});

test('remove clears config from instantiated tracking', async () => {
  mockEmptyDir();
  const factory: SemanticRouterFactory = {
    type: 'semantic-router',
    create: vi.fn().mockResolvedValue({ connectionId: 'con-1' }),
  };
  vi.mocked(providerRegistry.getSemanticRouterFactory).mockReturnValue({ internalId: 'provider-1', factory });

  const manager = createManager();
  await manager.init();

  await manager.create(sampleConfig);
  expect(factory.create).toHaveBeenCalledTimes(1);

  await manager.remove('my-router');

  mockEmptyDir();
  await manager.create(sampleConfig);
  expect(factory.create).toHaveBeenCalledTimes(2);
});
