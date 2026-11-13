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

import assert from 'node:assert';

import { beforeEach, expect, test, vi } from 'vitest';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { ConfigurationRegistry } from '/@/plugin/configuration-registry.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';

import { OpenshellSshConfig } from './openshell-ssh-config.js';
import { OpenshellSshHostManager } from './openshell-ssh-host-manager.js';

vi.mock(import('/@/plugin/cli-tool-registry.js'));
vi.mock(import('/@/plugin/configuration-registry.js'));
vi.mock(import('/@/plugin/util/exec.js'));
vi.mock(import('./openshell-ssh-config.js'));

const OPEN_SHELL_BINARY = '/Applications/Kaiden.app/Contents/Resources/openshell/openshell';
const PATH_BINARY = '/opt/homebrew/bin/openshell';
const HOST_ALIAS = 'openshell-my-sandbox.default';

const HOST_BLOCK = [
  `Host ${HOST_ALIAS}`,
  '    User sandbox',
  '    StrictHostKeyChecking no',
  '    UserKnownHostsFile /dev/null',
  '    GlobalKnownHostsFile /dev/null',
  '    LogLevel ERROR',
  '    ServerAliveInterval 15',
  '    ServerAliveCountMax 3',
  `    ProxyCommand ${OPEN_SHELL_BINARY} ssh-proxy --gateway-name remote-gateway --name my-sandbox --workspace default`,
].join('\n');

let exec: Exec;
let cliToolRegistry: CliToolRegistry;
let configurationRegistry: ConfigurationRegistry;
let configuredValues: Record<string, unknown>;
let sshConfig: OpenshellSshConfig;
let manager: OpenshellSshHostManager;

function registerOpenShellTool(path: string, installationSource?: 'extension' | 'external'): void {
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
    { name: 'openshell', path, installationSource },
  ] as unknown as CliToolInfo[]);
}

beforeEach(() => {
  vi.resetAllMocks();
  exec = new Exec({} as never);
  cliToolRegistry = new CliToolRegistry({} as never);
  configurationRegistry = new ConfigurationRegistry({} as never, {} as never, {} as never, {} as never);
  sshConfig = new OpenshellSshConfig({} as never);
  configuredValues = {};
  vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
    get: (key: string) => configuredValues[key],
  } as never);
  registerOpenShellTool(OPEN_SHELL_BINARY, 'extension');
  vi.mocked(exec.exec).mockResolvedValue({
    command: OPEN_SHELL_BINARY,
    stdout: `${HOST_BLOCK}\n`,
    stderr: '',
  });
  manager = new OpenshellSshHostManager(exec, cliToolRegistry, configurationRegistry, sshConfig);
});

test('generates the host block with the OpenShell CLI and installs it', async () => {
  await manager.install('my-sandbox', 'remote-gateway');

  expect(exec.exec).toHaveBeenCalledWith(OPEN_SHELL_BINARY, [
    '--gateway',
    'remote-gateway',
    '--workspace',
    'default',
    'sandbox',
    'ssh-config',
    'my-sandbox',
  ]);
  expect(sshConfig.installHost).toHaveBeenCalledWith(HOST_ALIAS, HOST_BLOCK, 'remote-gateway');
});

test('falls back to openshell from the PATH when the CLI is not registered', async () => {
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([]);
  vi.mocked(exec.exec).mockResolvedValue({ command: 'openshell', stdout: HOST_BLOCK, stderr: '' });

  await manager.install('my-sandbox', 'remote-gateway');

  expect(exec.exec).toHaveBeenCalledWith('openshell', expect.arrayContaining(['sandbox', 'ssh-config']));
  expect(sshConfig.installHost).toHaveBeenCalledWith(
    HOST_ALIAS,
    expect.stringContaining('ProxyCommand openshell ssh-proxy'),
    'remote-gateway',
  );
});

test('uses the host alias rendered by the CLI', async () => {
  vi.mocked(exec.exec).mockResolvedValue({
    command: OPEN_SHELL_BINARY,
    stdout: HOST_BLOCK.replace(`Host ${HOST_ALIAS}`, 'Host openshell-my-sandbox.team-a'),
    stderr: '',
  });

  await manager.install('my-sandbox', 'remote-gateway');

  expect(sshConfig.installHost).toHaveBeenCalledWith(
    'openshell-my-sandbox.team-a',
    expect.any(String),
    'remote-gateway',
  );
});

