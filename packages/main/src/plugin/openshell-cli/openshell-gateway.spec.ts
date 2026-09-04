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
import { type FileHandle, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunResult } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Directories } from '/@/plugin/directories.js';
import type { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type { NotificationRegistry } from '/@/plugin/tasks/notification-registry.js';
import type { Exec } from '/@/plugin/util/exec.js';
import { isFreePort } from '/@/plugin/util/port.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';
import type { GatewayInfo } from '/@api/openshell-gateway-info.js';

import { OpenshellGateway } from './openshell-gateway.js';

vi.mock(import('node:child_process'));
vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('/@/plugin/util/exec.js'));
vi.mock(import('/@/plugin/util/port.js'));

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

let gateway: OpenshellGateway;

const cliToolRegistry = {
  getCliToolInfos: vi.fn(),
} as unknown as CliToolRegistry;

const openshellCli = {
  listGateways: vi.fn(),
  selectGateway: vi.fn(),
  checkEndpointStatus: vi.fn(),
  addGateway: vi.fn(),
  removeGateway: vi.fn(),
  getGatewayInfo: vi.fn(),
} as unknown as OpenshellCli;

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
  vi.mocked(exec.exec).mockResolvedValue({ command: '', stdout: '', stderr: '' });
  vi.mocked(isFreePort).mockResolvedValue(true);
  vi.mocked(openshellCli.removeGateway).mockResolvedValue();
  vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
  vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });
  gateway = new OpenshellGateway(cliToolRegistry, openshellCli, directories, exec, notificationRegistry);
});

describe('init', () => {
  test('does not inspect storage paths for invalid registered gateway names', async () => {
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: '../outside', endpoint: 'http://127.0.0.1:17675', active: true, type: 'local' },
    ]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.init();

    expect(existsSync).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  test('starts a stopped gateway previously created by Kaiden', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: 'local-dev', endpoint: 'http://127.0.0.1:17675', active: true, type: 'local' },
    ]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValue(true);

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
    const existingGateways: GatewayInfo[] = [
      { name: 'local-gw', endpoint: 'https://127.0.0.1:8443', active: true, type: 'local' },
    ];
    vi.mocked(openshellCli.listGateways).mockResolvedValue(existingGateways);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.init();

    expect(openshellCli.listGateways).toHaveBeenCalled();
    expect(openshellCli.checkEndpointStatus).toHaveBeenCalledWith('https://127.0.0.1:8443');
    expect(spawn).not.toHaveBeenCalled();
    expect(createWriteStream).not.toHaveBeenCalled();
    expect(openshellCli.selectGateway).not.toHaveBeenCalled();
  });

  test('selects healthy gateway when it is not active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const existingGateways: GatewayInfo[] = [{ name: 'kaiden-alt', endpoint: 'http://127.0.0.1:18080', active: false }];
    vi.mocked(openshellCli.listGateways).mockResolvedValue(existingGateways);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.init();

    expect(openshellCli.selectGateway).toHaveBeenCalledWith('kaiden-alt');
    expect(spawn).not.toHaveBeenCalled();
  });

  test('auto-starts local gateway when no gateways exist and port is free', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '17670']),
      expect.objectContaining({ detached: false }),
    );
  });

  test('reuses orphan gateway when port is already healthy', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.init();

    expect(spawn).not.toHaveBeenCalled();
    expect(openshellCli.addGateway).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:17670',
      local: true,
      name: 'kaiden-local',
    });
  });

  test('skips auto-start when discovery fails and binary is not registered', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockRejectedValue(new Error('CLI not found'));
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([] as unknown as CliToolInfo[]);

    await gateway.init();

    expect(spawn).not.toHaveBeenCalled();
  });

  test('auto-starts when discovery fails but binary is available and port is free', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways)
      .mockRejectedValueOnce(new Error('no gateway configured'))
      .mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '17670']),
      expect.objectContaining({ detached: false }),
    );
  });

  test('returns without spawning when at least one gateway is healthy among multiple', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const gateways: GatewayInfo[] = [
      { name: 'gw-stopped', endpoint: 'http://127.0.0.1:8080', active: false },
      { name: 'gw-healthy', endpoint: 'http://127.0.0.1:9090', active: true },
    ];
    vi.mocked(openshellCli.listGateways).mockResolvedValue(gateways);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    await gateway.init();

    expect(spawn).not.toHaveBeenCalled();
  });

  test('creates new gateway when existing gateways are unreachable', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gateways: GatewayInfo[] = [{ name: 'broken-gw', endpoint: 'http://127.0.0.1:19999', active: true }];
    vi.mocked(openshellCli.listGateways).mockResolvedValue(gateways);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--port', '17670']),
      expect.objectContaining({ detached: false }),
    );
  });

  test('delegates health check to openshellCli for https endpoints', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const gateways: GatewayInfo[] = [
      { name: 'tls-gw', endpoint: 'https://127.0.0.1:8443', active: true, type: 'local' },
    ];
    vi.mocked(openshellCli.listGateways).mockResolvedValue(gateways);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.init();

    expect(openshellCli.checkEndpointStatus).toHaveBeenCalledWith('https://127.0.0.1:8443');
  });

  test('skips remote gateways during init and auto-starts local', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const gateways: GatewayInfo[] = [{ name: 'remote-gw', endpoint: 'https://gw.example.com', active: true }];
    vi.mocked(openshellCli.listGateways).mockResolvedValue(gateways);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.init();

    expect(openshellCli.checkEndpointStatus).not.toHaveBeenCalledWith('https://gw.example.com');
    expect(spawn).toHaveBeenCalled();
  });
});

