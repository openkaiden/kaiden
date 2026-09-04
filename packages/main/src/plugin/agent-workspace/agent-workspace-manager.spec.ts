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

import type { Stats } from 'node:fs';
import { access, lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  Agent,
  AgentWorkspaceConfiguration,
  AISDKInferenceProvider,
  Configuration,
  ProviderConnectionStatus,
} from '@openkaiden/api';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import type { IPty } from 'node-pty';
import { spawn } from 'node-pty';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AgentRegistry } from '/@/plugin/agent-registry.js';
import * as configWriter from '/@/plugin/agent-workspace/workspace-config-writer.js';
import type { IPCHandle } from '/@/plugin/api.js';
import type { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import type { Directories } from '/@/plugin/directories.js';
import { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import type { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import type { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import type { ProviderImpl } from '/@/plugin/provider-impl.js';
import type { ProviderRegistry } from '/@/plugin/provider-registry.js';
import type { SecretManager } from '/@/plugin/secret-manager/secret-manager.js';
import type { TaskManager } from '/@/plugin/tasks/task-manager.js';
import type { Task } from '/@/plugin/tasks/tasks.js';
import type { Exec } from '/@/plugin/util/exec.js';
import type { AgentWorkspaceCreateOptions } from '/@api/agent-workspace-info.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationPropertyRecordedSchema, IConfigurationRegistry } from '/@api/configuration/models.js';
import type { GatewayInfo, GatewaySandboxes } from '/@api/openshell-gateway-info.js';
import { AGENT_LABEL, decodeWorkspaceLabels } from '/@api/openshell-gateway-info.js';
import type { TaskState, TaskStatus } from '/@api/taskInfo.js';

import { AgentWorkspaceManager, encodeWorkspaceLabels } from './agent-workspace-manager.js';

vi.mock(import('node:fs/promises'));
vi.mock(import('node:os'));
vi.mock(import('js-yaml'));
vi.mock(import('yaml'));
vi.mock(import('node-pty'));

vi.mock(import('/@/plugin/openshell-cli/openshell-cli.js'));

const TEST_SUMMARIES: GatewaySandboxes[] = [
  {
    gateway: {
      name: 'kaiden',
      endpoint: 'http://localhost:10080',
    },
    sandboxes: [
      { id: 'ws-1', name: 'test-workspace-1', phase: 'Ready', sourcePath: '/tmp/ws1' },
      {
        id: 'ws-2',
        name: 'test-workspace-2',
        phase: 'Ready',
      },
    ],
  },
];

let manager: AgentWorkspaceManager;

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};
const ipcHandle: IPCHandle = vi.fn();
const openshellCli = new OpenshellCli({} as Exec, {} as CliToolRegistry);
const sdkSandbox = {
  create: vi.fn(),
  delete: vi.fn(),
  waitDeleted: vi.fn(),
  waitReady: vi.fn(),
};
const openshellSdkClientManager = {
  getClient: vi.fn().mockResolvedValue({ sandbox: sdkSandbox }),
} as unknown as OpenshellSdkClientManager;

const agentRegistry = {
  getAgentRegistration: vi.fn(),
  getAgent: vi.fn(),
} as unknown as AgentRegistry;

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

const webContents = {
  send: vi.fn(),
  receive: vi.fn(),
  isDestroyed: vi.fn().mockReturnValue(false),
} as unknown as WebContents;

const configurationRegistry = {
  registerConfigurations: vi.fn(),
  getConfiguration: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(undefined),
  }),
  getConfigurationProperties: vi.fn().mockReturnValue({}),
} as unknown as IConfigurationRegistry;

const providerRegistry = {
  getInferenceConnectionCredentials: vi.fn(),
  getInferenceConnection: vi.fn(),
  getProvider: vi.fn(),
} as unknown as ProviderRegistry;

let gatewayStartCallback: (() => void) | undefined;
let gatewayInitFailedCallback: ((message: string) => void) | undefined;
let gatewayStateUpdateCallback: (() => void) | undefined;
let sandboxListChangeCallback: (() => void) | undefined;

const openshellGateway = {
  createLocalGateway: vi.fn(),
  onDidGatewayStart: vi.fn((cb: () => void) => {
    gatewayStartCallback = cb;
    return { dispose: vi.fn() };
  }),
  onDidGatewayInitFailed: vi.fn((cb: (message: string) => void) => {
    gatewayInitFailedCallback = cb;
    return { dispose: vi.fn() };
  }),
} as unknown as OpenshellGateway;

const openshellGatewayStateManager = {
  listGateways: vi.fn(),
  refresh: vi.fn(),
  whenReady: vi.fn(),
  onDidUpdateGateways: vi.fn((cb: () => void) => {
    gatewayStateUpdateCallback = cb;
    return { dispose: vi.fn() };
  }),
} as unknown as OpenshellGatewayStateManager;

const secretManager = {
  create: vi.fn(),
  init: vi.fn(),
  getSecretForModel: vi.fn(),
  ensureSecretForModel: vi.fn(),
  getConnectionProperties: vi.fn(),
} as unknown as SecretManager;

const directories = {
  getAgentWorkspacesConfigDirectory: vi.fn().mockReturnValue('/mock/data/agent-workspaces'),
} as unknown as Directories;

function mockEnoent(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error('ENOENT');
  err.code = 'ENOENT';
  return err;
}

function getCreateLocalGatewayHandler(): (listener: unknown, options: unknown) => Promise<GatewayInfo[]> {
  return vi.mocked(ipcHandle).mock.calls.find(call => call[0] === 'agent-workspace:createLocalGateway')![1] as (
    listener: unknown,
    options: unknown,
  ) => Promise<GatewayInfo[]>;
}

function getSandboxUploads(): Array<{ local: string; remote: string }> {
  return vi.mocked(openshellCli.uploadToSandbox).mock.calls.map(([, local, remote]) => ({ local, remote }));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openshellSdkClientManager.getClient).mockResolvedValue({ sandbox: sdkSandbox } as never);
  vi.mocked(taskManager.createTask).mockReturnValue(mockTask);
  mockTask.state = '' as TaskState;
  mockTask.status = '' as TaskStatus;
  mockTask.error = '';
  vi.mocked(writeFile).mockResolvedValue(undefined);
  vi.mocked(rm).mockResolvedValue(undefined);
  vi.mocked(openshellGatewayStateManager.refresh).mockResolvedValue(undefined);
  vi.mocked(openshellGatewayStateManager.whenReady).mockResolvedValue(undefined);
  vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
    {
      name: 'kaiden',
      endpoint: 'http://127.0.0.1:17670',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  vi.mocked(readFile).mockResolvedValue('{}');
  vi.mocked(realpath).mockImplementation(async (p: unknown) => p as string);
  vi.mocked(configurationRegistry.getConfiguration).mockReturnValue({
    get: vi.fn().mockReturnValue(undefined),
  } as unknown as ReturnType<IConfigurationRegistry['getConfiguration']>);
  vi.mocked(configurationRegistry.getConfigurationProperties).mockReturnValue({});
  vi.mocked(directories.getAgentWorkspacesConfigDirectory).mockReturnValue('/mock/data/agent-workspaces');
  vi.mocked(lstat).mockImplementation(async path => {
    const value = String(path);
    const isDirectory =
      value === '/tmp/my-project' ||
      value.endsWith('shared-lib') ||
      value.endsWith('skills/github') ||
      value.endsWith('skills\\github') ||
      value.endsWith('skills/kubernetes') ||
      value.endsWith('skills\\kubernetes');
    return {
      isDirectory: () => isDirectory,
      isFile: () => !isDirectory,
      isSymbolicLink: () => false,
    } as Stats;
  });
  vi.mocked(homedir).mockReturnValue('/home/testuser');
  vi.mocked(tmpdir).mockReturnValue('/tmp');
  gatewayStartCallback = undefined;
  gatewayInitFailedCallback = undefined;
  gatewayStateUpdateCallback = undefined;
  sandboxListChangeCallback = undefined;
  Object.defineProperty(openshellCli, 'onDidSandboxListChange', {
    value: vi.fn((cb: () => void) => {
      sandboxListChangeCallback = cb;
      return { dispose: vi.fn() };
    }),
    writable: true,
    configurable: true,
  });
  manager = new AgentWorkspaceManager(
    apiSender,
    ipcHandle,
    taskManager,
    webContents,
    configurationRegistry,
    providerRegistry,
    secretManager,
    openshellCli,
    openshellSdkClientManager,
    agentRegistry,
    openshellGateway,
    openshellGatewayStateManager,
    directories,
  );
  manager.init();
});

