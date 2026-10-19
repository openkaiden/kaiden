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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import * as mcpStore from '/@/kaiden/stores/mcp-remote-servers';
import type { SandboxInfoWithGateway } from '/@/kaiden/stores/openshell-sandboxes';
import * as ragStore from '/@/kaiden/stores/rag-environments';
import * as skillsStore from '/@/kaiden/stores/skills';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { RagEnvironment } from '/@api/rag/rag-environment';
import type { SkillInfo } from '/@api/skill/skill-info';

import AgentWorkspaceDetailsSettings from './AgentWorkspaceDetailsSettings.svelte';

vi.mock(import('tinro'));
vi.mock(import('/@/kaiden/stores/skills'));
vi.mock(import('/@/kaiden/stores/rag-environments'));
vi.mock(import('/@/navigation'));
vi.mock(import('/@/kaiden/stores/mcp-remote-servers'));
vi.mock(import('/@/lib/dialogs/messagebox-utils'));

const routerStore = writable({
  path: '/agent-workspaces/ws-1/settings',
  url: '/agent-workspaces/ws-1/settings',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

const workspaceSummary: SandboxInfoWithGateway = {
  id: 'ws-1',
  name: 'api-refactor',
  phase: 'Unknown',
  gatewayName: 'kaiden',
  sourcePath: '/home/user/projects/backend',
  created_at: Date.now().toString(),
};

const configuration: AgentWorkspaceConfiguration = {
  mounts: [{ host: '$SOURCES/../shared-lib', target: '/workspace/shared-lib', ro: false }],
  environment: [{ name: 'API_KEY', value: 'test-key' }],
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  vi.mocked(window.updateAgentWorkspaceConfiguration).mockResolvedValue(undefined);
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([]);
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([]);
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([]);
});

test('Expect General section is active by default with workspace info', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  expect(screen.getByText('Workspace Information')).toBeInTheDocument();
});

test('Expect workspace name is displayed in input', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  expect(nameInput).toHaveValue('api-refactor');
});

test('Expect description is displayed in input when present in configuration', () => {
  const configWithDescription = {
    ...configuration,
    description: 'My workspace description',
  } as AgentWorkspaceConfiguration;
  render(AgentWorkspaceDetailsSettings, {
    workspaceId: 'ws-1',
    workspaceSummary,
    configuration: configWithDescription,
  });

  const descInput = screen.getByRole('textbox', { name: 'Description' });
  expect(descInput).toHaveValue('My workspace description');
  expect(descInput).not.toHaveAttribute('readonly');
});

test('Expect description input is empty when not present in configuration', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const descInput = screen.getByRole('textbox', { name: 'Description' });
  expect(descInput).toHaveValue('');
});

test('Expect editing description shows unsaved changes', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const descInput = screen.getByRole('textbox', { name: 'Description' });
  await fireEvent.input(descInput, { target: { value: 'Updated description' } });

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  expect(window.updateAgentWorkspaceConfiguration).not.toHaveBeenCalled();
});

test('Expect Save changes persists description', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const descInput = screen.getByRole('textbox', { name: 'Description' });
  await fireEvent.input(descInput, { target: { value: 'New description' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', { description: 'New description' });
});

test('Expect Discard changes resets description', async () => {
  const configWithDescription = {
    ...configuration,
    description: 'Original description',
  } as AgentWorkspaceConfiguration;
  render(AgentWorkspaceDetailsSettings, {
    workspaceId: 'ws-1',
    workspaceSummary,
    configuration: configWithDescription,
  });

  const descInput = screen.getByRole('textbox', { name: 'Description' });
  await fireEvent.input(descInput, { target: { value: 'Changed' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  expect(descInput).toHaveValue('Original description');
  expect(screen.getByText('No changes to save')).toBeInTheDocument();
});

test('Expect description shows character counter when non-empty', () => {
  const configWithDescription = {
    ...configuration,
    description: 'Hello',
  } as AgentWorkspaceConfiguration;
  render(AgentWorkspaceDetailsSettings, {
    workspaceId: 'ws-1',
    workspaceSummary,
    configuration: configWithDescription,
  });

  expect(screen.getByText('5/500')).toBeInTheDocument();
});

test('Expect description hides character counter when empty', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  expect(screen.queryByText(/\/500/)).not.toBeInTheDocument();
});

test('Expect working directory is displayed in input', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const dirInput = screen.getByRole('textbox', { name: 'Working Directory' });
  expect(dirInput).toHaveValue('/home/user/projects/backend');
});

test('Expect all settings nav sections are rendered', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  for (const label of ['General', 'Agent Skills', 'MCP Servers', 'Knowledge', 'File Access', 'Network', 'Advanced']) {
    expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
  }
});

test('Expect workspace name input is readonly', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  expect(nameInput).toHaveAttribute('readonly');
});

test('Expect working directory input is readonly', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const dirInput = screen.getByRole('textbox', { name: 'Working Directory' });
  expect(dirInput).toHaveAttribute('readonly');
});