describe('createLocalGateway', () => {
  test('starts and registers a named plaintext gateway on loopback', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
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
    const spawnArgs = vi.mocked(spawn).mock.calls[0]?.[1] ?? [];
    expect(spawnArgs).not.toContain('--tls-cert');
    expect(spawnArgs).not.toContain('--tls-key');
    expect(spawnArgs).not.toContain('--tls-client-ca');
    expect(openshellCli.addGateway).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:17675',
      local: true,
      name: 'local-dev',
    });
    expect(exec.exec).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['generate-certs', '--output-dir', storageDirectory]),
      { env: { XDG_CONFIG_HOME: join(storageDirectory, 'xdg-config') } },
    );
    expect(closeLogFile).toHaveBeenCalled();
  });

  test('infers the Docker driver from the active gateway when no override is supplied', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ name: 'docker', capabilities: { driver_name: 'docker' } }],
    });

    await gateway.createLocalGateway({
      name: 'docker-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
    });

    expect(writeFile).toHaveBeenCalledWith(
      join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'docker-dev', 'gateway.toml'),
      expect.stringContaining('compute_drivers = ["docker"]'),
      'utf-8',
    );
  });

  test('creates a local gateway using the VM driver', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.createLocalGateway({
      name: 'vm-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
      driver: 'vm',
    });

    expect(writeFile).toHaveBeenCalledWith(
      join(KAIDEN_DATA_DIRECTORY, 'openshell-gateways', 'vm-dev', 'gateway.toml'),
      expect.stringContaining('compute_drivers = ["vm"]'),
      'utf-8',
    );
  });

  test.each([
    ['../gateway', '127.0.0.1', 17675, 'Gateway name'],
    ['kaiden-local', '127.0.0.1', 17675, 'reserved'],
    ['local-dev', '0.0.0.0', 17675, 'must bind to 127.0.0.1'],
    ['local-dev', '127.0.0.1', 1023, 'between 1024 and 65535'],
  ])('rejects invalid local gateway input (%s, %s:%i): %s', async (name, bindAddress, port, message) => {
    await expect(gateway.createLocalGateway({ name, bindAddress, port, driver: 'podman' })).rejects.toThrow(message);
    expect(spawn).not.toHaveBeenCalled();
  });

  test('rejects a port occupied by an unregistered process before creating files', async () => {
    vi.mocked(isFreePort).mockRejectedValue(new Error('Port 17675 is already in use.'));

    await expect(
      gateway.createLocalGateway({
        name: 'local-dev',
        bindAddress: '127.0.0.1',
        port: 17675,
        driver: 'podman',
      }),
    ).rejects.toThrow('Port 17675 is already in use');

    expect(writeFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(openshellCli.addGateway).not.toHaveBeenCalled();
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
    expect(openshellCli.removeGateway).toHaveBeenCalledWith('local-dev');
  });

  test('force-stops a failed gateway process that ignores SIGTERM', async () => {
    vi.useFakeTimers();
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.getGatewayInfo).mockRejectedValue(new Error('not ready'));

    const creation = expect(
      gateway.createLocalGateway({
        name: 'local-dev',
        bindAddress: '127.0.0.1',
        port: 17675,
        driver: 'podman',
      }),
    ).rejects.toThrow('Gateway did not become ready');
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(5_000);

    await creation;
    expect(proc.kill).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(proc.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');
    vi.useRealTimers();
  });

  test('closes the log without registering when spawn throws', async () => {
    vi.mocked(spawn).mockImplementation(() => {
      throw new Error('spawn failed');
    });

    await expect(
      gateway.createLocalGateway({
        name: 'local-dev',
        bindAddress: '127.0.0.1',
        port: 17675,
        driver: 'podman',
      }),
    ).rejects.toThrow('spawn failed');

    expect(closeLogFile).toHaveBeenCalledOnce();
    expect(openshellCli.addGateway).not.toHaveBeenCalled();
    expect(openshellCli.removeGateway).not.toHaveBeenCalled();
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
  test('can retry after the gateway process emits an error without exiting', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failedProcess = createMockChildProcess();
    const retryProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(failedProcess).mockReturnValueOnce(retryProcess);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();
    failedProcess.emit('error', new Error('spawn error'));
    await gateway.start();

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(gateway.isRunning()).toBe(true);
  });

  test('spawns the gateway process and writes its output only to the log', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

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

  test('spawns with custom port and address', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start({ port: 9999, bindAddress: '0.0.0.0' });

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      [
        '--config',
        GATEWAY_CONFIG_PATH,
        '--port',
        '9999',
        '--bind-address',
        '0.0.0.0',
        '--disable-tls',
        '--db-url',
        GATEWAY_DB_URL,
      ],
      expect.objectContaining({ detached: false }),
    );
  });

  test('skips --disable-tls when disableTls is false', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start({ disableTls: false });

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      ['--config', GATEWAY_CONFIG_PATH, '--port', '17670', '--bind-address', '127.0.0.1', '--db-url', GATEWAY_DB_URL],
      expect.objectContaining({ detached: false }),
    );
  });

  test('passes --db-url pointing to the kaiden data directory', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      expect.arrayContaining(['--db-url', GATEWAY_DB_URL]),
      expect.objectContaining({ detached: false }),
    );
  });

  test('skips if already running', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();
    await gateway.start();

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  test('throws when gateway binary is not registered', async () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([] as unknown as CliToolInfo[]);

    await expect(gateway.start()).rejects.toThrow('openshell-gateway binary not registered');
  });

  test('performs health check via openshellCli', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    expect(openshellCli.checkEndpointStatus).toHaveBeenCalledWith('http://127.0.0.1:17670');
  });

  test('registers gateway via openshellCli after health check passes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    expect(openshellCli.addGateway).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:17670',
      local: true,
      name: 'kaiden-local',
    });
  });

  test('skips re-registration when kaiden-local already exists with same endpoint', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: 'kaiden-local', endpoint: 'http://127.0.0.1:17670' } as GatewayInfo,
    ]);

    await gateway.start();

    expect(openshellCli.removeGateway).not.toHaveBeenCalled();
    expect(openshellCli.addGateway).not.toHaveBeenCalled();
  });

  test('removes stale gateway and re-registers when endpoint differs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: 'kaiden-local', endpoint: 'http://127.0.0.1:9999' } as GatewayInfo,
    ]);

    await gateway.start();

    expect(openshellCli.removeGateway).toHaveBeenCalledWith('kaiden-local');
    expect(openshellCli.addGateway).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:17670',
      local: true,
      name: 'kaiden-local',
    });

    const removeOrder = vi.mocked(openshellCli.removeGateway).mock.invocationCallOrder[0]!;
    const addOrder = vi.mocked(openshellCli.addGateway).mock.invocationCallOrder[0]!;
    expect(removeOrder).toBeLessThan(addOrder);
  });

  test('registers fresh when kaiden-local does not exist', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);

    await gateway.start();

    expect(openshellCli.removeGateway).not.toHaveBeenCalled();
    expect(openshellCli.addGateway).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:17670',
      local: true,
      name: 'kaiden-local',
    });
  });

  test('registers successfully even when removeGateway fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: 'kaiden-local', endpoint: 'http://127.0.0.1:9999' } as GatewayInfo,
    ]);
    vi.mocked(openshellCli.removeGateway).mockRejectedValue(new Error('no such gateway'));

    await gateway.start();

    expect(openshellCli.addGateway).toHaveBeenCalledWith({
      endpoint: 'http://127.0.0.1:17670',
      local: true,
      name: 'kaiden-local',
    });
  });

  test('skips registerWithCli when skipRegistration is true', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start({ skipRegistration: true });

    expect(spawn).toHaveBeenCalled();
    expect(openshellCli.addGateway).not.toHaveBeenCalled();
  });

  test('generates certs by calling the gateway binary with generate-certs', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

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

  test('writes gateway.toml config with JWT paths', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

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

  test('generates gateway config with non-expiring JWTs (ttl_secs = 0)', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    expect(writeFile).toHaveBeenCalledWith(GATEWAY_CONFIG_PATH, expect.stringContaining('ttl_secs = 0'), 'utf-8');
  });

  test('starts gateway without --config when cert generation fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
    vi.mocked(exec.exec).mockRejectedValue(new Error('generate-certs failed'));

    await gateway.start();

    expect(spawn).toHaveBeenCalledWith(
      GATEWAY_BINARY,
      ['--port', '17670', '--bind-address', '127.0.0.1', '--disable-tls', '--db-url', GATEWAY_DB_URL],
      expect.objectContaining({ detached: false }),
    );
  });

  test('stops the spawned process when waitForReady fails', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(false);

    let caughtError: unknown;
    const startPromise = gateway.start().catch((err: unknown) => {
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
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    vi.useRealTimers();
  });
});

