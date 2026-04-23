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

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { FileSystemWatcher } from '@openkaiden/api';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { FilesystemMonitoring } from '/@/plugin/filesystem-monitoring.js';
import type { KdnCli } from '/@/plugin/kdn-cli/kdn-cli.js';
import type { TaskManager } from '/@/plugin/tasks/task-manager.js';
import type { Task } from '/@/plugin/tasks/tasks.js';
import type { AgentWorkspaceCreateOptions, AgentWorkspaceSummary } from '/@api/agent-workspace-info.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { TaskState, TaskStatus } from '/@api/taskInfo.js';

import { AgentWorkspaceManager } from './agent-workspace-manager.js';

vi.mock(import('node:fs/promises'));

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

let manager: AgentWorkspaceManager;

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};
const ipcHandle: IPCHandle = vi.fn();
const kdnCli = {
  getInfo: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  getCliPath: vi.fn(),
} as unknown as KdnCli;

const mockTask = {
  id: 'task-1',
  name: 'mock-task',
  started: Date.now(),
  state: '',
  status: '',
  error: '',
  cancellable: false,
  dispose: vi.fn(),
  onUpdate: vi.fn(),
} as unknown as Task;
const taskManager = {
  createTask: vi.fn().mockReturnValue(mockTask),
} as unknown as TaskManager;

const mockWatcher = {
  onDidChange: vi.fn(),
  onDidCreate: vi.fn(),
  onDidDelete: vi.fn(),
  dispose: vi.fn(),
} as unknown as FileSystemWatcher;
const filesystemMonitoring = {
  createFileSystemWatcher: vi.fn().mockReturnValue(mockWatcher),
} as unknown as FilesystemMonitoring;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(taskManager.createTask).mockReturnValue(mockTask);
  mockTask.state = '' as TaskState;
  mockTask.status = '' as TaskStatus;
  mockTask.error = '';
  vi.mocked(filesystemMonitoring.createFileSystemWatcher).mockReturnValue(mockWatcher);
  manager = new AgentWorkspaceManager(apiSender, ipcHandle, kdnCli, taskManager, filesystemMonitoring);
  manager.init();
});

describe('init', () => {
  test('registers IPC handler for create', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:create', expect.any(Function));
  });

  test('registers IPC handler for list', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:list', expect.any(Function));
  });

  test('registers IPC handler for remove', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:remove', expect.any(Function));
  });

  test('registers IPC handler for getConfiguration', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:getConfiguration', expect.any(Function));
  });

  test('registers IPC handler for start', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:start', expect.any(Function));
  });

  test('registers IPC handler for stop', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:stop', expect.any(Function));
  });

  test('registers IPC handler for getCliInfo', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:getCliInfo', expect.any(Function));
  });
});

