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

import type { RunError, RunResult } from '@openkaiden/api';
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

function mockRunError(overrides: Partial<RunError> = {}): RunError {
  const err = new Error(overrides.message ?? 'Command execution failed with exit code 1') as RunError;
  err.exitCode = overrides.exitCode ?? 1;
  err.command = overrides.command ?? OPENSHELL_CLI_PATH;
  err.stdout = overrides.stdout ?? '';
  err.stderr = overrides.stderr ?? '';
  err.cancelled = overrides.cancelled ?? false;
  err.killed = overrides.killed ?? false;
  return err;
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

describe('addGateway', () => {
  test('executes gateway add with endpoint', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.addGateway({ endpoint: 'https://gw.example.com' });

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'add', 'https://gw.example.com'], undefined);
  });

  test('includes --name flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.addGateway({ endpoint: 'https://gw.example.com', name: 'my-gw' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['gateway', 'add', 'https://gw.example.com', '--name', 'my-gw'],
      undefined,
    );
  });

  test('includes --remote flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.addGateway({ endpoint: 'https://gw.example.com', remote: 'user@host' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['gateway', 'add', 'https://gw.example.com', '--remote', 'user@host'],
      undefined,
    );
  });

  test('includes --local flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.addGateway({ endpoint: 'https://127.0.0.1', local: true });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['gateway', 'add', 'https://127.0.0.1', '--local'],
      undefined,
    );
  });

  test('extracts JSON error from stdout on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'invalid endpoint' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(openshellCli.addGateway({ endpoint: 'bad' })).rejects.toThrow('invalid endpoint');
  });
});

describe('removeGateway', () => {
  test('executes gateway remove with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.removeGateway('my-gw');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'remove', 'my-gw'], undefined);
  });

  test('executes gateway remove without name for active gateway', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.removeGateway();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'remove'], undefined);
  });
});

describe('selectGateway', () => {
  test('executes gateway select with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.selectGateway('my-gw');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'select', 'my-gw'], undefined);
  });

  test('executes gateway select without name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.selectGateway();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'select'], undefined);
  });
});

describe('listGateways', () => {
  test('executes gateway list with json output and returns parsed result', async () => {
    const payload = [
      { name: 'gw-1', endpoint: 'https://gw1.example.com' },
      { name: 'gw-2', endpoint: 'https://gw2.example.com' },
    ];
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    const result = await openshellCli.listGateways();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'list', '-o', 'json'], undefined);
    expect(result).toEqual(payload);
  });
});

describe('getGatewayInfo', () => {
  test('executes gateway info with json output and returns parsed result', async () => {
    const payload = {
      compute_drivers: [
        {
          capabilities: { driver_name: 'podman', driver_version: '0.0.92' },
          name: 'podman',
        },
      ],
      status: 'healthy',
    };
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    const result = await openshellCli.getGatewayInfo();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['gateway', 'info', '-o', 'json'], undefined);
    expect(result).toEqual(payload);
  });

  test('gets runtime information for a named gateway', async () => {
    const payload = { compute_drivers: [], status: 'degraded' };
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    await expect(openshellCli.getGatewayInfo('remote')).resolves.toEqual(payload);

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['gateway', 'info', '-g', 'remote', '-o', 'json'],
      undefined,
    );
  });
});

describe('checkEndpointStatus', () => {
  test('returns true when endpoint is healthy', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));
    expect(await openshellCli.checkEndpointStatus('https://127.0.0.1:8443')).toBe(true);
    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['status', '--gateway-endpoint', 'https://127.0.0.1:8443'],
      undefined,
    );
  });

  test('returns false when endpoint is unreachable', async () => {
    vi.mocked(exec.exec).mockRejectedValue(new Error('connection refused'));
    expect(await openshellCli.checkEndpointStatus('http://127.0.0.1:17670')).toBe(false);
  });

  test('appends --gateway-insecure for http endpoints', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));
    await openshellCli.checkEndpointStatus('http://127.0.0.1:17670');
    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['status', '--gateway-endpoint', 'http://127.0.0.1:17670', '--gateway-insecure'],
      undefined,
    );
  });

  test('does not append --gateway-insecure for https endpoints', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));
    await openshellCli.checkEndpointStatus('https://127.0.0.1:8443');
    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      expect.not.arrayContaining(['--gateway-insecure']),
      undefined,
    );
  });
});

