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

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get, writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { agentWorkspaces } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceConfiguration, AgentWorkspaceSummary } from '/@api/agent-workspace-info';

import AgentWorkspaceDetails from './AgentWorkspaceDetails.svelte';

vi.mock(import('tinro'));

const routerStore = writable({
  path: '/agent-workspaces/ws-1/summary',
  url: '/agent-workspaces/ws-1/summary',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

const configuration: AgentWorkspaceConfiguration = {
  mounts: [{ host: '$SOURCES/../shared-lib', target: '$SOURCES/../shared-lib', ro: false }],
  environment: [{ name: 'API_KEY', value: 'test-key' }],
};

const workspaceSummary: AgentWorkspaceSummary = {
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
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  vi.mocked(window.getAgentWorkspaceConfiguration).mockResolvedValue(configuration);
  vi.mocked(window.startAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  vi.mocked(window.stopAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });
  vi.mocked(window.removeAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  agentWorkspaces.set([{ ...workspaceSummary }]);
});

test('Expect page title to use workspace summary name', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText('api-refactor')).toBeInTheDocument();
  });
});

test('Expect getAgentWorkspaceConfiguration called with workspace id', () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  expect(window.getAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1');
});

test('Expect Summary tab is present', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });
});

test('Expect Terminal tab is present', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });
});

test('Expect workspace summary with project is resolved from the store', () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  const storeValue = [workspaceSummary];
  agentWorkspaces.set(storeValue);

  const resolved = get(agentWorkspaces);
  expect(resolved.find(ws => ws.id === 'ws-1')?.project).toBe('backend');
});

test('Expect page shell renders when configuration fetch fails', async () => {
  vi.mocked(window.getAgentWorkspaceConfiguration).mockRejectedValue(new Error('EACCES: permission denied'));

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
    expect(screen.getByText('Summary')).toBeInTheDocument();
  });
});

test('Expect start button is rendered when workspace is stopped', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeInTheDocument();
  });
});

test('Expect clicking start button transitions workspace to running', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeInTheDocument();
  });

  const startButton = screen.getByRole('button', { name: 'Start Workspace' });
  await fireEvent.click(startButton);

  await waitFor(() => {
    expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('running');
  });
});

test('Expect stop button is rendered when workspace is running', async () => {
  agentWorkspaces.set([{ ...workspaceSummary, state: 'running' }]);

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Stop Workspace' })).toBeInTheDocument();
  });
});

test('Expect clicking stop button transitions workspace to stopped', async () => {
  agentWorkspaces.set([{ ...workspaceSummary, state: 'running' }]);

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Stop Workspace' })).toBeInTheDocument();
  });

  const stopButton = screen.getByRole('button', { name: 'Stop Workspace' });
  await fireEvent.click(stopButton);

  await waitFor(() => {
    expect(get(agentWorkspaces).find(w => w.id === 'ws-1')?.state).toBe('stopped');
  });
});

test('Expect remove button is rendered', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
  });
});

test('Expect confirmation dialog shown when remove button clicked', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
  });

  const removeButton = screen.getByRole('button', { name: 'Remove Workspace' });
  await fireEvent.click(removeButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();
});

test('Expect workspace removed and navigated to list when user confirms', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
  });

  const removeButton = screen.getByRole('button', { name: 'Remove Workspace' });
  await fireEvent.click(removeButton);

  await waitFor(() => {
    expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1');
  });

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces');
});

test('Expect workspace not removed when user cancels', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
  });

  const removeButton = screen.getByRole('button', { name: 'Remove Workspace' });
  await fireEvent.click(removeButton);

  expect(window.removeAgentWorkspace).not.toHaveBeenCalled();
  expect(router.goto).not.toHaveBeenCalled();
});

test('Expect error dialog shown when start fails', async () => {
  vi.mocked(window.startAgentWorkspace).mockRejectedValue(new Error('container not found'));

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeInTheDocument();
  });

  const startButton = screen.getByRole('button', { name: 'Start Workspace' });
  await fireEvent.click(startButton);

  await waitFor(() => {
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

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeInTheDocument();
  });

  const startButton = screen.getByRole('button', { name: 'Start Workspace' });
  await fireEvent.click(startButton);

  await waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('api-refactor'),
      }),
    );
  });
});

test('Expect terminal button is rendered', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open Terminal' })).toBeInTheDocument();
  });
});

test('Expect clicking terminal button navigates to terminal tab', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open Terminal' })).toBeInTheDocument();
  });

  const terminalButton = screen.getByRole('button', { name: 'Open Terminal' });
  await fireEvent.click(terminalButton);

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal');
});

test('Expect clicking terminal button starts workspace when stopped', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open Terminal' })).toBeInTheDocument();
  });

  const terminalButton = screen.getByRole('button', { name: 'Open Terminal' });
  await fireEvent.click(terminalButton);

  expect(window.startAgentWorkspace).toHaveBeenCalledWith('ws-1');
  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal');
});

test('Expect clicking terminal button does not start workspace when already running', async () => {
  agentWorkspaces.set([{ ...workspaceSummary, state: 'running' }]);

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open Terminal' })).toBeInTheDocument();
  });

  const terminalButton = screen.getByRole('button', { name: 'Open Terminal' });
  await fireEvent.click(terminalButton);

  expect(window.startAgentWorkspace).not.toHaveBeenCalled();
  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal');
});

test('Expect error dialog shown when stop fails', async () => {
  agentWorkspaces.set([{ ...workspaceSummary, state: 'running' }]);
  vi.mocked(window.stopAgentWorkspace).mockRejectedValue(new Error('stop timeout'));

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Stop Workspace' })).toBeInTheDocument();
  });

  const stopButton = screen.getByRole('button', { name: 'Stop Workspace' });
  await fireEvent.click(stopButton);

  await waitFor(() => {
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

test('Expect no navigation when removal fails', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  vi.mocked(window.removeAgentWorkspace).mockRejectedValue(new Error('removal failed'));

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
  });

  const removeButton = screen.getByRole('button', { name: 'Remove Workspace' });
  await fireEvent.click(removeButton);

  await waitFor(() => {
    expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1');
  });

  expect(router.goto).not.toHaveBeenCalled();
});
