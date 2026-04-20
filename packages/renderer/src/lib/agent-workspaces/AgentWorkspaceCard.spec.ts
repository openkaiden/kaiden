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
import { get } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { agentWorkspaces } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceSummary } from '/@api/agent-workspace-info';

import AgentWorkspaceCard from './AgentWorkspaceCard.svelte';

vi.mock(import('tinro'));

const workspace: AgentWorkspaceSummary = {
  id: 'ws-1',
  name: 'api-refactor',
  project: 'backend',
  agent: 'coder-v1',
  state: 'stopped',
  paths: {
    source: '/home/user/projects/backend',
    configuration: '/home/user/.config/kaiden/workspaces/api-refactor.yaml',
  },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });
  vi.mocked(window.removeAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  vi.mocked(window.listAgentWorkspaces).mockResolvedValue([]);
  vi.mocked(window.startAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  vi.mocked(window.stopAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  agentWorkspaces.set([{ ...workspace }]);
});

test('Expect card displays workspace name', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByText('api-refactor')).toBeInTheDocument();
});

test('Expect card displays project name', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByText('backend')).toBeInTheDocument();
});

test('Expect card displays source path', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByText('/home/user/projects/backend')).toBeInTheDocument();
});

test('Expect card displays configuration path', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByText('/home/user/.config/kaiden/workspaces/api-refactor.yaml')).toBeInTheDocument();
});

test('Expect card displays model when present', () => {
  const wsWithModel: AgentWorkspaceSummary = { ...workspace, model: 'gpt-4o' };

  render(AgentWorkspaceCard, { workspace: wsWithModel });

  expect(screen.getByText('gpt-4o')).toBeInTheDocument();
});

test('Expect card does not display model when absent', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.queryByTitle(workspace.model ?? '')).not.toBeInTheDocument();
});

test('Expect card has aria label with workspace name', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByRole('button', { name: 'workspace api-refactor' })).toBeInTheDocument();
});

test('Expect remove button is rendered', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByRole('button', { name: 'Remove workspace api-refactor' })).toBeInTheDocument();
});

test('Expect confirmation dialog shown when remove button clicked', async () => {
  render(AgentWorkspaceCard, { workspace });

  const removeButton = screen.getByRole('button', { name: 'Remove workspace api-refactor' });
  await fireEvent.click(removeButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();
});

test('Expect workspace removed when user confirms', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceCard, { workspace });

  const removeButton = screen.getByRole('button', { name: 'Remove workspace api-refactor' });
  await fireEvent.click(removeButton);

  await vi.waitFor(() => {
    expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1');
  });
});

test('Expect workspace not removed when user cancels', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  render(AgentWorkspaceCard, { workspace });

  const removeButton = screen.getByRole('button', { name: 'Remove workspace api-refactor' });
  await fireEvent.click(removeButton);

  expect(window.removeAgentWorkspace).not.toHaveBeenCalled();
});

test('Expect clicking card navigates to workspace detail view', async () => {
  render(AgentWorkspaceCard, { workspace });

  const card = screen.getByRole('button', { name: 'workspace api-refactor' });
  await fireEvent.click(card);

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/summary');
});

test('Expect start button is rendered when workspace is stopped', () => {
  render(AgentWorkspaceCard, { workspace });

  expect(screen.getByRole('button', { name: 'Start workspace api-refactor' })).toBeInTheDocument();
});

test('Expect clicking start button calls startAgentWorkspace', async () => {
  render(AgentWorkspaceCard, { workspace });

  const startButton = screen.getByRole('button', { name: 'Start workspace api-refactor' });
  await fireEvent.click(startButton);

  await vi.waitFor(() => {
    expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('running');
  });
});

test('Expect stop button is rendered when workspace is running', async () => {
  render(AgentWorkspaceCard, { workspace: { ...workspace, state: 'running' } });

  expect(screen.getByRole('button', { name: 'Stop workspace api-refactor' })).toBeInTheDocument();
});

test('Expect clicking stop button calls stopAgentWorkspace', async () => {
  render(AgentWorkspaceCard, { workspace: { ...workspace, state: 'running' } });

  const stopButton = screen.getByRole('button', { name: 'Stop workspace api-refactor' });
  await fireEvent.click(stopButton);

  await vi.waitFor(() => {
    expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('stopped');
  });
});

test('Expect error dialog shown when start fails', async () => {
  vi.mocked(window.startAgentWorkspace).mockRejectedValue(new Error('container not found'));

  render(AgentWorkspaceCard, { workspace });

  const startButton = screen.getByRole('button', { name: 'Start workspace api-refactor' });
  await fireEvent.click(startButton);

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Agent Workspace',
        type: 'error',
        message: expect.stringContaining('container not found'),
      }),
    );
  });

  expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('stopped');
});

test('Expect error dialog uses workspace name when start fails', async () => {
  vi.mocked(window.startAgentWorkspace).mockRejectedValue(new Error('start failed'));

  render(AgentWorkspaceCard, { workspace });

  const startButton = screen.getByRole('button', { name: 'Start workspace api-refactor' });
  await fireEvent.click(startButton);

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('api-refactor'),
      }),
    );
  });
});

test('Expect error dialog shown when stop fails', async () => {
  vi.mocked(window.stopAgentWorkspace).mockRejectedValue(new Error('stop timeout'));

  render(AgentWorkspaceCard, { workspace: { ...workspace, state: 'running' } });

  const stopButton = screen.getByRole('button', { name: 'Stop workspace api-refactor' });
  await fireEvent.click(stopButton);

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Agent Workspace',
        type: 'error',
        message: expect.stringContaining('stop timeout'),
      }),
    );
  });

  expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('running');
});
