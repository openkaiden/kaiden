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

import { type ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createWriteStream, existsSync, type WriteStream } from 'node:fs';
import { type FileHandle, mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import type * as Timers from 'node:timers/promises';
import { setTimeout as delay } from 'node:timers/promises';

import type { CancellationToken, RunResult } from '@openkaiden/api';
import { afterEach, assert, beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Directories } from '/@/plugin/directories.js';
import type { OpenshellGatewayManager } from '/@/plugin/openshell-cli/openshell-gateway-manager.js';
import type { Proxy as ProxyService } from '/@/plugin/proxy.js';
import type { NotificationRegistry } from '/@/plugin/tasks/notification-registry.js';
import { Exec } from '/@/plugin/util/exec.js';
import { getFreePort, isFreePort } from '/@/plugin/util/port.js';
import { isLinux, isMac } from '/@/util.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';
import type { ListedGateway } from '/@api/openshell-gateway-info.js';

import { OpenshellGateway } from './openshell-gateway.js';

vi.mock(import('node:child_process'));
vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('node:timers/promises'));
vi.mock(import('/@/plugin/util/exec.js'));
vi.mock(import('/@/plugin/util/port.js'));
vi.mock(import('/@/util.js'));

const GATEWAY_BINARY = '/usr/local/bin/openshell-gateway';
const KAIDEN_DATA_DIRECTORY = '/home/user/.local/share/kaiden';
const GATEWAY_STORAGE_DIRECTORY = join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'kaiden-local');
const GATEWAY_CONFIG_PATH = join(GATEWAY_STORAGE_DIRECTORY, 'gateway.toml');
const GATEWAY_DB_URL = `sqlite:${join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db')}?mode=rwc`;
const GATEWAY_LOG_PATH = join(GATEWAY_STORAGE_DIRECTORY, 'gateway.log');

type MockWriteStream = WriteStream & {
  write: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const gatewayLogStream = Object.assign(new EventEmitter(), {
  write: vi.fn(),
  end: vi.fn(),
}) as unknown as MockWriteStream;

const closeLogFile = vi.fn();

function createMockChildProcess(): ChildProcess & { _stdout: EventEmitter; _stderr: EventEmitter } {
  const proc = new EventEmitter() as ChildProcess & { _stdout: EventEmitter; _stderr: EventEmitter };
  proc._stdout = new EventEmitter();
  proc._stderr = new EventEmitter();
  Object.defineProperty(proc, 'stdout', { get: (): EventEmitter => proc._stdout });
  Object.defineProperty(proc, 'stderr', { get: (): EventEmitter => proc._stderr });
  proc.kill = vi.fn().mockReturnValue(true);
  return proc;
}

function mockExecResult(stdout = ''): RunResult {
  return { command: GATEWAY_BINARY, stdout, stderr: '' };
}

function listed(name: string, endpoint: string, overrides: Partial<ListedGateway['metadata']> = {}): ListedGateway {
  return {
    metadata: { name, gateway_endpoint: endpoint, is_remote: false, gateway_port: 0, ...overrides },
    source: 'user',
  };
}

class TestOpenshellGateway extends OpenshellGateway {
  readonly stoppedGatewayNames: string[] = [];

  override stopAndDrainGateway(name: string): Promise<void> {
    this.stoppedGatewayNames.push(name);
    return super.stopAndDrainGateway(name);
  }
}

class GatewayFixture {
  readonly process = createMockChildProcess();

  exitOnKill(): void {
    vi.mocked(this.process.kill).mockImplementation(() => {
      this.process.emit('exit', undefined, 'SIGTERM');
      return true;
    });
  }

  discoverNamedGateway(): void {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:17675')]);
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('not ready'));
  }

  failSignals(proc: ChildProcess = this.process): void {
    vi.mocked(proc.kill).mockImplementation(() => {
      throw new Error('kill ENOSYS');
    });
  }
}

let exec: Exec;
let gateway: TestOpenshellGateway;
let logFile: FileHandle;
let fixture: GatewayFixture;

const cliToolRegistry = {
  getCliToolInfos: vi.fn(),
} as unknown as CliToolRegistry;

const gatewayManager = {
  listGateways: vi.fn(),
  getActiveGateway: vi.fn(),
  setActiveGateway: vi.fn(),
  health: vi.fn(),
  addGateway: vi.fn(),
  removeGateway: vi.fn(),
  getGateway: vi.fn(),
  getGatewayInfo: vi.fn(),
} as unknown as OpenshellGatewayManager;

const directories = {
  getDataDirectory: vi.fn().mockReturnValue(KAIDEN_DATA_DIRECTORY),
} as unknown as Directories;

const notificationRegistry = {
  addNotification: vi.fn(),
} as unknown as NotificationRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  exec = new Exec({} as unknown as ProxyService);
  vi.useRealTimers();
  vi.mocked(delay).mockImplementation(
    (ms, value, options) =>
      new Promise((resolve, reject) => {
        const signal = options?.signal;
        const abortError = new DOMException('The operation was aborted', 'AbortError');
        if (signal?.aborted) {
          reject(abortError);
          return;
        }
        const timeout = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        }, ms);
        const onAbort = (): void => {
          clearTimeout(timeout);
          reject(abortError);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
  );
  vi.mocked(getFreePort).mockResolvedValue(29670);
  gatewayLogStream.removeAllListeners();
  vi.mocked(directories.getDataDirectory).mockReturnValue(KAIDEN_DATA_DIRECTORY);
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
    { name: 'openshell-gateway', path: GATEWAY_BINARY },
  ] as unknown as CliToolInfo[]);
  vi.mocked(createWriteStream).mockReturnValue(gatewayLogStream);
  vi.mocked(existsSync).mockReturnValue(false);
  logFile = { fd: 42, close: closeLogFile } as unknown as FileHandle;
  vi.mocked(open).mockResolvedValue(logFile);
  vi.mocked(writeFile).mockResolvedValue();
  vi.mocked(unlink).mockResolvedValue();
  vi.mocked(isFreePort).mockResolvedValue(true);
  vi.mocked(gatewayManager.removeGateway).mockResolvedValue();
  vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
  vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue(undefined);
  vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });
  vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });
  vi.mocked(gatewayManager.addGateway).mockResolvedValue();
  vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
  vi.mocked(rename).mockResolvedValue(undefined);
  vi.mocked(readFile).mockResolvedValue('');
  gateway = new TestOpenshellGateway(cliToolRegistry, gatewayManager, directories, exec, notificationRegistry);
  fixture = new GatewayFixture();
  vi.mocked(spawn).mockReturnValue(fixture.process);
  vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(['default', 'created'])('%s gateway process environment', launch => {
  test.each([
    { platformKind: 'darwin', path: '/usr/bin:/bin' },
    { platformKind: 'linux', path: '/usr/bin:/bin' },
    { platformKind: 'darwin', path: undefined },
    { platformKind: 'linux', path: undefined },
    { platformKind: 'darwin', path: '' },
    { platformKind: 'linux', path: '' },
    { platformKind: 'win32', path: 'C:\\Windows\\System32' },
  ])('prepares the child environment on $platformKind with PATH=$path', async ({ platformKind, path }) => {
    vi.mocked(isMac).mockReturnValue(platformKind === 'darwin');
    vi.mocked(isLinux).mockReturnValue(platformKind === 'linux');
    vi.stubEnv('PATH', path);
    vi.stubEnv('NO_COLOR', '0');
    vi.stubEnv('OPENSHELL_LOG_LEVEL', 'debug');
    const bundleDirectory = join('/bundled tools', 'openshell');
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
      { name: 'openshell-gateway', path: join(bundleDirectory, 'openshell-gateway') },
    ] as unknown as CliToolInfo[]);
    vi.mocked(spawn).mockReturnValue(createMockChildProcess());
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.116'));

    if (launch === 'default') {
      await gateway.start();
    } else {
      await gateway.createLocalGateway({
        name: 'local-dev',
        bindAddress: '127.0.0.1',
        port: 17675,
        driver: 'vm',
      });
    }

    const env = vi.mocked(spawn).mock.calls[0]?.[2]?.env;
    const expectedPath =
      platformKind === 'win32' ? path : path ? `${bundleDirectory}${delimiter}${path}` : bundleDirectory;
    expect(env?.['PATH']).toBe(expectedPath);
    expect(env?.['NO_COLOR']).toBe('1');
    expect(env?.['OPENSHELL_LOG_LEVEL']).toBe('debug');
    expect(process.env['PATH']).toBe(path);
    expect(process.env['NO_COLOR']).toBe('0');
  });

  test('should set XDG_STATE_HOME to gateway storage state directory', async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess());
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.116'));

    if (launch === 'default') {
      await gateway.start();
      expect(vi.mocked(spawn).mock.calls[0]?.[2]?.env?.['XDG_STATE_HOME']).toBe(
        join(GATEWAY_STORAGE_DIRECTORY, 'state'),
      );
    } else {
      const name = 'local-dev';
      await gateway.createLocalGateway({
        name,
        bindAddress: '127.0.0.1',
        port: 17675,
        driver: 'vm',
      });
      const expectedStorageDir = join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', name);
      expect(vi.mocked(spawn).mock.calls[0]?.[2]?.env?.['XDG_STATE_HOME']).toBe(join(expectedStorageDir, 'state'));
    }
  });
});