describe('getGatewayStatus', () => {
  test('executes status and returns trimmed output', async () => {
    const statusText = 'Server Status\n\n  Gateway: openshell\n  Status: Connected\n';
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(statusText));

    const result = await openshellCli.getGatewayStatus();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['status']);
    expect(result).toBe(statusText.trim());
  });

  test('rejects when no gateway is configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('no gateway configured'));

    await expect(openshellCli.getGatewayStatus()).rejects.toThrow('no gateway configured');
  });
});

describe('listProviders', () => {
  test('executes provider list with json output and returns parsed result', async () => {
    const payload = [
      { name: 'my-openai', type: 'openai' },
      { name: 'my-anthropic', type: 'anthropic' },
    ];
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    const result = await openshellCli.listProviders();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['provider', 'list', '-o', 'json'], undefined);
    expect(result).toEqual(payload);
  });

  test('returns empty array when no providers exist', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify([])));

    const result = await openshellCli.listProviders();

    expect(result).toEqual([]);
  });

  test('lists providers from the selected gateway', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify([])));

    await openshellCli.listProviders('remote');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['provider', 'list', '-g', 'remote', '-o', 'json'],
      undefined,
    );
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('no gateway configured'));

    await expect(openshellCli.listProviders()).rejects.toThrow('no gateway configured');
  });
});

describe('listProfiles', () => {
  test('executes provider list-profiles with json output and returns parsed result', async () => {
    const payload = [
      {
        id: 'openai',
        display_name: 'OpenAI',
        description: 'OpenAI API provider',
        credentials: [{ name: 'api_key', required: true, description: 'API key', env_vars: ['OPENAI_API_KEY'] }],
      },
      {
        id: 'anthropic',
        display_name: 'Anthropic',
        credentials: [{ name: 'api_key', required: true, env_vars: ['ANTHROPIC_API_KEY'] }],
      },
    ];
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    const result = await openshellCli.listProfiles();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['provider', 'list-profiles', '-o', 'json'], undefined);
    expect(result).toEqual(payload);
  });

  test('returns empty array when no profiles exist', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify([])));

    const result = await openshellCli.listProfiles();

    expect(result).toEqual([]);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('no gateway configured'));

    await expect(openshellCli.listProfiles()).rejects.toThrow('no gateway configured');
  });
});

describe('deleteProvider', () => {
  test('executes provider delete with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.deleteProvider('my-openai');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['provider', 'delete', 'my-openai'], undefined);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('provider not found: unknown'));

    await expect(openshellCli.deleteProvider('unknown')).rejects.toThrow('provider not found: unknown');
  });

  test('deletes provider from the selected gateway', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.deleteProvider('my-openai', 'remote');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['provider', 'delete', 'my-openai', '-g', 'remote'],
      undefined,
    );
  });
});

