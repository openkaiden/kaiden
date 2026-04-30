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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunError, RunResult } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Proxy } from '/@/plugin/proxy.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { AgentWorkspaceCreateOptions, AgentWorkspaceSummary } from '/@api/agent-workspace-info.js';
import type { CliToolInfo } from '/@api/cli-tool-info.js';
import type { SecretCreateOptions, SecretInfo, SecretService } from '/@api/secret-info.js';

import { KdnCli } from './kdn-cli.js';

vi.mock(import('/@/plugin/util/exec.js'));
vi.mock(import('node:fs/promises'));

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
    timestamps: { created: 1700000000 },
  },
  {
    id: 'ws-2',
    name: 'test-workspace-2',
    project: 'project-beta',
    agent: 'coder-v2',
    state: 'running',
    paths: { source: '/tmp/ws2', configuration: '/tmp/ws2/.kaiden' },
    timestamps: { created: 1700000001, started: 1700000002 },
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

    const result = await kdnCli.createWorkspace(defaultOptions);

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

    await kdnCli.createWorkspace({ sourcePath: '/tmp/my-project', agent: 'claude' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--runtime', 'podman']));
  });

  test('includes optional name flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.createWorkspace({ ...defaultOptions, name: 'my-workspace' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--name', 'my-workspace']));
  });

  test('includes optional project flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.createWorkspace({ ...defaultOptions, project: 'my-project' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--project', 'my-project']));
  });

  test('rejects when source directory does not exist', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('sources directory does not exist: /tmp/not-found'));

    await expect(kdnCli.createWorkspace({ ...defaultOptions, sourcePath: '/tmp/not-found' })).rejects.toThrow(
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

    await expect(kdnCli.createWorkspace(defaultOptions)).rejects.toThrow(
      'failed to create runtime instance: exit status 125',
    );
  });

  test('writes workspace.json with skills before calling kdn init', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.createWorkspace({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes', '/home/user/.kaiden/skills/code-review'],
    });

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes', '/home/user/.kaiden/skills/code-review']);
    expect(exec.exec).toHaveBeenCalled();
  });

  test('does not write workspace.json when no skills provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.createWorkspace(defaultOptions);

    expect(writeFile).not.toHaveBeenCalled();
  });

  test('merges skills into existing workspace.json', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcp: { servers: [] } }));
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-new' })));

    await kdnCli.createWorkspace({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes'],
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcp).toEqual({ servers: [] });
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes']);
  });
});

describe('list', () => {
  test('executes kdn workspace list and returns items', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SUMMARIES })));

    const result = await kdnCli.listWorkspaces();

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, ['workspace', 'list', '--output', 'json'], undefined);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['ws-1', 'ws-2']);
  });

  test('returns summaries with expected CLI fields', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SUMMARIES })));

    const summary = (await kdnCli.listWorkspaces())[0]!;

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

    const summary = (await kdnCli.listWorkspaces())[1]!;

    expect(summary.model).toBeUndefined();
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(kdnCli.listWorkspaces()).rejects.toThrow('command not found');
  });
});

describe('remove', () => {
  test('executes kdn workspace remove and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-1' })));

    const result = await kdnCli.removeWorkspaces('ws-1');

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

    await expect(kdnCli.removeWorkspaces('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('start', () => {
  test('executes kdn workspace start and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-1' })));

    const result = await kdnCli.startWorkspace('ws-1');

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

    await expect(kdnCli.startWorkspace('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('stop', () => {
  test('executes kdn workspace stop and returns the workspace id', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ id: 'ws-1' })));

    const result = await kdnCli.stopWorkspace('ws-1');

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

    await expect(kdnCli.stopWorkspace('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('createSecret', () => {
  const defaultOptions: SecretCreateOptions = {
    name: 'my-secret',
    type: 'github',
    value: 'ghp_abc123',
  };

  test('executes kdn secret create with required flags and returns the secret name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    const result = await kdnCli.createSecret(defaultOptions);

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      ['secret', 'create', 'my-secret', '--type', 'github', '--value', 'ghp_abc123', '--output', 'json'],
      undefined,
    );
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('includes optional description flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    await kdnCli.createSecret({ ...defaultOptions, description: 'GitHub token' });

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      expect.arrayContaining(['--description', 'GitHub token']),
      undefined,
    );
  });

  test('includes optional host flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    await kdnCli.createSecret({ ...defaultOptions, type: 'other', hosts: ['api.example.com'] });

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      expect.arrayContaining(['--host', 'api.example.com']),
      undefined,
    );
  });

  test('includes optional header flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    await kdnCli.createSecret({ ...defaultOptions, type: 'other', header: 'Authorization' });

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      expect.arrayContaining(['--header', 'Authorization']),
      undefined,
    );
  });

  test('includes optional header-template flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    await kdnCli.createSecret({ ...defaultOptions, type: 'other', headerTemplate: 'Bearer ${value}' });

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      expect.arrayContaining(['--header-template', 'Bearer ${value}']),
      undefined,
    );
  });

  test('includes optional path flag when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    await kdnCli.createSecret({ ...defaultOptions, type: 'other', path: '/api/v1' });

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, expect.arrayContaining(['--path', '/api/v1']), undefined);
  });

  test('repeats env flag for each entry in the array', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    await kdnCli.createSecret({ ...defaultOptions, type: 'other', envs: ['API_KEY', 'SECRET_KEY'] });

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      expect.arrayContaining(['--env', 'API_KEY', '--env', 'SECRET_KEY']),
      undefined,
    );
  });

  test('extracts kdn JSON error from stdout on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'Error: secret already exists: my-secret' }),
    });
    vi.spyOn(exec, 'exec').mockRejectedValue(runError);

    await expect(kdnCli.createSecret(defaultOptions)).rejects.toThrow('Error: secret already exists: my-secret');
  });
});