describe('init', () => {
  test('does not inspect storage paths for invalid registered gateway names', async () => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('../outside', 'http://127.0.0.1:17675')]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('../outside');
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(existsSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test.each([
    '127.0.0.1',
    'localhost',
    '0.0.0.0',
  ])('starts a stopped gateway using its registered bind address %s', async bindAddress => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', `http://${bindAddress}:17675`)]);
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining([
        '--config',
        join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'local-dev', 'gateway.toml'),
        '--port',
        '17675',
        '--bind-address',
        bindAddress,
      ]),
      expect.objectContaining({ detached: false }),
    );
  });

  test('skips auto-start when existing gateway is healthy and already active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-gw', 'https://127.0.0.1:8443')]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local-gw');
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(gatewayManager.listGateways).toHaveBeenCalled();
    expect(gatewayManager.health).toHaveBeenCalledWith('local-gw');
    expect(spawn).not.toHaveBeenCalled();
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(gatewayManager.setActiveGateway).not.toHaveBeenCalled();
  });

  test('selects healthy gateway when it is not active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('kaiden-alt', 'http://127.0.0.1:18080')]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue(undefined);
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(gatewayManager.setActiveGateway).toHaveBeenCalledWith('kaiden-alt');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('auto-starts kaiden-local on 29670 without deduplicating a stopped standalone gateway on 17670', async () => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('openshell', 'http://127.0.0.1:17670')]);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(getFreePort).mockImplementation(async (port = 0) => port);
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('standalone gateway stopped'))
      .mockRejectedValueOnce(new Error('no gateway on the default port'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(spawn).toHaveBeenCalledWith(GATEWAY_BINARY, expect.arrayContaining(['--port', '29670']), expect.anything());
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:29670', gateway_port: 29670 }),
    );
    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('openshell');
    expect(gateway.isRunning()).toBe(true);
  });

  test('prefers external gateway over kaiden-local on same port and removes kaiden-local', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('kaiden-local', 'http://127.0.0.1:17670'),
      listed('openshell', 'http://127.0.0.1:17670'),
    ]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('kaiden-local');
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(gatewayManager.setActiveGateway).toHaveBeenCalledWith('openshell');
    expect(gatewayManager.removeGateway).toHaveBeenCalledWith('kaiden-local');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('removes stale gateway when kaiden-local is healthy on same port', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('my-private-gw', 'http://localhost:17670'),
      listed('kaiden-local', 'http://127.0.0.1:17670'),
    ]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('kaiden-local');
    // my-private-gw (ordered first due to same-port priority) is unreachable,
    // kaiden-local is healthy
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(gatewayManager.removeGateway).toHaveBeenCalledWith('my-private-gw');
    expect(gatewayManager.setActiveGateway).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('removes stale gateway on same port after auto-starting kaiden-local', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    vi.mocked(gatewayManager.listGateways)
      // init() discovery: only the stale external gateway
      .mockResolvedValueOnce([listed('my-private-gw', 'http://127.0.0.1:29670')])
      // removeSamePortGateways(): both exist after registration
      .mockResolvedValueOnce([
        listed('my-private-gw', 'http://127.0.0.1:29670'),
        listed('kaiden-local', 'http://127.0.0.1:29670'),
      ]);

    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('connection refused')) // stale gateway unreachable
      .mockRejectedValueOnce(new Error('connection refused')) // orphan check on default port
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' }); // waitForReady
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(spawn).toHaveBeenCalled();
    expect(gatewayManager.removeGateway).toHaveBeenCalledWith('my-private-gw');
  });

  test('replaces stopped legacy kaiden-local on 17670 with a gateway on 29670', async () => {
    const legacyGateway = listed('kaiden-local', 'http://127.0.0.1:17670', { gateway_port: 17670 });
    vi.mocked(gatewayManager.listGateways).mockResolvedValueOnce([legacyGateway]);
    vi.mocked(gatewayManager.getGateway).mockResolvedValueOnce(legacyGateway.metadata);
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('legacy gateway stopped'))
      .mockRejectedValueOnce(new Error('no gateway on the new default port'));

    await gateway.init();

    expect(gatewayManager.removeGateway).toHaveBeenNthCalledWith(1, 'kaiden-local');
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith('kaiden-local', {
      name: 'kaiden-local',
      gateway_endpoint: 'http://127.0.0.1:29670',
      is_remote: false,
      gateway_port: 29670,
    });
    expect(getFreePort).toHaveBeenCalledWith(29670);
    expect(spawn).toHaveBeenCalledWith(GATEWAY_BINARY, expect.arrayContaining(['--port', '29670']), expect.anything());
    expect(gateway.isRunning()).toBe(true);
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });

  test('auto-starts local gateway when no gateways exist and port is free', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    // The orphan check fails (health rejects), then auto-start health check succeeds
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.stringContaining('compute_driver = "podman"'),
      'utf-8',
    );
    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '29670']),
      expect.objectContaining({ detached: false }),
    );
  });

  test('reuses orphan gateway when port is already healthy', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.init();

    expect(spawn).not.toHaveBeenCalled();
    expect(gatewayManager.addGateway).toHaveBeenCalledWith(
      'kaiden-local',
      expect.objectContaining({
        name: 'kaiden-local',
        gateway_endpoint: 'http://127.0.0.1:29670',
        is_remote: false,
      }),
    );
  });

  test('skips auto-start when discovery fails and binary is not registered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockRejectedValue(new Error('config dir not found'));
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([] as unknown as CliToolInfo[]);

    await gateway.init();

    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('init port allocation', () => {
  test.each([29670, 29671, 29672, 65535])('starts and registers kaiden-local on available port %s', async port => {
    vi.mocked(getFreePort).mockResolvedValue(port);
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('default port is not a healthy gateway'));

    await gateway.init();

    expect(getFreePort).toHaveBeenCalledWith(29670);
    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', String(port)]),
      expect.anything(),
    );
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: `http://127.0.0.1:${port}`, gateway_port: port }),
    );
    expect(gateway.isRunning()).toBe(true);
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });

  test.each([
    { host: '127.0.0.1', isRemote: false },
    { host: 'localhost', isRemote: true },
    { host: '[::1]', isRemote: true },
  ])('preserves a stopped local registration on fallback port $host:29671', async ({ host, isRemote }) => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('local-dev', `http://${host}:29671`, { is_remote: isRemote }),
    ]);
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('registered gateway stopped'))
      .mockRejectedValueOnce(new Error('default port is not a healthy gateway'));
    vi.mocked(getFreePort).mockResolvedValueOnce(29671).mockResolvedValue(29672);

    await gateway.init();

    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('local-dev');
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:29672', gateway_port: 29672 }),
    );
    expect(spawn).toHaveBeenCalledWith(GATEWAY_BINARY, expect.arrayContaining(['--port', '29672']), expect.anything());
    expect(gateway.isRunning()).toBe(true);
  });

  test('keeps consecutive port reservations when active gateway lookup fails', async () => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('local-one', 'http://127.0.0.1:29671'),
      listed('local-two', 'http://127.0.0.1:29672'),
    ]);
    vi.mocked(gatewayManager.getActiveGateway).mockRejectedValue(new Error('cannot read active gateway'));
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('default port is not a healthy gateway'));
    vi.mocked(getFreePort).mockResolvedValueOnce(29671).mockResolvedValueOnce(29672).mockResolvedValue(29673);

    await gateway.init();

    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('local-one');
    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('local-two');
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:29673', gateway_port: 29673 }),
    );
    expect(gateway.isRunning()).toBe(true);
  });

  test('reserves the fallback port of a created gateway whose restart fails', async () => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:29671')]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(spawn).mockImplementationOnce(() => {
      throw new Error('failed to spawn created gateway');
    });
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('created gateway stopped'))
      .mockRejectedValueOnce(new Error('created gateway restart failed'))
      .mockRejectedValueOnce(new Error('default port is not a healthy gateway'));
    vi.mocked(getFreePort).mockResolvedValueOnce(29671).mockResolvedValue(29672);

    await gateway.init();

    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('local-dev');
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:29672', gateway_port: 29672 }),
    );
    expect(gateway.canStopGateway('local-dev')).toBe(false);
    expect(gateway.isRunning()).toBe(true);
  });

  test.each([
    listed('kaiden-local', 'http://127.0.0.1:29671'),
    listed('remote-dev', 'https://gateway.example.com:29671', { is_remote: true }),
  ])('does not reserve the fallback port of $metadata.name', async registration => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([registration]);
    if (registration.metadata.name === 'kaiden-local') {
      vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('registered gateway stopped'));
    }
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('default port is not a healthy gateway'));
    vi.mocked(getFreePort).mockResolvedValue(29671);

    await gateway.init();

    expect(getFreePort).toHaveBeenCalledOnce();
    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('remote-dev');
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:29671', gateway_port: 29671 }),
    );
    expect(gateway.isRunning()).toBe(true);
  });

  test('continues auto-start when registration discovery fails', async () => {
    vi.mocked(gatewayManager.listGateways).mockRejectedValueOnce(new Error('cannot read registrations'));
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('default port is not a healthy gateway'));
    vi.mocked(getFreePort).mockResolvedValue(29671);

    await gateway.init();

    expect(gatewayManager.listGateways).toHaveBeenCalledOnce();
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:29671', gateway_port: 29671 }),
    );
    expect(gateway.isRunning()).toBe(true);
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });

  test('reports exhaustion when the last available port is reserved without requesting port 65536', async () => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:65535')]);
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('connection refused'));
    vi.mocked(getFreePort).mockResolvedValue(65535);
    const failListener = vi.fn();
    gateway.onDidGatewayInitFailed(failListener);

    await gateway.init();

    const message = 'Unable to find an available gateway port: remaining ports are busy or reserved.';
    expect(getFreePort).toHaveBeenCalledExactlyOnceWith(29670);
    expect(gatewayManager.removeGateway).not.toHaveBeenCalledWith('local-dev');
    expect(spawn).not.toHaveBeenCalled();
    expect(gateway.isRunning()).toBe(false);
    expect(failListener).toHaveBeenCalledWith(message);
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: message, type: 'error' }),
    );
  });

  test('reports socket allocation failure without spawning a gateway', async () => {
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('default port is not a healthy gateway'));
    const message = 'Unable to find a free port: all ports in the valid range (1024-65535) are busy.';
    vi.mocked(getFreePort).mockRejectedValue(new Error(message));

    await gateway.init();

    expect(spawn).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: message, type: 'error' }),
    );
  });

  test('blocks auto-start when the recorded PID is still alive', async () => {
    // Signal 0 checks this test process without sending it a signal or mocking the global process.
    vi.mocked(readFile).mockResolvedValue(String(process.pid));
    vi.mocked(gatewayManager.health).mockRejectedValueOnce(new Error('default port is not a healthy gateway'));

    await gateway.init();

    const message = `A process recorded for kaiden-local is still alive (PID ${process.pid}). Stop it before restarting.`;
    expect(getFreePort).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ body: message, type: 'error' }),
    );
  });
});