describe('stop', () => {
  test('sends SIGTERM to running process', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    const stopPromise = gateway.stop();
    proc.emit('exit', 0, undefined);
    await stopPromise;

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
  });

  test('does not clear a newer process when the stopped process exits late', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stoppedProcess = createMockChildProcess();
    const currentProcess = createMockChildProcess();
    vi.mocked(spawn).mockReturnValueOnce(stoppedProcess).mockReturnValueOnce(currentProcess);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
    await gateway.start();
    const stopPromise = gateway.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await stopPromise;
    await gateway.start();

    stoppedProcess.emit('exit', 0, undefined);
    expect(gateway.isRunning()).toBe(true);
    vi.useRealTimers();
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
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    expect(gateway.isRunning()).toBe(true);
  });
});

describe('dispose', () => {
  test('stops gateways created from the settings UI', async () => {
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);

    await gateway.createLocalGateway({
      name: 'local-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
      driver: 'podman',
    });

    gateway.dispose();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    proc.emit('exit', 0, undefined);
  });

  test('stops the gateway process and closes its log', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    await gateway.start();

    gateway.dispose();

    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
    proc.emit('exit', 0, undefined);
    await vi.waitFor(() => expect(gatewayLogStream.end).toHaveBeenCalledOnce());
  });
});

