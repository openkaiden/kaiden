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

import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { beforeEach, expect, test, vi } from 'vitest';

import type { Directories } from '/@/plugin/directories.js';

import { OpenshellSshConfig } from './openshell-ssh-config.js';

const GATEWAY = 'kaiden-local';
const OTHER_GATEWAY = 'remote-gateway';
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
  `    ProxyCommand /opt/kaiden/openshell ssh-proxy --gateway-name ${GATEWAY} --name my-sandbox --workspace default`,
].join('\n');

let configDir: string;
let userSshConfig: string;

class TestOpenshellSshConfig extends OpenshellSshConfig {
  protected override userSshConfigPath(): string {
    return userSshConfig;
  }
}

let sshConfig: TestOpenshellSshConfig;

async function readManagedConfig(): Promise<string> {
  return readFile(join(configDir, 'ssh_config'), 'utf-8');
}

beforeEach(async () => {
  vi.resetAllMocks();
  const base = await mkdtemp(join(tmpdir(), 'openshell-ssh-config-'));
  configDir = join(base, 'config');
  userSshConfig = join(base, 'home', '.ssh', 'config');
  const directories = { getConfigurationDirectory: () => configDir } as Directories;
  sshConfig = new TestOpenshellSshConfig(directories);
});

test('writes the host block and includes the managed config from the user config', async () => {
  const alias = await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  expect(alias).toBe(HOST_ALIAS);
  const managedConfig = await readManagedConfig();
  expect(managedConfig).toContain(`# kaiden:gateway=${GATEWAY}`);
  expect(managedConfig).toContain(`Host ${HOST_ALIAS}`);
  expect(managedConfig).toContain('    User sandbox');
  expect(managedConfig).toContain('    StrictHostKeyChecking no');
  expect(managedConfig).toContain('    ProxyCommand /opt/kaiden/openshell ssh-proxy');

  const userConfig = await readFile(userSshConfig, 'utf-8');
  expect(userConfig).toContain(`Include "${join(configDir, 'ssh_config')}"`);
});

test('replaces an existing host block and preserves unrelated blocks', async () => {
  const managedConfigPath = join(configDir, 'ssh_config');
  await mkdir(dirname(managedConfigPath), { recursive: true });
  await writeFile(
    managedConfigPath,
    'Host openshell-my-sandbox.default\n    HostName 127.0.0.1\n    Port 11111\n    User sandbox\n\nHost other-host\n    User bob\n',
    'utf-8',
  );

  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const managedConfig = await readManagedConfig();
  expect(managedConfig).not.toContain('Port 11111');
  expect(managedConfig).toContain('    ProxyCommand /opt/kaiden/openshell ssh-proxy');
  expect(managedConfig).toContain('Host other-host');
  expect(managedConfig).toContain('    User bob');
});

test('does not duplicate the include on repeated calls', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const contents = await readFile(userSshConfig, 'utf-8');
  const includeLine = `Include "${join(configDir, 'ssh_config')}"`;
  expect(contents.split(includeLine).length - 1).toBe(1);
});

test('inserts the include before host definitions in the user config', async () => {
  await mkdir(dirname(userSshConfig), { recursive: true });
  await writeFile(userSshConfig, 'Host existing\n    User bob\n', 'utf-8');

  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const contents = await readFile(userSshConfig, 'utf-8');
  const includeIndex = contents.indexOf(`Include "${join(configDir, 'ssh_config')}"`);
  expect(includeIndex).toBeGreaterThanOrEqual(0);
  expect(includeIndex).toBeLessThan(contents.indexOf('Host existing'));
  expect(contents).toContain('Host existing');
  expect(contents).toContain('    User bob');
});

test('strips the trailing newlines of the generated block', async () => {
  await sshConfig.installHost(HOST_ALIAS, `${HOST_BLOCK}\r\n\r\n`, GATEWAY);

  const managedConfig = await readManagedConfig();
  expect(managedConfig).toBe(`# kaiden:gateway=${GATEWAY}\n${HOST_BLOCK}\n`);
});

test('appends the gateway to the alias when another gateway owns it', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const alias = await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, OTHER_GATEWAY);

  expect(alias).toBe(`${HOST_ALIAS}.${OTHER_GATEWAY}`);
  const managedConfig = await readManagedConfig();
  expect(managedConfig).toContain(`Host ${HOST_ALIAS}\n`);
  expect(managedConfig).toContain(`Host ${HOST_ALIAS}.${OTHER_GATEWAY}\n`);
  expect(managedConfig).toContain(`# kaiden:gateway=${GATEWAY}`);
  expect(managedConfig).toContain(`# kaiden:gateway=${OTHER_GATEWAY}`);
});

test('reinstalling from the same gateway keeps the suffixed alias', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, OTHER_GATEWAY);

  const alias = await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, OTHER_GATEWAY);

  expect(alias).toBe(`${HOST_ALIAS}.${OTHER_GATEWAY}`);
  const managedConfig = await readManagedConfig();
  expect(managedConfig.split(`Host ${HOST_ALIAS}\n`).length - 1).toBe(1);
  expect(managedConfig.split(`Host ${HOST_ALIAS}.${OTHER_GATEWAY}\n`).length - 1).toBe(1);
  expect(managedConfig.split(`# kaiden:gateway=${GATEWAY}`).length - 1).toBe(1);
  expect(managedConfig.split(`# kaiden:gateway=${OTHER_GATEWAY}`).length - 1).toBe(1);
});

test('reclaims an unmarked block left by an older Kaiden version', async () => {
  const managedConfigPath = join(configDir, 'ssh_config');
  await mkdir(dirname(managedConfigPath), { recursive: true });
  await writeFile(
    managedConfigPath,
    `Host ${HOST_ALIAS}\n    HostName 127.0.0.1\n    Port 43210\n    User sandbox\n`,
    'utf-8',
  );

  const alias = await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  expect(alias).toBe(HOST_ALIAS);
  const managedConfig = await readManagedConfig();
  expect(managedConfig).toContain(`# kaiden:gateway=${GATEWAY}`);
  expect(managedConfig).not.toContain('Port 43210');
});