describe('createLocalGateway', () => {
  test('does not track an invalid name for disposal', async () => {
    await expect(
      gateway.createLocalGateway({ name: ' invalid/name ', bindAddress: '127.0.0.1', port: 17675 }),
    ).rejects.toThrow('Gateway name must start with a lowercase letter or number');

    await gateway.asyncDispose();

    expect(gateway.stoppedGatewayNames).not.toContain('invalid/name');
    expect(gatewayManager.listGateways).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('uses the trimmed name for creation and lifecycle tracking', async () => {
    await gateway.createLocalGateway({ name: ' local-dev ', bindAddress: '127.0.0.1', port: 17675 });

    expect(gatewayManager.addGateway).toHaveBeenCalledWith('local-dev', expect.objectContaining({ name: 'local-dev' }));
    expect(gateway.canStopGateway('local-dev')).toBe(true);

    fixture.exitOnKill();
    await gateway.stopAndDrainGateway('local-dev');
    expect(gateway.canStopGateway('local-dev')).toBe(false);
  });

  test.each([
    { owner: 'stopped-gw', endpoint: 'http://127.0.0.1:17675', isRemote: false },
    { owner: 'kaiden-local', endpoint: 'http://127.0.0.1:17675', isRemote: false },
    { owner: 'external-gw', endpoint: 'http://localhost:17675', isRemote: false },
    { owner: 'lan-gw', endpoint: 'http://192.168.1.10:17675', isRemote: false },
    { owner: 'remote-flagged-gw', endpoint: 'http://127.0.0.1:17675', isRemote: true },
  ])('rejects a port assigned to registered local gateway $owner', async ({ owner, endpoint, isRemote }) => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed(owner, endpoint, { is_remote: isRemote })]);

    await expect(
      gateway.createLocalGateway({ name: 'local-dev', bindAddress: '127.0.0.1', port: 17675 }),
    ).rejects.toThrow(`Port 17675 is already assigned to gateway "${owner}"`);

    expect(isFreePort).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(gatewayManager.addGateway).not.toHaveBeenCalled();
  });

  test('allows a port number used by a remote gateway', async () => {
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('remote-gw', 'https://gateway.example.com:17675', { is_remote: true }),
    ]);

    await gateway.createLocalGateway({ name: 'local-dev', bindAddress: '127.0.0.1', port: 17675 });

    expect(gatewayManager.addGateway).toHaveBeenCalledWith(
      'local-dev',
      expect.objectContaining({ gateway_endpoint: 'http://127.0.0.1:17675' }),
    );
  });

  test('preserves each requested endpoint when same-name creations overlap', async () => {
    const opening = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const openLogFile = vi.mocked(open).getMockImplementation();
    assert(openLogFile);
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const logFile = await openLogFile(...args);
      opening.resolve();
      await resume.promise;
      return logFile;
    });
    vi.mocked(spawn).mockImplementation(() => createMockChildProcess());

    const firstCreation = gateway.createLocalGateway({
      name: 'local-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
    });
    await opening.promise;
    try {
      await gateway.createLocalGateway({
        name: 'local-dev',
        bindAddress: '127.0.0.1',
        port: 17676,
      });
    } finally {
      resume.resolve();
      await firstCreation;
    }

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(gatewayManager.addGateway).toHaveBeenCalledTimes(2);
    for (const [index, port] of [17676, 17675].entries()) {
      expect(spawn).toHaveBeenNthCalledWith(
        index + 1,
        GATEWAY_BINARY,
        expect.arrayContaining(['--port', String(port), '--bind-address', '127.0.0.1']),
        expect.anything(),
      );
      expect(gatewayManager.addGateway).toHaveBeenNthCalledWith(index + 1, 'local-dev', {
        name: 'local-dev',
        gateway_endpoint: `http://127.0.0.1:${port}`,
        is_remote: false,
        gateway_port: port,
      });
    }
  });

  describe('startup lifecycle', () => {
    const options = { name: 'local-dev', bindAddress: '127.0.0.1', port: 17675 };

    beforeEach(() => {
      fixture.exitOnKill();
    });

    test('cancels every overlapping creation before spawning', async () => {
      const opening = Promise.withResolvers<FileHandle>();
      vi.mocked(open).mockReturnValue(opening.promise);
      const first = expect(gateway.createLocalGateway(options)).rejects.toThrow('startup cancelled by Stop');
      const second = expect(gateway.createLocalGateway({ ...options, port: 17676 })).rejects.toThrow(
        'startup cancelled by Stop',
      );
      await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));

      const stopping = gateway.stopAndDrainGateway(options.name);
      opening.resolve(logFile);
      await Promise.all([first, second, stopping]);

      expect(spawn).not.toHaveBeenCalled();
      expect(gateway.canStopGateway(options.name)).toBe(false);
      expect(closeLogFile).toHaveBeenCalledTimes(2);
    });

    test('cancels creation during registration and permits an immediate restart', async () => {
      const pending = Promise.withResolvers<void>();
      vi.mocked(gatewayManager.addGateway).mockReturnValueOnce(pending.promise);
      const events: string[] = [];
      const started = gateway.onDidGatewayStart(() => events.push('started'));
      try {
        const rejected = expect(gateway.createLocalGateway(options)).rejects.toThrow('startup cancelled by Stop');
        await vi.waitFor(() => expect(gatewayManager.addGateway).toHaveBeenCalled());
        const stopping = gateway.stopAndDrainGateway(options.name);
        pending.resolve();
        await stopping;
        expect(events).toEqual([]);
        expect(gateway.canStopGateway(options.name)).toBe(false);
        expect(spawn).toHaveBeenCalledOnce();
        expect(gatewayManager.removeGateway).toHaveBeenCalledOnce();
        expect(gatewayManager.getGatewayInfo).not.toHaveBeenCalled();
        expect(closeLogFile).toHaveBeenCalledOnce();
        vi.mocked(spawn).mockReturnValue(createMockChildProcess());
        await gateway.createLocalGateway(options);
        await rejected;
        expect(events).toEqual(['started']);
        expect(gateway.canStopGateway(options.name)).toBe(true);
      } finally {
        started.dispose();
      }
    });

    test('rejects readiness for a signal-terminated process without polling', async () => {
      Object.defineProperty(fixture.process, 'signalCode', { value: 'SIGTERM', configurable: true });
      vi.mocked(fixture.process.kill).mockImplementation(() => {
        queueMicrotask(() => fixture.process.emit('exit', undefined, 'SIGTERM'));
        return true;
      });
      await expect(gateway.createLocalGateway(options)).rejects.toThrow('Gateway process exited before becoming ready');
      expect(gatewayManager.getGatewayInfo).not.toHaveBeenCalled();
    });

    test('preserves readiness failure and removes the registration after an exit timeout', async () => {
      vi.useFakeTimers();
      vi.mocked(fixture.process.kill).mockReturnValue(true);
      vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('not ready'));
      const starting = gateway.createLocalGateway(options);
      const rejected = expect(starting).rejects.toThrow('Gateway did not become ready');
      await vi.runAllTimersAsync();
      await rejected;

      expect(gatewayManager.removeGateway).toHaveBeenCalledExactlyOnceWith('local-dev');
      expect(gateway.canStopGateway('local-dev')).toBe(true);
      expect(spawn).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);

      fixture.exitOnKill();
      await gateway.stopAndDrainGateway('local-dev');
      expect(gateway.canStopGateway('local-dev')).toBe(false);
    });
  });

  test('starts and registers a named plaintext gateway on loopback', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.createLocalGateway({
      name: 'local-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
      driver: 'podman',
    });

    const storageDirectory = join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'local-dev');
    expect(writeFile).toHaveBeenCalledWith(
      join(storageDirectory, 'gateway.toml'),
      expect.stringContaining('enable_bind_mounts = true'),
      'utf-8',
    );
    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining([
        '--port',
        '17675',
        '--bind-address',
        '127.0.0.1',
        '--config',
        join(storageDirectory, 'gateway.toml'),
        '--db-url',
        `sqlite:${join(storageDirectory, 'gateway.db')}?mode=rwc`,
        '--disable-tls',
      ]),
      expect.objectContaining({
        detached: false,
        stdio: ['ignore', 42, 42],
      }),
    );
    expect(gatewayManager.addGateway).toHaveBeenCalledWith(
      'local-dev',
      expect.objectContaining({
        name: 'local-dev',
        gateway_endpoint: 'http://127.0.0.1:17675',
        is_remote: false,
        gateway_port: 17675,
      }),
    );
  });

  test('cleans up the process and registration when startup fails', async () => {
    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'exitCode', { get: () => 1 });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await expect(
      gateway.createLocalGateway({
        name: 'local-dev',
        bindAddress: '127.0.0.1',
        port: 17675,
        driver: 'podman',
      }),
    ).rejects.toThrow('Gateway process exited before becoming ready');

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    expect(gatewayManager.removeGateway).toHaveBeenCalledWith('local-dev');
  });
});

