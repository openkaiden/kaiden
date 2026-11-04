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

import { join } from 'node:path';

import { env } from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
// eslint-disable-next-line import/no-extraneous-dependencies
import DockerModem from 'docker-modem';
// eslint-disable-next-line import/no-extraneous-dependencies
import Dockerode from 'dockerode';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { SocketHelper } from '/@/helper/socket-helper';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol } from '/@/inject/symbol';

import {
  convertToWslPath,
  GATEWAY_IMAGE,
  GatewayContainerManager,
  getOpenshellGatewaysDir,
} from './gateway-container-manager';

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('tar', () => ({
  extract: vi.fn().mockReturnValue({}),
}));

// eslint-disable-next-line import/no-extraneous-dependencies
vi.mock(import('dockerode'));
// eslint-disable-next-line import/no-extraneous-dependencies
vi.mock(import('docker-modem'));

const containerMock = new Dockerode.Container({}, 'container123');
const disposableMock = {
  dispose: vi.fn().mockResolvedValue(undefined),
};

const endpointMock: EndpointConnection = {
  path: '/test/path',
  dockerode: new Dockerode(),
};

let gatewayContainerManager: GatewayContainerManager;
let containerExtensionAPIMock: ContainerExtensionAPI;
let onEndpointsChangedCallback: (() => void) | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  onEndpointsChangedCallback = undefined;

  vi.mocked(Dockerode.Container.prototype.start).mockResolvedValue(undefined);
  vi.mocked(Dockerode.Container.prototype.wait).mockResolvedValue({ StatusCode: 0 });
  vi.mocked(Dockerode.Container.prototype.getArchive).mockResolvedValue({} as unknown as NodeJS.ReadableStream);
  vi.mocked(Dockerode.Container.prototype.remove).mockResolvedValue(undefined);
  vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([]);
  vi.mocked(Dockerode.prototype.createContainer).mockResolvedValue(containerMock);
  vi.mocked(Dockerode.prototype.getContainer).mockReturnValue(containerMock);
  vi.mocked(Dockerode.prototype.pull).mockResolvedValue({} as unknown as NodeJS.ReadableStream);

  containerExtensionAPIMock = {
    getEndpoints: vi.fn().mockReturnValue([endpointMock]),
    onContainersChanged: vi.fn().mockReturnValue(disposableMock),
    onEndpointsChanged: vi.fn().mockImplementation((cb: () => void) => {
      onEndpointsChangedCallback = cb;
      return disposableMock;
    }),
  } as unknown as ContainerExtensionAPI;

  const extensionContextMock = {
    storagePath: '/test/storage',
    subscriptions: [],
  };

  const socketHelperMock = {
    getSocketPath: vi.fn().mockResolvedValue('/run/podman/podman.sock'),
  };

  const container = new Container();
  container.bind(GatewayContainerManager).toSelf();
  container.bind(ContainerExtensionAPISymbol).toConstantValue(containerExtensionAPIMock);
  container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
  container.bind(SocketHelper).toConstantValue(socketHelperMock as unknown as SocketHelper);

  gatewayContainerManager = await container.getAsync<GatewayContainerManager>(GatewayContainerManager);
});

async function expectGatewayMetadata(endpoint: string | RegExp): Promise<void> {
  const { writeFile: writeFileMock } = await import('node:fs/promises');
  const call = vi.mocked(writeFileMock).mock.calls.find(c => String(c[0]).endsWith('metadata.json'));
  expect(call).toBeDefined();
  expect(call![0]).toBe(join(getOpenshellGatewaysDir(), 'kaiden-podman', 'metadata.json'));
  expect(JSON.parse(String(call![1]))).toEqual({
    name: 'kaiden-podman',
    gateway_endpoint: typeof endpoint === 'string' ? endpoint : expect.stringMatching(endpoint),
    is_remote: false,
    gateway_port: 0,
    auth_mode: 'plaintext',
  });
}

function setupFollowProgress(): void {
  endpointMock.dockerode.modem = new DockerModem();
  vi.mocked(endpointMock.dockerode.modem.followProgress).mockImplementation((_stream, onFinished) => {
    onFinished(null, []);
  });
}