test('Expect empty inputs when workspace summary is undefined', () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary: undefined, configuration: {} });

  const nameInput = screen.getByRole('textbox', { name: 'Workspace Name' });
  expect(nameInput).toHaveValue('');

  const dirInput = screen.getByRole('textbox', { name: 'Working Directory' });
  expect(dirInput).toHaveValue('');
});

test('Expect skills checklist shown when switching to Agent Skills section', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));

  expect(screen.getByText('Skills')).toBeInTheDocument();
  expect(screen.getByText('kubernetes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Manage Skills' })).toBeInTheDocument();
});

test('Expect empty state when no skills available', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));

  expect(screen.getByText('No skills available yet.')).toBeInTheDocument();
});

test('Expect configured skills are pre-selected', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
    { name: 'code-review', description: 'Analyze code', path: '/skills/code-review', enabled: true, managed: true },
  ]);

  const configWithSkills: AgentWorkspaceConfiguration = {
    ...configuration,
    skills: ['/skills/kubernetes'],
  };

  render(AgentWorkspaceDetailsSettings, {
    workspaceId: 'ws-1',
    workspaceSummary,
    configuration: configWithSkills,
  });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));

  expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
});

test('Expect toggling a skill shows save bar without immediate save', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));
  await fireEvent.click(screen.getByRole('button', { name: 'kubernetes' }));

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
  expect(window.updateAgentWorkspaceConfiguration).not.toHaveBeenCalled();
});

test('Expect Save changes persists skill selection', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));
  await fireEvent.click(screen.getByRole('button', { name: 'kubernetes' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    skills: ['/skills/kubernetes'],
  });
});

test('Expect Discard changes resets skill selection', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));
  await fireEvent.click(screen.getByRole('button', { name: 'kubernetes' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
  expect(window.updateAgentWorkspaceConfiguration).not.toHaveBeenCalled();
});

test('Expect removing all skills saves undefined when Save changes clicked', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
  ]);

  const configWithSkills: AgentWorkspaceConfiguration = {
    ...configuration,
    skills: ['/skills/kubernetes'],
  };

  render(AgentWorkspaceDetailsSettings, {
    workspaceId: 'ws-1',
    workspaceSummary,
    configuration: configWithSkills,
  });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));
  await fireEvent.click(screen.getByRole('button', { name: 'kubernetes' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    skills: undefined,
  });
});

test('Expect all skills shown including disabled ones', async () => {
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
    { name: 'disabled-skill', description: 'Not active', path: '/skills/disabled', enabled: false, managed: false },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));

  expect(screen.getByText('kubernetes')).toBeInTheDocument();
  expect(screen.getByText('disabled-skill')).toBeInTheDocument();
});

test('Expect Manage Skills button navigates to skills page', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Manage Skills' }));

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'skills' });
});

