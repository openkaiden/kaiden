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

import { render, screen, within } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import { agentWorkspaces } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceSummary } from '/@api/agent-workspace-info';

import AgentWorkspaceList from './AgentWorkspaceList.svelte';

beforeEach(() => {
  vi.resetAllMocks();
  agentWorkspaces.set([]);
});

test('Expect empty screen when no workspaces', () => {
  render(AgentWorkspaceList);

  expect(screen.getByText('No agent workspaces')).toBeInTheDocument();
});

test('Expect stat cards show zero counts when empty', () => {
  render(AgentWorkspaceList);

  const activeCard = screen.getByText('Active Sessions').closest('div')!;
  const totalCard = screen.getByText('Total Sessions').closest('div')!;
  const agentsCard = screen.getByText('Configured Agents').closest('div')!;

  expect(within(activeCard).getByText('0')).toBeInTheDocument();
  expect(within(totalCard).getByText('0')).toBeInTheDocument();
  expect(within(agentsCard).getByText('0')).toBeInTheDocument();
});

test('Expect stat cards show correct counts with workspaces', () => {
  const workspaces: AgentWorkspaceSummary[] = [
    {
      id: 'ws-1',
      name: 'api-refactor',
      project: 'backend',
      agent: 'coder-v1',
      state: 'stopped',
      paths: {
        source: '/home/user/projects/backend',
        configuration: '/home/user/.config/kaiden/workspaces/api-refactor.yaml',
      },
      timestamps: { created: 1700000000 },
    },
    {
      id: 'ws-2',
      name: 'frontend-redesign',
      project: 'frontend',
      agent: 'coder-v2',
      state: 'running',
      paths: {
        source: '/home/user/projects/frontend',
        configuration: '/home/user/.config/kaiden/workspaces/frontend-redesign.yaml',
      },
      timestamps: { created: 1700000001, started: 1700000002 },
    },
  ];
  agentWorkspaces.set(workspaces);

  render(AgentWorkspaceList);

  expect(screen.getByText('api-refactor')).toBeInTheDocument();
  expect(screen.getByText('frontend-redesign')).toBeInTheDocument();
  const activeCard = screen.getByText('Active Sessions').closest('div')!;
  const totalCard = screen.getByText('Total Sessions').closest('div')!;
  const agentsCard = screen.getByText('Configured Agents').closest('div')!;

  expect(within(activeCard).getByText('1')).toBeInTheDocument();
  expect(within(totalCard).getByText('2')).toBeInTheDocument();
  expect(within(agentsCard).getByText('2')).toBeInTheDocument();
});

test('Expect Active and Stopped section headers when both types exist', () => {
  const workspaces: AgentWorkspaceSummary[] = [
    {
      id: 'ws-1',
      name: 'stopped-ws',
      project: 'proj',
      agent: 'coder-v1',
      state: 'stopped',
      paths: { source: '/src', configuration: '/cfg' },
      timestamps: { created: 1700000000 },
    },
    {
      id: 'ws-2',
      name: 'running-ws',
      project: 'proj',
      agent: 'coder-v1',
      state: 'running',
      paths: { source: '/src', configuration: '/cfg' },
      timestamps: { created: 1700000001, started: 1700000002 },
    },
  ];
  agentWorkspaces.set(workspaces);

  render(AgentWorkspaceList);

  expect(screen.getByLabelText('Active workspaces')).toBeInTheDocument();
  expect(screen.getByLabelText('Stopped workspaces')).toBeInTheDocument();
});

test('Expect only Active section when all workspaces are running', () => {
  const workspaces: AgentWorkspaceSummary[] = [
    {
      id: 'ws-1',
      name: 'running-ws',
      project: 'proj',
      agent: 'coder-v1',
      state: 'running',
      paths: { source: '/src', configuration: '/cfg' },
      timestamps: { created: 1700000000, started: 1700000001 },
    },
  ];
  agentWorkspaces.set(workspaces);

  render(AgentWorkspaceList);

  expect(screen.getByLabelText('Active workspaces')).toBeInTheDocument();
  expect(screen.queryByLabelText('Stopped workspaces')).not.toBeInTheDocument();
});

test('Expect only Stopped section when all workspaces are stopped', () => {
  const workspaces: AgentWorkspaceSummary[] = [
    {
      id: 'ws-1',
      name: 'stopped-ws',
      project: 'proj',
      agent: 'coder-v1',
      state: 'stopped',
      paths: { source: '/src', configuration: '/cfg' },
      timestamps: { created: 1700000000 },
    },
  ];
  agentWorkspaces.set(workspaces);

  render(AgentWorkspaceList);

  expect(screen.queryByLabelText('Active workspaces')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Stopped workspaces')).toBeInTheDocument();
});

test('Expect page title to be Agentic Workspaces', () => {
  render(AgentWorkspaceList);

  expect(screen.getByText('Agentic Workspaces')).toBeInTheDocument();
});
