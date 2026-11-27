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

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { env, process as processApi } from '@openkaiden/api';
import type { ContainerExtensionAPI, EndpointConnection } from '@openkaiden/container-extension-api';
// eslint-disable-next-line import/no-extraneous-dependencies
import DockerModem from 'docker-modem';
// eslint-disable-next-line import/no-extraneous-dependencies
import Dockerode from 'dockerode';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AdmissionHookHelper } from '/@/helper/admission-hook-helper';
import type { Info } from '/@/helper/podman-info';
import { SocketHelper } from '/@/helper/socket-helper';
import { ContainerExtensionAPISymbol, ExtensionContextSymbol } from '/@/inject/symbol';

import { GATEWAY_IMAGE, GatewayContainerManager } from './gateway-container-manager';

vi.mock('node:fs/promises', () => ({
  rm: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

// eslint-disable-next-line import/no-extraneous-dependencies
vi.mock(import('dockerode'));
// eslint-disable-next-line import/no-extraneous-dependencies
vi.mock(import('docker-modem'));
vi.mock(import('/@/helper/socket-helper'));
vi.mock(import('/@/helper/admission-hook-helper'));

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
let extensionContextMock: { storagePath: string; subscriptions: unknown[] };

const fakeInfo: Info = {
  host: {
    arch: 'amd64',
    buildahVersion: '1.33.0',
    cgroupManager: 'systemd',
    cgroupVersion: 'v2',
    cgroupControllers: [],
    conmon: { package: '', path: '/usr/bin/conmon', version: '2.1.7' },
    cpus: 4,
    cpuUtilization: { userPercent: 10, systemPercent: 5, idlePercent: 85 },
    databaseBackend: 'sqlite',
    distribution: { distribution: 'fedora', variant: '', version: '39' },
    eventLogger: 'journald',
    hostname: 'test-host',
    idMappings: { gidmap: [], uidmap: [] },
    kernel: '6.5.0',
    logDriver: 'journald',
    memFree: 4096,
    memTotal: 16384,
    networkBackend: 'netavark',
    ociRuntime: { name: 'crun', package: '', path: '/usr/bin/crun', version: '1.8.7' },
    os: 'linux',
    remoteSocket: { path: '/run/podman/podman.sock', exists: true },
    serviceIsRemote: false,
    security: {
      apparmorEnabled: false,
      capabilities: '',
      rootless: true,
      seccompEnabled: true,
      seccompProfilePath: '',
      selinuxEnabled: true,
    },
    slirp4netns: { executable: '/usr/bin/slirp4netns', package: '', version: '1.2.0' },
    swapFree: 0,
    swapTotal: 0,
    uptime: '24h',
    linkmode: 'dynamic',
  },
  store: {
    configFile: '/etc/containers/storage.conf',
    containerStore: { number: 2, paused: 0, running: 1, stopped: 1 },
    graphDriverName: 'overlay',
    graphOptions: {},
    graphRoot: '/var/lib/containers/storage',
    graphRootAllocated: 100000,
    graphRootUsed: 50000,
    graphStatus: {
      'Backing Filesystem': 'extfs',
      'Native Overlay Diff': 'true',
      'Supports d_type': 'true',
      'Using metacopy': 'false',
    },
    imageCopyTmpDir: '/var/tmp',
    imageStore: { number: 5 },
    runRoot: '/run/containers/storage',
    volumePath: '/var/lib/containers/storage/volumes',
    transientStore: false,
  },
  registries: { search: ['docker.io'] },
  plugins: { volume: ['local'], network: ['bridge'], log: ['journald'], authorization: null },
  version: {
    APIVersion: '4.2.0',
    Version: '4.7.0',
    GoVersion: 'go1.21',
    GitCommit: 'abc123',
    BuiltTime: '2024-01-01T00:00:00Z',
    Built: 1704067200,
    OsArch: 'linux/amd64',
    Os: 'linux',
  },
};

const HOOK_DIR = 'C:\\Program Files\\Kaiden\\resources\\openshell-admission-hook';

beforeEach(async () => {
  vi.resetAllMocks();
  console.error = vi.fn();
  onEndpointsChangedCallback = undefined;

  vi.mocked(Dockerode.Container.prototype.start).mockResolvedValue(undefined);
  vi.mocked(Dockerode.Container.prototype.wait).mockResolvedValue({ StatusCode: 0 });
  vi.mocked(Dockerode.Container.prototype.remove).mockResolvedValue(undefined);
  vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([]);
  vi.mocked(Dockerode.prototype.createContainer).mockResolvedValue(containerMock);
  vi.mocked(Dockerode.prototype.getContainer).mockReturnValue(containerMock);
  vi.mocked(Dockerode.prototype.getImage).mockReturnValue(new Dockerode.Image({}, GATEWAY_IMAGE));
  vi.mocked(Dockerode.Image.prototype.inspect).mockRejectedValue(new Error('no such image'));
  vi.mocked(Dockerode.prototype.pull).mockResolvedValue({} as unknown as NodeJS.ReadableStream);

  containerExtensionAPIMock = {
    getEndpoints: vi.fn().mockReturnValue([endpointMock]),
    onContainersChanged: vi.fn().mockReturnValue(disposableMock),
    onEndpointsChanged: vi.fn().mockImplementation((cb: () => void) => {
      onEndpointsChangedCallback = cb;
      return disposableMock;
    }),
  } as unknown as ContainerExtensionAPI;

  extensionContextMock = {
    storagePath: '/test/storage',
    subscriptions: [],
  };

  const container = new Container();
  container.bind(GatewayContainerManager).toSelf();
  container.bind(ContainerExtensionAPISymbol).toConstantValue(containerExtensionAPIMock);
  container.bind(ExtensionContextSymbol).toConstantValue(extensionContextMock);
  container.bind(SocketHelper).toSelf().inSingletonScope();
  container.bind(AdmissionHookHelper).toSelf().inSingletonScope();

  gatewayContainerManager = await container.getAsync<GatewayContainerManager>(GatewayContainerManager);

  vi.mocked(SocketHelper.prototype.getInfo).mockResolvedValue(fakeInfo);
  vi.mocked(SocketHelper.prototype.getSocketPathFromInfo).mockReturnValue('/run/podman/podman.sock');
  vi.mocked(SocketHelper.prototype.getLocalDataDir).mockReturnValue('/home/user/.local');
  vi.mocked(AdmissionHookHelper.prototype.getHookDirectory).mockReturnValue(HOOK_DIR);
});

async function expectGatewayMetadata(endpoint: string | RegExp): Promise<void> {
  expect(writeFile).toHaveBeenCalledWith(
    join(gatewayContainerManager.getOpenshellGatewaysDir(), 'kaiden-podman', 'metadata.json'),
    expect.toSatisfy(str => {
      expect(JSON.parse(str)).toEqual({
        name: 'kaiden-podman',
        gateway_endpoint: typeof endpoint === 'string' ? endpoint : expect.stringMatching(endpoint),
        is_remote: false,
        gateway_port: 0,
        auth_mode: 'plaintext',
      });
      return true;
    }),
    'utf-8',
  );
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
          'ai.openkaiden.openshell-podman-gateway.hook': 'true',
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
          'ai.openkaiden.openshell-podman-gateway.hook': 'true',
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

  test('should skip image pull when image already exists locally', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    vi.mocked(Dockerode.Image.prototype.inspect).mockResolvedValue({} as unknown as Dockerode.ImageInspectInfo);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.getImage).toHaveBeenCalledWith(GATEWAY_IMAGE);
    expect(Dockerode.prototype.pull).not.toHaveBeenCalled();
    expect(Dockerode.prototype.createContainer).toHaveBeenCalled();
  });

  test('should pull image when it does not exist locally', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    vi.mocked(Dockerode.Image.prototype.inspect).mockRejectedValue(new Error('no such image'));

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.getImage).toHaveBeenCalledWith(GATEWAY_IMAGE);
    expect(Dockerode.prototype.pull).toHaveBeenCalledWith(GATEWAY_IMAGE);
    expect(Dockerode.prototype.createContainer).toHaveBeenCalled();
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

    expect(gatewayCreateCall.Entrypoint).toEqual(['/kaiden-hook/openshell-admission-hook']);
    expect(gatewayCreateCall.Cmd).toEqual([
      'launch',
      '--',
      '/usr/local/bin/openshell-gateway',
      '--port',
      String(port),
      '--disable-tls',
      '--bind-address',
      '0.0.0.0',
      '--config',
      '/kaiden/gateway.toml',
    ]);
    expect(gatewayCreateCall.HostConfig!.PortBindings).toEqual({
      [`${port}/tcp`]: [{ HostPort: String(port) }],
    });
  });

  test('should mount the admission hook folder read-only to /kaiden-hook', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Labels: expect.objectContaining({ 'ai.openkaiden.openshell-podman-gateway.hook': 'true' }),
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([
            {
              Source: HOOK_DIR,
              Type: 'bind',
              Target: '/kaiden-hook',
              ReadOnly: true,
            },
          ]),
        }),
      }),
    );
  });

  test('should not create the gateway container when the admission hook binary is missing', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.mocked(AdmissionHookHelper.prototype.getHookDirectory).mockReturnValue(undefined);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.pull).not.toHaveBeenCalled();
    expect(Dockerode.prototype.createContainer).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to ensure gateway container'),
      expect.objectContaining({ message: expect.stringContaining('openshell-admission-hook binary not found') }),
    );
  });

  test('should replace an existing container that does not run the admission hook', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      {
        Id: 'legacy-gateway',
        State: 'running',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
          'ai.openkaiden.openshell-podman-gateway.port': '12345',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.getContainer).toHaveBeenCalledWith('legacy-gateway');
    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledWith({ force: true });
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Entrypoint: ['/kaiden-hook/openshell-admission-hook'],
        Labels: expect.objectContaining({ 'ai.openkaiden.openshell-podman-gateway.hook': 'true' }),
      }),
    );
    await expectGatewayMetadata(/^http:\/\/localhost:\d+$/);
  });

  test('should keep an existing container without the admission hook when the hook binary is missing', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    vi.mocked(Dockerode.prototype.listContainers).mockResolvedValue([
      {
        Id: 'legacy-gateway',
        State: 'running',
        Labels: {
          'ai.openkaiden.openshell-podman-gateway': 'true',
          'ai.openkaiden.openshell-podman-gateway.port': '12345',
        },
      },
    ] as unknown as Dockerode.ContainerInfo[]);
    vi.mocked(AdmissionHookHelper.prototype.getHookDirectory).mockReturnValue(undefined);

    await gatewayContainerManager.init();

    expect(Dockerode.Container.prototype.remove).not.toHaveBeenCalled();
    expect(Dockerode.prototype.createContainer).not.toHaveBeenCalled();
  });

  test.each([
    '/home/user/.local',
    '/root/.local',
  ])('should mount openshell state and share folders from %s', async localDataDir => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.mocked(SocketHelper.prototype.getLocalDataDir).mockReturnValue(localDataDir);

    await gatewayContainerManager.init();

    expect(SocketHelper.prototype.getInfo).toHaveBeenCalledWith(endpointMock.dockerode);
    expect(SocketHelper.prototype.getLocalDataDir).toHaveBeenCalledWith(fakeInfo);
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([
            {
              Source: `${localDataDir}/state/openshell`,
              Type: 'bind',
              Target: '/root/.local/state/openshell',
            },
            {
              Source: `${localDataDir}/share/openshell`,
              Type: 'bind',
              Target: '/root/.local/share/openshell',
            },
          ]),
        }),
      }),
    );
  });

  test('should mount the container engine socket from the engine info', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(SocketHelper.prototype.getSocketPathFromInfo).toHaveBeenCalledWith(fakeInfo);
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([
            {
              Source: '/run/podman/podman.sock',
              Type: 'bind',
              Target: '/run/user/0/podman/podman.sock',
            },
          ]),
        }),
      }),
    );
  });

  test('should mount the system drive from SYSTEMDRIVE', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.stubEnv('SYSTEMDRIVE', 'D:');

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([
            {
              Source: '/mnt/d',
              Type: 'bind',
              Target: '/mnt/d',
            },
          ]),
        }),
      }),
    );
  });

  test('should register gateway metadata after container is running', async () => {
    const { mkdir: mkdirMock } = await import('node:fs/promises');
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(mkdirMock).toHaveBeenCalledWith(join(gatewayContainerManager.getOpenshellGatewaysDir(), 'kaiden-podman'), {
      recursive: true,
    });
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
          'ai.openkaiden.openshell-podman-gateway.hook': 'true',
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
            'ai.openkaiden.openshell-podman-gateway.hook': 'true',
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
          'ai.openkaiden.openshell-podman-gateway.hook': 'true',
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

  test('should start cert container, wait for exit and remove it', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining(['generate-certs']),
        HostConfig: expect.not.objectContaining({ AutoRemove: expect.anything() }),
      }),
    );
    expect(Dockerode.Container.prototype.start).toHaveBeenCalled();
    expect(Dockerode.Container.prototype.wait).toHaveBeenCalledWith();
    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledOnce();
    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledWith({ force: true });
  });

  test('should get exit code when cert container has already exited before wait', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    let exited = false;
    vi.mocked(Dockerode.Container.prototype.start).mockImplementation(async () => {
      exited = true;
    });
    vi.mocked(Dockerode.Container.prototype.wait).mockImplementation(async () => {
      if (!exited) {
        throw new Error('wait registered before the container ran');
      }
      return { StatusCode: 0 };
    });

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledTimes(2);
  });

  test('should recreate gateway directory and bind mount it into cert container', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const gatewayDir = join('/test/storage', 'gateway');
    expect(rm).toHaveBeenCalledWith(gatewayDir, { recursive: true, force: true });
    expect(mkdir).toHaveBeenCalledWith(gatewayDir, { recursive: true });
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining(['generate-certs']),
        HostConfig: expect.objectContaining({
          Mounts: [{ Source: gatewayDir, Type: 'bind', Target: '/kaiden' }],
        }),
      }),
    );
  });

  test('should remove cert container and not create gateway when exit code is non-zero', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.mocked(Dockerode.Container.prototype.wait).mockResolvedValue({ StatusCode: 1 });

    await gatewayContainerManager.init();

    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledWith({ force: true });
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to ensure gateway container'),
      expect.objectContaining({ message: 'certificate generation failed with exit code 1' }),
    );
    expect(processApi.exec).not.toHaveBeenCalledWith('/usr/bin/openshell', expect.arrayContaining(['add']));
  });

  test('should remove cert container when start fails', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    const startError = new Error('mount failed');
    vi.mocked(Dockerode.Container.prototype.start).mockRejectedValueOnce(startError);

    await gatewayContainerManager.init();

    expect(Dockerode.Container.prototype.wait).not.toHaveBeenCalled();
    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledOnce();
    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledWith({ force: true });
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to ensure gateway container'),
      startError,
    );
    expect(processApi.exec).not.toHaveBeenCalledWith('/usr/bin/openshell', expect.arrayContaining(['add']));
  });

  test('should remove cert container when wait fails', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    const waitError = new Error('connection reset');
    vi.mocked(Dockerode.Container.prototype.wait).mockRejectedValueOnce(waitError);

    await gatewayContainerManager.init();

    expect(Dockerode.Container.prototype.remove).toHaveBeenCalledWith({ force: true });
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to ensure gateway container'),
      waitError,
    );
  });

  test('should surface start error even if cert container cleanup fails', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    const startError = new Error('mount failed');
    const removeError = new Error('no such container');
    vi.mocked(Dockerode.Container.prototype.start).mockRejectedValueOnce(startError);
    vi.mocked(Dockerode.Container.prototype.remove).mockRejectedValueOnce(removeError);

    await gatewayContainerManager.init();

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to remove certificate container'),
      removeError,
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to ensure gateway container'),
      startError,
    );
  });

  test('should still create gateway when cert container removal fails after success', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();
    vi.mocked(Dockerode.Container.prototype.remove).mockRejectedValueOnce(new Error('no such container'));

    await gatewayContainerManager.init();

    expect(Dockerode.prototype.createContainer).toHaveBeenCalledTimes(2);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('failed to remove certificate container'),
      expect.any(Error),
    );
  });

  test('should write gateway.toml config file', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('gateway.toml'),
      expect.stringContaining('[openshell.gateway.gateway_jwt]'),
    );
  });

  test('should generate gateway config using the podman compute driver', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('gateway.toml'),
      expect.stringContaining('compute_driver = "podman"'),
    );
  });

  test('should mount gateway directory to /kaiden in gateway container', async () => {
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const gatewayDir = join('/test/storage', 'gateway');
    expect(Dockerode.prototype.createContainer).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([
            expect.objectContaining({
              Source: gatewayDir,
              Type: 'bind',
              Target: '/kaiden',
            }),
          ]),
        }),
      }),
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

  test('should pass Windows host path unconverted as /kaiden mount source for cert and gateway containers', async () => {
    extensionContextMock.storagePath = 'C:\\Users\\test\\storage';
    Object.defineProperty(env, 'isWindows', { value: true, configurable: true });
    setupFollowProgress();

    await gatewayContainerManager.init();

    const gatewayDir = join('C:\\Users\\test\\storage', 'gateway');
    const kaidenMount = { Source: gatewayDir, Type: 'bind', Target: '/kaiden' };
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledTimes(2);
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining(['generate-certs']),
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([kaidenMount]),
        }),
      }),
    );
    expect(Dockerode.prototype.createContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Cmd: expect.arrayContaining(['--config', '/kaiden/gateway.toml']),
        HostConfig: expect.objectContaining({
          Mounts: expect.arrayContaining([kaidenMount]),
        }),
      }),
    );
  });
});

describe('getSystemDriveMountPath', () => {
  test.each([
    { systemDrive: 'C:', expected: '/mnt/c' },
    { systemDrive: 'D:', expected: '/mnt/d' },
    { systemDrive: 'e:', expected: '/mnt/e' },
    { systemDrive: 'F:\\', expected: '/mnt/f' },
  ])('should return $expected when SYSTEMDRIVE is $systemDrive', ({ systemDrive, expected }) => {
    vi.stubEnv('SYSTEMDRIVE', systemDrive);

    expect(gatewayContainerManager.getSystemDriveMountPath()).toBe(expected);
  });

  test.each(['', 'invalid'])('should fall back to /mnt/c when SYSTEMDRIVE is %j', systemDrive => {
    vi.stubEnv('SYSTEMDRIVE', systemDrive);

    expect(gatewayContainerManager.getSystemDriveMountPath()).toBe('/mnt/c');
  });

  test('should fall back to /mnt/c when SYSTEMDRIVE is not set', () => {
    vi.stubEnv('SYSTEMDRIVE', undefined);

    expect(gatewayContainerManager.getSystemDriveMountPath()).toBe('/mnt/c');
  });
});