test('Expect skills save failure rolls back skill selection', async () => {
  vi.mocked(window.updateAgentWorkspaceConfiguration).mockRejectedValueOnce(new Error('network error'));

  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>([
    { name: 'kubernetes', description: 'Deploy clusters', path: '/skills/kubernetes', enabled: true, managed: false },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Agent Skills' }));
  await fireEvent.click(screen.getByRole('button', { name: 'kubernetes' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
  expect(screen.getByText('0 of 1 selected')).toBeInTheDocument();
});

// --- File Access section tests ---

test('Expect File Access section shows Custom Paths selected for existing custom mounts', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  const customRadio = screen.getByRole('radio', { name: 'Use Custom Paths' });
  expect(customRadio).toBeChecked();
  const hostInput = screen.getByRole('textbox', { name: 'Host path 1' });
  expect(hostInput).toHaveValue('$SOURCES/../shared-lib');
  const targetInput = screen.getByRole('textbox', { name: 'Target path 1' });
  expect(targetInput).toHaveValue('/workspace/shared-lib');
});

test('Expect File Access section defaults to No host filesystem access when no mounts', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  const workspaceRadio = screen.getByRole('radio', { name: 'Use No host filesystem access' });
  expect(workspaceRadio).toBeChecked();
  expect(screen.queryByRole('textbox', { name: 'Host path 1' })).not.toBeInTheDocument();
});

test('Expect selecting Custom Paths shows mount editor with empty mount', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Custom Paths' }));

  expect(screen.getByRole('textbox', { name: 'Host path 1' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Target path 1' })).toBeInTheDocument();
});

test('Expect switching file access mode shows unsaved changes', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Custom Paths' }));

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
});

test('Expect toggling read-only updates the button text', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  const toggleBtn = screen.getByRole('button', { name: 'Toggle read-only for mount 1' });
  expect(toggleBtn).toHaveTextContent('read-write');

  await fireEvent.click(toggleBtn);

  expect(screen.getByRole('button', { name: 'Toggle read-only for mount 1' })).toHaveTextContent('read-only');
});

test('Expect saving custom mount calls updateAgentWorkspaceConfiguration with mount data', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Custom Paths' }));
  const hostInput = screen.getByRole('textbox', { name: 'Host path 1' });
  await fireEvent.input(hostInput, { target: { value: '/home/user/projects' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mounts: [{ host: '/home/user/projects', target: 'projects', ro: false }],
  });
});

test('Expect saving custom mounts calls updateAgentWorkspaceConfiguration', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Custom Paths' }));
  const hostInput = screen.getByRole('textbox', { name: 'Host path 1' });
  await fireEvent.input(hostInput, { target: { value: '/home/user/data' } });
  const targetInput = screen.getByRole('textbox', { name: 'Target path 1' });
  await fireEvent.input(targetInput, { target: { value: '/workspace/data' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mounts: [{ host: '/home/user/data', target: '/workspace/data', ro: false }],
  });
});

test('Expect saving custom mount with empty target defaults to basename of host', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Custom Paths' }));
  const hostInput = screen.getByRole('textbox', { name: 'Host path 1' });
  await fireEvent.input(hostInput, { target: { value: '/home/user/data' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mounts: [{ host: '/home/user/data', target: 'data', ro: false }],
  });
});

test('Expect saving custom mount with trailing separator derives correct basename', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Custom Paths' }));
  const hostInput = screen.getByRole('textbox', { name: 'Host path 1' });
  await fireEvent.input(hostInput, { target: { value: '/home/user/data/' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mounts: [{ host: '/home/user/data/', target: 'data', ro: false }],
  });
});

test('Expect discarding file access changes resets to original mode', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'No host filesystem access' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  const customRadio = screen.getByRole('radio', { name: 'Use Custom Paths' });
  expect(customRadio).toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Host path 1' })).toHaveValue('$SOURCES/../shared-lib');
  expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
});

test('Expect browse button calls openDialog and fills host path', async () => {
  vi.mocked(window.openDialog).mockResolvedValue(['/selected/path']);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const fileAccessNav = screen.getByRole('link', { name: 'File Access' });
  await fireEvent.click(fileAccessNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Browse for directory' }));

  expect(window.openDialog).toHaveBeenCalledWith({ title: 'Select a directory', selectors: ['openDirectory'] });
  expect(screen.getByRole('textbox', { name: 'Host path 1' })).toHaveValue('/selected/path');
});

test('Expect Knowledge section shows checklist with available knowledge bases', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'Project Docs',
      ragConnection: { name: 'ChromaDB', providerId: 'chroma-1' },
      chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
      files: [
        { path: '/docs/api.md', status: 'indexed' },
        { path: '/docs/guide.md', status: 'indexed' },
      ],
      mcpServer: {
        id: 'rag-1',
        name: 'Project Docs MCP',
        description: '',
        url: 'http://localhost:3100/sse',
        infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
        tools: {},
      },
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  expect(screen.getByText('Project Docs')).toBeInTheDocument();
  expect(screen.getByText('2 sources · ChromaDB')).toBeInTheDocument();
});

test('Expect Knowledge section shows empty message when no knowledge bases available', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  expect(screen.getByText('No knowledge bases available yet.')).toBeInTheDocument();
});

test('Expect Knowledge section pre-selects knowledge matching workspace mcp config', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'Project Docs',
      ragConnection: { name: 'ChromaDB', providerId: 'chroma-1' },
      chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
      files: [{ path: '/docs/api.md', status: 'indexed' }],
      mcpServer: {
        id: 'rag-1',
        name: 'Project Docs MCP',
        description: '',
        url: 'http://localhost:3100/sse',
        infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
        tools: {},
      },
    },
    {
      name: 'Wiki',
      ragConnection: { name: 'Weaviate', providerId: 'weav-1' },
      chunkerConnection: { id: 'chunker-2', providerId: 'weav-1' },
      files: [],
      mcpServer: {
        id: 'rag-2',
        name: 'Wiki MCP',
        description: '',
        url: 'http://localhost:3200/sse',
        infos: { internalProviderId: 'p2', serverId: 's2', remoteId: 2 },
        tools: {},
      },
    },
  ]);

  const configWithKnowledge: AgentWorkspaceConfiguration = {
    ...configuration,
    mcp: { servers: [{ name: 'Project Docs MCP', url: 'http://localhost:3100/sse' }] },
  };

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: configWithKnowledge });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
});

