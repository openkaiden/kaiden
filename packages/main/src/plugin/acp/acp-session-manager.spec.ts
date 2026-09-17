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

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as acp from '@agentclientprotocol/sdk';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AgentRegistry } from '/@/plugin/agent-registry.js';
import type { Directories } from '/@/plugin/directories.js';
import type { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import type { AcpSessionCreateOptions, AcpSessionInfo } from '/@api/acp-session-info.js';
import type { AgentInfo } from '/@api/agent-info.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import { AGENT_LABEL, type SandboxInfo } from '/@api/openshell-gateway-info.js';

import { AcpSessionManager } from './acp-session-manager.js';

vi.mock(import('node:fs'));
vi.mock(import('node:fs/promises'));
vi.mock(import('@agentclientprotocol/sdk'));

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};

const openshellCli: OpenshellCli = {
  getCliPath: vi.fn().mockReturnValue('/usr/bin/openshell'),
  listSandboxes: vi.fn(),
  uploadToSandbox: vi.fn(),
} as unknown as OpenshellCli;

const sdkSandbox = {
  execInteractive: vi.fn(),
};
const openshellSdkClientManager = {
  getClient: vi.fn().mockResolvedValue({ sandbox: sdkSandbox }),
} as unknown as OpenshellSdkClientManager;

const agentRegistry: AgentRegistry = {
  getAgent: vi.fn(),
} as unknown as AgentRegistry;

const FAKE_SESSIONS_DIR = join('/fake', 'acp-sessions');

const directories: Directories = {
  getAcpSessionsDirectory: vi.fn().mockReturnValue(FAKE_SESSIONS_DIR),
  getConfigurationDirectory: vi.fn(),
  getPluginsDirectory: vi.fn(),
  getPluginsScanDirectory: vi.fn(),
  getExtensionsStorageDirectory: vi.fn(),
  getContributionStorageDir: vi.fn(),
  getSafeStorageDirectory: vi.fn(),
  getDataDirectory: vi.fn(),
  getManagedDefaultsDirectory: vi.fn(),
  getSkillsDirectory: vi.fn(),
  getWorkspaceProjectsDirectory: vi.fn(),
  getSemanticRoutersDirectory: vi.fn(),
  getAgentWorkspacesConfigDirectory: vi.fn(),
} as unknown as Directories;

function createSandbox(overrides?: Partial<SandboxInfo>): SandboxInfo {
  return {
    id: 'sandbox-1',
    name: 'test-sandbox',
    phase: 'Ready',
    ...overrides,
  };
}

function createAgentInfo(overrides?: Partial<AgentInfo>): AgentInfo {
  return {
    id: 'openclaw',
    name: 'OpenClaw',
    description: 'Test agent',
    command: 'openclaw',
    acp: { args: ['acp'] },
    destinationSkillsFolder: '/skills',
    ...overrides,
  };
}