describe('onDidGatewayStart', () => {
  test('fires when existing gateway is healthy and active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: 'local-gw', endpoint: 'https://127.0.0.1:8443', active: true, type: 'local' },
    ]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('fires when existing gateway is healthy but not active', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([
      { name: 'kaiden-alt', endpoint: 'http://127.0.0.1:18080', active: false },
    ]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('fires when orphan gateway found on default port', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('fires when auto-start succeeds', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    const listener = vi.fn();
    gateway.onDidGatewayStart(listener);
    await gateway.init();

    expect(listener).toHaveBeenCalledOnce();
  });

  test('does not fire when no binary and no gateways', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(openshellCli.listGateways).mockRejectedValue(new Error('CLI not found'));
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
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(false);

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
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(false);

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
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(false);

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
    vi.mocked(openshellCli.listGateways).mockResolvedValue([]);
    const proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValueOnce(false).mockResolvedValue(true);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    const failListener = vi.fn();
    gateway.onDidGatewayInitFailed(failListener);
    await gateway.init();

    expect(failListener).not.toHaveBeenCalled();
    expect(notificationRegistry.addNotification).not.toHaveBeenCalled();
  });
});

describe('supportsMounts', () => {
  test('returns true when the managed gateway config enables bind mounts', async () => {
    vi.mocked(readFile).mockResolvedValue('[openshell.drivers.podman]\nenable_bind_mounts = true\n');

    await expect(
      gateway.supportsMounts({
        name: 'kaiden-local',
        endpoint: 'http://127.0.0.1:17670',
        type: 'local',
      }),
    ).resolves.toBe(true);
    expect(readFile).toHaveBeenCalledWith(GATEWAY_CONFIG_PATH, 'utf-8');
  });

  test('returns false for gateways without a managed bind-mount config', async () => {
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    await expect(
      gateway.supportsMounts({ name: 'kaiden-local', endpoint: 'http://127.0.0.1:17670', type: 'local' }),
    ).resolves.toBe(false);
  });

  test('returns false for a remote registration with stale managed storage', async () => {
    vi.mocked(readFile).mockResolvedValue('[openshell.drivers.podman]\nenable_bind_mounts = true\n');

    await expect(
      gateway.supportsMounts({
        name: 'kaiden-local',
        endpoint: 'https://gateway.example.com',
        type: 'remote',
        is_remote: true,
      }),
    ).resolves.toBe(false);
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe('gateway config generation', () => {
  let proc: ReturnType<typeof createMockChildProcess>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    proc = createMockChildProcess();
    vi.mocked(spawn).mockReturnValue(proc);
    vi.mocked(openshellCli.checkEndpointStatus).mockResolvedValue(true);
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

  test('config only includes podman driver section', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('[openshell.drivers.podman]');
    expect(writtenContent).not.toContain('[openshell.drivers.docker]');
  });

  test('pins supervisor image to detected gateway version', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));

    await gateway.start();

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
    await gateway.start({ supervisorImage: 'my-registry.io/supervisor:custom' });

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

    await gateway.start();

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

    await gateway.start();

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

  test('enables bind mounts when a local compute driver is detected', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({
      status: 'healthy',
      compute_drivers: [{ capabilities: { driver_name: 'podman' }, name: 'podman' }],
    });

    await gateway.start();

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('enable_bind_mounts = true');
  });

  test('generates config without bind mounts when no driver is available', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell-gateway 0.0.69'));
    vi.mocked(openshellCli.getGatewayInfo).mockResolvedValue({ status: 'healthy', compute_drivers: [] });

    await gateway.start();

    const writtenContent = vi.mocked(writeFile).mock.calls[0]?.[1] as string;
    expect(writtenContent).toContain('[openshell.drivers.podman]');
    expect(writtenContent).toContain('enable_bind_mounts');
    expect(writtenContent).not.toContain('compute_drivers');
  });
});