describe('init', () => {
  test('registers IPC handler for checkConfigExists', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:checkConfigExists', expect.any(Function));
  });

  test('registers IPC handler for create', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:create', expect.any(Function));
  });

  test('registers IPC handler for remove', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:remove', expect.any(Function));
  });

  test('registers IPC handler for getConfiguration', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:getConfiguration', expect.any(Function));
  });

  test('registers IPC handler for updateConfiguration', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:updateConfiguration', expect.any(Function));
  });

  test('registers IPC handler for listOpenshellGateways', () => {
    expect(ipcHandle).toHaveBeenCalledWith('agent-workspace:listOpenshellGateways', expect.any(Function));
  });

  test('refreshes gateway state before returning a newly created gateway', async () => {
    const createdGateway = { name: 'local-dev', endpoint: 'https://127.0.0.1:17675' } as GatewayInfo;
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([createdGateway]);
    const options = {
      name: 'local-dev',
      bindAddress: '127.0.0.1',
      port: 17675,
      driver: 'podman',
    };

    await expect(getCreateLocalGatewayHandler()({}, options)).resolves.toEqual([createdGateway]);

    expect(openshellGateway.createLocalGateway).toHaveBeenCalledWith(options);
    expect(openshellGatewayStateManager.refresh).toHaveBeenCalledOnce();
    expect(taskManager.createTask).toHaveBeenCalledWith({ title: 'Creating local gateway "local-dev"' });
    expect(mockTask.status).toBe('success');
    expect(mockTask.state).toBe('completed');
    expect(vi.mocked(openshellGatewayStateManager.refresh).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(openshellGatewayStateManager.listGateways).mock.invocationCallOrder[0]!,
    );
  });

  test('reports task failure when local gateway creation fails', async () => {
    vi.mocked(openshellGateway.createLocalGateway).mockRejectedValue(new Error('creation failed'));

    await expect(getCreateLocalGatewayHandler()({}, { name: 'local-dev' })).rejects.toThrow('creation failed');

    expect(mockTask.status).toBe('failure');
    expect(mockTask.error).toBe('Failed to create local gateway: creation failed');
    expect(mockTask.state).toBe('completed');
    expect(openshellGatewayStateManager.refresh).not.toHaveBeenCalled();
  });

  test('registers defaultBaseImage configuration', () => {
    expect(configurationRegistry.registerConfigurations).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'preferences.agentWorkspace',
        properties: expect.objectContaining({
          'agentWorkspace.defaultBaseImage': expect.objectContaining({
            type: 'string',
          }),
        }),
      }),
    ]);
  });

  test('subscribes to gateway start event', () => {
    expect(openshellGateway.onDidGatewayStart).toHaveBeenCalled();
  });

  test('refreshes gateway state and sends a workspace update when gateway starts', () => {
    gatewayStartCallback!();
    expect(openshellGatewayStateManager.refresh).toHaveBeenCalled();
    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('subscribes to gateway init failed event', () => {
    expect(openshellGateway.onDidGatewayInitFailed).toHaveBeenCalled();
  });

  test('refreshes gateway state when gateway init fails', () => {
    gatewayInitFailedCallback!('Socket not found');
    expect(openshellGatewayStateManager.refresh).toHaveBeenCalled();
  });

  test('sends gateway update event when monitored gateway state changes', () => {
    gatewayStateUpdateCallback!();
    expect(apiSender.send).toHaveBeenCalledWith('agent-gateway-update');
  });

  test('subscribes to sandbox list change event', () => {
    expect(openshellCli.onDidSandboxListChange).toHaveBeenCalled();
  });

  test('sends agent-workspace-update when sandbox list changes from polling', () => {
    sandboxListChangeCallback!();
    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });
});

test('rejects with a descriptive error when model is missing at runtime', async () => {
  const options = { sourcePath: '/tmp/p', agent: 'claude' } as AgentWorkspaceCreateOptions;
  await expect(manager.create(options)).rejects.toThrow(/model is required to create a workspace/);
});