test('Expect toggling knowledge base shows unsaved changes', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'Project Docs',
      ragConnection: { name: 'ChromaDB', providerId: 'chroma-1' },
      chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
      files: [],
      mcpServer: {
        id: 'rag-1',
        name: 'Project Docs MCP',
        description: '',
        url: 'http://localhost:3100/sse',
        infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
        tools: {},
      },
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  const itemButton = screen.getByRole('button', { name: 'Project Docs' });
  await fireEvent.click(itemButton);

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
});

test('Expect saving knowledge changes calls updateAgentWorkspaceConfiguration', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'Project Docs',
      ragConnection: { name: 'ChromaDB', providerId: 'chroma-1' },
      chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
      files: [],
      mcpServer: {
        id: 'rag-1',
        name: 'Project Docs MCP',
        description: '',
        url: 'http://localhost:3100/sse',
        infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
        tools: {},
      },
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  const itemButton = screen.getByRole('button', { name: 'Project Docs' });
  await fireEvent.click(itemButton);
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mcp: { servers: [{ name: 'Project Docs MCP', url: 'http://localhost:3100/sse' }] },
  });
});

test('Expect saving knowledge preserves non-knowledge MCP servers', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'Project Docs',
      ragConnection: { name: 'ChromaDB', providerId: 'chroma-1' },
      chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
      files: [],
      mcpServer: {
        id: 'rag-1',
        name: 'Project Docs MCP',
        description: '',
        url: 'http://localhost:3100/sse',
        infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
        tools: {},
      },
    },
  ]);

  const configWithExistingMcp: AgentWorkspaceConfiguration = {
    ...configuration,
    mcp: {
      servers: [{ name: 'GitHub MCP', url: 'https://mcp.github.com/sse' }],
      commands: [{ name: 'Local Tool', command: 'npx', args: ['tool'] }],
    },
  };

  render(AgentWorkspaceDetailsSettings, {
    workspaceId: 'ws-1',
    workspaceSummary,
    configuration: configWithExistingMcp,
  });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  const itemButton = screen.getByRole('button', { name: 'Project Docs' });
  await fireEvent.click(itemButton);
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mcp: {
      servers: [
        { name: 'GitHub MCP', url: 'https://mcp.github.com/sse' },
        { name: 'Project Docs MCP', url: 'http://localhost:3100/sse' },
      ],
      commands: [{ name: 'Local Tool', command: 'npx', args: ['tool'] }],
    },
  });
});

test('Expect discarding knowledge changes resets selection', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'Project Docs',
      ragConnection: { name: 'ChromaDB', providerId: 'chroma-1' },
      chunkerConnection: { id: 'chunker-1', providerId: 'chroma-1' },
      files: [],
      mcpServer: {
        id: 'rag-1',
        name: 'Project Docs MCP',
        description: '',
        url: 'http://localhost:3100/sse',
        infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
        tools: {},
      },
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  const itemButton = screen.getByRole('button', { name: 'Project Docs' });
  await fireEvent.click(itemButton);
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  expect(screen.getByText('No changes to save')).toBeInTheDocument();
  expect(window.updateAgentWorkspaceConfiguration).not.toHaveBeenCalled();
});

test('Expect Knowledge section has Manage Knowledges button', async () => {
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const knowledgeNav = screen.getByRole('link', { name: 'Knowledge' });
  await fireEvent.click(knowledgeNav);

  expect(screen.getByRole('button', { name: 'Manage Knowledges' })).toBeInTheDocument();
});