describe('getGatewayBinaryPath', () => {
  test('returns path from CLI tool registry', () => {
    expect(gateway.getGatewayBinaryPath()).toBe(GATEWAY_BINARY);
  });

  test('returns undefined when openshell-gateway is not registered', () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([] as unknown as CliToolInfo[]);
    expect(gateway.getGatewayBinaryPath()).toBeUndefined();
  });
});

describe('start', () => {
  test('concurrent callers await the same startup until it fails', async () => {
    const health = Promise.withResolvers<{ status: string; version: string }>();
    vi.mocked(gatewayManager.health).mockReturnValue(health.promise);
    vi.mocked(fixture.process.kill).mockImplementation(() => {
      Object.defineProperty(fixture.process, 'signalCode', { value: 'SIGTERM', configurable: true });
      fixture.process.emit('exit', undefined, 'SIGTERM');
      return true;
    });
    const first = gateway.start();
    await vi.waitFor(() => expect(gatewayManager.health).toHaveBeenCalledOnce());
    const second = gateway.start();
    const completion = Promise.allSettled([first, second]);
    const stopping = gateway.stop();
    health.resolve({ status: 'healthy', version: '1.0.0' });
    await stopping;
    const results = await completion;
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
    expect(spawn).toHaveBeenCalledOnce();
  });

  test('spawns the gateway process and writes its output only to the log', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();
    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      [
        '--config',
        GATEWAY_CONFIG_PATH,
        '--port',
        '29670',
        '--bind-address',
        '127.0.0.1',
        '--disable-tls',
        '--db-url',
        GATEWAY_DB_URL,
      ],
      expect.objectContaining({ detached: false }),
    );
    expect(createWriteStream).toHaveBeenCalledWith(GATEWAY_LOG_PATH, { flags: 'w' });
    expect(gatewayLogStream.write).not.toHaveBeenCalled();

    consoleLog.mockClear();
    consoleError.mockClear();
    const stdout = Buffer.from('routine gateway output\n');
    const stderr = Buffer.from('routine gateway diagnostic\n');
    proc._stdout.emit('data', stdout);
    proc._stderr.emit('data', stderr);

    expect(gatewayLogStream.write).toHaveBeenNthCalledWith(1, stdout);
    expect(gatewayLogStream.write).toHaveBeenNthCalledWith(2, stderr);
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  test('registers gateway via gatewayManager before waiting for health', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(gatewayManager.addGateway).toHaveBeenCalledWith(
      'kaiden-local',
      expect.objectContaining({
        name: 'kaiden-local',
        gateway_endpoint: 'http://127.0.0.1:29670',
        is_remote: false,
      }),
    );
  });

  test('skips registerGateway when skipRegistration is true', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start({ skipRegistration: true });

    expect(spawn).toHaveBeenCalled();
    expect(gatewayManager.addGateway).not.toHaveBeenCalled();
  });

  test('skips if already running', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();
    await gateway.start();

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('throws when gateway binary is not registered', async () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([] as unknown as CliToolInfo[]);

    await expect(gateway.start()).rejects.toThrow('openshell-gateway binary not registered');
  });

  test('performs health check via gatewayManager', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(gatewayManager.health).toHaveBeenCalledWith('kaiden-local');
  });
});

