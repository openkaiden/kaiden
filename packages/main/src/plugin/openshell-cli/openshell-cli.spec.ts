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
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

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
const sdkClientManager = { getClient: vi.fn() };

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
  openshellCli = new OpenshellCli(exec, cliToolRegistry, sdkClientManager as never);
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

describe('createSandbox', () => {
  test('executes openshell sandbox create with defaults', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'create'], undefined);
  });

  test('includes --name flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ name: 'my-sandbox' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--name', 'my-sandbox'],
      undefined,
    );
  });

  test('includes --from flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ from: 'python' });

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'create', '--from', 'python'], undefined);
  });

  test('includes -g flag and gateway label when gateway is provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ gateway: 'my-gw' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '-g', 'my-gw', '--label', 'gateway=my-gw'],
      undefined,
    );
  });

  test('includes resource flags when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ gpu: true, cpu: '2', memory: '4Gi' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--gpu', '--cpu', '2', '--memory', '4Gi'],
      undefined,
    );
  });

  test('includes --provider flags when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ providers: ['openai', 'anthropic'] });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--provider', 'openai', '--provider', 'anthropic'],
      undefined,
    );
  });

  test('includes repeatable --env flags when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ env: { API_KEY: 'sk-test', DEBUG: '1' } });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--env', 'API_KEY=sk-test', '--env', 'DEBUG=1'],
      undefined,
    );
  });

  test('includes --label flags when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ labels: { env: 'dev', team: 'platform' } });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--label', 'env=dev', '--label', 'team=platform'],
      undefined,
    );
  });

  test('includes single --upload flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({
      uploads: [{ local: '.agents/skills', remote: '.agents/skills' }],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--upload', '.agents/skills:.agents/skills'],
      undefined,
    );
  });

  test('includes multiple --upload flags when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({
      uploads: [
        { local: '.agents/skills/generate-sandbox-policy', remote: '.agents/skills/generate-sandbox-policy' },
        { local: '.agents/skills/openshell-cli', remote: '.agents/skills/openshell-cli' },
      ],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      [
        'sandbox',
        'create',
        '--upload',
        '.agents/skills/generate-sandbox-policy:.agents/skills/generate-sandbox-policy',
        '--upload',
        '.agents/skills/openshell-cli:.agents/skills/openshell-cli',
      ],
      undefined,
    );
  });

  test('places --upload flags before -- command separator', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({
      uploads: [{ local: '.agents/skills', remote: '.agents/skills' }],
      command: ['bash'],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--upload', '.agents/skills:.agents/skills', '--', 'bash'],
      undefined,
    );
  });

  test('redacts --env values in logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ env: { API_KEY: 'sk-secret-123' } });

    const executingLog = logSpy.mock.calls.find(c => String(c[0]).startsWith('Executing:'));
    expect(executingLog).toBeDefined();
    const loggedMessage = executingLog![0] as string;
    expect(loggedMessage).not.toContain('sk-secret-123');
    expect(loggedMessage).toContain('--env');
    expect(loggedMessage).toContain('***');
  });

  test('places --env flags before -- command separator', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({
      env: { API_KEY: 'sk-test' },
      command: ['bash'],
    });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--env', 'API_KEY=sk-test', '--', 'bash'],
      undefined,
    );
  });

  test('appends command after -- separator', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ command: ['bash', '-c', 'echo hello'] });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--', 'bash', '-c', 'echo hello'],
      undefined,
    );
  });

  test('passes --no-tty before command when noTty is true', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ noTty: true, command: ['true'] });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--no-tty', '--', 'true'],
      undefined,
    );
  });

  test('includes --policy flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.createSandbox({ policy: '/tmp/policy.yaml' });

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'create', '--policy', '/tmp/policy.yaml'],
      undefined,
    );
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('no active gateway'));

    await expect(openshellCli.createSandbox()).rejects.toThrow('no active gateway');
  });

  test('extracts JSON error from stdout on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'gateway connection refused' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(openshellCli.createSandbox()).rejects.toThrow('gateway connection refused');
  });

  test('extracts JSON error from stderr on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stderr: JSON.stringify({ error: 'stderr json error' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(openshellCli.createSandbox()).rejects.toThrow('stderr json error');
  });

  test('prefers stdout JSON error over stderr JSON error', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'stdout error' }),
      stderr: JSON.stringify({ error: 'stderr error' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(openshellCli.createSandbox()).rejects.toThrow('stdout error');
  });

  test('augments err.message with raw stderr when not JSON', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      message: 'command failed',
      stderr: 'permission denied',
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(openshellCli.createSandbox()).rejects.toThrow('command failed (stderr: permission denied)');
  });

  test('augments err.message with raw stdout when stderr is empty', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      message: 'command failed',
      stdout: 'unexpected output',
      stderr: '',
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(openshellCli.createSandbox()).rejects.toThrow('command failed (stdout: unexpected output)');
  });
});