describe('create – OpenShell mode', () => {
  const defaultOptions: AgentWorkspaceCreateOptions = {
    sourcePath: '/tmp/my-project',
    agent: 'claude',
    name: 'my-sandbox',
    model: 'ramalama::granite-4.6::',
    gateway: 'kaiden',
  };

  const mockAgent: Agent = {
    id: 'claude',
    name: 'Claude Code',
    description: 'Test agent',
    command: 'claude',
    configurationFiles: [],
    destinationSkillsFolder: '${HOME}/.claude/skills',
    async preWorkspaceStart(): Promise<void> {},
  };

  beforeEach(() => {
    vi.mocked(sdkSandbox.create).mockResolvedValue(undefined);
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue(mockAgent);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());
  });

  test('calls sdkSandbox.create with gateway, name, providers, workspace label, and agent label', async () => {
    const options = { ...defaultOptions, secrets: ['my-secret'] };
    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'my-sandbox',
        providers: ['my-secret'],
        labels: { gateway: 'kaiden', ...encodeWorkspaceLabels('/tmp/my-project'), [AGENT_LABEL]: 'claude' },
      }),
    );
    expect(openshellSdkClientManager.getClient).toHaveBeenCalledWith('kaiden');
    expect(sdkSandbox.waitReady).toHaveBeenCalledWith('my-sandbox', 120);
    expect(vi.mocked(sdkSandbox.create).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(apiSender.send).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(apiSender.send).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sdkSandbox.waitReady).mock.invocationCallOrder[0]!,
    );
    expect(vi.mocked(sdkSandbox.waitReady).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(openshellCli.uploadToSandbox).mock.invocationCallOrder[0]!,
    );
  });

  test('rejects an unreachable gateway before creating a sandbox', async () => {
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue([
      {
        name: 'kaiden',
        endpoint: 'http://127.0.0.1:17670',
        gatewayState: { reachable: false, health: 'unknown' },
      },
    ]);

    await expect(manager.create(defaultOptions)).rejects.toThrow('gateway "kaiden" is unreachable');

    expect(sdkSandbox.create).not.toHaveBeenCalled();
  });

  test('waits for the gateway cache before checking reachability', async () => {
    let resolveReady: () => void;
    vi.mocked(openshellGatewayStateManager.whenReady).mockReturnValue(
      new Promise(resolve => {
        resolveReady = resolve;
      }),
    );

    const createPromise = manager.create(defaultOptions);
    await Promise.resolve();
    expect(openshellGatewayStateManager.listGateways).not.toHaveBeenCalled();

    resolveReady!();
    await createPromise;
    expect(openshellGatewayStateManager.listGateways).toHaveBeenCalledOnce();
  });

  test('returns { id: sandboxName }', async () => {
    const result = await manager.create(defaultOptions);

    expect(result).toEqual({ id: 'my-sandbox' });
  });

  test('calls openshellCli.enableV2Provider when not globally enabled', async () => {
    vi.mocked(openshellCli.isV2ProviderEnabled).mockResolvedValue(false);
    await manager.create(defaultOptions);

    expect(openshellCli.enableV2Provider).toHaveBeenCalledWith();
  });

  test('skips openshellCli.enableV2Provider when globally enabled', async () => {
    vi.mocked(openshellCli.isV2ProviderEnabled).mockResolvedValue(true);
    await manager.create(defaultOptions);

    expect(openshellCli.enableV2Provider).not.toHaveBeenCalled();
  });

  test('derives sandbox name from sourcePath basename when name is omitted', async () => {
    const options: AgentWorkspaceCreateOptions = {
      sourcePath: '/tmp/my-project',
      agent: 'claude',
      model: 'ramalama::granite-4::',
      gateway: 'kaiden',
    };
    const result = await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'my-project' }));
    expect(result).toEqual({ id: 'my-project' });
  });

  test('rejects workspace names longer than the hostname limit', async () => {
    const options: AgentWorkspaceCreateOptions = {
      ...defaultOptions,
      name: 'a'.repeat(20),
    };

    await expect(manager.create(options)).rejects.toThrow(/must not exceed 19 characters/);
    expect(sdkSandbox.create).not.toHaveBeenCalled();
  });

  test('rejects basename-derived names longer than the hostname limit', async () => {
    const longBasename = 'a'.repeat(20);
    const options: AgentWorkspaceCreateOptions = {
      sourcePath: `/tmp/${longBasename}`,
      agent: 'claude',
      model: 'ramalama::granite-4::',
      gateway: 'kaiden',
    };

    await expect(manager.create(options)).rejects.toThrow(/must not exceed 19 characters/);
    expect(sdkSandbox.create).not.toHaveBeenCalled();
  });

  test('passes agent baseImage as from option to createSandbox', async () => {
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({
      ...mockAgent,
      baseImage: 'registry.example.com/agent-base:v1',
    });

    await manager.create(defaultOptions);

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'registry.example.com/agent-base:v1',
      }),
    );
  });

  test('resolves tilde in sourcePath to home directory', async () => {
    vi.mocked(lstat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as Stats);
    const options: AgentWorkspaceCreateOptions = {
      ...defaultOptions,
      sourcePath: '~/my-project',
    };
    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        labels: expect.objectContaining(encodeWorkspaceLabels(join(homedir(), 'my-project'))),
      }),
    );
    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([{ local: join(homedir(), 'my-project'), remote: '.' }]),
    );
  });

  test('resolves symlinks in sourcePath via realpath', async () => {
    vi.mocked(realpath).mockImplementation(async (p: unknown) => {
      if (String(p) === '/tmp/symlinked-project') return '/real/path/project' as never;
      return p as string;
    });
    vi.mocked(lstat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as Stats);
    const options: AgentWorkspaceCreateOptions = {
      ...defaultOptions,
      sourcePath: '/tmp/symlinked-project',
    };
    await manager.create(options);

    expect(getSandboxUploads()).toEqual(expect.arrayContaining([{ local: '/real/path/project', remote: '.' }]));
  });

  test('resolves symlinks in mount host paths via realpath', async () => {
    vi.mocked(realpath).mockImplementation(async (p: unknown) => {
      if (String(p) === resolve(homedir(), 'linked-dir')) return '/real/linked-dir' as never;
      return p as string;
    });
    vi.mocked(lstat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as Stats);
    await manager.create({
      ...defaultOptions,
      mounts: [{ host: '$HOME/linked-dir', target: '$HOME/linked-dir', ro: false }],
    });

    expect(getSandboxUploads()).toEqual(expect.arrayContaining([{ local: '/real/linked-dir', remote: '~' }]));
  });

  test('uses user-specified image over agent baseImage when provided', async () => {
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({
      ...mockAgent,
      baseImage: 'registry.example.com/agent-base:v1',
    });

    await manager.create({ ...defaultOptions, image: 'custom-registry.io/my-image:latest' });

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'custom-registry.io/my-image:latest',
      }),
    );
  });

  test('falls back to agent baseImage when image option is undefined', async () => {
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({
      ...mockAgent,
      baseImage: 'registry.example.com/agent-base:v1',
    });

    await manager.create({ ...defaultOptions, image: undefined });

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        image: 'registry.example.com/agent-base:v1',
      }),
    );
  });

  test('calls agent.preWorkspaceStart with correct context', async () => {
    const preWorkspaceStart = vi.fn();
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({ ...mockAgent, preWorkspaceStart });
    vi.mocked(providerRegistry.getInferenceConnectionCredentials).mockReturnValue({
      credentials: { 'claude:tokens': 'sk-ant-secret' },
      llmMetadataName: 'anthropic',
      endpoint: 'https://api.anthropic.com',
    });
    vi.mocked(secretManager.create).mockResolvedValue({ name: 'my-sandbox-anthropic' });

    const options = { ...defaultOptions, model: 'anthropic::claude-3-5-sonnet::' };
    await manager.create(options);

    expect(preWorkspaceStart).toHaveBeenCalledWith({
      model: {
        llmMetadata: { name: 'anthropic' },
        model: { label: 'claude-3-5-sonnet' },
        endpoint: 'https://api.anthropic.com',
      },
      configurationFiles: [],
      workspace: expect.anything(),
    });
  });

  test('uploads updated configuration files to sandbox', async () => {
    const configFile = {
      path: '/home/user/.config/agent/config.toml',
      read: vi.fn().mockResolvedValue(''),
    };
    const preWorkspaceStart = vi
      .fn()
      .mockImplementation(async (ctx: { configurationFiles: Array<{ update(c: string): Promise<void> }> }) => {
        await ctx.configurationFiles[0]!.update('key = "value"');
      });
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({
      ...mockAgent,
      configurationFiles: [configFile],
      preWorkspaceStart,
    });

    await manager.create(defaultOptions);

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([{ local: expect.any(String), remote: '/home/user/.config/agent/config.toml' }]),
    );
  });

  test('uploads workspace filesystem even when agent has no config files', async () => {
    await manager.create(defaultOptions);

    expect(getSandboxUploads()).toEqual(expect.arrayContaining([{ local: '/tmp/my-project', remote: '.' }]));
  });

  test('uploads config files even when preWorkspaceStart does not update them', async () => {
    const configFile = {
      path: '/home/user/.config/agent/config.toml',
      read: vi.fn().mockResolvedValue('initial content'),
    };
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({
      ...mockAgent,
      configurationFiles: [configFile],
    });

    await manager.create(defaultOptions);

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([{ local: expect.any(String), remote: '/home/user/.config/agent/config.toml' }]),
    );
  });

  test('uploads selected skills into the agent destination skills folder', async () => {
    const options = {
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/github', '/home/user/.kaiden/skills/kubernetes'],
    };

    await manager.create(options);

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([
        { local: '/home/user/.kaiden/skills/github', remote: '.claude/skills' },
        { local: '/home/user/.kaiden/skills/kubernetes', remote: '.claude/skills' },
      ]),
    );
  });

  test('uploads custom path mounts with relative sandbox target', async () => {
    vi.mocked(lstat).mockResolvedValue({
      isDirectory: () => true,
      isFile: () => false,
      isSymbolicLink: () => false,
    } as Stats);
    await manager.create({
      ...defaultOptions,
      mounts: [{ host: '/Users/fbricon/Dev/projects/gh-dashboard', target: 'gh-dashboard', ro: false }],
    });

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([{ local: '/Users/fbricon/Dev/projects/gh-dashboard', remote: '.' }]),
    );
  });

  test('uploads safe resolved mounts to the openshell sandbox', async () => {
    await manager.create({
      ...defaultOptions,
      mounts: [
        { host: '$SOURCES/subdir', target: '$SOURCES/subdir', ro: false },
        { host: '$HOME/.gitconfig', target: '$HOME/.gitconfig', ro: true },
      ],
    });

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([
        { local: '/tmp/my-project', remote: '.' },
        { local: resolve('/tmp/my-project', './subdir'), remote: 'subdir' },
        { local: resolve(homedir(), '.gitconfig'), remote: '~/.gitconfig' },
      ]),
    );
  });

  test('uploads broad host access mounts when creating an openshell sandbox', async () => {
    await manager.create({
      ...defaultOptions,
      mounts: [
        { host: '$HOME', target: '$HOME', ro: false },
        { host: '/', target: '/', ro: false },
      ],
    });

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([
        { local: '/tmp/my-project', remote: '.' },
        { local: homedir(), remote: '~' },
        { local: '/', remote: '/' },
      ]),
    );
  });

  test('resolves relative destination skills folders under the sandbox home', async () => {
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({
      ...mockAgent,
      destinationSkillsFolder: '.agents/skills',
    });

    await manager.create({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/github'],
    });

    expect(getSandboxUploads()).toEqual(
      expect.arrayContaining([{ local: '/home/user/.kaiden/skills/github', remote: '.agents/skills' }]),
    );
  });

  test('throws when agent is not found in registry', async () => {
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue(undefined);

    await expect(manager.create(defaultOptions)).rejects.toThrow('agent claude not registered');

    expect(sdkSandbox.create).not.toHaveBeenCalled();
  });

  test('updates policy with endpoint flags after sandbox creation for deny mode with hosts', async () => {
    const options = {
      ...defaultOptions,
      network: { mode: 'deny' as const, hosts: ['registry.npmjs.org', 'pypi.python.org'] },
    };

    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(expect.not.objectContaining({ policy: expect.anything() }));
    expect(openshellCli.updatePolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.arrayContaining([
        'registry.npmjs.org:443:full:rest',
        'registry.npmjs.org:80:full:rest',
        'pypi.python.org:443:full:rest',
        'pypi.python.org:80:full:rest',
      ]),
      ['/**'],
    );
  });

  test('does not set policy for deny mode with no hosts and no model endpoint', async () => {
    const options = { ...defaultOptions, network: { mode: 'deny' as const } };

    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(expect.not.objectContaining({ policy: expect.anything() }));
    expect(openshellCli.updatePolicy).not.toHaveBeenCalled();
  });

  test('does not set policy for deny mode with empty hosts and no model endpoint', async () => {
    const options = { ...defaultOptions, network: { mode: 'deny' as const, hosts: [] } };

    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(expect.not.objectContaining({ policy: expect.anything() }));
    expect(openshellCli.updatePolicy).not.toHaveBeenCalled();
  });

  test('does not set policy for allow mode with no model endpoint', async () => {
    const options = {
      ...defaultOptions,
      network: { mode: 'allow' as const, hosts: ['registry.npmjs.org'] },
    };

    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(expect.not.objectContaining({ policy: expect.anything() }));
    expect(openshellCli.updatePolicy).not.toHaveBeenCalled();
  });

  test('does not set policy when network is undefined and no model endpoint', async () => {
    await manager.create(defaultOptions);

    expect(sdkSandbox.create).toHaveBeenCalledWith(expect.not.objectContaining({ policy: expect.anything() }));
    expect(openshellCli.updatePolicy).not.toHaveBeenCalled();
  });

  test('deletes sandbox and rethrows when updatePolicy fails', async () => {
    const options = {
      ...defaultOptions,
      network: { mode: 'deny' as const, hosts: ['registry.npmjs.org'] },
    };
    vi.mocked(openshellCli.updatePolicy).mockRejectedValue(new Error('policy update failed'));
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await expect(manager.create(options)).rejects.toThrow('policy update failed');

    expect(sdkSandbox.delete).toHaveBeenCalledWith('my-sandbox');
  });

  test('deletes sandbox and rethrows when it does not become ready', async () => {
    vi.mocked(sdkSandbox.waitReady).mockRejectedValue(new Error('timed out waiting for sandbox'));
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await expect(manager.create(defaultOptions)).rejects.toThrow('timed out waiting for sandbox');

    expect(sdkSandbox.delete).toHaveBeenCalledWith('my-sandbox');
    expect(openshellCli.uploadToSandbox).not.toHaveBeenCalled();
    expect(apiSender.send).toHaveBeenCalledTimes(2);
  });

  test('emits agent-workspace-update even when creation fails', async () => {
    const options = {
      ...defaultOptions,
      network: { mode: 'deny' as const, hosts: ['registry.npmjs.org'] },
    };
    vi.mocked(openshellCli.updatePolicy).mockRejectedValue(new Error('policy update failed'));
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await expect(manager.create(options)).rejects.toThrow('policy update failed');

    expect(apiSender.send).toHaveBeenCalledTimes(2);
    expect(apiSender.send).toHaveBeenNthCalledWith(1, 'agent-workspace-update');
    expect(apiSender.send).toHaveBeenNthCalledWith(2, 'agent-workspace-update');
  });

  test('emits agent-workspace-update on successful creation', async () => {
    await manager.create(defaultOptions);

    expect(apiSender.send).toHaveBeenCalledTimes(2);
    expect(apiSender.send).toHaveBeenNthCalledWith(1, 'agent-workspace-update');
    expect(apiSender.send).toHaveBeenNthCalledWith(2, 'agent-workspace-update');
  });

  test('attaches secret to sandbox when ensureSecretForModel returns a secret', async () => {
    vi.mocked(secretManager.ensureSecretForModel).mockResolvedValue({ name: 'vertex-ai-conn-1', type: 'vertex-ai' });

    const options = { ...defaultOptions, model: 'vertexai::claude-sonnet-4::' };
    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.arrayContaining(['vertex-ai-conn-1']),
      }),
    );
  });

  test('does not pass env parameter when credentialsEnvironment is empty', async () => {
    const options = { ...defaultOptions };
    await manager.create(options);

    const call = vi.mocked(sdkSandbox.create).mock.calls[0]![0];
    expect(call!.environment).toBeUndefined();
  });

  test('filters out empty string values from environment before createSandbox', async () => {
    vi.spyOn(configWriter, 'writeWorkspaceConfig').mockResolvedValue({
      environment: [
        { name: 'VALID_VAR', value: 'valid-value' },
        { name: 'EMPTY_VAR', value: '' },
      ],
    } as AgentWorkspaceConfiguration);

    const options = { ...defaultOptions };
    await manager.create(options);

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: {
          VALID_VAR: 'valid-value',
        },
      }),
    );
    const call = vi.mocked(sdkSandbox.create).mock.calls[0]![0];
    expect(call!.environment).not.toHaveProperty('EMPTY_VAR');
  });

  test('calls setInference during create when secret type requires it', async () => {
    vi.mocked(secretManager.ensureSecretForModel).mockResolvedValue({ name: 'vertex-ai-conn-1', type: 'vertex-ai' });
    vi.mocked(secretManager.getConnectionProperties).mockReturnValue({
      config: {} as Configuration,
      connectionProperties: [['kaiden.vertexai._flags', {} as IConfigurationPropertyRecordedSchema]],
    });
    vi.mocked(providerRegistry.getInferenceConnection).mockReturnValue({
      connection: {
        name: 'vertexai',
        id: 'vertexai',
        type: 'cloud',
        sdk: {} as AISDKInferenceProvider,
        credentials: (): Record<string, string> => {
          return {};
        },
        status: (): ProviderConnectionStatus => 'started',
        models: [
          {
            label: 'claude-sonnet-4',
          },
        ],
      },
      providerId: 'kaiden.vertexai',
    });
    vi.mocked(providerRegistry.getProvider).mockReturnValue({
      extensionId: 'kaiden.vertexai',
    } as ProviderImpl);

    const options = { ...defaultOptions, model: 'vertexai::claude-sonnet-4::' };
    await manager.create(options);

    expect(openshellCli.setInference).toHaveBeenCalledWith({
      provider: 'vertex-ai-conn-1',
      model: 'claude-sonnet-4',
    });
  });

  test('does not pass env when all environment values are filtered out', async () => {
    vi.spyOn(configWriter, 'writeWorkspaceConfig').mockResolvedValue({
      environment: [
        { name: 'EMPTY_VAR_1', value: '' },
        { name: 'EMPTY_VAR_2', value: '' },
      ],
    } as AgentWorkspaceConfiguration);

    const options = { ...defaultOptions };
    await manager.create(options);

    const call = vi.mocked(sdkSandbox.create).mock.calls[0]![0];
    expect(call!.environment).toBeUndefined();
  });

  test('updates policy with model endpoint', async () => {
    vi.mocked(providerRegistry.getInferenceConnectionCredentials).mockReturnValue({
      credentials: { api_key: 'sk-test' },
      llmMetadataName: 'openai',
      endpoint: 'https://api.example.com/v1',
    });
    vi.mocked(secretManager.create).mockResolvedValue({ name: 'my-sandbox-openai' });

    const options = { ...defaultOptions, model: 'openai::gpt-4o::https://api.example.com/v1' };
    await manager.create(options);

    expect(openshellCli.updatePolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.arrayContaining(['api.example.com:443']),
      ['/**'],
    );
  });

  test('rewrites localhost model endpoint to host.openshell.internal', async () => {
    const preWorkspaceStart = vi.fn();
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue({ ...mockAgent, preWorkspaceStart });
    vi.mocked(providerRegistry.getInferenceConnectionCredentials).mockReturnValue({
      credentials: {},
      llmMetadataName: 'ollama',
      endpoint: 'http://localhost:11434/v1',
    });

    const options = { ...defaultOptions, model: 'ollama::qwen3::http://localhost:11434/v1' };
    await manager.create(options);

    expect(preWorkspaceStart).toHaveBeenCalledWith(
      expect.objectContaining({
        model: expect.objectContaining({
          endpoint: 'http://host.openshell.internal:11434/v1',
        }),
      }),
    );
    expect(openshellCli.updatePolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.arrayContaining(['host.openshell.internal:11434']),
      ['/**'],
    );
  });

  test('does not update policy when model has no endpoint', async () => {
    vi.mocked(providerRegistry.getInferenceConnectionCredentials).mockReturnValue({
      credentials: { api_key: 'sk-test' },
      llmMetadataName: 'anthropic',
    });
    vi.mocked(secretManager.create).mockResolvedValue({ name: 'my-sandbox-anthropic' });

    const options = { ...defaultOptions, model: 'anthropic::claude-sonnet-4-20250514' };
    await manager.create(options);

    expect(openshellCli.updatePolicy).not.toHaveBeenCalled();
  });

  test('updates policy for endpoint extracted from model ID when connectionInfo is unavailable', async () => {
    vi.mocked(providerRegistry.getInferenceConnectionCredentials).mockReturnValue(undefined);

    const options = { ...defaultOptions, model: 'ollama::qwen3:0.6b::http://localhost:11434/v1' };
    await manager.create(options);

    expect(openshellCli.updatePolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.arrayContaining(['host.openshell.internal:11434']),
      ['/**'],
    );
  });

  test('updates policy with both network and model endpoints together', async () => {
    vi.mocked(providerRegistry.getInferenceConnectionCredentials).mockReturnValue({
      credentials: { api_key: 'sk-test' },
      llmMetadataName: 'openai',
      endpoint: 'https://api.openai.com/v1',
    });
    vi.mocked(secretManager.create).mockResolvedValue({ name: 'my-sandbox-openai' });

    const options = {
      ...defaultOptions,
      model: 'openai::gpt-4o::https://api.openai.com/v1',
      network: { mode: 'deny' as const, hosts: ['registry.npmjs.org'] },
    };

    await manager.create(options);

    expect(openshellCli.updatePolicy).toHaveBeenCalledWith(
      'my-sandbox',
      expect.arrayContaining(['registry.npmjs.org:443:full:rest', 'api.openai.com:443']),
      ['/**'],
    );
  });
});

