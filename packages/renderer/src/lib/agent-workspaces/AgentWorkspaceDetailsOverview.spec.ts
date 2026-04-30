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
import { beforeEach, expect, test, vi } from 'vitest';

import type { AgentWorkspaceConfiguration, AgentWorkspaceSummary } from '/@api/agent-workspace-info';

import AgentWorkspaceDetailsOverview from './AgentWorkspaceDetailsOverview.svelte';

const workspaceSummary: AgentWorkspaceSummary = {
  id: 'ws-1',
  name: 'api-refactor',
  project: 'backend',
  agent: 'coder-v1',
  state: 'stopped',
  model: 'gpt-4o',
  paths: {
    source: '/home/user/projects/backend',
    configuration: '/home/user/.config/kaiden/workspaces/api-refactor.yaml',
  },
  timestamps: { created: 1700000000 },
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
});

test('Expect agent name is displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('coder-v1')).toBeInTheDocument();
});

test('Expect model is displayed when present', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('gpt-4o')).toBeInTheDocument();
});

test('Expect project is displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('Project: backend')).toBeInTheDocument();
});

test('Expect state is displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('stopped')).toBeInTheDocument();
});

test('Expect started shows placeholder dash', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  const dashes = screen.getAllByText('-');
  expect(dashes.length).toBeGreaterThanOrEqual(1);
});

test('Expect directory is displayed', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  const matches = screen.getAllByText('/home/user/projects/backend');
  expect(matches.length).toBeGreaterThanOrEqual(1);
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

  const matches = screen.getAllByText('/home/user/projects/backend');
  expect(matches.length).toBe(2);
});

test('Expect mounts are displayed with access type', () => {
  render(AgentWorkspaceDetailsOverview, { workspaceSummary, configuration });

  expect(screen.getByText('/workspace/shared-lib')).toBeInTheDocument();
  expect(screen.getByText('/workspace/.gitconfig')).toBeInTheDocument();
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