describe('updatePolicy', () => {
  test('sets a sandbox-scoped network policy through the SDK', async () => {
    const setPolicy = vi.fn();
    const getConfig = vi.fn().mockResolvedValue({ policy: undefined });
    sdkClientManager.getClient.mockResolvedValue({ sandbox: { getConfig, setPolicy } });

    await openshellCli.updatePolicy('my-sandbox', ['api.example.com:443:full:rest', 'host.local:11434']);

    expect(setPolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.objectContaining({
        version: 1,
        networkPolicies: {
          'kdn-network': expect.objectContaining({
            endpoints: [
              expect.objectContaining({ host: 'api.example.com', port: 443, access: 'full', protocol: 'rest' }),
              expect.objectContaining({ host: 'host.local', port: 11434 }),
            ],
          }),
        },
      }),
      { wait: true },
    );
  });

  test('includes binaries in the SDK policy', async () => {
    const setPolicy = vi.fn();
    const getConfig = vi.fn().mockResolvedValue({ policy: undefined });
    sdkClientManager.getClient.mockResolvedValue({ sandbox: { getConfig, setPolicy } });

    await openshellCli.updatePolicy('my-sandbox', ['api.example.com:443'], ['/**']);

    expect(setPolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.objectContaining({
        networkPolicies: {
          'kdn-network': expect.objectContaining({ binaries: [{ path: '/**' }] }),
        },
      }),
      { wait: true },
    );
  });

  test('preserves existing policy fields and targets the selected gateway', async () => {
    const setPolicy = vi.fn();
    const existingRule = { name: 'existing', endpoints: [], binaries: [] };
    const getConfig = vi.fn().mockResolvedValue({
      policy: {
        version: 1,
        filesystem: { includeWorkdir: true },
        networkPolicies: { existing: existingRule },
        networkMiddlewares: { audit: { name: 'audit', middleware: 'audit' } },
      },
    });
    sdkClientManager.getClient.mockResolvedValue({ sandbox: { getConfig, setPolicy } });

    await openshellCli.updatePolicy('my-sandbox', ['api.example.com:443'], ['/**'], 'remote');

    expect(sdkClientManager.getClient).toHaveBeenCalledWith('remote');
    expect(getConfig).toHaveBeenCalledWith('my-sandbox');
    expect(setPolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.objectContaining({
        filesystem: { includeWorkdir: true },
        networkPolicies: {
          existing: existingRule,
          'kdn-network': expect.any(Object),
        },
        networkMiddlewares: { audit: { name: 'audit', middleware: 'audit' } },
      }),
      { wait: true },
    );
  });
});

describe('listSandboxes', () => {
  test('executes openshell sandbox list with json output', async () => {
    const payload = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    const result = await openshellCli.listSandboxes();

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'list', '-o', 'json'], undefined);
    expect(result).toEqual(payload);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(openshellCli.listSandboxes()).rejects.toThrow('command not found');
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

describe('deleteSandbox', () => {
  test('executes openshell sandbox delete with name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.deleteSandbox('my-sandbox');

    expect(exec.exec).toHaveBeenCalledWith(OPENSHELL_CLI_PATH, ['sandbox', 'delete', 'my-sandbox'], undefined);
  });

  test('includes -g flag when gateway is provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(''));

    await openshellCli.deleteSandbox('my-sandbox', 'remote-gateway');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'delete', 'my-sandbox', '-g', 'remote-gateway'],
      undefined,
    );
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sandbox not found: unknown'));

    await expect(openshellCli.deleteSandbox('unknown')).rejects.toThrow('sandbox not found: unknown');
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

    await openshellCli.uploadToSandbox('my-sandbox', '/local/image.png', '/tmp/kaiden-attachments/abc');

    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'upload', 'my-sandbox', '/local/image.png', '/tmp/kaiden-attachments/abc'],
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

describe('listSandboxesForGateway', () => {
  test('lists sandboxes for a specific gateway using -g flag', async () => {
    const gateways = [
      { name: 'gw-1', endpoint: 'https://gw1.example.com', active: true },
      { name: 'gw-2', endpoint: 'https://gw2.example.com', active: false },
    ];
    const sandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(sandboxes)));

    const result = await openshellCli.listSandboxesForGateway('gw-2');

    expect(result.gateway.name).toBe('gw-2');
    expect(result.sandboxes).toEqual(sandboxes);
    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'list', '-g', 'gw-2', '-o', 'json'],
      undefined,
    );
    expect(exec.exec).not.toHaveBeenCalledWith(OPENSHELL_CLI_PATH, expect.arrayContaining(['gateway', 'select']));
  });

  test('throws when gateway is not found', async () => {
    const gateways = [{ name: 'gw-1', endpoint: 'https://gw1.example.com', active: true }];
    vi.mocked(exec.exec).mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)));

    await expect(openshellCli.listSandboxesForGateway('unknown')).rejects.toThrow('Gateway not found: unknown');
  });
});