describe('stop', () => {
  describe('managed shutdown', () => {
    beforeEach(async () => {
      vi.useFakeTimers();
      await gateway.start();
    });

    test('stopping one managed gateway leaves another running', async () => {
      const other = createMockChildProcess();
      vi.mocked(spawn).mockReturnValueOnce(other);
      await gateway.createLocalGateway({ name: 'other', bindAddress: '127.0.0.1', port: 17675 });
      const stopping = gateway.stopAndDrainGateway('other');
      other.emit('exit', 0, undefined);
      await stopping;
      expect(other.kill).toHaveBeenCalledWith('SIGTERM');
      expect(fixture.process.kill).not.toHaveBeenCalled();
      expect(gateway.isRunning()).toBe(true);
    });

    test('falls back to SIGKILL when the managed gateway does not exit', async () => {
      const stopping = gateway.stopAndDrainGateway('kaiden-local');
      let completed = false;
      const completion = (async (): Promise<void> => {
        await stopping;
        completed = true;
      })();
      await vi.advanceTimersToNextTimerAsync();
      expect(completed).toBe(false);
      expect(gateway.isRunning()).toBe(true);
      expect(fixture.process.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
      expect(fixture.process.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
      fixture.process.emit('exit', undefined, 'SIGKILL');
      await completion;
      expect(gateway.isRunning()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    test.each([
      { failOn: 'SIGTERM', message: 'kill ENOSYS' },
      { failOn: undefined, message: 'did not exit after SIGKILL' },
    ])('retains ownership after $message', async ({ failOn, message }) => {
      Object.defineProperty(fixture.process, 'pid', { value: 12345 });
      vi.mocked(fixture.process.kill).mockImplementation(signal => {
        if (signal === failOn) {
          throw new Error('kill ENOSYS');
        }
        return true;
      });
      const listeners = fixture.process.listenerCount('exit');
      const errorListeners = fixture.process.listenerCount('error');
      const rejected = expect(gateway.stopAndDrainGateway('kaiden-local')).rejects.toThrow(message);
      await vi.runAllTimersAsync();
      await rejected;
      expect(gateway.isRunning()).toBe(true);
      expect(fixture.process.listenerCount('exit')).toBe(listeners);
      expect(fixture.process.listenerCount('error')).toBe(errorListeners);
      expect(vi.getTimerCount()).toBe(0);
      fixture.exitOnKill();
      await gateway.stop();
      expect(gateway.isRunning()).toBe(false);
    });
  });

  test('concurrent stops share one shutdown', async () => {
    vi.useFakeTimers();
    await gateway.start();
    const stopping = gateway.stop();
    const concurrent = gateway.stop();
    fixture.process.emit('exit', 0);
    await Promise.all([stopping, concurrent]);
    expect(fixture.process.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(gateway.isRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('sends SIGTERM to running process', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    const stopPromise = gateway.stop();
    proc.emit('exit', 0, undefined);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('is a no-op when not running', async () => {
    await gateway.stop();
  });
});

describe('stopManagedGateway', () => {
  test.each([
    { name: 'kaiden-local', otherName: 'local-dev' },
    { name: 'local-dev', otherName: 'kaiden-local' },
  ] as const)('stops only the named managed gateway: $name', async ({ name, otherName }) => {
    const processes = {
      'kaiden-local': createMockChildProcess(),
      'local-dev': createMockChildProcess(),
    };
    vi.mocked(spawn).mockReturnValueOnce(processes['kaiden-local']).mockReturnValueOnce(processes['local-dev']);
    await gateway.start();
    await gateway.createLocalGateway({ name: 'local-dev', port: 17675, bindAddress: '127.0.0.1' });

    const stopping = gateway.stopManagedGateway(name);
    const stoppedProcess = processes[name];
    const otherProcess = processes[otherName];
    stoppedProcess.emit('exit', 0, undefined);
    await stopping;

    expect(stoppedProcess.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM');
    expect(otherProcess.kill).not.toHaveBeenCalled();
    expect(gateway.canStopGateway(name)).toBe(false);
    expect(gateway.canStopGateway(otherName)).toBe(true);
    expect(gatewayManager.removeGateway).not.toHaveBeenCalled();
  });

  test('rejects an unowned gateway without stopping a managed gateway', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    await gateway.start();

    await expect(gateway.stopManagedGateway('external')).rejects.toThrow(
      'Gateway "external" is not managed by this instance',
    );
    expect(proc.kill).not.toHaveBeenCalled();
    expect(gateway.isRunning()).toBe(true);
  });

  test('treats a managed gateway that already exited as stopped', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    await gateway.start();
    proc.emit('exit', 0, undefined);

    await expect(gateway.stopManagedGateway('kaiden-local')).resolves.toBeUndefined();
    expect(proc.kill).not.toHaveBeenCalled();
    expect(gateway.isRunning()).toBe(false);
  });
});

describe('isRunning', () => {
  test('returns false when no process is spawned', () => {
    expect(gateway.isRunning()).toBe(false);
  });

  test('returns true when process is running', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(gateway.isRunning()).toBe(true);
  });
});

describe('gateway bookkeeping', () => {
  test.each(['exit', 'stop'])('retains the default endpoint and log stream after %s', async action => {
    const firstProcess = createMockChildProcess();
    const nextProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(firstProcess).mockReturnValueOnce(nextProcess);

    await gateway.start({ port: 18000, bindAddress: '0.0.0.0' });
    const stopping = action === 'stop' ? gateway.stop() : undefined;
    firstProcess.emit('exit', 0, undefined);
    await stopping;
    expect(gateway.isRunning()).toBe(false);
    expect(gatewayManager.removeGateway).not.toHaveBeenCalled();

    await gateway.start();

    expect(gateway.isRunning()).toBe(true);
    expect(spawn).toHaveBeenLastCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '18000', '--bind-address', '0.0.0.0']),
      expect.anything(),
    );
    expect(gatewayManager.addGateway).toHaveBeenLastCalledWith(
      'kaiden-local',
      expect.objectContaining({ gateway_endpoint: 'http://0.0.0.0:18000', gateway_port: 18000 }),
    );
    const output = Buffer.from('restarted gateway output');
    nextProcess._stdout.emit('data', output);
    expect(createWriteStream).toHaveBeenCalledOnce();
    expect(gatewayLogStream.write).toHaveBeenLastCalledWith(output);
  });

  test.each(['exit', 'error'])('isolates named gateway %s cleanup from other processes', async event => {
    const defaultProcess = createMockChildProcess();
    const namedProcess = createMockChildProcess();
    const replacementProcess = createMockChildProcess();
    vi.mocked(spawn)
      .mockReturnValueOnce(defaultProcess)
      .mockReturnValueOnce(namedProcess)
      .mockReturnValueOnce(replacementProcess);
    await gateway.start({ port: 18000 });
    const options = { name: 'local-dev', port: 17675, bindAddress: '127.0.0.1' };
    await gateway.createLocalGateway(options);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([
      listed('kaiden-local', 'http://127.0.0.1:18000'),
      listed('local-dev', 'http://127.0.0.1:17675'),
    ]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('kaiden-local');
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.health).mockResolvedValueOnce({ status: 'unhealthy', version: '1.0.0' });

    namedProcess.emit(event, new Error('gateway ended'));
    expect(gateway.canStopGateway('local-dev')).toBe(false);
    expect(gateway.isRunning()).toBe(true);
    expect(gatewayManager.removeGateway).not.toHaveBeenCalled();

    await gateway.init();
    expect(spawn).toHaveBeenCalledTimes(3);
    expect(gatewayManager.addGateway).toHaveBeenCalledTimes(2);
    expect(spawn).toHaveBeenLastCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '17675', '--bind-address', '127.0.0.1']),
      expect.anything(),
    );
    namedProcess.emit('exit', 0, undefined);
    expect(gateway.canStopGateway('local-dev')).toBe(true);
    expect(gateway.isRunning()).toBe(true);

    const stopping = gateway.stop();
    defaultProcess.emit('exit', 0, undefined);
    await stopping;
    expect(gateway.isRunning()).toBe(false);
    expect(gateway.canStopGateway('local-dev')).toBe(true);
    expect(replacementProcess.kill).not.toHaveBeenCalled();
    expect(gatewayManager.removeGateway).not.toHaveBeenCalled();
  });
});

describe('asyncDispose', () => {
  test('keeps event listeners active while waiting for gateway shutdown', async () => {
    await gateway.start();

    const health = Promise.withResolvers<{ status: string; version: string }>();
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('kaiden-local', 'http://127.0.0.1:17670')]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('kaiden-local');
    vi.mocked(gatewayManager.health).mockReturnValueOnce(health.promise);
    const events: string[] = [];
    const subscription = gateway.onDidGatewayStart(() => events.push('started'));

    try {
      const initializing = gateway.init();
      await vi.waitFor(() => expect(gatewayManager.health).toHaveBeenCalledTimes(2));
      const disposing = gateway.asyncDispose();

      health.resolve({ status: 'healthy', version: '1.0.0' });
      await initializing;
      const eventsDuringShutdown = [...events];
      fixture.process.emit('exit', 0, undefined);
      await disposing;

      expect(eventsDuringShutdown).toEqual(['started']);
      expect(gateway.isRunning()).toBe(false);
      expect(gatewayLogStream.end).toHaveBeenCalledOnce();
    } finally {
      subscription.dispose();
    }
  });

  test.each([
    {
      stage: 'default discovery',
      gateways: [],
      defer: (pending: Promise<void>): void => {
        vi.mocked(gatewayManager.listGateways).mockImplementationOnce(async () => {
          await pending;
          return [];
        });
      },
      pendingCalled: (): void => expect(gatewayManager.listGateways).toHaveBeenCalledOnce(),
    },
    {
      stage: 'named health',
      gateways: [listed('local-dev', 'http://127.0.0.1:17675')],
      defer: (pending: Promise<void>): void => {
        vi.mocked(gatewayManager.health).mockImplementationOnce(async () => {
          await pending;
          return { status: 'unhealthy', version: '1.0.0' };
        });
      },
      pendingCalled: (): void => expect(gatewayManager.health).toHaveBeenCalledOnce(),
    },
  ])('does not start after disposal during $stage', async ({ gateways, defer, pendingCalled }) => {
    const pending = Promise.withResolvers<void>();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue(gateways);
    defer(pending.promise);
    vi.mocked(spawn).mockReturnValue(createMockChildProcess());
    const initializing = gateway.init();
    await vi.waitFor(pendingCalled);
    await gateway.asyncDispose();
    pending.resolve();
    await initializing;
    expect(spawn).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(gatewayManager.addGateway).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });

  test.each([
    { kind: 'default', start: (): Promise<void> => gateway.start() },
    {
      kind: 'created',
      start: (): Promise<void> =>
        gateway.createLocalGateway({ name: 'local-dev', bindAddress: '127.0.0.1', port: 17675 }),
    },
  ])('rejects a new $kind startup after disposal', async ({ start }) => {
    await gateway.asyncDispose();

    await expect(start()).rejects.toThrow('Gateway lifecycle has been disposed');
    expect(spawn).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('stops the gateway process and closes its log', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    const disposing = gateway.asyncDispose();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    proc.emit('exit', 0, undefined);
    await disposing;
    expect(gatewayLogStream.end).toHaveBeenCalledOnce();
  });

  test('completes disposal when a gateway never exits', async () => {
    vi.useFakeTimers();
    await gateway.start();
    const disposing = gateway.asyncDispose();
    await vi.runAllTimersAsync();
    expect(fixture.process.kill).toHaveBeenLastCalledWith('SIGKILL');
    await disposing;
    expect(gatewayLogStream.end).toHaveBeenCalledOnce();
    expect(gateway.isRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('supportsMounts', () => {
  beforeEach(async () => {
    vi.mocked(spawn).mockReturnValue(createMockChildProcess());
    await gateway.start();
  });

  test('queries runtime info for a discovered gateway instead of reading local config', async () => {
    vi.mocked(readFile).mockResolvedValue('[openshell.drivers.podman]\nenable_bind_mounts = true');
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ name: 'podman', capabilities: { driver_name: 'podman' } }],
    });
    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'discovered',
        endpoint: 'http://127.0.0.1:17671',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(true);
    expect(readFile).not.toHaveBeenCalled();
    expect(gatewayManager.getGatewayInfo).toHaveBeenCalledWith('discovered');
  });

  test('returns true when the managed gateway config enables bind mounts', async () => {
    vi.mocked(readFile).mockResolvedValue('[openshell.drivers.podman]\nenable_bind_mounts = true\n');

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'kaiden-local',
        endpoint: 'http://127.0.0.1:17670',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(true);
    expect(readFile).toHaveBeenCalledWith(GATEWAY_CONFIG_PATH, 'utf-8');
  });

  test('returns false for gateways without a managed bind-mount config', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'kaiden-local',
        endpoint: 'http://127.0.0.1:17670',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(false);
  });

  test('falls back to runtime check when the managed gateway exits', async () => {
    vi.mocked(readFile).mockResolvedValue('[openshell.drivers.podman]\nenable_bind_mounts = true\n');
    const info = {
      canStop: false,
      name: 'kaiden-local',
      endpoint: 'http://127.0.0.1:17670',
      type: 'local' as const,
      driver: 'podman' as const,
    };
    await expect(gateway.supportsMounts(info)).resolves.toBe(true);

    vi.mocked(spawn).mock.results[0]?.value.emit('exit', 0);
    vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('gateway unreachable'));

    await expect(gateway.supportsMounts(info)).resolves.toBe(false);
  });

  test.each([
    { type: 'remote' as const, endpoint: 'https://gateway.example.com', is_remote: true },
    { type: 'local' as const, endpoint: 'http://10.0.0.5:17670' },
  ])('returns false for $type registration at $endpoint despite managed storage', async registration => {
    vi.mocked(readFile).mockResolvedValue('[openshell.drivers.podman]\nenable_bind_mounts = true\n');

    await expect(
      gateway.supportsMounts({
        name: 'kaiden-local',
        canStop: false,
        ...registration,
        driver: 'podman',
      }),
    ).resolves.toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('supportsMounts (non-managed gateways)', () => {
  test.each([
    'podman',
    'docker',
  ] as const)('returns true for a non-managed local gateway with %s driver', async driverName => {
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ name: driverName, capabilities: { driver_name: driverName } }],
    });

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'external-gw',
        endpoint: 'http://127.0.0.1:17671',
        type: 'local',
        driver: driverName,
      }),
    ).resolves.toBe(true);
    expect(gatewayManager.getGatewayInfo).toHaveBeenCalledWith('external-gw');
  });

  test('returns false for a non-managed local gateway with vm driver', async () => {
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ name: 'vm', capabilities: { driver_name: 'vm' } }],
    });

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'external-gw',
        endpoint: 'http://127.0.0.1:17671',
        type: 'local',
        driver: 'vm',
      }),
    ).resolves.toBe(false);
  });

  test('returns false when getGatewayInfo fails for a non-managed gateway', async () => {
    vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('connection refused'));

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'external-gw',
        endpoint: 'http://127.0.0.1:17671',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(false);
  });

  test('returns false when the non-managed gateway has no compute drivers', async () => {
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [],
    });

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'external-gw',
        endpoint: 'http://127.0.0.1:17671',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(false);
  });

  test('returns false for a non-managed remote gateway with podman driver', async () => {
    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'remote-gw',
        endpoint: 'https://gateway.example.com',
        type: 'local',
        is_remote: true,
        driver: 'podman',
      }),
    ).resolves.toBe(false);
    expect(gatewayManager.getGatewayInfo).not.toHaveBeenCalled();
  });

  test('returns false for a non-managed gateway on a non-local endpoint', async () => {
    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'external-gw',
        endpoint: 'http://10.0.0.5:17671',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(false);
    expect(gatewayManager.getGatewayInfo).not.toHaveBeenCalled();
  });

  test('returns true for a non-managed gateway bound to IPv6 loopback [::1]', async () => {
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ name: 'podman', capabilities: { driver_name: 'podman' } }],
    });

    await expect(
      gateway.supportsMounts({
        canStop: false,
        name: 'ipv6-gw',
        endpoint: 'http://[::1]:17671',
        type: 'local',
        driver: 'podman',
      }),
    ).resolves.toBe(true);
    expect(gatewayManager.getGatewayInfo).toHaveBeenCalledWith('ipv6-gw');
  });
});

