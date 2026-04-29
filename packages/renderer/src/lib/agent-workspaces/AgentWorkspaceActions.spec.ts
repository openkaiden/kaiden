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

import AgentWorkspaceActions from './AgentWorkspaceActions.svelte';

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
  timestamps: { created: 1700000000 },
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

test('Expect remove button is rendered', () => {
  render(AgentWorkspaceActions, { object: workspace });

  expect(screen.getByRole('button', { name: 'Remove workspace' })).toBeInTheDocument();
});

test('Expect confirmation dialog shown when remove button clicked', async () => {
  render(AgentWorkspaceActions, { object: workspace });

  const removeButton = screen.getByRole('button', { name: 'Remove workspace' });
  await fireEvent.click(removeButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();
});

test('Expect workspace removed when user confirms', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceActions, { object: workspace });

  const removeButton = screen.getByRole('button', { name: 'Remove workspace' });
  await fireEvent.click(removeButton);

  await vi.waitFor(() => {
    expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1');
  });
});

test('Expect workspace not removed when user cancels', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  render(AgentWorkspaceActions, { object: workspace });

  const removeButton = screen.getByRole('button', { name: 'Remove workspace' });
  await fireEvent.click(removeButton);

  expect(window.removeAgentWorkspace).not.toHaveBeenCalled();
});

test('Expect start button is rendered when workspace is stopped', () => {
  render(AgentWorkspaceActions, { object: workspace });

  expect(screen.getByRole('button', { name: 'Start workspace' })).toBeInTheDocument();
});

test('Expect clicking start button calls startAgentWorkspace', async () => {
  render(AgentWorkspaceActions, { object: workspace });

  const startButton = screen.getByRole('button', { name: 'Start workspace' });
  await fireEvent.click(startButton);

  await vi.waitFor(() => {
    expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('running');
  });
});

test('Expect stop button is rendered when workspace is running', () => {
  render(AgentWorkspaceActions, { object: { ...workspace, state: 'running' } });

  expect(screen.getByRole('button', { name: 'Stop workspace' })).toBeInTheDocument();
});

test('Expect clicking stop button calls stopAgentWorkspace', async () => {
  render(AgentWorkspaceActions, { object: { ...workspace, state: 'running' } });

  const stopButton = screen.getByRole('button', { name: 'Stop workspace' });
  await fireEvent.click(stopButton);

  await vi.waitFor(() => {
    expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('stopped');
  });
});

test('Expect error dialog shown when start fails', async () => {
  vi.mocked(window.startAgentWorkspace).mockRejectedValue(new Error('container not found'));

  render(AgentWorkspaceActions, { object: workspace });

  const startButton = screen.getByRole('button', { name: 'Start workspace' });
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

  render(AgentWorkspaceActions, { object: workspace });

  const startButton = screen.getByRole('button', { name: 'Start workspace' });
  await fireEvent.click(startButton);

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('api-refactor'),
      }),
    );
  });
});

test('Expect terminal button is rendered', () => {
  render(AgentWorkspaceActions, { object: workspace });

  expect(screen.getByRole('button', { name: 'Open terminal for workspace api-refactor' })).toBeInTheDocument();
});

test('Expect clicking terminal button navigates to terminal tab', async () => {
  render(AgentWorkspaceActions, { object: workspace });

  const terminalButton = screen.getByRole('button', { name: 'Open terminal for workspace api-refactor' });
  await fireEvent.click(terminalButton);

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal');
});

test('Expect clicking terminal button starts workspace when stopped', async () => {
  render(AgentWorkspaceActions, { object: workspace });

  const terminalButton = screen.getByRole('button', { name: 'Open terminal for workspace api-refactor' });
  await fireEvent.click(terminalButton);

  expect(window.startAgentWorkspace).toHaveBeenCalledWith('ws-1');
  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal');
});

test('Expect clicking terminal button does not start workspace when already running', async () => {
  agentWorkspaces.set([{ ...workspace, state: 'running' }]);

  render(AgentWorkspaceActions, { object: { ...workspace, state: 'running' } });

  const terminalButton = screen.getByRole('button', { name: 'Open terminal for workspace api-refactor' });
  await fireEvent.click(terminalButton);

  expect(window.startAgentWorkspace).not.toHaveBeenCalled();
  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal');
});

test('Expect error dialog shown when stop fails', async () => {
  vi.mocked(window.stopAgentWorkspace).mockRejectedValue(new Error('stop timeout'));

  render(AgentWorkspaceActions, { object: { ...workspace, state: 'running' } });

  const stopButton = screen.getByRole('button', { name: 'Stop workspace' });
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