test('Expect MCP section shows checklist with available servers', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([
    {
      id: 'mcp-1',
      name: 'GitHub MCP',
      description: 'Repos & PRs',
      url: 'https://mcp.github.com/sse',
      infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
      tools: {},
    },
    {
      id: 'mcp-2',
      name: 'Slack MCP',
      description: 'Messaging',
      url: 'https://mcp.slack.com/sse',
      infos: { internalProviderId: 'p2', serverId: 's2', remoteId: 2 },
      tools: {},
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  expect(screen.getByText('GitHub MCP')).toBeInTheDocument();
  expect(screen.getByText('Slack MCP')).toBeInTheDocument();
  expect(screen.getByText('Repos & PRs')).toBeInTheDocument();
});

test('Expect MCP section shows empty message when no servers available', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  expect(screen.getByText('No MCP servers available yet.')).toBeInTheDocument();
});

test('Expect MCP section pre-selects servers matching workspace configuration', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([
    {
      id: 'mcp-1',
      name: 'GitHub MCP',
      description: 'Repos & PRs',
      url: 'https://mcp.github.com/sse',
      infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
      tools: {},
    },
    {
      id: 'mcp-2',
      name: 'Slack MCP',
      description: 'Messaging',
      url: 'https://mcp.slack.com/sse',
      infos: { internalProviderId: 'p2', serverId: 's2', remoteId: 2 },
      tools: {},
    },
  ]);

  const configWithMcp: AgentWorkspaceConfiguration = {
    ...configuration,
    mcp: { servers: [{ name: 'GitHub MCP', url: 'https://mcp.github.com/sse' }] },
  };

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: configWithMcp });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
});

test('Expect toggling MCP server shows unsaved changes', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([
    {
      id: 'mcp-1',
      name: 'GitHub MCP',
      description: 'Repos & PRs',
      url: 'https://mcp.github.com/sse',
      infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
      tools: {},
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  const serverButton = screen.getByRole('button', { name: 'GitHub MCP' });
  await fireEvent.click(serverButton);

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
});

test('Expect saving MCP changes calls updateAgentWorkspaceConfiguration', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([
    {
      id: 'mcp-1',
      name: 'GitHub MCP',
      description: 'Repos & PRs',
      url: 'https://mcp.github.com/sse',
      infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
      tools: {},
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  const serverButton = screen.getByRole('button', { name: 'GitHub MCP' });
  await fireEvent.click(serverButton);
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    mcp: { servers: [{ name: 'GitHub MCP', url: 'https://mcp.github.com/sse' }] },
  });
});

test('Expect discarding MCP changes resets selection', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([
    {
      id: 'mcp-1',
      name: 'GitHub MCP',
      description: 'Repos & PRs',
      url: 'https://mcp.github.com/sse',
      infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
      tools: {},
    },
  ]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  const serverButton = screen.getByRole('button', { name: 'GitHub MCP' });
  await fireEvent.click(serverButton);
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  expect(screen.getByText('No changes to save')).toBeInTheDocument();
  expect(window.updateAgentWorkspaceConfiguration).not.toHaveBeenCalled();
});

test('Expect MCP section has Manage Servers button', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<readonly MCPRemoteServerInfo[]>([]);

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  const mcpNav = screen.getByRole('link', { name: 'MCP Servers' });
  await fireEvent.click(mcpNav);

  expect(screen.getByRole('button', { name: 'Manage Servers' })).toBeInTheDocument();
});

// --- Network section tests ---

test('Expect Network section defaults to Developer Preset when no network config', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  const registriesRadio = screen.getByRole('radio', { name: 'Use Developer Preset' });
  expect(registriesRadio).toBeChecked();
});

test('Expect Network section shows disabled Allow all outbound for allow mode config', async () => {
  const networkConfig: AgentWorkspaceConfiguration = { network: { mode: 'allow' } };
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: networkConfig });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  const openRadio = screen.getByRole('radio', { name: 'Use Allow all outbound' });
  expect(openRadio).toBeChecked();
  expect(openRadio).toBeDisabled();
  expect(screen.queryByRole('radio', { name: 'Use Unrestricted' })).not.toBeInTheDocument();
});

test('Expect Network section shows Deny All selected for deny mode without hosts', async () => {
  const networkConfig: AgentWorkspaceConfiguration = { network: { mode: 'deny' } };
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: networkConfig });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  const blockedRadio = screen.getByRole('radio', { name: 'Use Deny All' });
  expect(blockedRadio).toBeChecked();
});