describe('listSandboxesPerGateway', () => {
  test('returns sandboxes for each gateway using -g flag', async () => {
    const gateways = [
      { name: 'gw-1', endpoint: 'https://gw1.example.com', active: true },
      { name: 'gw-2', endpoint: 'https://gw2.example.com', active: false },
    ];
    const sandboxes1 = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];
    const sandboxes2 = [{ id: 'sb-2', name: 'sb-2', phase: 'Unknown' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(sandboxes1)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(sandboxes2)));

    const results = await openshellCli.listSandboxesPerGateway();

    expect(results).toHaveLength(2);
    const [first, second] = results;
    expect(first?.gateway.name).toBe('gw-1');
    expect(first?.sandboxes).toEqual(sandboxes1);
    expect(second?.gateway.name).toBe('gw-2');
    expect(second?.sandboxes).toEqual(sandboxes2);
    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'list', '-g', 'gw-1', '-o', 'json'],
      undefined,
    );
    expect(exec.exec).toHaveBeenCalledWith(
      OPENSHELL_CLI_PATH,
      ['sandbox', 'list', '-g', 'gw-2', '-o', 'json'],
      undefined,
    );
    expect(exec.exec).not.toHaveBeenCalledWith(OPENSHELL_CLI_PATH, expect.arrayContaining(['gateway', 'select']));
  });

  test('returns empty array when no gateways exist', async () => {
    vi.mocked(exec.exec).mockResolvedValueOnce(mockExecResult(JSON.stringify([])));

    const results = await openshellCli.listSandboxesPerGateway();

    expect(results).toEqual([]);
  });

  test('returns empty sandboxes for a gateway that fails to list', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const gateways = [{ name: 'gw-1', endpoint: 'https://gw1.example.com', active: true }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockRejectedValueOnce(new Error('connection refused'));

    const results = await openshellCli.listSandboxesPerGateway();

    expect(results).toHaveLength(1);
    expect(results.at(0)?.sandboxes).toEqual([]);
  });
});