describe('createProvider', () => {
  test('creates provider on the selected gateway', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider(
      {
        name: 'my-openai',
        type: 'openai',
        credentials: { apiKey: 'sk-123' },
      },
      'remote',
    );

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['provider', 'create', '--name', 'my-openai', '--type', 'openai', '-g', 'remote', '--credential', 'apiKey'],
      {
        env: {
          apiKey: 'sk-123',
        },
      },
    );
  });

  test('executes provider create with name, type, and credentials', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-openai',
      type: 'openai',
      credentials: { apiKey: 'sk-123' },
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['provider', 'create', '--name', 'my-openai', '--type', 'openai', '--credential', 'apiKey'],
      {
        env: {
          apiKey: 'sk-123',
        },
      },
    );
  });

  test('includes multiple credential entries', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-provider',
      type: 'custom',
      credentials: { apiKey: 'key-1', secret: 'sec-2' },
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      [
        'provider',
        'create',
        '--name',
        'my-provider',
        '--type',
        'custom',
        '--credential',
        'apiKey',
        '--credential',
        'secret',
      ],
      {
        env: {
          apiKey: 'key-1',
          secret: 'sec-2',
        },
      },
    );
  });

  test('includes optional config keys', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-openai',
      type: 'openai',
      credentials: { apiKey: 'sk-123' },
      config: { model: 'gpt-4', temperature: '0.7' },
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      [
        'provider',
        'create',
        '--name',
        'my-openai',
        '--type',
        'openai',
        '--credential',
        'apiKey',
        '--config',
        'model=gpt-4',
        '--config',
        'temperature=0.7',
      ],
      {
        env: {
          apiKey: 'sk-123',
        },
      },
    );
  });

  test('rejects when credentials and flags are both empty', async () => {
    await expect(
      openshellCli.createProvider({
        name: 'my-openai',
        type: 'openai',
        credentials: {},
      }),
    ).rejects.toThrow('credentials must not be empty');

    expect(exec.exec).not.toHaveBeenCalled();
  });

  test('includes flag entries', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-vertex',
      type: 'google-vertex-ai',
      credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' },
      flags: ['--from-gcloud-adc'],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      [
        'provider',
        'create',
        '--name',
        'my-vertex',
        '--type',
        'google-vertex-ai',
        '--credential',
        'GOOGLE_APPLICATION_CREDENTIALS',
        '--from-gcloud-adc',
      ],
      {
        env: {
          GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json',
        },
      },
    );
  });

  test('accepts empty credentials when flags are provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-vertex',
      type: 'google-vertex-ai',
      credentials: {},
      flags: ['--from-gcloud-adc'],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['provider', 'create', '--name', 'my-vertex', '--type', 'google-vertex-ai', '--from-gcloud-adc'],
      { env: {} },
    );
  });

  test('merges options.env into credential env', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-vertex',
      type: 'google-vertex-ai',
      credentials: { GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json' },
      env: { GOOGLE_VERTEX_PROJECT: 'my-project' },
      flags: ['--from-gcloud-adc'],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      [
        'provider',
        'create',
        '--name',
        'my-vertex',
        '--type',
        'google-vertex-ai',
        '--credential',
        'GOOGLE_APPLICATION_CREDENTIALS',
        '--from-gcloud-adc',
      ],
      {
        env: {
          GOOGLE_VERTEX_PROJECT: 'my-project',
          GOOGLE_APPLICATION_CREDENTIALS: '/path/to/creds.json',
        },
      },
    );
  });

  test('redacts provider credential and configuration arguments in logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createProvider({
      name: 'my-openai',
      type: 'openai',
      credentials: { apiKey: 'sk-secret-123' },
      config: { model: 'gpt-4' },
    });

    expect(logSpy).toHaveBeenCalledWith(
      `Executing: ${OPENSHELL_CLI_PATH} provider create --name my-openai --type openai --credential *** --config ***`,
    );
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('apiKey'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('model=gpt-4'));
  });

  test('rejects when CLI fails', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('provider type not supported'));

    await expect(
      openshellCli.createProvider({
        name: 'bad',
        type: 'unsupported',
        credentials: { key: 'val' },
      }),
    ).rejects.toThrow('provider type not supported');

    expect(logSpy).toHaveBeenCalledWith(
      `Executing: ${OPENSHELL_CLI_PATH} provider create --name bad --type unsupported --credential ***`,
    );
    expect(errorSpy).toHaveBeenCalledWith(
      `openshell failed: ${OPENSHELL_CLI_PATH} provider create --name bad --type unsupported --credential *** — provider type not supported`,
    );
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('key'));
    expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('key'));
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