describe('AcpSessionManager', () => {
  let manager: AcpSessionManager;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(directories.getAcpSessionsDirectory).mockReturnValue(FAKE_SESSIONS_DIR);
    vi.mocked(openshellCli.listSandboxes).mockResolvedValue([]);
    vi.mocked(openshellSdkClientManager.getClient).mockResolvedValue({ sandbox: sdkSandbox } as never);
    manager = new AcpSessionManager(apiSender, openshellCli, agentRegistry, directories, openshellSdkClientManager);
  });

  describe('resolveAgentCommand', () => {
    test('resolves agent from options.agentId', async () => {
      const agent = createAgentInfo();
      vi.mocked(agentRegistry.getAgent).mockResolvedValue(agent);

      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello', agentId: 'openclaw' };
      const sandbox = createSandbox();

      const result = await manager.resolveAgentCommand(options, sandbox);

      expect(agentRegistry.getAgent).toHaveBeenCalledWith('openclaw');
      expect(result.agentInfo).toBe(agent);
      expect(result.command).toEqual(['openclaw', 'acp']);
    });

    test('resolves agent from sandbox kaiden.agent label', async () => {
      const agent = createAgentInfo({ id: 'copilot', command: 'copilot', acp: { args: ['--acp'] } });
      vi.mocked(agentRegistry.getAgent).mockResolvedValue(agent);

      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello' };
      const sandbox = createSandbox({ labels: { [AGENT_LABEL]: 'copilot' } });

      const result = await manager.resolveAgentCommand(options, sandbox);

      expect(agentRegistry.getAgent).toHaveBeenCalledWith('copilot');
      expect(result.command).toEqual(['copilot', '--acp']);
    });

    test('uses acp.command override when provided', async () => {
      const agent = createAgentInfo({
        id: 'claude',
        command: 'claude',
        acp: { command: 'claude-agent-acp', args: [] },
      });
      vi.mocked(agentRegistry.getAgent).mockResolvedValue(agent);

      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello', agentId: 'claude' };
      const sandbox = createSandbox();

      const result = await manager.resolveAgentCommand(options, sandbox);

      expect(result.command).toEqual(['claude-agent-acp']);
    });

    test('options.agentId takes priority over sandbox label', async () => {
      const agent = createAgentInfo({ id: 'openclaw', command: 'openclaw' });
      vi.mocked(agentRegistry.getAgent).mockResolvedValue(agent);

      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello', agentId: 'openclaw' };
      const sandbox = createSandbox({ labels: { [AGENT_LABEL]: 'copilot' } });

      const result = await manager.resolveAgentCommand(options, sandbox);

      expect(agentRegistry.getAgent).toHaveBeenCalledWith('openclaw');
      expect(result.agentInfo.id).toBe('openclaw');
    });

    test('throws when no agent specified and no sandbox label', async () => {
      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello' };
      const sandbox = createSandbox();

      await expect(manager.resolveAgentCommand(options, sandbox)).rejects.toThrow('No agent specified');
    });

    test('throws when agent not found in registry', async () => {
      vi.mocked(agentRegistry.getAgent).mockResolvedValue(undefined);

      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello', agentId: 'unknown' };
      const sandbox = createSandbox();

      await expect(manager.resolveAgentCommand(options, sandbox)).rejects.toThrow('Agent "unknown" not found');
    });

    test('throws when agent does not support ACP', async () => {
      const agent = createAgentInfo({ id: 'claude', name: 'Claude Code', acp: undefined });
      vi.mocked(agentRegistry.getAgent).mockResolvedValue(agent);

      const options: AcpSessionCreateOptions = { sandboxName: 'sb', prompt: 'hello', agentId: 'claude' };
      const sandbox = createSandbox();

      await expect(manager.resolveAgentCommand(options, sandbox)).rejects.toThrow(
        'Agent "Claude Code" does not support ACP',
      );
    });
  });

  describe('uploadAttachments', () => {
    test('uploads image attachments to sandbox and returns remote path', async () => {
      vi.mocked(openshellCli.uploadToSandbox).mockResolvedValue();

      const attachments = [{ filePath: '/local/photo.png', fileName: 'photo.png', mimeType: 'image/png' }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (manager as any).uploadAttachments('test-sandbox', attachments);

      expect(openshellCli.uploadToSandbox).toHaveBeenCalledWith(
        'test-sandbox',
        '/local/photo.png',
        expect.stringContaining('/sandbox/.kaiden-attachments/'),
        undefined,
      );
      expect(result).toHaveLength(1);
      expect(result[0].remotePath).toMatch(/\/sandbox\/\.kaiden-attachments\/.*\/photo\.png/);
    });

    test('uploads text attachments to sandbox instead of inlining', async () => {
      vi.mocked(openshellCli.uploadToSandbox).mockResolvedValue();

      const attachments = [{ filePath: '/local/notes.txt', fileName: 'notes.txt', mimeType: 'text/plain' }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (manager as any).uploadAttachments('test-sandbox', attachments);

      expect(openshellCli.uploadToSandbox).toHaveBeenCalledWith(
        'test-sandbox',
        '/local/notes.txt',
        expect.stringContaining('/sandbox/.kaiden-attachments/'),
        undefined,
      );
      expect(result).toHaveLength(1);
      expect(result[0].remotePath).toMatch(/\/sandbox\/\.kaiden-attachments\/.*\/notes\.txt/);
    });

    test('uploads markdown attachments to sandbox instead of inlining', async () => {
      vi.mocked(openshellCli.uploadToSandbox).mockResolvedValue();

      const attachments = [{ filePath: '/local/doc.md', fileName: 'doc.md', mimeType: 'text/markdown' }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (manager as any).uploadAttachments('test-sandbox', attachments);

      expect(openshellCli.uploadToSandbox).toHaveBeenCalledWith(
        'test-sandbox',
        '/local/doc.md',
        expect.stringContaining('/sandbox/.kaiden-attachments/'),
        undefined,
      );
      expect(result).toHaveLength(1);
      expect(result[0].remotePath).toMatch(/\/sandbox\/\.kaiden-attachments\/.*\/doc\.md/);
    });

    test('uploads PDF attachments to sandbox', async () => {
      vi.mocked(openshellCli.uploadToSandbox).mockResolvedValue();

      const attachments = [{ filePath: '/local/doc.pdf', fileName: 'doc.pdf', mimeType: 'application/pdf' }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (manager as any).uploadAttachments('test-sandbox', attachments);

      expect(openshellCli.uploadToSandbox).toHaveBeenCalled();
      expect(result[0].remotePath).toMatch(/\/sandbox\/\.kaiden-attachments\/.*\/doc\.pdf/);
    });

    test('returns undefined when no attachments', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (manager as any).uploadAttachments('test-sandbox', undefined);
      expect(result).toBeUndefined();
    });

    test('passes gateway name to uploadToSandbox when provided', async () => {
      vi.mocked(openshellCli.uploadToSandbox).mockResolvedValue();

      const attachments = [{ filePath: '/local/photo.png', fileName: 'photo.png', mimeType: 'image/png' }];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (manager as any).uploadAttachments('test-sandbox', attachments, 'my-gateway');

      expect(openshellCli.uploadToSandbox).toHaveBeenCalledWith(
        'test-sandbox',
        '/local/photo.png',
        expect.stringContaining('/sandbox/.kaiden-attachments/'),
        'my-gateway',
      );
    });
  });

  describe('buildContentBlocks', () => {
    test('creates resource_link for uploaded image files', () => {
      const attachments = [
        {
          filePath: '/local/photo.png',
          fileName: 'photo.png',
          mimeType: 'image/png',
          remotePath: '/sandbox/.kaiden-attachments/uuid-123/photo.png',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = (manager as any).buildContentBlocks('describe this', attachments);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        type: 'resource_link',
        uri: pathToFileURL('/sandbox/.kaiden-attachments/uuid-123/photo.png').href,
        name: 'photo.png',
        mimeType: 'image/png',
      });
      expect(blocks[1]).toEqual({ type: 'text', text: 'describe this' });
    });

    test('creates resource_link for uploaded text files', () => {
      const attachments = [
        {
          filePath: '/local/notes.txt',
          fileName: 'notes.txt',
          mimeType: 'text/plain',
          remotePath: '/sandbox/.kaiden-attachments/uuid-456/notes.txt',
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = (manager as any).buildContentBlocks('summarize this', attachments);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        type: 'resource_link',
        uri: pathToFileURL('/sandbox/.kaiden-attachments/uuid-456/notes.txt').href,
        name: 'notes.txt',
        mimeType: 'text/plain',
      });
      expect(blocks[1]).toEqual({ type: 'text', text: 'summarize this' });
    });

    test('encodes reserved characters in resource_link URI', () => {
      const remotePath = '/sandbox/.kaiden-attachments/uuid-789/notes#final.md';
      const attachments = [
        {
          filePath: '/local/notes#final.md',
          fileName: 'notes#final.md',
          mimeType: 'text/markdown',
          remotePath,
        },
      ];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = (manager as any).buildContentBlocks('read this', attachments);

      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toEqual({
        type: 'resource_link',
        uri: pathToFileURL(remotePath).href,
        name: 'notes#final.md',
        mimeType: 'text/markdown',
      });
      // The '#' must be percent-encoded so it is not parsed as a URI fragment
      expect(blocks[0].uri).toBe(pathToFileURL(remotePath).href);
      expect(blocks[1]).toEqual({ type: 'text', text: 'read this' });
    });

    test('creates only text block when no attachments', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blocks = (manager as any).buildContentBlocks('hello', undefined);

      expect(blocks).toEqual([{ type: 'text', text: 'hello' }]);
    });
  });

  describe('init', () => {
    test('skips loading when sessions directory does not exist', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(false);

      await manager.init();

      expect(readdir).not.toHaveBeenCalled();
    });

    test('loads sessions from disk and marks non-terminal as completed', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-1.json' as never]);

      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-1',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'running',
          createdAt: 1000,
          updatedAt: 2000,
          agentId: 'agent-1',
          agentName: 'Agent',
        },
        events: [{ kind: 'prompt', text: 'hello', timestamp: 1000 }],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe('session-1');
      expect(sessions[0]!.status).toBe('completed');
    });

    test('preserves terminal session status on load', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-2.json' as never]);

      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-2',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'bye',
          status: 'error',
          createdAt: 1000,
          updatedAt: 2000,
          error: 'Something went wrong',
        },
        events: [],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.status).toBe('error');
      expect(sessions[0]!.error).toBe('Something went wrong');
    });

    test('skips non-json files', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['.gitkeep' as never]);

      await manager.init();

      expect(await manager.listSessions()).toHaveLength(0);
    });

    test('marks unresolved permission requests as resolved and expired on load', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-perm.json' as never]);

      const storedSession = {
        info: {
          id: 'session-perm',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'waiting_input',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [
          { kind: 'prompt', text: 'hello', timestamp: 1000 },
          {
            kind: 'tool_call',
            toolCallId: 'tc-1',
            title: 'Run command',
            status: 'running',
            timestamp: 2000,
            permissionRequest: {
              requestId: 'req-1',
              options: [
                { name: 'Allow', kind: 'allow', optionId: 'opt-allow' },
                { name: 'Reject', kind: 'deny', optionId: 'opt-deny' },
              ],
              resolved: false,
            },
          },
        ],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const events = manager.getSessionEvents('session-perm');
      const toolCallEvent = events.find(e => e.kind === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      expect(toolCallEvent!.kind).toBe('tool_call');
      if (toolCallEvent!.kind === 'tool_call') {
        expect(toolCallEvent!.permissionRequest?.resolved).toBe(true);
        expect(toolCallEvent!.permissionRequest?.expired).toBe(true);
      }

      const sessions = await manager.listSessions();
      expect(sessions[0]!.status).toBe('completed');
    });

    test('preserves already-resolved permission requests on load', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-resolved.json' as never]);

      const storedSession = {
        info: {
          id: 'session-resolved',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [
          {
            kind: 'tool_call',
            toolCallId: 'tc-1',
            title: 'Run command',
            status: 'completed',
            timestamp: 2000,
            permissionRequest: {
              requestId: 'req-1',
              options: [
                { name: 'Allow', kind: 'allow', optionId: 'opt-allow' },
                { name: 'Reject', kind: 'deny', optionId: 'opt-deny' },
              ],
              resolved: true,
              selectedOptionId: 'opt-allow',
            },
          },
        ],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const events = manager.getSessionEvents('session-resolved');
      const toolCallEvent = events.find(e => e.kind === 'tool_call');
      expect(toolCallEvent).toBeDefined();
      if (toolCallEvent!.kind === 'tool_call') {
        expect(toolCallEvent!.permissionRequest?.resolved).toBe(true);
        expect(toolCallEvent!.permissionRequest?.expired).toBeUndefined();
        expect(toolCallEvent!.permissionRequest?.selectedOptionId).toBe('opt-allow');
      }
    });

    test('handles corrupt session files gracefully', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['bad.json' as never]);
      vi.mocked(readFile).mockResolvedValue('not valid json');

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await manager.init();

      expect(await manager.listSessions()).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load ACP session file'),
        expect.any(SyntaxError),
      );
    });

    test('restores session events from disk', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-3.json' as never]);

      const events = [
        { kind: 'prompt', text: 'hello', timestamp: 1000 },
        { kind: 'agent_message', text: 'response', messageId: 'msg-1', turn: 0, timestamp: 2000 },
      ];
      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-3',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 3000,
        },
        events,
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const sessionEvents = manager.getSessionEvents('session-3');
      expect(sessionEvents).toHaveLength(2);
      expect(sessionEvents[0]!.kind).toBe('prompt');
      expect(sessionEvents[1]!.kind).toBe('agent_message');
    });
  });

  describe('deleteSession', () => {
    test('removes session file from disk', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, rm, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-del.json' as never]);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(rm).mockResolvedValue();

      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-del',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();
      expect(await manager.listSessions()).toHaveLength(1);

      await manager.deleteSession('session-del');

      expect(await manager.listSessions()).toHaveLength(0);
      expect(rm).toHaveBeenCalledWith(join(FAKE_SESSIONS_DIR, 'session-del.json'));
    });
  });

  describe('renameSession', () => {
    test('updates the name field and persists to disk', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-rename.json' as never]);
      vi.mocked(writeFile).mockResolvedValue();

      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-rename',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'original prompt text',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      await manager.renameSession('session-rename', 'My Custom Name');

      const sessions = await manager.listSessions();
      expect(sessions[0]!.name).toBe('My Custom Name');
      expect(sessions[0]!.updatedAt).toBeGreaterThan(2000);
      expect(writeFile).toHaveBeenCalledWith(
        join(FAKE_SESSIONS_DIR, 'session-rename.json'),
        expect.stringContaining('"My Custom Name"'),
        'utf-8',
      );
      expect(apiSender.send).toHaveBeenCalledWith('acp-session-update');
    });

    test('persists to disk before broadcasting update event', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-order.json' as never]);

      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-order',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'prompt',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      let resolveWrite: () => void;
      const writePromise = new Promise<void>(resolve => {
        resolveWrite = resolve;
      });

      vi.mocked(writeFile).mockReturnValue(writePromise);

      await manager.init();
      const renamePromise = manager.renameSession('session-order', 'New Name');

      expect(apiSender.send).not.toHaveBeenCalledWith('acp-session-update');
      resolveWrite!();
      await renamePromise;

      expect(apiSender.send).toHaveBeenCalledWith('acp-session-update');
    });

    test('restores previous metadata when persistence fails', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-fail.json' as never]);

      const storedSession: { info: AcpSessionInfo; events: unknown[] } = {
        info: {
          id: 'session-fail',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'prompt',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));
      vi.mocked(writeFile).mockRejectedValue(new Error('disk error'));

      await manager.init();
      await expect(manager.renameSession('session-fail', 'Bad Name')).rejects.toThrow('disk error');

      const sessions = await manager.listSessions();
      expect(sessions[0]!.name).toBeUndefined();
      expect(sessions[0]!.updatedAt).toBe(2000);
      expect(apiSender.send).not.toHaveBeenCalledWith('acp-session-update');
    });

    test('throws when renaming a non-existent session', async () => {
      await manager.init();
      await expect(manager.renameSession('nonexistent', 'new name')).rejects.toThrow('Session "nonexistent" not found');
    });
  });

  describe('persistence of resume fields', () => {
    test('restores acpSessionId, agentCommand, and gatewayName from disk', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-resume.json' as never]);

      const storedSession = {
        info: {
          id: 'session-resume',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
          agentId: 'openclaw',
          agentName: 'OpenClaw',
        },
        events: [],
        acpSessionId: 'acp-123',
        agentCommand: ['openclaw', 'acp'],
        gatewayName: 'my-gateway',
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.id).toBe('session-resume');
    });

    test('restores messageTurn from max turn in persisted events', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-turn.json' as never]);

      const events = [
        { kind: 'prompt', text: 'hello', timestamp: 1000 },
        { kind: 'agent_message', text: 'first response', messageId: 'msg-1', turn: 0, timestamp: 2000 },
        { kind: 'tool_call', toolCallId: 'tc-1', title: 'tool', status: 'completed', timestamp: 3000 },
        { kind: 'agent_message', text: 'after tool', messageId: 'msg-2', turn: 1, timestamp: 4000 },
        { kind: 'prompt', text: 'follow up', timestamp: 5000 },
        { kind: 'agent_message', text: 'second response', messageId: 'msg-3', turn: 2, timestamp: 6000 },
      ];
      const storedSession = {
        info: {
          id: 'session-turn',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 6000,
        },
        events,
        acpSessionId: 'acp-456',
        agentCommand: ['agent', 'acp'],
        gatewayName: 'gw',
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const sessionEvents = manager.getSessionEvents('session-turn');
      expect(sessionEvents).toHaveLength(6);
      const agentMessages = sessionEvents.filter(e => e.kind === 'agent_message');
      expect(agentMessages).toHaveLength(3);
      const maxTurn = Math.max(...agentMessages.map(e => ('turn' in e ? (e.turn as number) : 0)));
      expect(maxTurn).toBe(2);

      // Simulate a new agent_message_chunk arriving after resume — its turn
      // must be 3 (maxTurn + 1), not collide with any persisted event.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).handleSessionUpdate('session-turn', {
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'msg-new',
          content: { type: 'text', text: 'new response' },
        },
      });

      const updatedEvents = manager.getSessionEvents('session-turn');
      const newMessage = updatedEvents.findLast(e => e.kind === 'agent_message' && 'turn' in e && e.turn === 3);
      expect(newMessage).toBeDefined();
      expect((newMessage as { text: string }).text).toBe('new response');
    });

    test('handles missing resume fields in old persisted data', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['old-session.json' as never]);

      const storedSession = {
        info: {
          id: 'old-session',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed',
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions).toHaveLength(1);
    });
  });

  describe('sandbox validation during init', () => {
    test('marks sessions with missing sandboxes', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['s1.json' as never]);
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          info: {
            id: 's1',
            sandboxName: 'deleted-sandbox',
            sandboxId: 'sb-id',
            prompt: 'hello',
            status: 'completed',
            createdAt: 1000,
            updatedAt: 2000,
          },
          events: [],
        }),
      );
      vi.mocked(openshellCli.listSandboxes).mockResolvedValue([
        { id: 'other-id', name: 'other-sandbox', phase: 'Ready' },
      ]);

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions[0]!.sandboxId).toBeUndefined();
    });

    test('preserves sandboxId when sandbox is still ready', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['s1.json' as never]);
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          info: {
            id: 's1',
            sandboxName: 'my-sandbox',
            sandboxId: 'sb-id',
            prompt: 'hello',
            status: 'completed',
            createdAt: 1000,
            updatedAt: 2000,
          },
          events: [],
        }),
      );
      vi.mocked(openshellCli.listSandboxes).mockResolvedValue([{ id: 'sb-id', name: 'my-sandbox', phase: 'Ready' }]);

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions[0]!.sandboxId).toBe('sb-id');
    });

    test('clears sandboxId when sandbox exists but is not ready', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['s1.json' as never]);
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          info: {
            id: 's1',
            sandboxName: 'my-sandbox',
            sandboxId: 'sb-id',
            prompt: 'hello',
            status: 'completed',
            createdAt: 1000,
            updatedAt: 2000,
          },
          events: [],
        }),
      );
      vi.mocked(openshellCli.listSandboxes).mockResolvedValue([{ id: 'sb-id', name: 'my-sandbox', phase: 'Deleting' }]);

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions[0]!.sandboxId).toBeUndefined();
    });

    test('handles listSandboxes failure gracefully', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['s1.json' as never]);
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          info: {
            id: 's1',
            sandboxName: 'my-sandbox',
            sandboxId: 'sb-id',
            prompt: 'hello',
            status: 'completed',
            createdAt: 1000,
            updatedAt: 2000,
          },
          events: [],
        }),
      );
      vi.mocked(openshellCli.listSandboxes).mockRejectedValue(new Error('CLI not found'));

      await manager.init();

      const sessions = await manager.listSessions();
      expect(sessions[0]!.sandboxId).toBe('sb-id');
    });
  });

  describe('sendFollowUp guard', () => {
    test('throws when sandbox is missing', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['s1.json' as never]);
      vi.mocked(readFile).mockResolvedValue(
        JSON.stringify({
          info: {
            id: 's1',
            sandboxName: 'gone-sandbox',
            sandboxId: 'sb-id',
            prompt: 'hello',
            status: 'completed',
            createdAt: 1000,
            updatedAt: 2000,
          },
          events: [],
        }),
      );
      vi.mocked(openshellCli.listSandboxes).mockResolvedValue([]);

      await manager.init();

      await expect(manager.sendFollowUp('s1', 'hello')).rejects.toThrow('Sandbox "gone-sandbox" no longer exists');
    });
  });

  describe('setSessionModel', () => {
    test('resets contextUsed and contextSize to undefined after model switch', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(readdir).mockResolvedValue(['session-model.json' as never]);

      const storedSession = {
        info: {
          id: 'session-model',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed' as const,
          createdAt: 1000,
          updatedAt: 2000,
          currentModelId: 'old-200k-model',
          contextSize: 200_000,
          contextUsed: 50_000,
        },
        events: [],
        acpSessionId: 'acp-model-test',
        agentCommand: ['openclaw', 'acp'],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      // Inject a mock connection into the session
      const mockSendRequest = vi.fn().mockResolvedValue({});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessions = (manager as any).sessions as Map<string, any>;
      const session = sessions.get('session-model');
      session.connection = { connection: { sendRequest: mockSendRequest } };

      await manager.setSessionModel('session-model', 'new-1m-model');

      const listed = await manager.listSessions();
      const updated = listed.find(s => s.id === 'session-model');

      expect(updated?.currentModelId).toBe('new-1m-model');
      expect(updated?.contextSize).toBeUndefined();
      expect(updated?.contextUsed).toBeUndefined();
      expect(mockSendRequest).toHaveBeenCalledWith('session/set_model', {
        sessionId: 'acp-model-test',
        modelId: 'new-1m-model',
      });
      expect(apiSender.send).toHaveBeenCalledWith('acp-session-update');

      await vi.waitFor(() => {
        expect(writeFile).toHaveBeenCalledWith(
          join(FAKE_SESSIONS_DIR, 'session-model.json'),
          expect.stringContaining('"new-1m-model"'),
          'utf-8',
        );
      });
    });
  });

  describe('setSessionConfigOption', () => {
    test('resets contextUsed and contextSize to undefined when config option category is model', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(readdir).mockResolvedValue(['session-config.json' as never]);

      const storedSession = {
        info: {
          id: 'session-config',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed' as const,
          createdAt: 1000,
          updatedAt: 2000,
          currentModelId: 'old-model',
          contextSize: 200_000,
          contextUsed: 50_000,
          configOptions: [
            {
              id: 'model-selector',
              name: 'Model',
              category: 'model',
              type: 'select' as const,
              currentValue: 'old-model',
            },
          ],
        },
        events: [],
        acpSessionId: 'acp-config-test',
        agentCommand: ['openclaw', 'acp'],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      // Inject a mock connection with setSessionConfigOption
      const mockSetSessionConfigOption = vi.fn().mockResolvedValue({
        configOptions: [
          {
            id: 'model-selector',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'new-model',
            options: [],
          },
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessions = (manager as any).sessions as Map<string, any>;
      const session = sessions.get('session-config');
      session.connection = { setSessionConfigOption: mockSetSessionConfigOption };

      await manager.setSessionConfigOption('session-config', 'model-selector', 'new-model');

      const listed = await manager.listSessions();
      const updated = listed.find(s => s.id === 'session-config');

      expect(updated?.contextSize).toBeUndefined();
      expect(updated?.contextUsed).toBeUndefined();
      expect(apiSender.send).toHaveBeenCalledWith('acp-session-update');

      await vi.waitFor(() => {
        expect(writeFile).toHaveBeenCalledWith(
          join(FAKE_SESSIONS_DIR, 'session-config.json'),
          expect.any(String),
          'utf-8',
        );
      });
    });

    test('preserves context data when config option category is not model', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile, writeFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(writeFile).mockResolvedValue();
      vi.mocked(readdir).mockResolvedValue(['session-config-other.json' as never]);

      const storedSession = {
        info: {
          id: 'session-config-other',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'completed' as const,
          createdAt: 1000,
          updatedAt: 2000,
          currentModelId: 'some-model',
          contextSize: 200_000,
          contextUsed: 50_000,
          configOptions: [
            {
              id: 'theme-option',
              name: 'Theme',
              category: 'appearance',
              type: 'select' as const,
              currentValue: 'dark',
            },
          ],
        },
        events: [],
        acpSessionId: 'acp-config-other-test',
        agentCommand: ['openclaw', 'acp'],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      const mockSetSessionConfigOption = vi.fn().mockResolvedValue({
        configOptions: [
          {
            id: 'theme-option',
            name: 'Theme',
            category: 'appearance',
            type: 'select',
            currentValue: 'light',
            options: [],
          },
        ],
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sessions = (manager as any).sessions as Map<string, any>;
      const session = sessions.get('session-config-other');
      session.connection = { setSessionConfigOption: mockSetSessionConfigOption };

      await manager.setSessionConfigOption('session-config-other', 'theme-option', 'light');

      const listed = await manager.listSessions();
      const updated = listed.find(s => s.id === 'session-config-other');

      expect(updated?.contextSize).toBe(200_000);
      expect(updated?.contextUsed).toBe(50_000);
    });
  });

  describe('usage_update notification', () => {
    test('notifies subscribers for cost-free usage_update events', async () => {
      const { existsSync } = await import('node:fs');
      const { readdir, readFile } = await import('node:fs/promises');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readdir).mockResolvedValue(['session-usage.json' as never]);

      const storedSession = {
        info: {
          id: 'session-usage',
          sandboxName: 'sb',
          sandboxId: 'sb-id',
          prompt: 'hello',
          status: 'running' as const,
          createdAt: 1000,
          updatedAt: 2000,
        },
        events: [],
        acpSessionId: 'acp-usage-test',
        agentCommand: ['openclaw', 'acp'],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(storedSession));

      await manager.init();

      vi.mocked(apiSender.send).mockClear();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (manager as any).handleSessionUpdate('session-usage', {
        update: {
          sessionUpdate: 'usage_update',
          used: 10_000,
          size: 128_000,
        },
      });

      const listed = await manager.listSessions();
      const updated = listed.find(s => s.id === 'session-usage');
      expect(updated?.contextUsed).toBe(10_000);
      expect(updated?.contextSize).toBe(128_000);
      expect(apiSender.send).toHaveBeenCalledWith('acp-session-update');
    });
  });

  interface MockExecSession {
    pushStderr: (data: string) => void;
    end: (exitCode: number) => void;
  }

  async function setupSdkSession(): Promise<{
    sessionId: string;
    mockExec: MockExecSession;
  }> {
    const { existsSync } = await import('node:fs');
    const { writeFile } = await import('node:fs/promises');

    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(writeFile).mockResolvedValue();

    const agent = createAgentInfo();
    vi.mocked(agentRegistry.getAgent).mockResolvedValue(agent);
    vi.mocked(openshellCli.listSandboxes).mockResolvedValue([createSandbox()]);

    type ExecStreamEvent = { stream: 'stdout' | 'stderr'; data: Buffer } | { type: 'exit'; exitCode: number };
    const events: ExecStreamEvent[] = [];
    let eventResolve: ((result: IteratorResult<ExecStreamEvent>) => void) | undefined;
    let iterDone = false;
    let doneResolve!: (code: number) => void;
    const donePromise = new Promise<number>(r => {
      doneResolve = r;
    });

    const output: AsyncIterable<ExecStreamEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<ExecStreamEvent>> {
            if (events.length > 0) {
              return Promise.resolve({ value: events.shift()!, done: false });
            }
            if (iterDone) {
              return Promise.resolve({ value: undefined as never, done: true });
            }
            return new Promise(r => {
              eventResolve = r;
            });
          },
        };
      },
    };

    const mockSession = {
      output,
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      done: donePromise,
    };

    sdkSandbox.execInteractive.mockResolvedValue(mockSession);

    const mockConnection = {
      initialize: vi.fn().mockResolvedValue({ protocolVersion: '0.1' }),
      newSession: vi.fn().mockResolvedValue({ sessionId: 'acp-1' }),
      prompt: vi.fn().mockReturnValue(new Promise(() => {})),
    };
    vi.mocked(acp.ClientSideConnection).mockImplementation(function () {
      return mockConnection as never;
    });
    vi.mocked(acp.ndJsonStream).mockReturnValue({} as never);

    const options: AcpSessionCreateOptions = {
      sandboxName: 'test-sandbox',
      prompt: 'hello',
      agentId: 'openclaw',
    };

    const session = await manager.createSession(options);

    await vi.waitFor(() => {
      expect(mockConnection.prompt).toHaveBeenCalled();
    });

    function pushEvent(event: ExecStreamEvent): void {
      if (eventResolve) {
        const r = eventResolve;
        eventResolve = undefined;
        r({ value: event, done: false });
      } else {
        events.push(event);
      }
    }

    return {
      sessionId: session.id,
      mockExec: {
        pushStderr: (data: string): void => {
          pushEvent({ stream: 'stderr', data: Buffer.from(data) });
        },
        end: (exitCode: number): void => {
          iterDone = true;
          if (eventResolve) {
            const r = eventResolve;
            eventResolve = undefined;
            r({ value: undefined as never, done: true });
          }
          // Defer done resolution to let the output loop drain queued events first
          queueMicrotask(() => queueMicrotask(() => doneResolve(exitCode)));
        },
      },
    };
  }

  describe('ANSI code stripping in error messages', () => {
    test('strips ANSI escape codes from stderr lines on process exit', async () => {
      const { mockExec, sessionId } = await setupSdkSession();

      mockExec.pushStderr('\x1b[31m×\x1b[0m code: service unavailable');
      mockExec.pushStderr('\x1b[1m\x1b[33mwarning:\x1b[0m connection lost');
      mockExec.end(1);

      await vi.waitFor(async () => {
        const sessions = await manager.listSessions();
        const updatedSession = sessions.find(s => s.id === sessionId);
        expect(updatedSession?.error).toBeDefined();
        expect(updatedSession!.error).not.toContain('\x1b[');
        expect(updatedSession!.error).toContain('code: service unavailable');
        expect(updatedSession!.error).toContain('warning:');
        expect(updatedSession!.error).toContain('connection lost');
      });
    });

    test('handles stderr lines without ANSI codes unchanged', async () => {
      const { mockExec, sessionId } = await setupSdkSession();

      mockExec.pushStderr('plain error message');
      mockExec.end(1);

      await vi.waitFor(async () => {
        const sessions = await manager.listSessions();
        const updatedSession = sessions.find(s => s.id === sessionId);
        expect(updatedSession?.error).toBe('plain error message');
      });
    });

    test('handles empty stderr lines after stripping ANSI codes', async () => {
      const { mockExec, sessionId } = await setupSdkSession();

      mockExec.pushStderr('\x1b[31m×\x1b[0m supervisor relay failed');
      mockExec.end(1);

      await vi.waitFor(async () => {
        const sessions = await manager.listSessions();
        const updatedSession = sessions.find(s => s.id === sessionId);
        expect(updatedSession?.error).toBe('× supervisor relay failed');
      });
    });
  });
});