describe('onDidGatewayStart', () => {
  test('fires when existing gateway is healthy and active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-gw', 'https://127.0.0.1:8443')]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue('local-gw');
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('fires when existing gateway is healthy but not active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('kaiden-alt', 'http://127.0.0.1:18080')]);
    vi.mocked(gatewayManager.getActiveGateway).mockResolvedValue(undefined);
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('fires when orphan gateway found on default port', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('fires when auto-start succeeds', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('does not fire when no binary and no gateways', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockRejectedValue(new Error('config dir not found'));
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([] as unknown as CliToolInfo[]);

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('onDidGatewayInitFailed', () => {
  test('fires with error message when auto-start fails because process exits', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('connection refused'));

    const proc = createMockChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      setTimeout(() => {
        Object.defineProperty(proc, 'exitCode', { value: 1, configurable: true });
        proc.emit('exit', 1, undefined);
      }, 0);
      return proc;
    });
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    const failListener = vi.fn();
    const startListener = vi.fn();
    gateway.onDidGatewayInitFailed(failListener);
    gateway.onDidGatewayStart(startListener);

    await gateway.init();

    expect(failListener).toHaveBeenCalledOnce();
    expect(failListener).toHaveBeenCalledWith(expect.stringContaining('Gateway process exited before becoming ready'));
    expect(startListener).not.toHaveBeenCalled();
  });

  test('creates error notification when auto-start fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('connection refused'));

    const proc = createMockChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      setTimeout(() => {
        Object.defineProperty(proc, 'exitCode', { value: 1, configurable: true });
        proc.emit('exit', 1, undefined);
      }, 0);
      return proc;
    });
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenShell Gateway failed to start',
        type: 'error',
        extensionId: 'core',
      }),
    );
  });

  test('includes stderr output in notification body', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('connection refused'));

    const proc = createMockChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      setTimeout(() => {
        proc._stderr.emit('data', Buffer.from('Socket not found: /var/run/docker.sock'));
        Object.defineProperty(proc, 'exitCode', { value: 1, configurable: true });
        proc.emit('exit', 1, undefined);
      }, 0);
      return proc;
    });
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining('Socket not found: /var/run/docker.sock'),
      }),
    );
  });

  test('does not fire on successful init', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(gatewayManager.getGateway).mockRejectedValue(new Error('not found'));
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    const failListener = vi.fn();
    gateway.onDidGatewayInitFailed(failListener);
    await gateway.init();

    expect(failListener).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });
});

describe('migration backup in start()', () => {
  test('rejects startup and keeps the original process when shutdown fails before a migration retry', async () => {
    vi.useFakeTimers();
    fixture.failSignals();
    const replacement = createMockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(fixture.process).mockReturnValue(replacement);
    vi.mocked(gatewayManager.health).mockResolvedValue({ status: 'unhealthy', version: '1.0.0' });

    const starting = Promise.allSettled([gateway.start()]);
    await vi.advanceTimersByTimeAsync(0);
    fixture.process._stderr.emit('data', Buffer.from('migration error'));
    await vi.runAllTimersAsync();
    const results = await starting;

    expect(spawn).toHaveBeenCalledOnce();
    expect(results).toEqual([
      {
        status: 'rejected',
        reason: expect.objectContaining({ message: expect.stringContaining('Gateway did not become ready') }),
      },
    ]);
    expect(gateway.isRunning()).toBe(true);

    fixture.exitOnKill();
    await gateway.stop();
    expect(fixture.process.kill).toHaveBeenCalledTimes(2);
    expect(replacement.kill).not.toHaveBeenCalled();
    expect(gateway.isRunning()).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('backs up database, notifies, and retries once when migration error occurs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failProc = createMockChildProcess();
    const retryProc = createMockChildProcess();

    vi.mocked(spawn)
      .mockImplementationOnce(() => {
        setTimeout(() => {
          failProc._stderr.emit(
            'data',
            Buffer.from(
              'migration error: migration 7 was previously applied but is missing in the resolved migrations',
            ),
          );
          Object.defineProperty(failProc, 'exitCode', { value: 1, configurable: true });
          failProc.emit('exit', 1, undefined);
        }, 0);
        return failProc;
      })
      .mockReturnValueOnce(retryProc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    await gateway.start();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(rename).toHaveBeenCalledWith(
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db'),
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db.backup'),
    );
    expect(rename).toHaveBeenCalledWith(
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db-wal'),
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db-wal.backup'),
    );
    expect(rename).toHaveBeenCalledWith(
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db-shm'),
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db-shm.backup'),
    );
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenShell Gateway database migration error',
        body: expect.stringContaining('kaiden-local'),
        type: 'warn',
        extensionId: 'core',
      }),
    );
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(join(GATEWAY_STORAGE_DIRECTORY, 'gateway.db.backup')),
      }),
    );
  });

  test('does not back up database on non-migration errors', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const proc = createMockChildProcess();
    vi.mocked(spawn).mockImplementation(() => {
      setTimeout(() => {
        proc._stderr.emit('data', Buffer.from('Socket not found: /var/run/docker.sock'));
        Object.defineProperty(proc, 'exitCode', { value: 1, configurable: true });
        proc.emit('exit', 1, undefined);
      }, 0);
      return proc;
    });
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('not ready'));

    await expect(gateway.start()).rejects.toThrow('Gateway process exited before becoming ready');

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(rename).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });
});