describe('watchInstancesFile', () => {
  test('watches ~/.kdn/instances.json on init', () => {
    expect(filesystemMonitoring.createFileSystemWatcher).toHaveBeenCalledWith(
      expect.stringMatching(/\.kdn[\\/]instances\.json$/),
    );
  });

  test('sends agent-workspace-update on file change', () => {
    const changeCallback = vi.mocked(mockWatcher.onDidChange).mock.calls[0]![0] as () => void;
    changeCallback();
    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('sends agent-workspace-update on file create', () => {
    const createCallback = vi.mocked(mockWatcher.onDidCreate).mock.calls[0]![0] as () => void;
    createCallback();
    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('sends agent-workspace-update on file delete', () => {
    const deleteCallback = vi.mocked(mockWatcher.onDidDelete).mock.calls[0]![0] as () => void;
    deleteCallback();
    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('disposes watcher on dispose', () => {
    manager.dispose();
    expect(mockWatcher.dispose).toHaveBeenCalled();
  });
});

describe('getCliInfo', () => {
  test('delegates to kdnCli.getInfo', async () => {
    const expected = { version: '0.1.0', agents: ['claude'], runtimes: ['podman'] };
    vi.mocked(kdnCli.getInfo).mockResolvedValue(expected);

    const result = await manager.getCliInfo();

    expect(kdnCli.getInfo).toHaveBeenCalled();
    expect(result).toEqual(expected);
  });

  test('rejects when kdnCli.getInfo fails', async () => {
    vi.mocked(kdnCli.getInfo).mockRejectedValue(new Error('command not found'));

    await expect(manager.getCliInfo()).rejects.toThrow('command not found');
  });
});

describe('create', () => {
  const defaultOptions: AgentWorkspaceCreateOptions = {
    sourcePath: '/tmp/my-project',
    agent: 'claude',
    runtime: 'podman',
  };

  test('delegates to kdnCli.create and returns the workspace id', async () => {
    vi.mocked(kdnCli.create).mockResolvedValue({ id: 'ws-new' });

    const result = await manager.create(defaultOptions);

    expect(kdnCli.create).toHaveBeenCalledWith(defaultOptions);
    expect(result).toEqual({ id: 'ws-new' });
  });

  test('creates a task and sets success status on completion', async () => {
    vi.mocked(kdnCli.create).mockResolvedValue({ id: 'ws-new' });

    await manager.create(defaultOptions);

    expect(taskManager.createTask).toHaveBeenCalledWith({ title: 'Creating workspace' });
    expect(mockTask.status).toBe('success');
    expect(mockTask.state).toBe('completed');
  });

  test('sets task failure status when CLI fails', async () => {
    vi.mocked(kdnCli.create).mockRejectedValue(new Error('command not found'));

    await expect(manager.create(defaultOptions)).rejects.toThrow('command not found');

    expect(mockTask.status).toBe('failure');
    expect(mockTask.error).toContain('command not found');
    expect(mockTask.state).toBe('completed');
  });

  test('preserves error detail in task error message', async () => {
    vi.mocked(kdnCli.create).mockRejectedValue(new Error('failed to create runtime instance: exit status 125'));

    await expect(manager.create(defaultOptions)).rejects.toThrow('failed to create runtime instance: exit status 125');

    expect(mockTask.error).toBe('Failed to create workspace: failed to create runtime instance: exit status 125');
  });

  test('includes workspace name in task title when provided', async () => {
    vi.mocked(kdnCli.create).mockResolvedValue({ id: 'ws-new' });

    await manager.create({ ...defaultOptions, name: 'my-workspace' });

    expect(taskManager.createTask).toHaveBeenCalledWith({ title: 'Creating workspace "my-workspace"' });
  });

  test('emits agent-workspace-update event', async () => {
    vi.mocked(kdnCli.create).mockResolvedValue({ id: 'ws-new' });

    await manager.create(defaultOptions);

    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });
});

describe('list', () => {
  test('delegates to kdnCli.list and returns items', async () => {
    vi.mocked(kdnCli.list).mockResolvedValue(TEST_SUMMARIES);

    const result = await manager.list();

    expect(kdnCli.list).toHaveBeenCalled();
    expect(result).toHaveLength(2);
    expect(result.map(s => s.id)).toEqual(['ws-1', 'ws-2']);
  });

  test('rejects when kdnCli.list fails', async () => {
    vi.mocked(kdnCli.list).mockRejectedValue(new Error('command not found'));

    await expect(manager.list()).rejects.toThrow('command not found');
  });
});

describe('remove', () => {
  test('delegates to kdnCli.remove and returns the workspace id', async () => {
    vi.mocked(kdnCli.remove).mockResolvedValue({ id: 'ws-1' });

    const result = await manager.remove('ws-1');

    expect(kdnCli.remove).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('emits agent-workspace-update event', async () => {
    vi.mocked(kdnCli.remove).mockResolvedValue({ id: 'ws-1' });

    await manager.remove('ws-1');

    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('rejects when kdnCli.remove fails', async () => {
    vi.mocked(kdnCli.remove).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(manager.remove('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('getConfiguration', () => {
  test('reads JSON configuration file from workspace directory', async () => {
    vi.mocked(kdnCli.list).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(readFile).mockResolvedValue('{"mounts":{"dependencies":[]}}');

    const result = await manager.getConfiguration('ws-1');

    expect(kdnCli.list).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith(join('/tmp/ws1/.kaiden', 'workspace.json'), 'utf-8');
    expect(result).toEqual({ mounts: { dependencies: [] } });
  });

  test('throws when workspace id is not found in list', async () => {
    vi.mocked(kdnCli.list).mockResolvedValue(TEST_SUMMARIES);

    await expect(manager.getConfiguration('unknown-id')).rejects.toThrow(
      'workspace "unknown-id" not found. Use "workspace list" to see available workspaces.',
    );
  });

  test('returns empty configuration when file does not exist', async () => {
    vi.mocked(kdnCli.list).mockResolvedValue(TEST_SUMMARIES);
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValue(enoent);

    const result = await manager.getConfiguration('ws-1');

    expect(result).toEqual({});
  });

  test('rejects when reading the configuration file fails with a non-ENOENT error', async () => {
    vi.mocked(kdnCli.list).mockResolvedValue(TEST_SUMMARIES);
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    vi.mocked(readFile).mockRejectedValue(eacces);

    await expect(manager.getConfiguration('ws-1')).rejects.toThrow('EACCES: permission denied');
  });
});

describe('start', () => {
  test('delegates to kdnCli.start and returns the workspace id', async () => {
    vi.mocked(kdnCli.start).mockResolvedValue({ id: 'ws-1' });

    const result = await manager.start('ws-1');

    expect(kdnCli.start).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('emits agent-workspace-update event', async () => {
    vi.mocked(kdnCli.start).mockResolvedValue({ id: 'ws-1' });

    await manager.start('ws-1');

    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('rejects when kdnCli.start fails', async () => {
    vi.mocked(kdnCli.start).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(manager.start('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});

describe('stop', () => {
  test('delegates to kdnCli.stop and returns the workspace id', async () => {
    vi.mocked(kdnCli.stop).mockResolvedValue({ id: 'ws-1' });

    const result = await manager.stop('ws-1');

    expect(kdnCli.stop).toHaveBeenCalledWith('ws-1');
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('emits agent-workspace-update event', async () => {
    vi.mocked(kdnCli.stop).mockResolvedValue({ id: 'ws-1' });

    await manager.stop('ws-1');

    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('rejects when kdnCli.stop fails', async () => {
    vi.mocked(kdnCli.stop).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(manager.stop('unknown-id')).rejects.toThrow('workspace not found: unknown-id');
  });
});
