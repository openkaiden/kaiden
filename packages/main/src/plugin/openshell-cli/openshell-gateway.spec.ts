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

import type { RunResult } from '@openkaiden/api';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Directories } from '/@/plugin/directories.js';
import type { OpenshellGatewayManager } from '/@/plugin/openshell-cli/openshell-gateway-manager.js';
import type { NotificationRegistry } from '/@/plugin/tasks/notification-registry.js';
import type { Exec } from '/@/plugin/util/exec.js';
import { isFreePort } from '/@/plugin/util/port.js';
import { isLinux, isMac } from '/@/util.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';
import type { ListedGateway } from '/@api/openshell-gateway-info.js';

import { OpenshellGateway } from './openshell-gateway.js';

vi.mock(import('node:child_process'));
vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
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

let gateway: OpenshellGateway;

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

const exec = {
  exec: vi.fn(),
} as unknown as Exec;

const notificationRegistry = {
  addNotification: vi.fn(),
} as unknown as NotificationRegistry;

beforeEach(() => {
  vi.resetAllMocks();
  gatewayLogStream.removeAllListeners();
  vi.mocked(directories.getDataDirectory).mockReturnValue(KAIDEN_DATA_DIRECTORY);
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
    { name: 'openshell-gateway', path: GATEWAY_BINARY },
  ] as unknown as CliToolInfo[]);
  vi.mocked(createWriteStream).mockReturnValue(gatewayLogStream);
  vi.mocked(existsSync).mockReturnValue(false);
  vi.mocked(open).mockResolvedValue({ fd: 42, close: closeLogFile } as unknown as FileHandle);
  vi.mocked(writeFile).mockResolvedValue();
  vi.mocked(unlink).mockResolvedValue();
  vi.mocked(exec.exec).mockResolvedValue({ command: '', stdout: '', stderr: '' });
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
  gateway = new OpenshellGateway(cliToolRegistry, gatewayManager, directories, exec, notificationRegistry);
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

  test('starts a stopped gateway previously created by Kaiden', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(gatewayManager.listGateways).mockResolvedValue([listed('local-dev', 'http://127.0.0.1:17675')]);
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
      .mockResolvedValueOnce([listed('my-private-gw', 'http://127.0.0.1:17670')])
      // removeSamePortGateways(): both exist after registration
      .mockResolvedValueOnce([
        listed('my-private-gw', 'http://127.0.0.1:17670'),
        listed('kaiden-local', 'http://127.0.0.1:17670'),
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
      expect.stringContaining('compute_drivers = ["podman"]'),
      'utf-8',
    );
    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '17670']),
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
        gateway_endpoint: 'http://127.0.0.1:17670',
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

describe('createLocalGateway', () => {
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
        '17670',
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
        gateway_endpoint: 'http://127.0.0.1:17670',
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

describe('dispose', () => {
  test('stops the gateway process and closes its log', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    gateway.dispose();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    proc.emit('exit', 0, undefined);
    await vi.waitFor(() => expect(gatewayLogStream.end).toHaveBeenCalledOnce());
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

    for (let i = 0; i < 30; i++) {
      await vi.advanceTimersByTimeAsync(1000);
    }

    proc.emit('exit', 1, undefined);
    await vi.advanceTimersByTimeAsync(5000);
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
    expect(exec.exec).toHaveBeenCalledWith(GATEWAY_BINARY, [
      'generate-certs',
      '--server-san',
      '127.0.0.1',
      '--server-san',
      'localhost',
      '--server-san',
      'host.openshell.internal',
      '--output-dir',
      GATEWAY_STORAGE_DIRECTORY,
    ]);
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
    expect(writtenContent).toContain('compute_drivers = ["podman"]');
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

    expect(exec.exec).toHaveBeenCalledWith(GATEWAY_BINARY, ['--version']);
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

    expect(exec.exec).not.toHaveBeenCalledWith(GATEWAY_BINARY, ['--version']);
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
      ['--port', '17670', '--bind-address', '127.0.0.1', '--disable-tls', '--db-url', GATEWAY_DB_URL],
      expect.objectContaining({ detached: false }),
    );
  });

  test.each(['podman', 'docker'] as const)('honors an explicit %s driver and enables bind mounts', async driver => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    await gateway.start({ driver });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('enable_bind_mounts = true');
    expect(writtenContent).toContain(`compute_drivers = ["${driver}"]`);
  });

  test('honors an explicit VM driver and omits container settings even when the active driver is Podman', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.116'));
    vi.mocked(gatewayManager.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ capabilities: { driver_name: 'podman' }, name: 'podman' }],
    });

    await gateway.start({ driver: 'vm' });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('compute_drivers = ["vm"]');
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
    expect(writtenContent).toContain('compute_drivers = ["podman"]');
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

  test('removes gateway.pid on process error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    Object.defineProperty(proc, 'pid', { value: 12345 });
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();
    proc.emit('error', new Error('spawn error'));
    // Flush microtask queue — unlink is chained after the PID write promise
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(unlink).toHaveBeenCalledWith(join(GATEWAY_STORAGE_DIRECTORY, 'gateway.pid'));
  });

  test('getGatewayPid returns pid for alive process', async () => {
    vi.mocked(readFile).mockResolvedValue('12345');
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const pid = await gateway.getGatewayPid({
      name: 'local-dev',
      endpoint: 'http://127.0.0.1:17675',
    });

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

    const pid = await gateway.getGatewayPid({
      name: 'local-dev',
      endpoint: 'http://127.0.0.1:17675',
    });

    expect(pid).toBeUndefined();
    killSpy.mockRestore();
  });

  test('getGatewayPid returns undefined when no pid file exists', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const pid = await gateway.getGatewayPid({
      name: 'local-dev',
      endpoint: 'http://127.0.0.1:17675',
    });

    expect(pid).toBeUndefined();
  });
});
