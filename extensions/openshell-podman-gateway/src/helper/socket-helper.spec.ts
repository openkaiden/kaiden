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

import type Dockerode from 'dockerode';
import { Container } from 'inversify';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Info } from '/@/helper/podman-info';

import { SocketHelper } from './socket-helper';

let socketHelper: SocketHelper;

beforeEach(async () => {
  vi.resetAllMocks();

  const container = new Container();
  container.bind(SocketHelper).toSelf();

  socketHelper = await container.getAsync<SocketHelper>(SocketHelper);
});

function createMockDockerode(
  dialImpl: (opts: unknown, callback: (err: unknown, data: unknown) => void) => void,
): Dockerode {
  return {
    modem: {
      dial: vi.fn().mockImplementation(dialImpl),
    },
  } as unknown as Dockerode;
}

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

describe('SocketHelper', () => {
  test('should call modem.dial with correct options', async () => {
    const dockerode = createMockDockerode((_opts, callback) => {
      callback(null, fakeInfo);
    });

    await socketHelper.getInfo(dockerode);

    expect(dockerode.modem.dial).toHaveBeenCalledWith(
      {
        path: '/v4.2.0/libpod/info',
        method: 'GET',
        statusCodes: {
          200: true,
          500: 'server error',
        },
        options: {},
      },
      expect.any(Function),
    );
  });

  test('should return parsed Info on success', async () => {
    const dockerode = createMockDockerode((_opts, callback) => {
      callback(null, fakeInfo);
    });

    const result = await socketHelper.getInfo(dockerode);

    expect(result).toEqual(fakeInfo);
    expect(result.host.os).toBe('linux');
    expect(result.version.APIVersion).toBe('4.2.0');
    expect(result.store.containerStore.running).toBe(1);
  });

  test('should reject on modem error', async () => {
    const dockerode = createMockDockerode((_opts, callback) => {
      callback(new Error('connection refused'), null);
    });

    await expect(socketHelper.getInfo(dockerode)).rejects.toThrow('connection refused');
  });

  test('should strip unix:// prefix from socket path', async () => {
    const info = structuredClone(fakeInfo);
    info.host.remoteSocket.path = 'unix:///run/podman/podman.sock';
    const dockerode = createMockDockerode((_opts, callback) => {
      callback(null, info);
    });

    const result = await socketHelper.getSocketPath(dockerode);

    expect(result).toBe('/run/podman/podman.sock');
  });

  test('should return path as-is when no unix:// prefix', async () => {
    const dockerode = createMockDockerode((_opts, callback) => {
      callback(null, fakeInfo);
    });

    const result = await socketHelper.getSocketPath(dockerode);

    expect(result).toBe('/run/podman/podman.sock');
  });

  test('should propagate error from getInfo', async () => {
    const dockerode = createMockDockerode((_opts, callback) => {
      callback(new Error('socket not found'), null);
    });

    await expect(socketHelper.getSocketPath(dockerode)).rejects.toThrow('socket not found');
  });

  test('should strip unix:// prefix from an already fetched info', () => {
    const info = structuredClone(fakeInfo);
    info.host.remoteSocket.path = 'unix:///run/user/1000/podman/podman.sock';

    expect(socketHelper.getSocketPathFromInfo(info)).toBe('/run/user/1000/podman/podman.sock');
  });

  test.each([
    { rootless: true, expected: '/home/user/.local' },
    { rootless: false, expected: '/root/.local' },
  ])('should return $expected as local data dir when rootless is $rootless', ({ rootless, expected }) => {
    const info = structuredClone(fakeInfo);
    info.host.security.rootless = rootless;

    expect(socketHelper.getLocalDataDir(info)).toBe(expected);
  });
});
