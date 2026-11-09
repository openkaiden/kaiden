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
 **********************************************************************/

import { beforeEach, expect, test, vi } from 'vitest';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';

import { OpenshellCli } from './openshell-cli.js';

vi.mock(import('/@/plugin/cli-tool-registry.js'));
vi.mock(import('/@/plugin/util/exec.js'));

const OPEN_SHELL_BINARY = '/usr/local/bin/openshell';

let exec: Exec;
let cliToolRegistry: CliToolRegistry;
let openshellCli: OpenshellCli;

beforeEach(() => {
  vi.resetAllMocks();
  exec = new Exec({} as never);
  cliToolRegistry = new CliToolRegistry({} as never);
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
    { name: 'openshell', path: OPEN_SHELL_BINARY },
  ] as unknown as CliToolInfo[]);
  vi.mocked(exec.exec).mockResolvedValue({ command: OPEN_SHELL_BINARY, stdout: '', stderr: '' });
  openshellCli = new OpenshellCli(exec, cliToolRegistry);
});

test('installs the SSH config of a sandbox on its gateway', async () => {
  await openshellCli.installSandboxSshConfig('remote-gateway', 'my-sandbox');

  expect(exec.exec).toHaveBeenCalledWith(OPEN_SHELL_BINARY, [
    '--gateway',
    'remote-gateway',
    'sandbox',
    'ssh-config',
    'my-sandbox',
    '--install',
  ]);
});

test('falls back to openshell from the PATH when the CLI is not registered', async () => {
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([]);
  vi.mocked(exec.exec).mockResolvedValue({ command: 'openshell', stdout: '', stderr: '' });

  await openshellCli.installSandboxSshConfig('remote-gateway', 'my-sandbox');

  expect(exec.exec).toHaveBeenCalledWith('openshell', [
    '--gateway',
    'remote-gateway',
    'sandbox',
    'ssh-config',
    'my-sandbox',
    '--install',
  ]);
});

test('reports the sandbox name when the command fails', async () => {
  vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

  await expect(openshellCli.installSandboxSshConfig('remote-gateway', 'my-sandbox')).rejects.toThrow(
    'Failed to install the SSH config for workspace "my-sandbox": command not found',
  );
});