describe('create – no-folder workspace', () => {
  const noFolderOptions: AgentWorkspaceCreateOptions = {
    agent: 'claude',
    name: 'empty-sandbox',
    model: 'ramalama::granite-4.6::',
    gateway: 'kaiden',
  };

  const mockAgent: Agent = {
    id: 'claude',
    name: 'Claude Code',
    description: 'Test agent',
    command: 'claude',
    configurationFiles: [],
    destinationSkillsFolder: '${HOME}/.claude/skills',
    async preWorkspaceStart(): Promise<void> {},
  };

  beforeEach(() => {
    vi.mocked(sdkSandbox.create).mockResolvedValue(undefined);
    vi.mocked(agentRegistry.getAgentRegistration).mockReturnValue(mockAgent);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());
    vi.mocked(realpath).mockImplementation(async (p: unknown) => p as string);
  });

  test('rejects workspace name containing path-traversal characters', async () => {
    await expect(manager.create({ ...noFolderOptions, name: '../../etc' })).rejects.toThrow(
      'Workspace name must contain only lowercase letters (a-z), digits (0-9), and hyphens (-)',
    );
    expect(sdkSandbox.create).not.toHaveBeenCalled();
  });

  test('throws when sourcePath is absent and name is not provided', async () => {
    await expect(manager.create({ ...noFolderOptions, name: undefined })).rejects.toThrow(
      'workspace name is required when no project folder is specified',
    );
    expect(sdkSandbox.create).not.toHaveBeenCalled();
  });

  test('creates sandbox without source file uploads when sourcePath is absent', async () => {
    await manager.create(noFolderOptions);

    expect(sdkSandbox.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'empty-sandbox',
        labels: expect.objectContaining({ gateway: 'kaiden' }),
      }),
    );
    expect(openshellCli.uploadToSandbox).not.toHaveBeenCalled();
  });

  test('does not add WORKSPACE_LABEL when sourcePath is absent', async () => {
    await manager.create(noFolderOptions);

    const callArg = vi.mocked(sdkSandbox.create).mock.calls[0]![0]!;
    expect(callArg.labels).toEqual({ gateway: 'kaiden', [AGENT_LABEL]: 'claude' });
  });

  test('writes config to global directory scoped by gateway and name', async () => {
    const spy = vi.spyOn(configWriter, 'writeWorkspaceConfig');
    await manager.create(noFolderOptions);

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'empty-sandbox', gateway: 'kaiden' }),
      join('/mock/data/agent-workspaces', 'kaiden', 'empty-sandbox'),
    );
  });

  test('replaceConfig removes config from global directory when sourcePath is absent', async () => {
    await manager.create({ ...noFolderOptions, replaceConfig: true });

    expect(rm).toHaveBeenCalledWith(join('/mock/data/agent-workspaces', 'kaiden', 'empty-sandbox', 'workspace.json'), {
      force: true,
    });
  });

  test('uploads mounts with absolute paths and warns about skipped $SOURCES mounts', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(configWriter, 'writeWorkspaceConfig').mockResolvedValue({
      mounts: [
        { host: '/Users/me/repos/lib', target: 'lib', ro: false },
        { host: '$SOURCES/sub', target: 'sub', ro: true },
      ],
    } as AgentWorkspaceConfiguration);

    await manager.create(noFolderOptions);

    expect(getSandboxUploads()).toEqual([{ local: '/Users/me/repos/lib', remote: 'lib' }]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('skipping mount "$SOURCES/sub"'));
    spy.mockRestore();
    warnSpy.mockRestore();
  });

  test('merges into existing config at global directory', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ skills: ['/existing/skill'] }));
    const spy = vi.spyOn(configWriter, 'writeWorkspaceConfig');

    await manager.create({ ...noFolderOptions, network: { mode: 'allow' } });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ network: { mode: 'allow' } }),
      join('/mock/data/agent-workspaces', 'kaiden', 'empty-sandbox'),
    );
  });
});

