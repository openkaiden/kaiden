/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import { access, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { Extension, ExtensionContext, LifecycleContext, Provider } from '@openkaiden/api';
import { extensions } from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
// eslint-disable-next-line import/no-extraneous-dependencies
import DockerModem from 'docker-modem';
// eslint-disable-next-line import/no-extraneous-dependencies
import Dockerode from 'dockerode';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { ConfigHelper } from '/@/util/config';

import { MilvusConnection } from '../api/milvus-connection';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol, MilvusProvider } from '../inject/symbol';
import { ConnectionManager } from './connection-manager';

vi.mock(import('node:fs/promises'));

vi.mock(import('../api/milvus-connection'));
vi.mock(import('../util/config'));

// eslint-disable-next-line import/no-extraneous-dependencies
vi.mock(import('dockerode'));
// eslint-disable-next-line import/no-extraneous-dependencies
vi.mock(import('docker-modem'));

const endpointMock: EndpointConnection = {
  path: '/test/path',
  dockerode: new Dockerode(),
};
let connectionManager: ConnectionManager;
let containerExtensionAPIMock: ContainerExtensionAPI;
let milvusProviderMock: Provider;
// Mock Dockerode Container
const containerMock = new Dockerode.Container({}, 'container123');
const disposableMock = {
  dispose: vi.fn().mockResolvedValue(undefined),
};
// Mock ExtensionContext
const extensionContextMock = {
  storagePath: '/test/storage',
  subscriptions: [],
} as unknown as ExtensionContext;

beforeEach(async () => {
  vi.resetAllMocks();

  vi.mocked(access).mockRejectedValue(new Error('ENOENT'));
  vi.mocked(mkdir).mockResolvedValue(undefined);
  vi.mocked(rm).mockResolvedValue(undefined);

  vi.mocked(ConfigHelper.prototype.createConfigFile).mockResolvedValue({
    etcdConfigFile: '/path/to/etcd.yaml',
    userConfigFile: '/path/to/user.yaml',
  });

  vi.mocked(Dockerode.Container.prototype.start).mockResolvedValue(undefined);
  vi.mocked(Dockerode.Container.prototype.stop).mockResolvedValue(undefined);
  vi.mocked(Dockerode.Container.prototype.remove).mockResolvedValue(undefined);

  // Mock Dockerode
  vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([]);
  vi.mocked(Dockerode.prototype.createContainer).mockResolvedValue(containerMock);
  vi.mocked(Dockerode.prototype.getContainer).mockReturnValue(containerMock);
  vi.mocked(Dockerode.Image.prototype.inspect).mockResolvedValue({} as unknown as Dockerode.ImageInspectInfo);
  vi.mocked(Dockerode.prototype.pull).mockResolvedValue({} as unknown as NodeJS.ReadableStream);

  // Mock ContainerExtensionEndpoint

  vi.mocked(extensions.getExtension<ContainerExtensionAPI>).mockReturnValue({
    exports: {
      getEndpoints: vi.fn().mockReturnValue([endpointMock]),
      onContainersChanged: vi.fn().mockReturnValue(disposableMock),
      onEndpointsChanged: vi.fn().mockReturnValue(disposableMock),
    },
  } as unknown as Extension<ContainerExtensionAPI>);
  // Mock ContainerExtensionAPI
  containerExtensionAPIMock = {
    getEndpoints: vi.fn().mockReturnValue([endpointMock]),
    onContainersChanged: vi.fn().mockReturnValue(disposableMock),
    onEndpointsChanged: vi.fn().mockReturnValue(disposableMock),
  } as unknown as ContainerExtensionAPI;

  // Mock Provider
  milvusProviderMock = {
    registerRagProviderConnection: vi.fn().mockReturnValue(disposableMock),
    setRagProviderConnectionFactory: vi.fn().mockReturnValue(disposableMock),
  } as unknown as Provider;

  // Setup Inversify container
  const container = new Container();
  container.bind(ConnectionManager).toSelf();
  container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
  container.bind(ContainerExtensionAPISymbol).toConstantValue(containerExtensionAPIMock);
  container.bind(MilvusProvider).toConstantValue(milvusProviderMock);
  container.bind(ConfigHelper).toSelf();

  connectionManager = await container.getAsync<ConnectionManager>(ConnectionManager);
});