describe('migration backup in startCreatedGateway via init()', () => {
  test('keeps the original process when shutdown fails before a migration retry', async () => {
    vi.useFakeTimers();
    fixture.discoverNamedGateway();
    fixture.failSignals();
    const replacement = createMockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(fixture.process).mockReturnValue(replacement);
    vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('not ready'));
    vi.mocked(readFile).mockResolvedValue('migration error: incompatible database');

    const initializing = gateway.init();
    await vi.runAllTimersAsync();
    await initializing;

    expect(spawn).toHaveBeenCalledOnce();
    expect(gateway.canStopGateway('local-dev')).toBe(true);

    fixture.exitOnKill();
    await gateway.stopAndDrainGateway('local-dev');
    expect(fixture.process.kill).toHaveBeenCalledTimes(2);
    expect(replacement.kill).not.toHaveBeenCalled();
    expect(gateway.canStopGateway('local-dev')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('retains the retry guard through process cleanup and clears it after a failed retry', async () => {
    const firstProcess = createMockChildProcess();
    const retryProcess = createMockChildProcess();
    const nextProcess = createMockChildProcess();
    const recoveredProcess = createMockChildProcess();
    for (const proc of [firstProcess, retryProcess, nextProcess]) {
      Object.defineProperty(proc, 'exitCode', { value: 1, configurable: true });
    }
    vi.mocked(spawn)
      .mockReturnValueOnce(firstProcess)
      .mockReturnValueOnce(retryProcess)
      .mockReturnValueOnce(nextProcess)
      .mockReturnValueOnce(recoveredProcess);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:17675')]);
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({ status: 'healthy', version: '1.0.0' })
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValueOnce({ status: 'healthy', version: '1.0.0' });
    vi.mocked(readFile).mockResolvedValue('migration error: incompatible database');

    await gateway.init();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(gateway.canStopGateway('local-dev')).toBe(false);

    await gateway.init();

    expect(spawn).toHaveBeenCalledTimes(4);
    expect(gateway.canStopGateway('local-dev')).toBe(true);
  });

  test('backs up database, notifies, and retries once when created gateway fails with migration error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const failProc = createMockChildProcess();
    const retryProc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(failProc).mockReturnValueOnce(retryProc);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:17675')]);
    // First: startCreatedGateway health check (rejects → triggers spawn)
    // After: init's health loop finds gateway healthy so it returns early
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });

    // First spawn exits immediately (migration error in log file)
    Object.defineProperty(failProc, 'exitCode', { value: 1, configurable: true });
    vi.mocked(readFile).mockResolvedValueOnce(
      'migration error: migration 7 was previously applied but is missing in the resolved migrations',
    );

    // init() → startCreatedGateway detects migration error, backs up, notifies,
    // then retries once; the retry (retryProc) succeeds via getGatewayInfo
    await gateway.init();

    expect(spawn).toHaveBeenCalledTimes(2);
    const storageDirectory = join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'local-dev');
    expect(rename).toHaveBeenCalledWith(
      join(storageDirectory, 'gateway.db'),
      join(storageDirectory, 'gateway.db.backup'),
    );
    expect(rename).toHaveBeenCalledWith(
      join(storageDirectory, 'gateway.db-wal'),
      join(storageDirectory, 'gateway.db-wal.backup'),
    );
    expect(rename).toHaveBeenCalledWith(
      join(storageDirectory, 'gateway.db-shm'),
      join(storageDirectory, 'gateway.db-shm.backup'),
    );
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'OpenShell Gateway database migration error',
        body: expect.stringContaining('local-dev'),
        type: 'warn',
        extensionId: 'core',
      }),
    );
    expect(notificationRegistry.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining(join(storageDirectory, 'gateway.db.backup')),
      }),
    );
  });

  test('does not back up database on non-migration errors for created gateway', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'exitCode', { value: 1, configurable: true });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:17675')]);
    // First: startCreatedGateway health check (rejects → triggers spawn which fails)
    // After: init's health loop finds gateway healthy so it returns early
    vi.mocked(gatewayManager.health)
      .mockRejectedValueOnce(new Error('not ready'))
      .mockResolvedValue({ status: 'healthy', version: '1.0.0' });
    vi.mocked(readFile).mockResolvedValueOnce('some other error');

    // init() catches startCreatedGateway errors and warns instead of throwing
    await gateway.init();

    // rename should not have been called since the error is not a migration error
    expect(rename).not.toHaveBeenCalled();
  });
});

describe('registration-before-health failure path', () => {
  test('cleans up gateway and restores port when registerGateway succeeds but waitForReady times out', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    // health always fails so waitForReady times out
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('connection refused'));

    let caughtError: unknown;
    const startPromise = gateway.start({ port: 9999, bindAddress: '127.0.0.1' }).catch((err: unknown) => {
      caughtError = err;
    });

    while (!vi.mocked(proc.kill).mock.calls.length) {
      await vi.advanceTimersToNextTimerAsync();
    }

    proc.emit('exit', 1, undefined);
    await vi.advanceTimersToNextTimerAsync();
    await startPromise;

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toContain('Gateway did not become ready');
    // registerGateway was called (succeeds by default mock)
    expect(gatewayManager.addGateway).toHaveBeenCalled();
    // Process was stopped
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });
});

describe('gateway config generation', () => {
  let proc: ReturnType<typeof createMockChildProcess>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
  });

  test('generates certs by calling the gateway binary with generate-certs', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(mkdir).toHaveBeenCalledWith(GATEWAY_STORAGE_DIRECTORY, { recursive: true });
    expect(exec.exec).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      [
        'generate-certs',
        '--server-san',
        '127.0.0.1',
        '--server-san',
        'localhost',
        '--server-san',
        'host.openshell.internal',
        '--output-dir',
        GATEWAY_STORAGE_DIRECTORY,
      ],
      expect.objectContaining({ token: expect.objectContaining({ isCancellationRequested: false }) }),
    );
  });

  test('writes gateway config under the kaiden data directory', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(mkdir).toHaveBeenCalledWith(GATEWAY_STORAGE_DIRECTORY, { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.stringContaining('[openshell.drivers.podman]'),
      'utf-8',
    );
  });

  test('config defaults to the Podman driver', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('[openshell.drivers.podman]');
    expect(writtenContent).toContain('compute_driver = "podman"');
    expect(writtenContent).not.toContain('[openshell.drivers.vm]');
    expect(writtenContent).not.toContain('[openshell.drivers.docker]');
  });

  test('writes gateway.toml config with JWT paths', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.stringContaining('[openshell.gateway.gateway_jwt]'),
      'utf-8',
    );
    expect(writeFile).toHaveBeenCalledWith(GATEWAY_CONFIG_PATH, expect.stringContaining('signing_key_path'), 'utf-8');
    expect(writeFile).toHaveBeenCalledWith(GATEWAY_CONFIG_PATH, expect.stringContaining('public_key_path'), 'utf-8');
    expect(writeFile).toHaveBeenCalledWith(GATEWAY_CONFIG_PATH, expect.stringContaining('kid_path'), 'utf-8');
  });

  test('pins supervisor image to detected gateway version', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start({ driver: 'podman' });

    expect(exec.exec).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      ['--version'],
      expect.objectContaining({ token: expect.objectContaining({ isCancellationRequested: false }) }),
    );
    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.stringContaining('supervisor_image = "ghcr.io/nvidia/openshell/supervisor:0.0.69"'),
      'utf-8',
    );
  });

  test('passes --config flag to spawned gateway process', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--config', GATEWAY_CONFIG_PATH]),
      expect.objectContaining({ detached: false }),
    );
  });

  test('uses custom supervisorImage without version detection', async () => {
    await gateway.start({ driver: 'podman', supervisorImage: 'my-registry.io/supervisor:custom' });

    expect(exec.exec).not.toHaveBeenCalledWith(GATEWAY_BINARY, ['--version'], expect.anything());
    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.stringContaining('supervisor_image = "my-registry.io/supervisor:custom"'),
      'utf-8',
    );
  });

  test('still generates config when version detection fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValueOnce(new Error('command not found'));

    await gateway.start({ driver: 'podman' });

    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.not.stringContaining('supervisor_image'),
      'utf-8',
    );
    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--config', GATEWAY_CONFIG_PATH]),
      expect.objectContaining({ detached: false }),
    );
  });

  test('still generates config when version output is unparseable', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('unknown-format'));

    await gateway.start({ driver: 'podman' });

    expect(writeFile).toHaveBeenCalledWith(
      GATEWAY_CONFIG_PATH,
      expect.not.stringContaining('supervisor_image'),
      'utf-8',
    );
  });

  test('starts without --config when writeFile fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(writeFile).mockRejectedValueOnce(new Error('permission denied'));

    await gateway.start();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      ['--port', '29670', '--bind-address', '127.0.0.1', '--disable-tls', '--db-url', GATEWAY_DB_URL],
      expect.objectContaining({ detached: false }),
    );
  });

  test.each(['podman', 'docker'] as const)('honors an explicit %s driver and enables bind mounts', async driver => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    await gateway.start({ driver });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('enable_bind_mounts = true');
    expect(writtenContent).toContain(`compute_driver = "${driver}"`);
  });

  test('honors an explicit VM driver and omits container settings even when the active driver is Podman', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.116'));
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ capabilities: { driver_name: 'podman' }, name: 'podman' }],
    });

    await gateway.start({ driver: 'vm' });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('compute_driver = "vm"');
    expect(writtenContent).toContain('[openshell.drivers.vm]');
    expect(writtenContent).not.toContain('enable_bind_mounts');
    expect(writtenContent).not.toContain('supervisor_image');
  });

  test('defaults to Podman when no gateway is available', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(gatewayManager.getGatewayInfo).mockRejectedValue(new Error('No gateway configured'));

    await gateway.start();

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('[openshell.drivers.podman]');
    expect(writtenContent).toContain('enable_bind_mounts = true');
    expect(writtenContent).toContain('compute_driver = "podman"');
    expect(gatewayManager.getGatewayInfo).not.toHaveBeenCalled();
  });
});