describe('checkWorkspaceConfigExists', () => {
  test('returns true when workspace.json exists', async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    const result = await manager.checkWorkspaceConfigExists('/tmp/my-project');

    expect(result).toBe(true);
    expect(access).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden', 'workspace.json'));
  });

  test('returns false when workspace.json does not exist', async () => {
    vi.mocked(access).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await manager.checkWorkspaceConfigExists('/tmp/my-project');

    expect(result).toBe(false);
  });

  test('returns false for empty sourcePath', async () => {
    const result = await manager.checkWorkspaceConfigExists('');

    expect(result).toBe(false);
    expect(access).not.toHaveBeenCalled();
  });

  test('resolves tilde in sourcePath before checking', async () => {
    vi.mocked(access).mockResolvedValue(undefined);

    const result = await manager.checkWorkspaceConfigExists('~/my-project');

    expect(result).toBe(true);
    expect(access).toHaveBeenCalledWith(join('/home/testuser/my-project', '.kaiden', 'workspace.json'));
  });
});

describe('ensureModelSecret', () => {
  const baseOptions: AgentWorkspaceCreateOptions = {
    sourcePath: '/tmp/my-project',
    agent: 'claude',
    model: 'anthropic::claude-sonnet-4::',
    name: 'my-workspace',
    gateway: 'kaiden',
  };

  test('skips when workspaceConfiguration already has secrets (e.g. onboarding)', async () => {
    const options = {
      ...baseOptions,
      model: 'anthropic::claude-sonnet-4-20250514::',
      workspaceConfiguration: { secrets: ['anthropic'] },
    } as AgentWorkspaceCreateOptions;
    await manager.ensureModelSecret(options);

    expect(secretManager.ensureSecretForModel).not.toHaveBeenCalled();
  });

  test('skips when ensureSecretForModel returns undefined (no registered provider)', async () => {
    vi.mocked(secretManager.ensureSecretForModel).mockResolvedValue(undefined);

    const options = { ...baseOptions, model: 'unknown::model::' };
    await manager.ensureModelSecret(options);

    expect(options.secrets).toBeUndefined();
    expect(secretManager.ensureSecretForModel).toHaveBeenCalledWith('unknown::model::', 'kaiden');
  });

  test('adds secret name to options.secrets when found', async () => {
    vi.mocked(secretManager.ensureSecretForModel).mockResolvedValue({ name: 'cursor-conn-123', type: 'cursor' });

    const options = { ...baseOptions, model: 'cursor::gpt-4o::https://api.cursor.com' };
    await manager.ensureModelSecret(options);

    expect(options.secrets).toContain('cursor-conn-123');
    expect(secretManager.ensureSecretForModel).toHaveBeenCalledWith('cursor::gpt-4o::https://api.cursor.com', 'kaiden');
  });

  test('does not call setInference when secret type is not in SET_INFERENCE_TYPES', async () => {
    vi.mocked(secretManager.ensureSecretForModel).mockResolvedValue({ name: 'cursor-conn-123', type: 'cursor' });

    const options = { ...baseOptions, model: 'cursor::gpt-4o::https://api.cursor.com' };
    await manager.ensureModelSecret(options);

    expect(openshellCli.setInference).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  test('delegates to kdnCli.list and returns items', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    const result = await manager.listOpenshellSandboxes();

    expect(openshellCli.listSandboxesPerGateway).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result.flatMap(gw => gw.sandboxes).map(s => s.id)).toEqual(['ws-1', 'ws-2']);
  });

  test('rejects when kdnCli.list fails', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockRejectedValue(new Error('command not found'));

    await expect(manager.listOpenshellSandboxes()).rejects.toThrow('command not found');
  });
});

