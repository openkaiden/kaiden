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

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { KdnCli } from '/@/plugin/kdn-cli/kdn-cli.js';
import type { Exec } from '/@/plugin/util/exec.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { SecretCreateOptions, SecretInfo } from '/@api/secret-info.js';

import { SecretManager } from './secret-manager.js';

vi.mock(import('/@/plugin/kdn-cli/kdn-cli.js'));

const TEST_SECRETS: SecretInfo[] = [
  { name: 'my-secret', type: 'github', description: 'GitHub token' },
  {
    name: 'my-other-secret',
    type: 'other',
    description: 'a secret for example.com API',
    envs: ['EXAMPLE_API_KEY'],
    hosts: ['api.example.com'],
    path: '/',
    header: 'Authorization',
    headerTemplate: 'Bearer ${value}',
  },
];

let manager: SecretManager;

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};
const ipcHandle: IPCHandle = vi.fn();
const kdnCli = new KdnCli({} as Exec, {} as CliToolRegistry);

beforeEach(() => {
  vi.resetAllMocks();
  manager = new SecretManager(apiSender, ipcHandle, kdnCli);
  manager.init();
});

describe('init', () => {
  test('registers IPC handler for create', () => {
    expect(ipcHandle).toHaveBeenCalledWith('secret-manager:create', expect.any(Function));
  });

  test('registers IPC handler for list', () => {
    expect(ipcHandle).toHaveBeenCalledWith('secret-manager:list', expect.any(Function));
  });

  test('registers IPC handler for remove', () => {
    expect(ipcHandle).toHaveBeenCalledWith('secret-manager:remove', expect.any(Function));
  });
});

describe('create', () => {
  const defaultOptions: SecretCreateOptions = {
    name: 'my-secret',
    type: 'github',
    value: 'ghp_abc123',
  };

  test('delegates to kdnCli.createSecret and returns the secret name', async () => {
    vi.mocked(kdnCli.createSecret).mockResolvedValue({ name: 'my-secret' });

    const result = await manager.create(defaultOptions);

    expect(kdnCli.createSecret).toHaveBeenCalledWith(defaultOptions);
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('emits secret-manager-update event', async () => {
    vi.mocked(kdnCli.createSecret).mockResolvedValue({ name: 'my-secret' });

    await manager.create(defaultOptions);

    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });

  test('rejects when kdnCli.createSecret fails', async () => {
    vi.mocked(kdnCli.createSecret).mockRejectedValue(new Error('secret already exists: my-secret'));

    await expect(manager.create(defaultOptions)).rejects.toThrow('secret already exists: my-secret');
  });
});

describe('list', () => {
  test('delegates to kdnCli.listSecrets and returns the result', async () => {
    vi.mocked(kdnCli.listSecrets).mockResolvedValue(TEST_SECRETS);

    const result = await manager.list();

    expect(kdnCli.listSecrets).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['my-secret', 'my-other-secret']);
  });

  test('rejects when kdnCli.listSecrets fails', async () => {
    vi.mocked(kdnCli.listSecrets).mockRejectedValue(new Error('command not found'));

    await expect(manager.list()).rejects.toThrow('command not found');
  });
});

describe('remove', () => {
  test('delegates to kdnCli.removeSecret and returns the secret name', async () => {
    vi.mocked(kdnCli.removeSecret).mockResolvedValue({ name: 'my-secret' });

    const result = await manager.remove('my-secret');

    expect(kdnCli.removeSecret).toHaveBeenCalledWith('my-secret');
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('emits secret-manager-update event', async () => {
    vi.mocked(kdnCli.removeSecret).mockResolvedValue({ name: 'my-secret' });

    await manager.remove('my-secret');

    expect(apiSender.send).toHaveBeenCalledWith('secret-manager-update');
  });

  test('rejects when kdnCli.removeSecret fails', async () => {
    vi.mocked(kdnCli.removeSecret).mockRejectedValue(new Error('secret not found: unknown'));

    await expect(manager.remove('unknown')).rejects.toThrow('secret not found: unknown');
  });
});
