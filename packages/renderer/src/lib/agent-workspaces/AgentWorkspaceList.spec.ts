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

test('Expect workspace cards displayed with total count', () => {
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
    },
  ];
  agentWorkspaces.set(workspaces);

  render(AgentWorkspaceList);

  expect(screen.getByText('api-refactor')).toBeInTheDocument();
  expect(screen.getByText('frontend-redesign')).toBeInTheDocument();
  expect(screen.getByText('/home/user/projects/backend')).toBeInTheDocument();
  expect(screen.getByText('/home/user/projects/frontend')).toBeInTheDocument();
  expect(screen.getByText('2 total sessions')).toBeInTheDocument();
});

test('Expect page title to be Agent Workspaces', () => {
  render(AgentWorkspaceList);

  expect(screen.getByText('Agent Workspaces')).toBeInTheDocument();
});
