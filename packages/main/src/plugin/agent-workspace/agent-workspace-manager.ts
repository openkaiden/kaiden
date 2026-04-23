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
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Disposable, FileSystemWatcher } from '@openkaiden/api';
import { inject, injectable, preDestroy } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { FilesystemMonitoring } from '/@/plugin/filesystem-monitoring.js';
import { KdnCli } from '/@/plugin/kdn-cli/kdn-cli.js';
import { TaskManager } from '/@/plugin/tasks/task-manager.js';
import type {
  AgentWorkspaceConfiguration,
  AgentWorkspaceCreateOptions,
  AgentWorkspaceId,
  AgentWorkspaceSummary,
  CliInfo,
} from '/@api/agent-workspace-info.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';

/**
 * Manages agent workspaces by delegating to the `kdn` CLI.
 */
@injectable()
export class AgentWorkspaceManager implements Disposable {
  private instancesWatcher: FileSystemWatcher | undefined;

  constructor(
    @inject(ApiSenderType)
    private readonly apiSender: ApiSenderType,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(KdnCli)
    private readonly kdnCli: KdnCli,
    @inject(TaskManager)
    private readonly taskManager: TaskManager,
    @inject(FilesystemMonitoring)
    private readonly filesystemMonitoring: FilesystemMonitoring,
  ) {}

  async getCliInfo(): Promise<CliInfo> {
    return this.kdnCli.getInfo();
  }

  async create(options: AgentWorkspaceCreateOptions): Promise<AgentWorkspaceId> {
    const suffix = options.name ? ` "${options.name}"` : '';
    const task = this.taskManager.createTask({ title: `Creating workspace${suffix}` });
    task.state = 'running';
    task.status = 'in-progress';
    try {
      const workspaceId = await this.kdnCli.createWorkspace(options);
      this.apiSender.send('agent-workspace-update');
      task.status = 'success';
      return workspaceId;
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      task.status = 'failure';
      task.error = `Failed to create workspace: ${detail}`;
      throw new Error(detail);
    } finally {
      task.state = 'completed';
    }
  }

  async list(): Promise<AgentWorkspaceSummary[]> {
    return this.kdnCli.listWorkspaces();
  }

  async remove(id: string): Promise<AgentWorkspaceId> {
    const result = await this.kdnCli.removeWorkspaces(id);
    this.apiSender.send('agent-workspace-update');
    return result;
  }

  async getConfiguration(id: string): Promise<AgentWorkspaceConfiguration> {
    const workspaces = await this.list();
    const workspace = workspaces.find(ws => ws.id === id);
    if (!workspace) {
      throw new Error(`workspace "${id}" not found. Use "workspace list" to see available workspaces.`);
    }
    try {
      const content = await readFile(join(workspace.paths.configuration, 'workspace.json'), 'utf-8');
      return JSON.parse(content) as AgentWorkspaceConfiguration;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {} as AgentWorkspaceConfiguration;
      }
      throw error;
    }
  }

  async start(id: string): Promise<AgentWorkspaceId> {
    const result = await this.kdnCli.startWorkspace(id);
    this.apiSender.send('agent-workspace-update');
    return result;
  }

  async stop(id: string): Promise<AgentWorkspaceId> {
    const result = await this.kdnCli.stopWorkspace(id);
    this.apiSender.send('agent-workspace-update');
    return result;
  }

  init(): void {
    this.ipcHandle('agent-workspace:getCliInfo', async (): Promise<CliInfo> => {
      return this.getCliInfo();
    });

    this.ipcHandle(
      'agent-workspace:create',
      async (_listener: unknown, options: AgentWorkspaceCreateOptions): Promise<AgentWorkspaceId> => {
        return this.create(options);
      },
    );

    this.ipcHandle('agent-workspace:list', async (): Promise<AgentWorkspaceSummary[]> => {
      return this.list();
    });

    this.ipcHandle('agent-workspace:remove', async (_listener: unknown, id: string): Promise<AgentWorkspaceId> => {
      return this.remove(id);
    });

    this.ipcHandle(
      'agent-workspace:getConfiguration',
      async (_listener: unknown, id: string): Promise<AgentWorkspaceConfiguration> => {
        return this.getConfiguration(id);
      },
    );

    this.ipcHandle('agent-workspace:start', async (_listener: unknown, id: string): Promise<AgentWorkspaceId> => {
      return this.start(id);
    });

    this.ipcHandle('agent-workspace:stop', async (_listener: unknown, id: string): Promise<AgentWorkspaceId> => {
      return this.stop(id);
    });

    this.watchInstancesFile();
  }

  private watchInstancesFile(): void {
    this.instancesWatcher?.dispose();
    const instancesPath = join(homedir(), '.kdn', 'instances.json');
    this.instancesWatcher = this.filesystemMonitoring.createFileSystemWatcher(instancesPath);
    const notify = (): void => {
      this.apiSender.send('agent-workspace-update');
    };
    this.instancesWatcher.onDidChange(notify);
    this.instancesWatcher.onDidCreate(notify);
    this.instancesWatcher.onDidDelete(notify);
  }

  @preDestroy()
  dispose(): void {
    this.instancesWatcher?.dispose();
  }
}
