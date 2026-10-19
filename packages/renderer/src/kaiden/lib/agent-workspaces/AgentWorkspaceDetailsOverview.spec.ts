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

import { render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import * as agentsStore from '/@/kaiden/stores/agents';
import * as modelsStore from '/@/kaiden/stores/models';
import type { SandboxInfoWithGateway } from '/@/kaiden/stores/openshell-sandboxes';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';
import type { CatalogModelInfo } from '/@api/model-registry-info';

import AgentWorkspaceDetailsOverview from './AgentWorkspaceDetailsOverview.svelte';

vi.mock(import('/@/kaiden/stores/agents'));
vi.mock(import('/@/kaiden/stores/models'));

const workspaceSummary: SandboxInfoWithGateway = {
  id: 'ws-1',
  name: 'api-refactor',
  gatewayName: 'kaiden',
  phase: 'Unknown',
  sourcePath: '/home/user/projects/backend',
  created_at: Date.now().toString(),
  labels: {
    'ai.openkaiden.kaiden.agent': 'coder-v1',
  },
};

const configuration: AgentWorkspaceConfiguration = {
  mounts: [
    { host: '$SOURCES/../shared-lib', target: '/workspace/shared-lib', ro: false },
    { host: '$HOME/.gitconfig', target: '/workspace/.gitconfig', ro: true },
  ],
  environment: [{ name: 'API_KEY', value: 'test-key' }],
  skills: ['code-review', 'testing'],
  mcp: {
    servers: [{ name: 'RHEL MCP', url: 'http://localhost:3000' }],
    commands: [{ name: 'local-tools', command: 'npx', args: ['-y', 'mcp-tools'] }],
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(agentsStore).agentInfos = writable([
    {
      name: 'Coder V1',
      id: 'coder-v1',
      description: 'coder-v1',
      command: 'coder-v1',
      destinationSkillsFolder: '.coder-v1/skiils',
    },
  ]);
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>([]);
});

test('Expect agent name is displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('Coder V1')).toBeInTheDocument();
});

test('Expect raw model string is displayed when no catalog match', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('Not available')).toBeInTheDocument();
});

test('Expect project path is displayed in agent profile card', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  const profileCard = screen.getByLabelText('Agent profile');
  expect(profileCard).toHaveTextContent('/home/user/projects/backend');
});

test('Expect state is displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('Unknown')).toBeInTheDocument();
});

test('Expect running workspace shows Started label with relative time', () => {
  const runningWorkspace: SandboxInfoWithGateway = {
    ...workspaceSummary,
    phase: 'Ready',
    created_at: new Date(Date.now() - 25 * 60 * 1000).toString(),
  };

  render(AgentWorkspaceDetailsOverview, { workspaceSummary: runningWorkspace, configuration });

  expect(screen.getByText('Started')).toBeInTheDocument();
  expect(screen.getByText('25 min ago')).toBeInTheDocument();
});

test('Expect stopped workspace shows Created label with relative time', () => {
  const stoppedWorkspace = {
    ...workspaceSummary,
    created_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toString(),
  };
  render(AgentWorkspaceDetailsOverview, { workspaceSummary: stoppedWorkspace, configuration });

  expect(screen.getByText('Created')).toBeInTheDocument();
  expect(screen.getByText('3 hr ago')).toBeInTheDocument();
});

test('Expect stopping workspace shows Sandbox Stopping label', () => {
  const stoppingWorkspace: SandboxInfoWithGateway = {
    ...workspaceSummary,
    phase: 'Deleting',
  };
  render(AgentWorkspaceDetailsOverview, { workspaceSummary: stoppingWorkspace, configuration });

  expect(screen.getByText('Sandbox Stopping')).toBeInTheDocument();
});

test('Expect skills are displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('code-review')).toBeInTheDocument();
  expect(screen.getByText('testing')).toBeInTheDocument();
});

test('Expect skills count badge shows correct count', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  const matches = screen.getAllByText('2');
  expect(matches.length).toBeGreaterThanOrEqual(1);
});

test('Expect MCP servers are displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('RHEL MCP')).toBeInTheDocument();
  expect(screen.getByText('local-tools')).toBeInTheDocument();
});

test('Expect filesystem shows workspace source path', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  const filesystemCard = screen.getByLabelText('Filesystem card');
  expect(filesystemCard).toHaveTextContent('/home/user/projects/backend');
});

test('Expect mounts are displayed with access type', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('$SOURCES/../shared-lib')).toBeInTheDocument();
  expect(screen.getByText('$HOME/.gitconfig')).toBeInTheDocument();
});

test('Expect no skills message when configuration has no skills', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration: {} });

  expect(screen.getByText('No skills configured')).toBeInTheDocument();
});

test('Expect no MCP servers message when configuration has no MCP', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration: {} });

  expect(screen.getByText('No MCP servers configured')).toBeInTheDocument();
});

test('Expect component renders without error when workspace is undefined', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary: undefined, configuration: {} });

  expect(screen.queryByText('coder-v1')).not.toBeInTheDocument();
});
