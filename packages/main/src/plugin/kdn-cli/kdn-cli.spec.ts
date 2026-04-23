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

import type { RunError, RunResult } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Proxy } from '/@/plugin/proxy.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { AgentWorkspaceCreateOptions, AgentWorkspaceSummary } from '/@api/agent-workspace-info.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';

import { KdnCli } from './kdn-cli.js';

vi.mock(import('/@/plugin/util/exec.js'));

const KAIDEN_CLI_PATH = '/usr/local/bin/kdn';

const TEST_SUMMARIES: AgentWorkspaceSummary[] = [
  {
    id: 'ws-1',
    name: 'test-workspace-1',
    project: 'project-alpha',
    agent: 'coder-v1',
    state: 'stopped',
    model: 'gpt-4o',
    paths: { source: '/tmp/ws1', configuration: '/tmp/ws1/.kaiden' },
  },
  {
    id: 'ws-2',
    name: 'test-workspace-2',
    project: 'project-beta',
    agent: 'coder-v2',
    state: 'running',
    paths: { source: '/tmp/ws2', configuration: '/tmp/ws2/.kaiden' },
  },
];

let kdnCli: KdnCli;

const exec = new Exec({} as Proxy);
const cliToolRegistry = {
  getCliToolInfos: vi.fn().mockReturnValue([{ name: 'kdn', path: KAIDEN_CLI_PATH }]),
} as unknown as CliToolRegistry;

function mockExecResult(stdout: string): RunResult {
  return { command: KAIDEN_CLI_PATH, stdout, stderr: '' };
}

function mockRunError(overrides: Partial<RunError> = {}): RunError {
  const err = new Error(overrides.message ?? 'Command execution failed with exit code 1') as RunError;
  err.exitCode = overrides.exitCode ?? 1;
  err.command = overrides.command ?? KAIDEN_CLI_PATH;
  err.stdout = overrides.stdout ?? '';
  err.stderr = overrides.stderr ?? '';
  err.cancelled = overrides.cancelled ?? false;
  err.killed = overrides.killed ?? false;
  return err;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([
    { name: 'kdn', path: KAIDEN_CLI_PATH },
  ] as unknown as CliToolInfo[]);
  kdnCli = new KdnCli(exec, cliToolRegistry);
});

describe('getCliPath', () => {
  test('returns path from CLI tool registry', () => {
    expect(kdnCli.getCliPath()).toBe(KAIDEN_CLI_PATH);
  });

  test('falls back to kdn when no CLI tool is registered', () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([]);
    expect(kdnCli.getCliPath()).toBe('kdn');
  });

  test('falls back to kdn when tool has no path', () => {
    vi.mocked(cliToolRegistry.getCliToolInfos).mockReturnValue([{ name: 'kdn' }] as unknown as CliToolInfo[]);
    expect(kdnCli.getCliPath()).toBe('kdn');
  });
});

describe('getInfo', () => {
  test('executes kdn info and returns agents, runtimes, and version', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(
      mockExecResult(JSON.stringify({ version: '0.1.0', agents: ['claude', 'opencode'], runtimes: ['podman'] })),
    );

    const result = await kdnCli.getInfo();

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, ['info', '--output', 'json']);
    expect(result).toEqual({ version: '0.1.0', agents: ['claude', 'opencode'], runtimes: ['podman'] });
  });

  test('preserves extra fields from future CLI versions', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const payload = { version: '0.2.0', agents: ['opencode'], runtimes: ['podman'], newField: 'hello' };
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify(payload)));

    const result = await kdnCli.getInfo();

    expect(result).toEqual(payload);
  });

  test('returns defaults when CLI returns non-object response', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult('"unexpected string"'));

    const result = await kdnCli.getInfo();

    expect(result).toEqual({ version: '', agents: [], runtimes: [] });
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(kdnCli.getInfo()).rejects.toThrow('command not found');
  });

  test('extracts kdn JSON error from stdout on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'failed to read --storage flag' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(kdnCli.getInfo()).rejects.toThrow('failed to read --storage flag');
  });
});

describe('create', () => {
  const defaultOptions: AgentWorkspaceCreateOptions = {
    sourcePath: '/tmp/my-project',
    agent: 'claude',
    runtime: 'podman',
  };

  test('executes kdn init with required flags and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    const result = await kdnCli.create(defaultOptions);

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, [
      'init',
      '/tmp/my-project',
      '--runtime',
      'podman',
      '--agent',
      'claude',
      '--output',
      'json',
    ]);
    expect(result).toEqual({ id: 'ws-new' });
  });

  test('defaults runtime to podman when not specified', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.create({ sourcePath: '/tmp/my-project', agent: 'claude' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--runtime', 'podman']));
  });

  test('includes optional name flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.create({ ...defaultOptions, name: 'my-workspace' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--name', 'my-workspace']));
  });

  test('includes optional project flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.create({ ...defaultOptions, project: 'my-project' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--project', 'my-project']));
  });

  test('rejects when source directory does not exist', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sources directory does not exist: /tmp/not-found'));

    await expect(kdnCli.create({ ...defaultOptions, sourcePath: '/tmp/not-found' })).rejects.toThrow(
      'sources directory does not exist: /tmp/not-found',
    );
  });

  test('extracts kdn JSON error from stdout on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'failed to create runtime instance: exit status 125' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(kdnCli.create(defaultOptions)).rejects.toThrow('failed to create runtime instance: exit status 125');
  });
});

describe('list', () => {
  test('executes kdn workspace list and returns items', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SUMMARIES })));

    const result = await kdnCli.list();

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, ['workspace', 'list', '--output', 'json'], undefined);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['ws-1', 'ws-2']);
  });

  test('returns summaries with expected CLI fields', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SUMMARIES })));

    const summary = (await kdnCli.list())[0]!;

    expect(summary).toHaveProperty('id');
    expect(summary).toHaveProperty('name');
    expect(summary).toHaveProperty('project');
    expect(summary).toHaveProperty('agent');
    expect(summary).toHaveProperty('state');
    expect(summary).toHaveProperty('model');
    expect(summary).toHaveProperty('paths');
    expect(summary.paths).toHaveProperty('source');
    expect(summary.paths).toHaveProperty('configuration');
  });

  test('returns summaries without model when CLI omits it', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SUMMARIES })));

    const summary = (await kdnCli.list())[1]!;

    expect(summary.model).toBeUndefined();
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(kdnCli.list()).rejects.toThrow('command not found');
  });
});

describe('remove', () => {
  test('executes kdn workspace remove and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-1' })));

    const result = await kdnCli.remove('ws-1');

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      ['workspace', 'remove', 'ws-1', '--output', 'json'],
      undefined,
    );
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('rejects when CLI fails for unknown id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(kdnCli.remove('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('start', () => {
  test('executes kdn workspace start and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-1' })));

    const result = await kdnCli.start('ws-1');

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      ['workspace', 'start', 'ws-1', '--output', 'json'],
      undefined,
    );
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('rejects when CLI fails for unknown id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(kdnCli.start('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('stop', () => {
  test('executes kdn workspace stop and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-1' })));

    const result = await kdnCli.stop('ws-1');

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      ['workspace', 'stop', 'ws-1', '--output', 'json'],
      undefined,
    );
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('rejects when CLI fails for unknown id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(kdnCli.stop('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});
