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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RunResult } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Proxy } from '/@/plugin/proxy.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';

import { OpenshellCli } from './openshell-cli.js';

vi.mock(import('node:fs'));
vi.mock(import('/@/plugin/util/exec.js'));

const OPENSHELL_CLI_PATH = '/usr/local/bin/openshell';

let openshellCli: OpenshellCli;

const exec = new Exec({} as Proxy);
const cliToolRegistry = {
  getCliToolInfos: vi.fn().mockReturnValue([{ name: 'openshell', path: OPENSHELL_CLI_PATH }]),
} as unknown as CliToolRegistry;

function mockExecResult(stdout: string): RunResult {
  return { command: OPENSHELL_CLI_PATH, stdout, stderr: '' };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
    { name: 'openshell', path: OPENSHELL_CLI_PATH },
  ] as unknown as CliToolInfo[]);
  openshellCli = new OpenshellCli(exec, cliToolRegistry);
});

describe('getCliPath', () => {
  test('returns path from CLI tool registry', () => {
    expect(openshellCli.getCliPath()).toBe(OPENSHELL_CLI_PATH);
  });

  test('falls back to bundled binary when no CLI tool is registered', () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([]);
    Object.defineProperty(process, 'resourcesPath', { value: '/app/resources', configurable: true });
    vi.mocked(existsSync).mockReturnValue(true);

    expect(openshellCli.getCliPath()).toBe(join('/app/resources', 'openshell', 'openshell'));

    Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true });
  });

  test('falls back to bundled binary when tool has no path', () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([{ name: 'openshell' }] as unknown as CliToolInfo[]);
    Object.defineProperty(process, 'resourcesPath', { value: '/app/resources', configurable: true });
    vi.mocked(existsSync).mockReturnValue(true);

    expect(openshellCli.getCliPath()).toBe(join('/app/resources', 'openshell', 'openshell'));

    Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true });
  });

  test('falls back to bare openshell when no registry and no bundled binary', () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([]);
    Object.defineProperty(process, 'resourcesPath', { value: undefined, configurable: true });

    expect(openshellCli.getCliPath()).toBe('openshell');
  });
});

describe('getVersion', () => {
  test('executes openshell --version and returns trimmed output', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('openshell 0.0.52\n'));

    const result = await openshellCli.getVersion();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['--version']);
    expect(result).toBe('openshell 0.0.52');
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(openshellCli.getVersion()).rejects.toThrow('command not found');
  });
});

describe('startSandbox', () => {
  test('executes openshell sandbox start with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.startSandbox('my-sandbox');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'start', 'my-sandbox'], undefined);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sandbox not found: unknown'));

    await expect(openshellCli.startSandbox('unknown')).rejects.toThrow('sandbox not found: unknown');
  });
});

describe('stopSandbox', () => {
  test('executes openshell sandbox stop with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.stopSandbox('my-sandbox');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'stop', 'my-sandbox'], undefined);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sandbox not found: unknown'));

    await expect(openshellCli.stopSandbox('unknown')).rejects.toThrow('sandbox not found: unknown');
  });
});

describe('deleteAllSandboxes', () => {
  test('executes openshell sandbox delete --all', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.deleteAllSandboxes();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'delete', '--all'], undefined);
  });

  test('includes -g flag when gateway is provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.deleteAllSandboxes('my-gw');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'delete', '--all', '-g', 'my-gw'],
      undefined,
    );
  });
});

describe('connectSandbox', () => {
  test('executes openshell sandbox connect with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.connectSandbox('my-sandbox');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'connect', 'my-sandbox'], undefined);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sandbox not found: unknown'));

    await expect(openshellCli.connectSandbox('unknown')).rejects.toThrow('sandbox not found: unknown');
  });
});

describe('uploadToSandbox', () => {
  test('executes openshell sandbox upload with name, path, and dest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.uploadToSandbox('my-sandbox', '/local/image.png', '/sandbox/.kaiden-attachments/abc');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'upload', 'my-sandbox', '/local/image.png', '/sandbox/.kaiden-attachments/abc'],
      undefined,
    );
  });

  test('passes gateway flag when gatewayName is provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.uploadToSandbox('my-sandbox', '/local/image.png', '/tmp/attachments/', 'my-gateway');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'upload', 'my-sandbox', '/local/image.png', '/tmp/attachments/', '-g', 'my-gateway'],
      undefined,
    );
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sandbox not found: unknown'));

    await expect(openshellCli.uploadToSandbox('unknown', '/local/file', '/tmp')).rejects.toThrow(
      'sandbox not found: unknown',
    );
  });
});

describe('setInference', () => {
  test('executes inference set with provider and model', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.setInference({ provider: 'my-vertex', model: 'claude-sonnet-4-20250514' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['inference', 'set', '--provider', 'my-vertex', '--model', 'claude-sonnet-4-20250514', '--no-verify'],
      undefined,
    );
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('provider not found'));

    await expect(openshellCli.setInference({ provider: 'unknown', model: 'model' })).rejects.toThrow(
      'provider not found',
    );
  });
});

describe('isV2ProviderEnabled', () => {
  const GLOBAL_SETTINGS = {
    scope: 'global',
    settings: {
      agent_policy_proposals_enabled: '<unset>',
      ocsf_json_enabled: '<unset>',
      proposal_approval_mode: '<unset>',
      providers_v2_enabled: '<unset>',
    },
    settings_revision: 0,
  };

  test('returns true when setting is globally enabled', async () => {
    vi.mocked(exec.exec).mockResolvedValue(
      mockExecResult(
        JSON.stringify({ ...GLOBAL_SETTINGS, settings: { ...GLOBAL_SETTINGS.settings, providers_v2_enabled: true } }),
      ),
    );

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['settings', 'get', '--global', '--json']);
  });

  test('returns true when value is string "true"', async () => {
    vi.mocked(exec.exec).mockResolvedValue(
      mockExecResult(
        JSON.stringify({ ...GLOBAL_SETTINGS, settings: { ...GLOBAL_SETTINGS.settings, providers_v2_enabled: 'true' } }),
      ),
    );

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(true);
  });

  test('returns false when setting is unset', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(GLOBAL_SETTINGS)));

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(false);
  });

  test('returns false when command fails', async () => {
    vi.mocked(exec.exec).mockRejectedValue(new Error('setting not found'));

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(false);
  });
});

describe('enableV2Provider', () => {
  test('executes settings set with --global flag', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.enableV2Provider();

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['settings', 'set', '--global', '--key', 'providers_v2_enabled', '--value', 'true', '--yes'],
      undefined,
    );
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('settings update failed'));

    await expect(openshellCli.enableV2Provider()).rejects.toThrow('settings update failed');
  });
});