describe('listOpenshellGateways', () => {
  const TEST_GATEWAYS: GatewayInfo[] = [
    {
      name: 'kaiden-local',
      endpoint: 'http://127.0.0.1:17670',
      active: true,
      auth: 'plaintext',
      type: 'local',
      source: 'user',
      gatewayState: { reachable: true, health: 'healthy' },
    },
    {
      name: 'remote-vm',
      endpoint: 'https://127.0.0.1:17670',
      active: false,
      auth: 'mtls',
      type: 'remote',
      source: 'user',
      is_remote: true,
      remote_host: 'user@gateway-alias',
      resolved_host: '10.0.0.5',
      gatewayState: { reachable: false, health: 'unknown' },
    },
  ];

  test('returns the cached gateway-state snapshot', async () => {
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue(TEST_GATEWAYS);

    const result = await manager.listOpenshellGateways();

    expect(openshellGatewayStateManager.listGateways).toHaveBeenCalled();
    expect(result).toEqual(TEST_GATEWAYS);
    expect(result).not.toBe(TEST_GATEWAYS);
  });

  test('IPC handler returns OpenShell gateways', async () => {
    vi.mocked(openshellGatewayStateManager.listGateways).mockReturnValue(TEST_GATEWAYS);
    const handler = vi
      .mocked(ipcHandle)
      .mock.calls.find(([channel]) => channel === 'agent-workspace:listOpenshellGateways')?.[1];

    expect(handler).toBeDefined();
    await expect(handler?.({} as IpcMainInvokeEvent)).resolves.toEqual(TEST_GATEWAYS);
  });
});

describe('remove', () => {
  test('delegates to kdnCli.remove and returns the workspace id', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    const result = await manager.remove('ws-1', 'kaiden');

    expect(sdkSandbox.delete).toHaveBeenCalledWith('test-workspace-1');
    expect(sdkSandbox.waitDeleted).toHaveBeenCalledWith('test-workspace-1', 120);
    expect(result).toEqual({ id: 'ws-1' });
  });

  test('creates a task with workspace name and sets success status on completion', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await manager.remove('ws-1', 'kaiden');

    expect(taskManager.createTask).toHaveBeenCalledWith({ title: 'Deleting workspace "test-workspace-1"' });
    expect(mockTask.status).toBe('success');
    expect(mockTask.state).toBe('completed');
  });

  test('uses workspace id as fallback when workspace not found in list', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue([]);
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await manager.remove('unknown-id', 'kaiden');

    expect(taskManager.createTask).toHaveBeenCalledWith({ title: 'Deleting workspace "unknown-id"' });
  });

  test('sets task failure status when CLI fails', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(sdkSandbox.delete).mockRejectedValue(new Error('workspace not found: unknown-id'));

    await expect(manager.remove('unknown-id', 'kaiden')).rejects.toThrow('workspace not found: unknown-id');

    expect(mockTask.status).toBe('failure');
    expect(mockTask.error).toContain('workspace not found: unknown-id');
    expect(mockTask.state).toBe('completed');
  });

  test('preserves error detail in task error message', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(sdkSandbox.delete).mockRejectedValue(new Error('failed to remove workspace: permission denied'));

    await expect(manager.remove('ws-1', 'kaiden')).rejects.toThrow('failed to remove workspace: permission denied');

    expect(mockTask.error).toBe('Failed to delete workspace: failed to remove workspace: permission denied');
  });

  test('emits agent-workspace-update event', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await manager.remove('ws-1', 'kaiden');

    expect(apiSender.send).toHaveBeenCalledTimes(2);
    expect(apiSender.send).toHaveBeenNthCalledWith(1, 'agent-workspace-update');
    expect(apiSender.send).toHaveBeenNthCalledWith(2, 'agent-workspace-update');
    expect(vi.mocked(apiSender.send).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(rm).mock.invocationCallOrder[0]!,
    );
  });

  test('cleans up global config directory after sandbox deletion', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await manager.remove('ws-1', 'kaiden');

    expect(rm).toHaveBeenCalledWith(join('/mock/data/agent-workspaces', 'kaiden', 'test-workspace-1'), {
      recursive: true,
      force: true,
    });
  });
});

describe('deleteOpenshellSandbox', () => {
  test('deletes the sandbox from the requested gateway', async () => {
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await manager.deleteOpenshellSandbox('shared-name', 'remote-gateway');

    expect(sdkSandbox.delete).toHaveBeenCalledWith('shared-name');
    expect(sdkSandbox.waitDeleted).toHaveBeenCalledWith('shared-name', 120);
  });

  test('cleans up global config directory after sandbox deletion', async () => {
    vi.mocked(sdkSandbox.delete).mockResolvedValue(undefined);

    await manager.deleteOpenshellSandbox('my-workspace', 'kaiden');

    expect(rm).toHaveBeenCalledWith(join('/mock/data/agent-workspaces', 'kaiden', 'my-workspace'), {
      recursive: true,
      force: true,
    });
  });
});

describe('getConfiguration', () => {
  test('reads JSON configuration file from workspace directory', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(readFile).mockResolvedValue('{"mounts":{"dependencies":[]}}');

    const result = await manager.getConfiguration('ws-1');

    expect(openshellCli.listSandboxesPerGateway).toHaveBeenCalled();
    expect(readFile).toHaveBeenCalledWith(join('/tmp/ws1/.kaiden', 'workspace.json'), 'utf-8');
    expect(result).toEqual({ mounts: { dependencies: [] } });
  });

  test('throws when workspace id is not found in list', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    await expect(manager.getConfiguration('unknown-id')).rejects.toThrow(
      'workspace "unknown-id" not found. Use "workspace list" to see available workspaces.',
    );
  });

  test('returns empty configuration when file does not exist', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    vi.mocked(readFile).mockRejectedValue(enoent);

    const result = await manager.getConfiguration('ws-1');

    expect(result).toEqual({});
  });

  test('rejects when reading the configuration file fails with a non-ENOENT error', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    const eacces = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    vi.mocked(readFile).mockRejectedValue(eacces);

    await expect(manager.getConfiguration('ws-1')).rejects.toThrow('EACCES: permission denied');
  });

  test('reads from global directory for no-folder workspaces', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(readFile).mockResolvedValue('{"network":{"mode":"allow"}}');

    const result = await manager.getConfiguration('ws-2');

    expect(readFile).toHaveBeenCalledWith(
      join('/mock/data/agent-workspaces', 'kaiden', 'test-workspace-2', 'workspace.json'),
      'utf-8',
    );
    expect(result).toEqual({ network: { mode: 'allow' } });
  });

  test('returns empty config when global directory file does not exist for no-folder workspace', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    const result = await manager.getConfiguration('ws-2');

    expect(result).toEqual({});
  });
});

