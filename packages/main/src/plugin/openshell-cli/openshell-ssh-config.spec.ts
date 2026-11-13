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

import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { beforeEach, expect, test, vi } from 'vitest';

import type { Directories } from '/@/plugin/directories.js';

import { OpenshellSshConfig } from './openshell-ssh-config.js';

const GATEWAY = 'kaiden-local';
const OTHER_GATEWAY = 'remote-gateway';
const SANDBOX = 'my-sandbox';
const HOST_ALIAS = `openshell-${SANDBOX}.default`;
const OPEN_SHELL_BINARY = '/opt/kaiden/openshell';

function renderBlock(alias: string, gateway: string, sandbox = SANDBOX): string {
  return [
    `Host ${alias}`,
    '    User sandbox',
    '    StrictHostKeyChecking no',
    '    UserKnownHostsFile /dev/null',
    '    GlobalKnownHostsFile /dev/null',
    '    LogLevel ERROR',
    '    ServerAliveInterval 15',
    '    ServerAliveCountMax 3',
    `    ProxyCommand ${OPEN_SHELL_BINARY} ssh-proxy --gateway-name ${gateway} --name ${sandbox} --workspace default`,
  ].join('\n');
}

const HOST_BLOCK = renderBlock(HOST_ALIAS, GATEWAY);

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

async function writeManagedConfig(contents: string): Promise<void> {
  const managedConfigPath = join(configDir, 'ssh_config');
  await mkdir(dirname(managedConfigPath), { recursive: true });
  await writeFile(managedConfigPath, contents, 'utf-8');
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
  expect(await readManagedConfig()).toBe(`${HOST_BLOCK}\n`);

  const userConfig = await readFile(userSshConfig, 'utf-8');
  expect(userConfig).toContain(`Include "${join(configDir, 'ssh_config')}"`);
});

// Windows ignores the mode: files get the ACL inherited from their directory
test.skipIf(process.platform === 'win32')(
  'creates the config files and directories readable by their owner only',
  async () => {
    await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

    expect((await stat(userSshConfig)).mode & 0o777).toBe(0o600);
    expect((await stat(dirname(userSshConfig))).mode & 0o777).toBe(0o700);
    expect((await stat(join(configDir, 'ssh_config'))).mode & 0o777).toBe(0o600);
    expect((await stat(configDir)).mode & 0o777).toBe(0o700);
  },
);

test('replaces an existing host block and preserves unrelated blocks', async () => {
  await writeManagedConfig(
    `Host ${HOST_ALIAS}\n    HostName 127.0.0.1\n    Port 11111\n    User sandbox\n\nHost other-host\n    User bob\n`,
  );

  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const managedConfig = await readManagedConfig();
  expect(managedConfig).not.toContain('Port 11111');
  expect(managedConfig).toContain(`ProxyCommand ${OPEN_SHELL_BINARY} ssh-proxy`);
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
  expect(includeIndex).toBe(0);
  expect(includeIndex).toBeLessThan(contents.indexOf('Host existing'));
  expect(contents).toContain('Host existing');
  expect(contents).toContain('    User bob');
});

test('inserts the include before directives that precede the first host block', async () => {
  await mkdir(dirname(userSshConfig), { recursive: true });
  await writeFile(userSshConfig, 'HostName plexnuc.local\n  User fbricon\n\nHost existing\n    User bob\n', 'utf-8');

  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const contents = await readFile(userSshConfig, 'utf-8');
  const includeIndex = contents.indexOf(`Include "${join(configDir, 'ssh_config')}"`);
  expect(includeIndex).toBe(0);
  expect(includeIndex).toBeLessThan(contents.indexOf('HostName plexnuc.local'));
  expect(contents).toContain('HostName plexnuc.local');
  expect(contents).toContain('Host existing');
});

test('moves an include found further down the user config back to the top', async () => {
  await mkdir(dirname(userSshConfig), { recursive: true });
  const includeLine = `Include "${join(configDir, 'ssh_config')}"`;
  await writeFile(userSshConfig, `Host existing\n    User bob\n\n${includeLine}\n`, 'utf-8');

  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const contents = await readFile(userSshConfig, 'utf-8');
  expect(contents.startsWith(`${includeLine}\n`)).toBe(true);
  expect(contents.split(includeLine).length - 1).toBe(1);
  expect(contents).toContain('Host existing');
});

test('strips the trailing newlines of the generated block', async () => {
  await sshConfig.installHost(HOST_ALIAS, `${HOST_BLOCK}\r\n\r\n`, GATEWAY);

  expect(await readManagedConfig()).toBe(`${HOST_BLOCK}\n`);
});

test('appends the gateway to the alias when another gateway owns it', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  const alias = await sshConfig.installHost(HOST_ALIAS, renderBlock(HOST_ALIAS, OTHER_GATEWAY), OTHER_GATEWAY);

  expect(alias).toBe(`${HOST_ALIAS}.${OTHER_GATEWAY}`);
  const managedConfig = await readManagedConfig();
  expect(managedConfig).toContain(`Host ${HOST_ALIAS}\n`);
  expect(managedConfig).toContain(`Host ${HOST_ALIAS}.${OTHER_GATEWAY}\n`);
  expect(managedConfig).toContain(`--gateway-name ${GATEWAY} `);
  expect(managedConfig).toContain(`--gateway-name ${OTHER_GATEWAY} `);
});