describe('listSandboxesPerGateway transitional auto-refresh', () => {
  const gateways = [{ name: 'gw-1', endpoint: 'https://gw1.example.com', active: true }];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    openshellCli.dispose();
    vi.useRealTimers();
  });

  test('schedules re-list 5s after detecting a Deleting sandbox and fires emitter', async () => {
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];
    const readySandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();

    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([{ gateway: gateways[0], sandboxes: readySandboxes }]);
  });

  test('schedules re-list 5s after detecting a Provisioning sandbox and fires emitter', async () => {
    const provisioningSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Provisioning' }];
    const readySandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(provisioningSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();

    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([{ gateway: gateways[0], sandboxes: readySandboxes }]);
  });

  test('does not schedule poll when no sandbox is in a transitional state', async () => {
    const readySandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();
    await vi.advanceTimersByTimeAsync(10000);

    expect(listener).not.toHaveBeenCalled();
  });

  test('does not schedule a second timer if one is already pending', async () => {
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];
    const readySandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();
    await openshellCli.listSandboxesPerGateway();

    await vi.advanceTimersByTimeAsync(5000);

    expect(listener).toHaveBeenCalledOnce();
  });

  test('does not fire emitter when sandbox phases are unchanged', async () => {
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();
    await vi.advanceTimersByTimeAsync(5000);

    expect(listener).not.toHaveBeenCalled();
  });

  test('continues polling while transitional sandboxes remain and fires only on change', async () => {
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];
    const readySandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();

    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(5000);
    expect(listener).toHaveBeenCalledOnce();
  });

  test('handles errors in the polling re-list gracefully', async () => {
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      .mockRejectedValueOnce(new Error('connection lost'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();
    await vi.advanceTimersByTimeAsync(5000);

    expect(listener).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('transitional-poll refresh failed'));
  });

  test('dispose clears pending poll timer', async () => {
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.listSandboxesPerGateway();
    openshellCli.dispose();
    await vi.advanceTimersByTimeAsync(10000);

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('early and post-operation polls during createSandbox and deleteSandbox', () => {
  const gateways = [{ name: 'gw-1', endpoint: 'https://gw1.example.com', active: true }];

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    openshellCli.dispose();
    vi.useRealTimers();
  });

  test('createSandbox fires early poll at 500ms to catch Provisioning phase', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const provisioningSandboxes = [{ id: 'sb-new', name: 'sb-new', phase: 'Provisioning' }];

    let resolveCreate!: () => void;
    vi.mocked(exec.exec).mockReturnValueOnce(
      new Promise<{ command: string; stdout: string; stderr: string }>((r): void => {
        resolveCreate = (): void => r(mockExecResult(''));
      }),
    );

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(provisioningSandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    const createPromise = openshellCli.createSandbox({ name: 'sb-new' });

    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([{ gateway: gateways[0], sandboxes: provisioningSandboxes }]);

    resolveCreate();
    await createPromise;
  });

  test('createSandbox refreshes immediately when CLI completes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const readySandboxes = [{ id: 'sb-new', name: 'sb-new', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(''))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.createSandbox({ name: 'sb-new' });

    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([{ gateway: gateways[0], sandboxes: readySandboxes }]);
  });

  test('skips early poll when CLI finishes before 500ms', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const readySandboxes = [{ id: 'sb-new', name: 'sb-new', phase: 'Ready' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(''))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)))
      // delayed refresh at 500ms after CLI completes
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(readySandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.createSandbox({ name: 'sb-new' });

    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(15000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('createSandbox refreshes immediately on CLI failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sandboxes = [{ id: 'sb-new', name: 'sb-new', phase: 'Error' }];

    vi.mocked(exec.exec)
      .mockRejectedValueOnce(new Error('creation failed'))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(sandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await expect(openshellCli.createSandbox({ name: 'sb-new' })).rejects.toThrow('creation failed');

    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalledOnce();
  });

  test('deleteSandbox fires early poll at 500ms to catch Deleting phase', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];

    let resolveDelete!: () => void;
    vi.mocked(exec.exec).mockReturnValueOnce(
      new Promise<{ command: string; stdout: string; stderr: string }>((r): void => {
        resolveDelete = (): void => r(mockExecResult(''));
      }),
    );

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    const deletePromise = openshellCli.deleteSandbox('sb-1');

    expect(listener).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(listener).toHaveBeenCalledOnce();

    resolveDelete();
    await deletePromise;
  });

  test('deleteSandbox refreshes immediately when CLI completes', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(''))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify([])));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.deleteSandbox('sb-1');

    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([{ gateway: gateways[0], sandboxes: [] }]);
  });

  test('deleteSandbox fires delayed refresh 500ms after CLI completes to catch server lag', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const deletingSandboxes = [{ id: 'sb-1', name: 'sb-1', phase: 'Deleting' }];

    vi.mocked(exec.exec)
      .mockResolvedValueOnce(mockExecResult(''))
      // immediate refresh — server still shows Deleting
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(deletingSandboxes)))
      // delayed refresh at 500ms — sandbox gone
      .mockResolvedValueOnce(mockExecResult(JSON.stringify(gateways)))
      .mockResolvedValueOnce(mockExecResult(JSON.stringify([])));

    const listener = vi.fn();
    openshellCli.onDidSandboxListChange(listener);

    await openshellCli.deleteSandbox('sb-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith([{ gateway: gateways[0], sandboxes: deletingSandboxes }]);

    await vi.advanceTimersByTimeAsync(500);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith([{ gateway: gateways[0], sandboxes: [] }]);
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
  test('returns true when setting is globally enabled', async () => {
    const getGatewayConfig = vi.fn().mockResolvedValue({
      settings: { providers_v2_enabled: { value: { case: 'boolValue', value: true } } },
    });
    sdkClientManager.getClient.mockResolvedValue({ raw: { getGatewayConfig } });

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(true);
    expect(getGatewayConfig).toHaveBeenCalledWith({});
  });

  test('returns false when setting is unset', async () => {
    sdkClientManager.getClient.mockResolvedValue({
      raw: { getGatewayConfig: vi.fn().mockResolvedValue({ settings: {} }) },
    });

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(false);
  });

  test('returns false when command fails', async () => {
    sdkClientManager.getClient.mockRejectedValue(new Error('setting not found'));

    const result = await openshellCli.isV2ProviderEnabled();

    expect(result).toBe(false);
  });
});

describe('enableV2Provider', () => {
  test('updates the global setting through the raw SDK client', async () => {
    const updateConfig = vi.fn();
    sdkClientManager.getClient.mockResolvedValue({ raw: { updateConfig } });

    await openshellCli.enableV2Provider();

    expect(updateConfig).toHaveBeenCalledWith({
      global: true,
      settingKey: 'providers_v2_enabled',
      settingValue: { value: { case: 'boolValue', value: true } },
    });
  });

  test('rejects when SDK update fails', async () => {
    sdkClientManager.getClient.mockResolvedValue({
      raw: { updateConfig: vi.fn().mockRejectedValue(new Error('settings update failed')) },
    });

    await expect(openshellCli.enableV2Provider()).rejects.toThrow('settings update failed');
  });
});