describe('GatewayContainerManager', () => {
  test('should do nothing on non-Windows platforms', async () => {
    Object.defineProperty(env, 'isWindows', { value: false, configurable: true });

    await gatewayContainerManager.init();

    expect(containerExtensionAPIMock.getEndpoints).not.toHaveBeenCalled();
  });

  test('should register onEndpointsChanged listener on Windows', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(containerExtensionAPIMock.onEndpointsChanged).toHaveBeenCalled();
  });

  test('should skip when no endpoints are available', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([]);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.listContainers).not.toHaveBeenCalled();
  });

  test('should retry setup when endpoints become available', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValueOnce([]);
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.listContainers).not.toHaveBeenCalled();

    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([endpointMock]);

    onEndpointsChangedCallback?.();

    expect(Dockerode.prototype.listContainers).toHaveBeenCalled();
  });

  test('should start existing stopped container', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      {
        Id: 'gateway-container-123',
        State: 'exited',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
          'ai.openkaiden.openshell-podman-gateway.port': '12345',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.getContainer).toHaveBeenCalledWith('gateway-container-123');
    expect(Dockerode.Container.prototype.start).toHaveBeenCalled();
    expect(Dockerode.prototype.createContainer).not.toHaveBeenCalled();
  });

  test('should use existing running container without starting', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      {
        Id: 'gateway-container-123',
        State: 'running',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
          'ai.openkaiden.openshell-podman-gateway.port': '12345',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    expect(Dockerode.Container.prototype.start).not.toHaveBeenCalled();
    expect(Dockerode.prototype.createContainer).not.toHaveBeenCalled();
  });

  test('should create new container when none exists', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.pull).toHaveBeenCalledWith(GATEWAY_IMAGE);
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: GATEWAY_IMAGE,
        Labels: expect.objectContaining({
          'ai.openkaiden.openshell-podman-gateway': 'true',
        }),
      }),
    );
    expect(Dockerode.Container.prototype.start).toHaveBeenCalled();
  });

  test('should create container with correct port configuration', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const createCalls = vi.mocked(Dockerode.prototype.createContainer).mock.calls;
    const gatewayCreateCall = createCalls[1]![0]!;
    const portLabel = gatewayCreateCall.Labels!['ai.openkaiden.openshell-podman-gateway.port'];
    const port = parseInt(portLabel!, 10);

    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThan(65536);

    expect(gatewayCreateCall.Cmd).toEqual([
      '--port',
      String(port),
      '--disable-tls',
      '--bind-address',
      '0.0.0.0',
      '--log-level',
      'trace',
      '--config',
      '/kaiden/gateway.toml',
    ]);
    expect(gatewayCreateCall.HostConfig!.PortBindings).toEqual({
      [`${port}/tcp`]: [{ HostPort: String(port) }],
    });
  });

  test('should register gateway metadata after container is running', async () => {
    const { mkdir: mkdirMock } = await import('node:fs/promises');
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(mkdirMock).toHaveBeenCalledWith(join(getOpenshellGatewaysDir(), 'kaiden-podman'), { recursive: true });
    await expectGatewayMetadata(/^http:\/\/localhost:\d+$/);
  });

  test('should register gateway with existing container port', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      {
        Id: 'gateway-container-123',
        State: 'running',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
          'ai.openkaiden.openshell-podman-gateway.port': '54321',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    await expectGatewayMetadata('http://localhost:54321');
  });

  test('should handle metadata write errors gracefully', async () => {
    const { writeFile: writeFileMock } = await import('node:fs/promises');
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(writeFileMock).mockImplementation(async path => {
      if (String(path).endsWith('metadata.json')) {
        throw new Error('access denied');
      }
    });

    await gatewayContainerManager.init();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to register gateway'),
      expect.any(Error),
    );
  });

  test('should not run setup twice (idempotency)', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const listCallsBefore = vi.mocked(Dockerode.prototype.listContainers).mock.calls.length;

    await gatewayContainerManager.trySetupGateway();

    expect(vi.mocked(Dockerode.prototype.listContainers).mock.calls.length).toBe(listCallsBefore);
  });

  test('should not run setup after dispose', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValueOnce([]);

    await gatewayContainerManager.init();

    gatewayContainerManager.dispose();

    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([endpointMock]);

    await gatewayContainerManager.trySetupGateway();

    expect(Dockerode.prototype.listContainers).not.toHaveBeenCalled();
  });

  test('should handle invalid port label gracefully', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    setupFollowProgress();

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      {
        Id: 'gateway-container-123',
        State: 'running',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('port label is missing or invalid'));
  });

  test('should handle container creation errors gracefully', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    vi.mocked(Dockerode.prototype.createContainer).mockRejectedValue(new Error('port already in use'));

    await gatewayContainerManager.init();

    const { writeFile: writeFileMock } = await import('node:fs/promises');
    expect(vi.mocked(writeFileMock).mock.calls.some(c => String(c[0]).endsWith('metadata.json'))).toBe(false);
  });

  test('should find container on second endpoint', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });

    const endpoint2: EndpointConnection = {
      path: '/test/path2',
      dockerode: new Dockerode(),
    };

    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([endpointMock, endpoint2]);

    vi.mocked(Dockerode.prototype.listContainers)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          Id: 'gateway-on-endpoint2',
          State: 'running',
          Labels: {
            'ai.openkaiden.openshell-podman-gateway': 'true',
            'ai.openkaiden.openshell-podman-gateway.port': '9999',
          },
        },
      ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.listContainers).toHaveBeenCalledTimes(2);
    expect(Dockerode.prototype.createContainer).not.toHaveBeenCalled();
    await expectGatewayMetadata('http://localhost:9999');
  });

  test('should stop searching once container is found on first endpoint', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });

    const endpoint2: EndpointConnection = {
      path: '/test/path2',
      dockerode: new Dockerode(),
    };

    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([endpointMock, endpoint2]);

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValueOnce([
      {
        Id: 'gateway-on-endpoint1',
        State: 'running',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
          'ai.openkaiden.openshell-podman-gateway.port': '8888',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.listContainers).toHaveBeenCalledTimes(1);
    expect(Dockerode.prototype.createContainer).not.toHaveBeenCalled();
  });

  test('should create on first endpoint when no container found on any endpoint', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    const endpoint2: EndpointConnection = {
      path: '/test/path2',
      dockerode: new Dockerode(),
    };

    vi.mocked(containerExtensionAPIMock.getEndpoints).mockReturnValue([endpointMock, endpoint2]);

    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.listContainers).toHaveBeenCalledTimes(2);
    expect(Dockerode.prototype.createContainer).toHaveBeenCalled();
  });

  test('should generate certs before starting gateway container', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const createCalls = vi.mocked(Dockerode.prototype.createContainer).mock.calls;
    expect(createCalls).toHaveLength(2);

    const certCreateCall = createCalls[0]![0]!;
    expect(certCreateCall.Cmd).toEqual([
      'generate-certs',
      '--server-san',
      '127.0.0.1',
      '--server-san',
      'localhost',
      '--server-san',
      'host.openshell.internal',
      '--output-dir',
      '/kaiden',
    ]);

    const gatewayCreateCall = createCalls[1]![0]!;
    expect(gatewayCreateCall.Labels).toEqual(
      expect.objectContaining({
        'ai.openkaiden.openshell-podman-gateway': 'true',
      }),
    );
  });

  test('should wait for cert container to exit and remove it', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(Dockerode.Container.prototype.wait).toHaveBeenCalled();
    expect(Dockerode.Container.prototype.remove).toHaveBeenCalled();
  });

  test('should copy certs from container to gateway directory', async () => {
    const { rm: rmMock, mkdir: mkdirMock } = await import('node:fs/promises');
    const { pipeline: pipelineMock } = await import('node:stream/promises');
    const tarMock = await import('tar');

    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(rmMock).toHaveBeenCalledWith(expect.stringContaining('gateway'), { recursive: true, force: true });
    expect(mkdirMock).toHaveBeenCalledWith(expect.stringContaining('gateway'), { recursive: true });
    expect(Dockerode.Container.prototype.getArchive).toHaveBeenCalledWith({ path: '/kaiden' });
    expect(pipelineMock).toHaveBeenCalled();
    expect(tarMock.extract).toHaveBeenCalledWith(expect.objectContaining({ strip: 1 }));
  });

  test('should write gateway.toml config file', async () => {
    const { writeFile: writeFileMock } = await import('node:fs/promises');

    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('gateway.toml'),
      expect.stringContaining('[openshell.gateway.gateway_jwt]'),
    );
  });

  test('should generate gateway config using the podman compute driver', async () => {
    const { writeFile: writeFileMock } = await import('node:fs/promises');

    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(writeFileMock).toHaveBeenCalledWith(
      expect.stringContaining('gateway.toml'),
      expect.stringContaining('compute_driver = "podman"'),
    );
  });

  test('should mount gateway directory to /kaiden in gateway container', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const createCalls = vi.mocked(Dockerode.prototype.createContainer).mock.calls;
    const gatewayCreateCall = createCalls[1]![0]!;
    const mounts = gatewayCreateCall.HostConfig!.Mounts!;

    expect(mounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          Type: 'bind',
          Target: '/kaiden',
        }),
      ]),
    );
  });

  test('should include --config in gateway container Cmd', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const createCalls = vi.mocked(Dockerode.prototype.createContainer).mock.calls;
    const gatewayCreateCall = createCalls[1]![0]!;

    expect(gatewayCreateCall.Cmd).toEqual(expect.arrayContaining(['--config', '/kaiden/gateway.toml']));
  });
});

describe('convertToWslPath', () => {
  test('should convert Windows drive path to WSL mount path', () => {
    expect(convertToWslPath('C:\\Users\\Jeff\\storage\\gateway')).toBe('/mnt/c/Users/Jeff/storage/gateway');
  });

  test('should handle lowercase drive letter', () => {
    expect(convertToWslPath('d:\\data\\files')).toBe('/mnt/d/data/files');
  });

  test('should handle forward slashes in Windows path', () => {
    expect(convertToWslPath('C:/Users/Jeff/storage')).toBe('/mnt/c/Users/Jeff/storage');
  });

  test('should return non-Windows paths unchanged', () => {
    expect(convertToWslPath('/usr/local/bin')).toBe('/usr/local/bin');
  });
});