test('reinstalling from the same gateway keeps the suffixed alias', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  await sshConfig.installHost(HOST_ALIAS, renderBlock(HOST_ALIAS, OTHER_GATEWAY), OTHER_GATEWAY);

  const alias = await sshConfig.installHost(HOST_ALIAS, renderBlock(HOST_ALIAS, OTHER_GATEWAY), OTHER_GATEWAY);

  expect(alias).toBe(`${HOST_ALIAS}.${OTHER_GATEWAY}`);
  const managedConfig = await readManagedConfig();
  expect(managedConfig.split(`Host ${HOST_ALIAS}\n`).length - 1).toBe(1);
  expect(managedConfig.split(`Host ${HOST_ALIAS}.${OTHER_GATEWAY}\n`).length - 1).toBe(1);
  expect(managedConfig.split(`--gateway-name ${GATEWAY} `).length - 1).toBe(1);
  expect(managedConfig.split(`--gateway-name ${OTHER_GATEWAY} `).length - 1).toBe(1);
});

test('reclaims an unmarked block left by an older Kaiden version', async () => {
  await writeManagedConfig(`Host ${HOST_ALIAS}\n    HostName 127.0.0.1\n    Port 43210\n    User sandbox\n`);

  const alias = await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  expect(alias).toBe(HOST_ALIAS);
  const managedConfig = await readManagedConfig();
  expect(managedConfig).toBe(`${HOST_BLOCK}\n`);
});

test('removes the host block of a deleted sandbox and keeps the others', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  const otherAlias = 'openshell-other-sandbox.default';
  const otherBlock = renderBlock(otherAlias, GATEWAY, 'other-sandbox');
  await sshConfig.installHost(otherAlias, otherBlock, GATEWAY);

  const removed = await sshConfig.removeHost(SANDBOX, GATEWAY);

  expect(removed).toBe(1);
  expect(await readManagedConfig()).toBe(`${otherBlock}\n`);
});

test('removes the last host block without touching the first one', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  const otherAlias = 'openshell-other-sandbox.default';
  await sshConfig.installHost(otherAlias, renderBlock(otherAlias, GATEWAY, 'other-sandbox'), GATEWAY);

  const removed = await sshConfig.removeHost('other-sandbox', GATEWAY);

  expect(removed).toBe(1);
  expect(await readManagedConfig()).toBe(`${HOST_BLOCK}\n`);
});

test('keeps the blocks separated when removing a block between two others', async () => {
  const firstAlias = 'openshell-first-sandbox.default';
  const lastAlias = 'openshell-last-sandbox.default';
  await sshConfig.installHost(firstAlias, renderBlock(firstAlias, GATEWAY, 'first-sandbox'), GATEWAY);
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  const lastBlock = renderBlock(lastAlias, GATEWAY, 'last-sandbox');
  await sshConfig.installHost(lastAlias, lastBlock, GATEWAY);

  expect(await sshConfig.removeHost(SANDBOX, GATEWAY)).toBe(1);

  const managedConfig = await readManagedConfig();
  expect(managedConfig).toContain(`Host ${firstAlias}\n`);
  expect(managedConfig).toContain(`Host ${lastAlias}\n`);
  expect(managedConfig).not.toContain(`Host ${HOST_ALIAS}\n`);
  expect(managedConfig).not.toContain('\n\n\n');
});

test('keeps the block of the same sandbox installed on another gateway', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);
  const otherAlias = `${HOST_ALIAS}.${OTHER_GATEWAY}`;
  await sshConfig.installHost(HOST_ALIAS, renderBlock(otherAlias, OTHER_GATEWAY), OTHER_GATEWAY);

  const removed = await sshConfig.removeHost(SANDBOX, OTHER_GATEWAY);

  expect(removed).toBe(1);
  expect(await readManagedConfig()).toBe(`${HOST_BLOCK}\n`);
});

test('removes a block Kaiden did not install but whose ProxyCommand targets the sandbox', async () => {
  await writeManagedConfig(
    `Host my-custom-alias\n    User sandbox\n    ProxyCommand openshell ssh-proxy --gateway-name ${GATEWAY} --name ${SANDBOX} --workspace default\n\nHost keep-me\n    User bob\n`,
  );

  const removed = await sshConfig.removeHost(SANDBOX, GATEWAY);

  expect(removed).toBe(1);
  const managedConfig = await readManagedConfig();
  expect(managedConfig).not.toContain('my-custom-alias');
  expect(managedConfig).toBe('Host keep-me\n    User bob\n');
});

test('removes a block whose ProxyCommand executable is quoted', async () => {
  const spacedBinary = '/Applications/My Apps/Kaiden.app/openshell';
  const block = HOST_BLOCK.replace(OPEN_SHELL_BINARY, `'${spacedBinary}'`);
  await sshConfig.installHost(HOST_ALIAS, block, GATEWAY);

  expect(await sshConfig.removeHost(SANDBOX, GATEWAY)).toBe(1);
  expect(await readManagedConfig()).toBe('');
});

test('removes nothing when no block targets the sandbox', async () => {
  await sshConfig.installHost(HOST_ALIAS, HOST_BLOCK, GATEWAY);

  expect(await sshConfig.removeHost('unknown-sandbox', GATEWAY)).toBe(0);
  expect(await readManagedConfig()).toBe(`${HOST_BLOCK}\n`);
});

test('removes nothing when the managed config does not exist', async () => {
  expect(await sshConfig.removeHost(SANDBOX, GATEWAY)).toBe(0);
  await expect(readManagedConfig()).rejects.toThrow(/ENOENT/);
});