describe('gateway.pid persistence', () => {
  test('writes gateway.pid after spawning a created gateway', async () => {
    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'pid', { value: 12345 });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.createLocalGateway({
      name: 'local-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
      driver: 'podman',
    });

    const storageDirectory = join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'local-dev');
    expect(writeFile).toHaveBeenCalledWith(join(storageDirectory, 'gateway.pid'), '12345', 'utf-8');
  });

  test('writes gateway.pid after starting the default gateway', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'pid', { value: 54321 });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(writeFile).toHaveBeenCalledWith(join(GATEWAY_STORAGE_DIRECTORY, 'gateway.pid'), '54321', 'utf-8');
  });

  test('does not write gateway.pid when spawn provides no pid', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    expect(writeFile).not.toHaveBeenCalledWith(
      join(GATEWAY_STORAGE_DIRECTORY, 'gateway.pid'),
      expect.any(String),
      'utf-8',
    );
  });

  test('removes gateway.pid on process exit', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'pid', { value: 12345 });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();
    proc.emit('exit', 0, undefined);
    // Flush microtask queue — unlink is chained after the PID write promise
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(unlink).toHaveBeenCalledWith(join(GATEWAY_STORAGE_DIRECTORY, 'gateway.pid'));
  });

  test('retains gateway.pid after a signalling error until the process exits', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'pid', { value: 12345 });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();
    proc.emit('error', new Error('kill EPERM'));
    expect(gateway.isRunning()).toBe(true);
    expect(unlink).not.toHaveBeenCalled();
    proc.emit('exit', 0);
    // Flush microtask queue — unlink is chained after the PID write promise
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(unlink).toHaveBeenCalledWith(join(GATEWAY_STORAGE_DIRECTORY, 'gateway.pid'));
  });

  test('removes gateway.pid on a spawn error without a pid', async () => {
    await gateway.start();
    fixture.process.emit('error', new Error('spawn ENOENT'));
    expect(gateway.isRunning()).toBe(false);
    await vi.waitFor(() => expect(unlink).toHaveBeenCalledWith(join(GATEWAY_STORAGE_DIRECTORY, 'gateway.pid')));
  });

  test('getGatewayPid returns pid for alive process', async () => {
    vi.mocked(readFile).mockResolvedValue('12345');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const pid = await gateway.getGatewayPid({ canStop: false, name: 'local-dev', endpoint: 'http://127.0.0.1:17675' });

    expect(pid).toBe(12345);
    killSpy.mockRestore();
  });

  test('getGatewayPid returns undefined for dead process', async () => {
    vi.mocked(readFile).mockResolvedValue('99999');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('ESRCH') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    const pid = await gateway.getGatewayPid({ canStop: false, name: 'local-dev', endpoint: 'http://127.0.0.1:17675' });

    expect(pid).toBeUndefined();
    killSpy.mockRestore();
  });

  test('getGatewayPid returns undefined when no pid file exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const pid = await gateway.getGatewayPid({ canStop: false, name: 'local-dev', endpoint: 'http://127.0.0.1:17675' });

    expect(pid).toBeUndefined();
  });
});

describe.each([
  {
    kind: 'default',
    name: 'kaiden-local',
    configCalls: 2,
    removed: 0,
    start: (): Promise<void> => gateway.start(),
    stop: (): Promise<void> => gateway.stop(),
  },
  {
    kind: 'named',
    name: 'local-dev',
    configCalls: 1,
    removed: 1,
    start: (): Promise<void> =>
      gateway.createLocalGateway({ name: 'local-dev', bindAddress: '127.0.0.1', port: 17675 }),
    stop: (): Promise<void> => gateway.stopAndDrainGateway('local-dev'),
  },
  {
    kind: 'default managed',
    name: 'kaiden-local',
    configCalls: 2,
    removed: 0,
    start: (): Promise<void> => gateway.start(),
    stop: (): Promise<void> => gateway.stopManagedGateway('kaiden-local'),
  },
  {
    kind: 'named managed',
    name: 'local-dev',
    configCalls: 1,
    removed: 1,
    start: (): Promise<void> =>
      gateway.createLocalGateway({ name: 'local-dev', bindAddress: '127.0.0.1', port: 17675 }),
    stop: (): Promise<void> => gateway.stopManagedGateway('local-dev'),
  },
])('$kind gateway startup cancellation', ({ name, configCalls, removed, start, stop }) => {
  beforeEach(() => {
    fixture.exitOnKill();
  });

  test.each([
    { listenerTiming: 'before Stop', stopFirst: false, succeeds: false },
    { listenerTiming: 'after Stop', stopFirst: true, succeeds: false },
    { listenerTiming: 'before Stop', stopFirst: false, succeeds: true },
  ])('cancels certificate generation with listener $listenerTiming and succeeds=$succeeds', async ({
    stopFirst,
    succeeds,
  }) => {
    const pending = Promise.withResolvers<RunResult>();
    let token: CancellationToken | undefined;
    vi.mocked(exec.exec).mockImplementation((_binary, args, options) => {
      if (args?.[0] !== 'generate-certs') {
        return Promise.resolve(mockExecResult('openshell-gateway 0.0.69'));
      }
      token = options?.token;
      return pending.promise;
    });
    const starting = expect(start()).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => assert(token));
    assert(token);
    const stopping = stopFirst ? stop() : undefined;
    const subscription = token.onCancellationRequested(() => {
      if (succeeds) {
        pending.resolve(mockExecResult(''));
      } else {
        pending.reject(new Error('Execution cancelled'));
      }
    });
    try {
      await (stopping ?? stop());
      await starting;
      expect(token.isCancellationRequested).toBe(true);
      expect(exec.exec).toHaveBeenCalledTimes(configCalls);
      expect(writeFile).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
      expect(gatewayManager.addGateway).not.toHaveBeenCalled();
      expect(gateway.canStopGateway(name)).toBe(false);
    } finally {
      subscription.dispose();
    }
  });

  test('cancels a pending readiness request', async () => {
    const pending = Promise.withResolvers<never>();
    const check = removed === 0 ? gatewayManager.health : gatewayManager.getGatewayInfo;
    vi.mocked(check).mockReturnValueOnce(pending.promise);
    const rejected = expect(start()).rejects.toThrow('startup cancelled by Stop');
    await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
    fixture.process._stderr.emit('data', Buffer.from('migration error'));
    await stop();
    await rejected;
    expect(fixture.process.kill).toHaveBeenCalledWith('SIGTERM');
    expect(gatewayManager.removeGateway).toHaveBeenCalledTimes(removed);
    expect(spawn).toHaveBeenCalledOnce();
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(gateway.canStopGateway(name)).toBe(false);
    // A late rejection cannot restart the cancelled attempt.
    pending.reject(new Error('late readiness failure'));
    vi.mocked(spawn).mockReturnValue(createMockChildProcess());
    await start();
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  test.each([
    {
      timer: 'fake',
      setup: (): Promise<void> => {
        vi.useFakeTimers();
        return Promise.resolve();
      },
    },
    {
      timer: 'real',
      setup: async (): Promise<void> => {
        const timers = await vi.importActual<typeof Timers>('node:timers/promises');
        vi.mocked(delay).mockImplementation(timers.setTimeout);
      },
    },
  ])('cancels the $timer readiness interval when stopped', async ({ setup }) => {
    await setup();
    const check = removed === 0 ? gatewayManager.health : gatewayManager.getGatewayInfo;
    vi.mocked(check).mockRejectedValue(new Error('not ready'));
    const rejected = expect(start()).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(delay).toHaveBeenCalledOnce());
    const interval = vi.mocked(delay).mock.results[0]?.value;
    assert(interval);
    const cancelled = expect(interval).rejects.toMatchObject({ name: 'AbortError' });

    await stop();
    await Promise.all([rejected, cancelled]);

    expect(check).toHaveBeenCalledOnce();
    expect(gateway.canStopGateway(name)).toBe(false);
    if (vi.isFakeTimers()) expect(vi.getTimerCount()).toBe(0);
  });
});

describe('explicit stop cancels startup recovery', () => {
  beforeEach(() => {
    fixture.exitOnKill();
  });

  test('cancels pending auto-start config without reporting a failure', async () => {
    const writing = Promise.withResolvers<void>();
    vi.mocked(writeFile).mockReturnValueOnce(writing.promise);
    vi.mocked(gatewayManager.health).mockRejectedValue(new Error('not ready'));
    const events: string[] = [];
    const failed = gateway.onDidGatewayInitFailed(() => events.push('failed'));
    const started = gateway.onDidGatewayStart(() => events.push('started'));
    try {
      const starting = gateway.init();
      await vi.waitFor(() => expect(writeFile).toHaveBeenCalled());
      const stopping = gateway.stop();
      writing.resolve();
      await Promise.all([starting, stopping]);
      expect(events).toEqual([]);
      expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    } finally {
      failed.dispose();
      started.dispose();
    }
  });

  test('settles cancelled startup even when shutdown fails and health is pending', async () => {
    const health = Promise.withResolvers<{ status: string; version: string }>();
    vi.mocked(gatewayManager.health).mockReturnValue(health.promise);
    fixture.failSignals();
    const starting = gateway.start();
    const rejected = expect(starting).rejects.toThrow('startup cancelled by Stop');
    await vi.waitFor(() => expect(gatewayManager.health).toHaveBeenCalled());

    await expect(gateway.stop()).rejects.toThrow('kill ENOSYS');
    await rejected;
    expect(fixture.process.kill).toHaveBeenCalledWith('SIGTERM');
    expect(gateway.isRunning()).toBe(true);
    health.resolve({ status: 'healthy', version: '1.0.0' });
  });

  test('cancels named recovery while reading the gateway log', async () => {
    Object.defineProperty(fixture.process, 'exitCode', { value: 1, configurable: true });
    fixture.discoverNamedGateway();
    const pending = Promise.withResolvers<string>();
    vi.mocked(readFile).mockReturnValueOnce(pending.promise);
    const starting = gateway.init();
    await vi.waitFor(() => expect(readFile).toHaveBeenCalled());
    const stopping = gateway.stopAndDrainGateway('local-dev');
    pending.resolve('migration error');
    await Promise.all([starting, stopping]);
    expect(spawn).toHaveBeenCalledOnce();
    expect(rename).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });
});