test('Expect Network section shows Developer Preset selected for deny mode with hosts', async () => {
  const networkConfig: AgentWorkspaceConfiguration = { network: { mode: 'deny', hosts: ['registry.npmjs.org'] } };
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: networkConfig });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  const registriesRadio = screen.getByRole('radio', { name: 'Use Developer Preset' });
  expect(registriesRadio).toBeChecked();
  expect(screen.getByLabelText('Custom host 1')).toHaveValue('registry.npmjs.org');
});

test('Expect switching network mode shows unsaved changes', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));

  expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
});

test('Expect Agent mode radio is disabled', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  expect(screen.getByRole('radio', { name: 'Use Agent mode' })).toBeDisabled();
});

test('Expect saving Deny All mode calls updateAgentWorkspaceConfiguration', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    network: { mode: 'deny', hosts: undefined },
  });
});

test('Expect saving Developer Preset with custom hosts calls updateAgentWorkspaceConfiguration', async () => {
  const networkConfig: AgentWorkspaceConfiguration = { network: { mode: 'deny', hosts: ['registry.npmjs.org'] } };
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: networkConfig });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  await fireEvent.click(screen.getByRole('button', { name: 'Add Another Host' }));
  const inputs = screen.getAllByPlaceholderText('e.g. api.example.com');
  await fireEvent.input(inputs[inputs.length - 1], { target: { value: 'api.example.com' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.updateAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1', {
    network: { mode: 'deny', hosts: ['registry.npmjs.org', 'api.example.com'] },
  });
});

test('Expect discarding network changes resets to original mode', async () => {
  const networkConfig: AgentWorkspaceConfiguration = { network: { mode: 'allow' } };
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: networkConfig });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));

  const openRadio = screen.getByRole('radio', { name: 'Use Allow all outbound' });
  expect(openRadio).toBeChecked();
  expect(openRadio).toBeDisabled();
  expect(screen.queryByText('You have unsaved changes')).not.toBeInTheDocument();
});

test('Expect switching to Developer Preset auto-fills default registry hosts', async () => {
  const networkConfig: AgentWorkspaceConfiguration = { network: { mode: 'deny' } };
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: networkConfig });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Developer Preset' }));

  expect(screen.getByLabelText('Custom host 1')).toHaveValue('registry.npmjs.org');
  expect(screen.getByLabelText('Custom host 2')).toHaveValue('pypi.python.org');
});

test('Expect error dialog shown when network save fails', async () => {
  vi.mocked(window.updateAgentWorkspaceConfiguration).mockRejectedValue(new Error('server error'));
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration: {} });

  const networkNav = screen.getByRole('link', { name: 'Network' });
  await fireEvent.click(networkNav);

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

  expect(window.showMessageBox).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Agent Workspace',
      type: 'error',
      message: expect.stringContaining('server error'),
    }),
  );
});

// --- Advanced / Danger Zone section tests ---

test('Expect Advanced section shows danger zone with delete button', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Advanced' }));

  expect(screen.getByText('Danger Zone')).toBeInTheDocument();
  expect(screen.getByText('Irreversible and destructive actions')).toBeInTheDocument();
  expect(screen.getByText('Delete Workspace')).toBeInTheDocument();
  expect(screen.getByText('Permanently delete this workspace and all its data')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete workspace' })).toBeInTheDocument();
});

test('Expect clicking Delete calls withConfirmation', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Advanced' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));

  expect(withConfirmation).toHaveBeenCalledWith(expect.any(Function), 'remove workspace api-refactor');
});

test('Expect delete confirmation calls removeAgentWorkspace and navigates', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn());
  vi.mocked(window.removeAgentWorkspace).mockResolvedValue({ id: 'ws-1' });

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Advanced' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));

  expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1', 'kaiden');
  await vi.waitFor(() => {
    expect(router.goto).toHaveBeenCalledWith('/agent-workspaces');
  });
});

test('Expect delete confirmation uses workspace ID when name is unavailable', async () => {
  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary: undefined, configuration: {} });

  await fireEvent.click(screen.getByRole('link', { name: 'Advanced' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));

  expect(withConfirmation).toHaveBeenCalledWith(expect.any(Function), 'remove workspace ws-1');
});

test('Expect delete does not proceed when confirmation dialog fails', async () => {
  vi.mocked(withConfirmation).mockImplementation(fn => fn(new Error('dialog error')));

  render(AgentWorkspaceDetailsSettings, { workspaceId: 'ws-1', workspaceSummary, configuration });

  await fireEvent.click(screen.getByRole('link', { name: 'Advanced' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }));

  expect(window.removeAgentWorkspace).not.toHaveBeenCalled();
  expect(router.goto).not.toHaveBeenCalled();
});