test('keeps the bundled CLI path in the ProxyCommand', async () => {
  await manager.install('my-sandbox', 'remote-gateway');

  expect(sshConfig.installHost).toHaveBeenCalledWith(
    HOST_ALIAS,
    expect.stringContaining(`ProxyCommand ${OPEN_SHELL_BINARY} ssh-proxy`),
    'remote-gateway',
  );
});

test('keeps the absolute path of a CLI configured in Kaiden', async () => {
  registerOpenShellTool(PATH_BINARY, 'external');
  configuredValues['binary.path'] = PATH_BINARY;

  await manager.install('my-sandbox', 'remote-gateway');

  expect(sshConfig.installHost).toHaveBeenCalledWith(
    HOST_ALIAS,
    expect.stringContaining(`ProxyCommand ${PATH_BINARY} ssh-proxy`),
    'remote-gateway',
  );
});

test('uses a bare openshell when the CLI was found on the PATH', async () => {
  registerOpenShellTool(PATH_BINARY, 'external');

  await manager.install('my-sandbox', 'remote-gateway');

  const [, block] = vi.mocked(sshConfig.installHost).mock.calls[0] ?? [];
  assert(block);
  expect(block).toContain('ProxyCommand openshell ssh-proxy');
  expect(block).not.toContain(PATH_BINARY);
});

test('quotes an embedded CLI path that contains spaces', async () => {
  const spacedPath = '/Applications/My Apps/Kaiden.app/Contents/Resources/openshell/openshell';
  registerOpenShellTool(spacedPath, 'extension');

  await manager.install('my-sandbox', 'remote-gateway');

  expect(sshConfig.installHost).toHaveBeenCalledWith(
    HOST_ALIAS,
    expect.stringContaining(`ProxyCommand '${spacedPath}' ssh-proxy`),
    'remote-gateway',
  );
});

test('removes the host block of a deleted sandbox', async () => {
  vi.mocked(sshConfig.removeHost).mockResolvedValue(1);

  const removed = await manager.remove('my-sandbox', 'remote-gateway');

  expect(removed).toBe(1);
  expect(sshConfig.removeHost).toHaveBeenCalledWith('my-sandbox', 'remote-gateway');
});

test('rejects sandbox names that could corrupt the SSH config', async () => {
  await expect(manager.install('bad name', 'remote-gateway')).rejects.toThrow('invalid sandbox name "bad name"');

  expect(exec.exec).not.toHaveBeenCalled();
  expect(sshConfig.installHost).not.toHaveBeenCalled();
});

test('reports CLI failures with the workspace and gateway', async () => {
  vi.mocked(exec.exec).mockRejectedValue(new Error("Unknown gateway 'remote-gateway'"));

  await expect(manager.install('my-sandbox', 'remote-gateway')).rejects.toThrow(
    'Failed to generate the SSH host config for workspace "my-sandbox" on gateway "remote-gateway": Unknown gateway',
  );

  expect(sshConfig.installHost).not.toHaveBeenCalled();
});

test('rejects CLI output without a host block', async () => {
  vi.mocked(exec.exec).mockResolvedValue({ command: OPEN_SHELL_BINARY, stdout: 'no config here', stderr: '' });

  await expect(manager.install('my-sandbox', 'remote-gateway')).rejects.toThrow(
    'returned no SSH host block for workspace "my-sandbox"',
  );

  expect(sshConfig.installHost).not.toHaveBeenCalled();
});

test('rejects CLI output without a ProxyCommand', async () => {
  const block = HOST_BLOCK.split('\n')
    .filter(line => !line.trimStart().startsWith('ProxyCommand '))
    .join('\n');
  vi.mocked(exec.exec).mockResolvedValue({ command: OPEN_SHELL_BINARY, stdout: block, stderr: '' });

  await expect(manager.install('my-sandbox', 'remote-gateway')).rejects.toThrow(
    'without a ProxyCommand for workspace "my-sandbox"',
  );

  expect(sshConfig.installHost).not.toHaveBeenCalled();
});