describe('ConnectionManager', () => {
  test('init should discover existing containers and setup listeners when endpoints exist', async () => {
    await connectionManager.init();

    expect(containerExtensionAPIMock.onContainersChanged).toHaveBeenCalled();
    expect(containerExtensionAPIMock.onEndpointsChanged).toHaveBeenCalled();
    expect(milvusProviderMock.setRagProviderConnectionFactory).toHaveBeenCalled();
  });

  test('init should not register factory when no endpoints exist', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await connectionManager.init();

    expect(containerExtensionAPIMock.onContainersChanged).toHaveBeenCalled();
    expect(containerExtensionAPIMock.onEndpointsChanged).toHaveBeenCalled();
    expect(milvusProviderMock.setRagProviderConnectionFactory).not.toHaveBeenCalled();
  });

  test('should register factory when endpoints appear after init with no endpoints', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await connectionManager.init();

    expect(milvusProviderMock.setRagProviderConnectionFactory).not.toHaveBeenCalled();

    // Simulate endpoints appearing
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([endpointMock]);
    connectionManager.handleEndpointsChanged([endpointMock]);

    expect(milvusProviderMock.setRagProviderConnectionFactory).toHaveBeenCalled();
  });

  test('should unregister factory and connections when all endpoints disappear', async () => {
    await connectionManager.init();

    expect(milvusProviderMock.setRagProviderConnectionFactory).toHaveBeenCalled();

    // Register a connection first
    connectionManager.registerConnection({
      path: '/test/path',
      id: 'container123',
      name: 'test-milvus',
      port: 19530,
      running: true,
    });

    // Simulate endpoints disappearing
    connectionManager.handleEndpointsChanged([]);

    // Factory disposable should be disposed
    expect(disposableMock.dispose).toHaveBeenCalled();
  });

  test('should not register factory again if already registered when endpoints change', async () => {
    await connectionManager.init();

    expect(milvusProviderMock.setRagProviderConnectionFactory).toHaveBeenCalledTimes(1);

    // Simulate endpoints changed but still have endpoints
    connectionManager.handleEndpointsChanged([endpointMock]);

    // Factory should not be registered again
    expect(milvusProviderMock.setRagProviderConnectionFactory).toHaveBeenCalledTimes(1);
  });

  test('should not unregister factory when endpoints disappear if not registered', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await connectionManager.init();

    // Simulate endpoints disappearing — factory was never registered
    connectionManager.handleEndpointsChanged([]);

    // dispose should not have been called on the factory since it was never created
    expect(disposableMock.dispose).not.toHaveBeenCalled();
  });

  test('registerConnection should create new connection when not exists', () => {
    const container = {
      path: '/test/path',
      id: 'container123',
      name: 'test-milvus',
      port: 19530,
      running: true,
    };

    connectionManager.registerConnection(container);

    expect(MilvusConnection).toHaveBeenCalledWith('/test/path', 'test-milvus', 'container123', 19530, true);
    expect(milvusProviderMock.registerRagProviderConnection).toHaveBeenCalled();
  });

  test('registerConnection should update status when connection exists', () => {
    const container = {
      path: '/test/path',
      id: 'container123',
      name: 'test-milvus',
      port: 19530,
      running: true,
    };

    // Register first time
    connectionManager.registerConnection(container);

    const milvusConnectionInstance = vi.mocked(MilvusConnection).mock.results[0]?.value;
    const updateStatusSpy = vi.spyOn(milvusConnectionInstance, 'updateStatus');

    // Register again with different running status
    connectionManager.registerConnection({ ...container, running: false });

    expect(updateStatusSpy).toHaveBeenCalledWith('stopped');
  });

  test('startConnection should start container', async () => {
    const container = {
      path: '/test/path',
      id: 'container123',
      name: 'test-milvus',
      port: 19530,
      running: false,
    };

    vi.mocked(MilvusConnection.prototype).containerId = 'container123';
    vi.mocked(MilvusConnection.prototype).path = '/test/path';

    connectionManager.registerConnection(container);

    const connection = vi.mocked(MilvusConnection).mock.results[0]?.value;
    const lifecycleContext = {} as LifecycleContext;

    await connectionManager['startConnection'](connection, lifecycleContext);

    expect(containerMock.start).toHaveBeenCalled();
    expect(connection.start).toHaveBeenCalledWith(lifecycleContext);
  });

  test('stopConnection should stop container', async () => {
    const container = {
      path: '/test/path',
      id: 'container123',
      name: 'test-milvus',
      port: 19530,
      running: true,
    };

    connectionManager.registerConnection(container);

    const connection = vi.mocked(MilvusConnection).mock.results[0]?.value;
    const lifecycleContext = {} as LifecycleContext;

    await connectionManager['stopConnection'](connection, lifecycleContext);

    expect(containerMock.stop).toHaveBeenCalled();
    expect(connection.stop).toHaveBeenCalledWith(lifecycleContext);
  });

  test('deleteConnection should remove container and clean up', async () => {
    const container = {
      path: '/test/path',
      id: 'container123',
      name: 'test-milvus',
      port: 19530,
      running: true,
    };

    vi.mocked(MilvusConnection.prototype).containerId = 'container123';
    vi.mocked(MilvusConnection.prototype).path = '/test/path';
    vi.mocked(MilvusConnection.prototype).name = 'test-milvus';

    connectionManager.registerConnection(container);

    const connection = vi.mocked(MilvusConnection).mock.results[0]?.value;

    await connectionManager['deleteConnection'](connection);

    expect(containerMock.remove).toHaveBeenCalled();
    expect(disposableMock.dispose).toHaveBeenCalled();

    expect(rm).toHaveBeenCalledWith(join('/test', 'storage', 'test-milvus'), { recursive: true, force: true });
  });

  test('dispose should clean up all connections', () => {
    const container1 = {
      path: '/test/path',
      id: 'container1',
      name: 'test-milvus-1',
      port: 19530,
      running: true,
    };

    const container2 = {
      path: '/test/path',
      id: 'container2',
      name: 'test-milvus-2',
      port: 19531,
      running: true,
    };

    connectionManager.registerConnection(container1);
    connectionManager.registerConnection(container2);

    connectionManager.dispose();

    expect(disposableMock.dispose).toHaveBeenCalledTimes(2);
  });

  test('discoverExistingContainers should find containers with milvus labels', async () => {
    const containers = [
      {
        Id: 'container123',
        State: 'running',
        Labels: {
          'ai.openkaiden.milvus.name': 'test-milvus',
          'ai.openkaiden.milvus.port': '19530',
        },
      },
    ];
    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue(containers as unknown as Dockerode.ContainerInfo[]);

    await connectionManager.discoverExistingContainers();

    expect(MilvusConnection).toHaveBeenCalledWith('/test/path', 'test-milvus', 'container123', 19530, true);
  });

  test('discoverExistingContainers should ignore containers without milvus labels', async () => {
    const containers = [
      {
        Id: 'container123',
        State: 'running',
        Labels: {
          'some.other.label': 'value',
        },
      },
    ];

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue(containers as unknown as Dockerode.ContainerInfo[]);

    await connectionManager.discoverExistingContainers();

    expect(MilvusConnection).not.toHaveBeenCalled();
  });

  test('discoverExistingContainers should handle errors gracefully', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Failed to list containers');

    vi.mocked(Dockerode.prototype.listContainers).mockRejectedValue(error);

    await connectionManager.discoverExistingContainers();

    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to discover containers'));
  });

  test('factory should create milvus container with correct configuration', async () => {
    const params = {
      'milvus.name': 'my-milvus',
    };

    vi.mocked(Dockerode.prototype.getImage).mockReturnValue(new Dockerode.Image({}, 'image123'));
    await connectionManager.factory(params);

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'milvus-my-milvus',
        Image: 'docker.io/milvusdb/milvus:v2.6.3',
        Cmd: ['milvus', 'run', 'standalone'],
        Labels: expect.objectContaining({
          'ai.openkaiden.milvus.name': 'my-milvus',
        }),
      }),
    );
    expect(containerMock.start).toHaveBeenCalled();
  });

  test('factory should sanitize name with spaces for container naming', async () => {
    const params = {
      'milvus.name': 'my milvus db',
    };

    vi.mocked(Dockerode.prototype.getImage).mockReturnValue(new Dockerode.Image({}, 'image123'));
    await connectionManager.factory(params);

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'milvus-my-milvus-db',
        Labels: expect.objectContaining({
          'ai.openkaiden.milvus.name': 'my-milvus-db',
        }),
      }),
    );
  });

  test('factory should deduplicate when container name already exists', async () => {
    const params = {
      'milvus.name': 'my-milvus',
    };

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      { Names: ['/milvus-my-milvus'] },
    ] as unknown as Dockerode.ContainerInfo[]);
    vi.mocked(Dockerode.prototype.getImage).mockReturnValue(new Dockerode.Image({}, 'image123'));
    await connectionManager.factory(params);

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'milvus-my-milvus-2',
      }),
    );
  });

  test('factory should deduplicate when storage directory already exists', async () => {
    const params = {
      'milvus.name': 'my-milvus',
    };

    vi.mocked(access).mockResolvedValueOnce(undefined);
    vi.mocked(access).mockRejectedValueOnce(new Error('ENOENT'));
    vi.mocked(Dockerode.prototype.getImage).mockReturnValue(new Dockerode.Image({}, 'image123'));
    await connectionManager.factory(params);

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'milvus-my-milvus-2',
      }),
    );
  });

  test('factory should throw error when name parameter is missing', async () => {
    const params = {};

    await expect(connectionManager.factory(params)).rejects.toThrow('Name parameter is required');
  });

  test('factory should throw error when no container endpoint is available', async () => {
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    const params = {
      'milvus.name': 'my-milvus',
    };

    await expect(connectionManager.factory(params)).rejects.toThrow('No container endpoint available');
  });

  test('factory should pull image if not available', async () => {
    const params = {
      'milvus.name': 'my-milvus',
    };

    vi.mocked(Dockerode.prototype.getImage).mockImplementation(() => {
      throw new Error('Image not found');
    });
    endpointMock.dockerode.modem = new DockerModem();
    vi.mocked(endpointMock.dockerode.modem.followProgress).mockImplementation((_, onFinished) => onFinished(null, []));

    await connectionManager.factory(params);

    expect(Dockerode.prototype.pull).toHaveBeenCalledWith('docker.io/milvusdb/milvus:v2.6.3');
  });

  test('factory should use logger when provided', async () => {
    const loggerMock = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };

    const params = {
      'milvus.name': 'my-milvus',
    };

    vi.mocked(Dockerode.prototype.getImage).mockReturnValue(new Dockerode.Image({}, 'image123'));
    await connectionManager.factory(params, loggerMock);

    expect(loggerMock.log).toHaveBeenCalledWith(expect.stringContaining('Creating Milvus RAG connection'));
    expect(loggerMock.log).toHaveBeenCalledWith(expect.stringContaining('Connection name: my-milvus'));
  });

  test('startConnection should handle missing container gracefully', async () => {
    const connection = new MilvusConnection('/test/path', 'test-milvus', 'nonexistent', 19530, false);
    const lifecycleContext = {} as LifecycleContext;

    // This should not throw, just return without doing anything
    await expect(connectionManager['startConnection'](connection, lifecycleContext)).resolves.toBeUndefined();
  });

  test('stopConnection should handle missing container gracefully', async () => {
    const connection = new MilvusConnection('/test/path', 'test-milvus', 'nonexistent', 19530, true);
    const lifecycleContext = {} as LifecycleContext;

    // This should not throw, just return without doing anything
    await expect(connectionManager['stopConnection'](connection, lifecycleContext)).resolves.toBeUndefined();
  });

  test('deleteConnection should handle missing container gracefully', async () => {
    const connection = new MilvusConnection('/test/path', 'test-milvus', 'nonexistent', 19530, true);

    // This should not throw, just return without doing anything
    await expect(connectionManager['deleteConnection'](connection)).resolves.toBeUndefined();
  });
});