describe('updateConfiguration', () => {
  test('delegates to kdnCli.updateWorkspaceConfig with the workspace configuration path', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    const spy = vi.spyOn(configWriter, 'updateWorkspaceConfig');

    await manager.updateConfiguration('ws-1', { skills: ['/path/to/skill'] });

    expect(spy).toHaveBeenCalledWith(join('/tmp/ws1', '.kaiden'), { skills: ['/path/to/skill'] });
  });

  test('emits agent-workspace-update event', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    await manager.updateConfiguration('ws-1', { network: { mode: 'allow' } });

    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });

  test('throws when workspace id is not found', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    await expect(manager.updateConfiguration('unknown-id', {})).rejects.toThrow(
      'workspace "unknown-id" not found. Use "workspace list" to see available workspaces.',
    );
  });

  test('propagates errors from kdnCli.updateWorkspaceConfig', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    vi.mocked(configWriter.updateWorkspaceConfig).mockRejectedValue(new Error('permission denied'));

    await expect(manager.updateConfiguration('ws-1', {})).rejects.toThrow('permission denied');
  });

  test('writes to global directory for no-folder workspaces', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    const spy = vi.spyOn(configWriter, 'updateWorkspaceConfig');

    await manager.updateConfiguration('ws-2', { skills: ['/new/skill'] });

    expect(spy).toHaveBeenCalledWith(join('/mock/data/agent-workspaces', 'kaiden', 'test-workspace-2'), {
      skills: ['/new/skill'],
    });
    expect(apiSender.send).toHaveBeenCalledWith('agent-workspace-update');
  });
});

describe('shellInAgentWorkspace', () => {
  let onDataCallback: ((data: string) => void) | undefined;
  let onExitCallback: (() => void) | undefined;

  function createMockPty(): IPty {
    onDataCallback = undefined;
    onExitCallback = undefined;
    return {
      onData: vi.fn((cb: (data: string) => void) => {
        onDataCallback = cb;
        return { dispose: vi.fn() };
      }),
      onExit: vi.fn((cb: () => void) => {
        onExitCallback = cb;
        return { dispose: vi.fn() };
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 123,
      cols: 80,
      rows: 24,
      process: 'kdn',
      handleFlowControl: false,
      pause: vi.fn(),
      resume: vi.fn(),
      clear: vi.fn(),
    } as unknown as IPty;
  }

  test('returns write, resize, and ptyProcess', () => {
    vi.mocked(spawn).mockReturnValue(createMockPty());

    const result = manager.shellInAgentWorkspace('test-workspace-1', vi.fn(), vi.fn(), vi.fn());

    expect(result).toHaveProperty('write');
    expect(result).toHaveProperty('resize');
    expect(result).toHaveProperty('ptyProcess');
  });

  test('spawns kdn terminal with workspace name', () => {
    vi.mocked(spawn).mockReturnValue(createMockPty());
    vi.mocked(openshellCli.getCliPath).mockReturnValue('openshell');

    manager.shellInAgentWorkspace('test-workspace-1', vi.fn(), vi.fn(), vi.fn());

    expect(spawn).toHaveBeenCalledWith('openshell', ['sandbox', 'connect', 'test-workspace-1'], expect.any(Object));
  });

  test('write function forwards data to pty', () => {
    const mockPty = createMockPty();
    vi.mocked(spawn).mockReturnValue(mockPty);

    const result = manager.shellInAgentWorkspace('test-workspace-1', vi.fn(), vi.fn(), vi.fn());
    result.write('hello');

    expect(mockPty.write).toHaveBeenCalledWith('hello');
  });

  test('resize function forwards dimensions to pty', () => {
    const mockPty = createMockPty();
    vi.mocked(spawn).mockReturnValue(mockPty);

    const result = manager.shellInAgentWorkspace('test-workspace-1', vi.fn(), vi.fn(), vi.fn());
    result.resize(120, 40);

    expect(mockPty.resize).toHaveBeenCalledWith(120, 40);
  });

  test('calls onData when pty emits data', () => {
    vi.mocked(spawn).mockReturnValue(createMockPty());

    const onData = vi.fn();
    manager.shellInAgentWorkspace('test-workspace-1', onData, vi.fn(), vi.fn());

    expect(onDataCallback).toBeDefined();
    onDataCallback!('output');

    expect(onData).toHaveBeenCalledWith('output');
  });

  test('calls onEnd when pty exits', () => {
    vi.mocked(spawn).mockReturnValue(createMockPty());

    const onEnd = vi.fn();
    manager.shellInAgentWorkspace('test-workspace-1', vi.fn(), vi.fn(), onEnd);

    expect(onExitCallback).toBeDefined();
    onExitCallback!();

    expect(onEnd).toHaveBeenCalled();
  });
});

describe('dispose', () => {
  test('kills active terminal processes', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    const mockPty = {
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 123,
    } as unknown as IPty;
    vi.mocked(spawn).mockReturnValue(mockPty);

    const terminalHandler = vi
      .mocked(ipcHandle)
      .mock.calls.find(call => call[0] === 'agent-workspace:terminal')?.[1] as (
      _listener: unknown,
      id: string,
      onDataId: number,
    ) => Promise<number>;
    expect(terminalHandler).toBeDefined();

    await terminalHandler({}, 'ws-1', 1);

    manager.dispose();

    expect(mockPty.kill).toHaveBeenCalled();
  });

  test('terminal IPC handler rejects when workspace id is not found', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    const terminalHandler = vi
      .mocked(ipcHandle)
      .mock.calls.find(call => call[0] === 'agent-workspace:terminal')?.[1] as (
      _listener: unknown,
      id: string,
      onDataId: number,
    ) => Promise<number>;
    expect(terminalHandler).toBeDefined();

    await expect(terminalHandler({}, 'unknown-id', 1)).rejects.toThrow(
      'workspace "unknown-id" not found. Use "workspace list" to see available workspaces.',
    );
  });

  test('does not send terminal data when webContents is destroyed', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);

    let onDataCallback: ((data: string) => void) | undefined;
    let onExitCallback: (() => void) | undefined;
    const mockPty = {
      onData: vi.fn((cb: (data: string) => void) => {
        onDataCallback = cb;
        return { dispose: vi.fn() };
      }),
      onExit: vi.fn((cb: () => void) => {
        onExitCallback = cb;
        return { dispose: vi.fn() };
      }),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 123,
    } as unknown as IPty;
    vi.mocked(spawn).mockReturnValue(mockPty);

    const terminalHandler = vi
      .mocked(ipcHandle)
      .mock.calls.find(call => call[0] === 'agent-workspace:terminal')?.[1] as (
      _listener: unknown,
      id: string,
      onDataId: number,
    ) => Promise<number>;

    await terminalHandler({}, 'ws-1', 1);

    vi.mocked(webContents.isDestroyed).mockReturnValue(true);

    onDataCallback!('some output');
    onExitCallback!();

    expect(webContents.send).not.toHaveBeenCalled();
  });
});

describe('terminal IPC session lifecycle', () => {
  function createTerminalMockPty(): { pty: IPty; triggerData: (data: string) => void } {
    let onDataCb: ((data: string) => void) | undefined;
    const pty = {
      onData: vi.fn((cb: (data: string) => void) => {
        onDataCb = cb;
        return { dispose: vi.fn() };
      }),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 789,
    } as unknown as IPty;
    return {
      pty,
      triggerData: (data: string): void => {
        onDataCb?.(data);
      },
    };
  }

  function getIpcHandler<T>(channel: string): T {
    return vi.mocked(ipcHandle).mock.calls.find(call => call[0] === channel)![1] as unknown as T;
  }

  test('closes an active workspace terminal before opening a fresh one', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    const { pty: firstPty, triggerData: triggerFirstData } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(firstPty);

    const terminalHandler =
      getIpcHandler<(_listener: unknown, id: string, onDataId: number) => Promise<number>>('agent-workspace:terminal');

    await terminalHandler({}, 'ws-1', 10);

    const { pty: secondPty, triggerData: triggerSecondData } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(secondPty);
    await terminalHandler({}, 'ws-1', 11);
    triggerFirstData('stale output');
    triggerSecondData('output');

    expect(firstPty.kill).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(webContents.send).not.toHaveBeenCalledWith('agent-workspace:terminal-onData', 11, 'stale output');
    expect(webContents.send).toHaveBeenCalledWith('agent-workspace:terminal-onData', 11, 'output');
  });

  test('routes send and resize through the workspace terminal session and removes it on close', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(TEST_SUMMARIES);
    const { pty } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty);

    const terminalHandler =
      getIpcHandler<(_listener: unknown, id: string, onDataId: number) => Promise<number>>('agent-workspace:terminal');
    const sendHandler =
      getIpcHandler<(_listener: unknown, onDataId: number, content: string) => Promise<void>>(
        'agent-workspace:terminalSend',
      );
    const resizeHandler = getIpcHandler<
      (_listener: unknown, onDataId: number, width: number, height: number) => Promise<void>
    >('agent-workspace:terminalResize');
    const closeHandler = getIpcHandler<(_listener: unknown, onDataId: number) => Promise<void>>(
      'agent-workspace:terminalClose',
    );

    await terminalHandler({}, 'ws-1', 10);
    await sendHandler({}, 10, 'hello');
    await resizeHandler({}, 10, 120, 40);
    await closeHandler({}, 10);

    const nextPty = createTerminalMockPty().pty;
    vi.mocked(spawn).mockReturnValue(nextPty);
    await terminalHandler({}, 'ws-1', 11);

    expect(pty.write).toHaveBeenCalledWith('hello');
    expect(pty.resize).toHaveBeenCalledWith(120, 40);
    expect(pty.kill).toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(2);
  });
});