describe('listSecrets', () => {
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

  test('executes kdn secret list and returns items', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SECRETS })));

    const result = await kdnCli.listSecrets();

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, ['secret', 'list', '--output', 'json'], undefined);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['my-secret', 'my-other-secret']);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(kdnCli.listSecrets()).rejects.toThrow('command not found');
  });
});

describe('removeSecret', () => {
  test('executes kdn secret remove and returns the secret name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ name: 'my-secret' })));

    const result = await kdnCli.removeSecret('my-secret');

    expect(exec.exec).toHaveBeenCalledWith(
      KAIDEN_CLI_PATH,
      ['secret', 'remove', 'my-secret', '--output', 'json'],
      undefined,
    );
    expect(result).toEqual({ name: 'my-secret' });
  });

  test('rejects when CLI fails for unknown name', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('secret not found: unknown'));

    await expect(kdnCli.removeSecret('unknown')).rejects.toThrow('secret not found: unknown');
  });
});

describe('listServices', () => {
  const TEST_SERVICES: SecretService[] = [
    {
      name: 'github',
      hostPattern: 'api.github.com',
      headerName: 'Authorization',
      headerTemplate: 'Bearer ${value}',
      envVars: ['GH_TOKEN', 'GITHUB_TOKEN'],
    },
    {
      name: 'gitlab',
      hostPattern: 'gitlab.com',
      headerName: 'PRIVATE-TOKEN',
    },
  ];

  test('executes kdn service list and returns services', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SERVICES })));

    const result = await kdnCli.listServices();

    expect(exec.exec).toHaveBeenCalledWith(KAIDEN_CLI_PATH, ['service', 'list', '--output', 'json'], undefined);
    expect(result).toHaveLength(2);
    expect(result.map(s => s.name)).toEqual(['github', 'gitlab']);
  });

  test('returns services with optional fields when present', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SERVICES })));

    const result = await kdnCli.listServices();

    expect(result[0]).toEqual({
      name: 'github',
      hostPattern: 'api.github.com',
      headerName: 'Authorization',
      headerTemplate: 'Bearer ${value}',
      envVars: ['GH_TOKEN', 'GITHUB_TOKEN'],
    });
  });

  test('returns services without optional fields when omitted', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: TEST_SERVICES })));

    const result = await kdnCli.listServices();

    expect(result[1]!.headerTemplate).toBeUndefined();
    expect(result[1]!.envVars).toBeUndefined();
  });

  test('returns empty array when CLI returns no services', async () => {
    vi.mocked(exec.exec).mockResolvedValue(mockExecResult(JSON.stringify({ items: [] })));

    const result = await kdnCli.listServices();

    expect(result).toEqual([]);
  });

  test('rejects when CLI fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(exec.exec).mockRejectedValue(new Error('command not found'));

    await expect(kdnCli.listServices()).rejects.toThrow('command not found');
  });

  test('extracts kdn JSON error from stdout on failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const runError = mockRunError({
      stdout: JSON.stringify({ error: 'Error: failed to list secrets services' }),
    });
    vi.mocked(exec.exec).mockRejectedValue(runError);

    await expect(kdnCli.listServices()).rejects.toThrow('Error: failed to list secrets services');
  });
});