describe('terminal agent command execution', () => {
  const SANDBOXES_WITH_AGENT: GatewaySandboxes[] = [
    {
      gateway: { name: 'kaiden', endpoint: 'http://localhost:10080' },
      sandboxes: [
        {
          id: 'ws-agent',
          name: 'agent-workspace',
          phase: 'Ready',
          labels: { [AGENT_LABEL]: 'test-agent' },
        },
        {
          id: 'ws-no-label',
          name: 'no-label-workspace',
          phase: 'Ready',
        },
      ],
    },
  ];

  function createTerminalMockPty(): { pty: IPty; triggerData: (data: string) => void } {
    let onDataCb: ((data: string) => void) | undefined;
    const pty = {
      onData: vi.fn((cb: (data: string) => void) => {
        onDataCb = cb;
        return { dispose: vi.fn() };
      }),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      pid: 456,
    } as unknown as IPty;
    return {
      pty,
      triggerData: (data: string): void => {
        onDataCb?.(data);
      },
    };
  }

  function getTerminalHandler(): (_listener: unknown, id: string, onDataId: number) => Promise<number> {
    return vi.mocked(ipcHandle).mock.calls.find(call => call[0] === 'agent-workspace:terminal')![1] as (
      _listener: unknown,
      id: string,
      onDataId: number,
    ) => Promise<number>;
  }

  test('executes agent command on first terminal data', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(SANDBOXES_WITH_AGENT);
    vi.mocked(agentRegistry.getAgent).mockResolvedValue({
      id: 'test-agent',
      name: 'Test Agent',
      description: '',
      command: '/usr/bin/agent start',
      destinationSkillsFolder: '~/.agent',
    });
    const { pty, triggerData } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty);

    await getTerminalHandler()({}, 'ws-agent', 10);
    triggerData('$ ');

    expect(pty.write).toHaveBeenCalledWith('/usr/bin/agent start\n');
  });

  test('does not execute agent command on subsequent connections', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(SANDBOXES_WITH_AGENT);
    vi.mocked(agentRegistry.getAgent).mockResolvedValue({
      id: 'test-agent',
      name: 'Test Agent',
      description: '',
      command: '/usr/bin/agent start',
      destinationSkillsFolder: '~/.agent',
    });
    const { pty: pty1, triggerData: triggerData1 } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty1);

    await getTerminalHandler()({}, 'ws-agent', 10);
    triggerData1('$ ');

    const { pty: pty2, triggerData: triggerData2 } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty2);

    await getTerminalHandler()({}, 'ws-agent', 11);
    triggerData2('$ ');

    expect(pty2.write).not.toHaveBeenCalled();
  });

  test('retries agent command when replaced before first terminal data', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(SANDBOXES_WITH_AGENT);
    vi.mocked(agentRegistry.getAgent).mockResolvedValue({
      id: 'test-agent',
      name: 'Test Agent',
      description: '',
      command: '/usr/bin/agent start',
      destinationSkillsFolder: '~/.agent',
    });
    const { pty: pty1, triggerData: triggerData1 } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty1);

    await getTerminalHandler()({}, 'ws-agent', 10);

    const { pty: pty2, triggerData: triggerData2 } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty2);
    await getTerminalHandler()({}, 'ws-agent', 11);

    triggerData1('$ ');
    triggerData2('$ ');

    expect(pty1.write).not.toHaveBeenCalledWith('/usr/bin/agent start\n');
    expect(pty2.write).toHaveBeenCalledWith('/usr/bin/agent start\n');
  });

  test('does not execute command when workspace has no agent label', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(SANDBOXES_WITH_AGENT);
    const { pty, triggerData } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty);

    await getTerminalHandler()({}, 'ws-no-label', 10);
    triggerData('$ ');

    expect(pty.write).not.toHaveBeenCalled();
    expect(agentRegistry.getAgent).not.toHaveBeenCalled();
  });

  test('does not execute command when agent has no command', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(SANDBOXES_WITH_AGENT);
    vi.mocked(agentRegistry.getAgent).mockResolvedValue({
      id: 'test-agent',
      name: 'Test Agent',
      description: '',
      command: '',
      destinationSkillsFolder: '~/.agent',
    });
    const { pty, triggerData } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty);

    await getTerminalHandler()({}, 'ws-agent', 10);
    triggerData('$ ');

    expect(pty.write).not.toHaveBeenCalled();
  });

  test('executes agent command only once despite multiple data events', async () => {
    vi.mocked(openshellCli.listSandboxesPerGateway).mockResolvedValue(SANDBOXES_WITH_AGENT);
    vi.mocked(agentRegistry.getAgent).mockResolvedValue({
      id: 'test-agent',
      name: 'Test Agent',
      description: '',
      command: '/usr/bin/agent start',
      destinationSkillsFolder: '~/.agent',
    });
    const { pty, triggerData } = createTerminalMockPty();
    vi.mocked(spawn).mockReturnValue(pty);

    await getTerminalHandler()({}, 'ws-agent', 10);
    triggerData('$ ');
    triggerData('more output');
    triggerData('even more output');

    expect(pty.write).toHaveBeenCalledTimes(1);
    expect(pty.write).toHaveBeenCalledWith('/usr/bin/agent start\n');
  });
});

describe('encodeWorkspaceLabels', () => {
  test('returns single label for short paths', () => {
    const labels = encodeWorkspaceLabels('/tmp/my-project');
    expect(Object.keys(labels)).toEqual(['ai.openkaiden.kaiden.workspace']);
    expect(labels['ai.openkaiden.kaiden.workspace']!.length).toBeLessThanOrEqual(63);
  });

  test('splits into indexed labels for long paths', () => {
    const longPath = '/Users/fbricon/Dev/souk/ideas/stock-trading-ai/backend';
    const labels = encodeWorkspaceLabels(longPath);
    expect(labels['ai.openkaiden.kaiden.workspace']).toBeUndefined();
    expect(labels['ai.openkaiden.kaiden.workspace.0']).toBeDefined();
    expect(labels['ai.openkaiden.kaiden.workspace.1']).toBeDefined();
    for (const value of Object.values(labels)) {
      expect(value.length).toBeLessThanOrEqual(63);
    }
  });
});

describe('decodeWorkspaceLabels', () => {
  test('round-trips a short path', () => {
    const path = '/tmp/my-project';
    expect(decodeWorkspaceLabels(encodeWorkspaceLabels(path))).toBe(path);
  });

  test('round-trips a long path', () => {
    const path = '/Users/fbricon/Dev/souk/ideas/stock-trading-ai/backend';
    expect(decodeWorkspaceLabels(encodeWorkspaceLabels(path))).toBe(path);
  });

  test('returns undefined when no matching labels exist', () => {
    expect(decodeWorkspaceLabels({ unrelated: 'value' })).toBeUndefined();
  });

  test('returns undefined for non-numeric chunk suffixes', () => {
    expect(decodeWorkspaceLabels({ 'ai.openkaiden.kaiden.workspace.foo': 'abc' })).toBeUndefined();
  });

  test('returns undefined for non-contiguous chunk indices', () => {
    expect(
      decodeWorkspaceLabels({
        'ai.openkaiden.kaiden.workspace.0': 'abc',
        'ai.openkaiden.kaiden.workspace.2': 'def',
      }),
    ).toBeUndefined();
  });
});
