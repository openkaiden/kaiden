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

import { openshellSandboxes } from '/@/kaiden/stores/openshell-sandboxes';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';
import type { GatewaySandboxes } from '/@api/openshell-gateway-info';

import AgentWorkspaceDetails from './AgentWorkspaceDetails.svelte';

vi.mock(import('tinro'));

const routerStore = writable({
  path: '/agent-workspaces/ws-1/overview',
  url: '/agent-workspaces/ws-1/overview',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

const configuration: AgentWorkspaceConfiguration = {
  mounts: [{ host: '$SOURCES/../shared-lib', target: '$SOURCES/../shared-lib', ro: false }],
  environment: [{ name: 'API_KEY', value: 'test-key' }],
};

const workspaceSummary: GatewaySandboxes = {
  gateway: { canStop: false, canStart: false, name: 'kaiden', endpoint: 'http://localhost:18080' },
  sandboxes: [
    {
      id: 'ws-1',
      name: 'api-refactor',
      phase: 'Unknown',
      sourcePath: '/home/user/projects/backend',
      created_at: Date.now().toString(),
    },
  ],
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
  openshellSandboxes.set([{ ...workspaceSummary }]);
});

test('Expect page title to use workspace overview name', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText('api-refactor')).toBeInTheDocument();
  });
});

test('Expect getAgentWorkspaceConfiguration called with workspace id', () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  expect(window.getAgentWorkspaceConfiguration).toHaveBeenCalledWith('ws-1');
});

test('Expect Overview tab is present', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText('Overview')).toBeInTheDocument();
  });
});

test(`Expect Agent's Terminal and Shell Terminal tabs are present`, async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText(`Agent's Terminal`)).toBeInTheDocument();
    expect(screen.getByText('Shell Terminal')).toBeInTheDocument();
  });
});

test('Expect workspace summary with project is resolved from the store', () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  const storeValue = [workspaceSummary];
  openshellSandboxes.set(storeValue);

  const resolved = get(openshellSandboxes);
  expect(resolved.flatMap(gw => gw.sandboxes).find(ws => ws.id === 'ws-1')?.name).toBe('api-refactor');
});

test('Expect page shell renders when configuration fetch fails', async () => {
  vi.mocked(window.getAgentWorkspaceConfiguration).mockRejectedValue(new Error('EACCES: permission denied'));

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
    expect(screen.getByText('Overview')).toBeInTheDocument();
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
    expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1', 'kaiden');
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

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal-agent');
});

test('Expect clicking terminal redirects to terminal', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Open Terminal' })).toBeInTheDocument();
  });

  const terminalButton = screen.getByRole('button', { name: 'Open Terminal' });
  await fireEvent.click(terminalButton);

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces/ws-1/terminal-agent');
});

test('Expect navigation even when removal fails', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  vi.mocked(window.removeAgentWorkspace).mockRejectedValue(new Error('removal failed'));

  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Remove Workspace' })).toBeInTheDocument();
  });

  const removeButton = screen.getByRole('button', { name: 'Remove Workspace' });
  await fireEvent.click(removeButton);

  await waitFor(() => {
    expect(window.removeAgentWorkspace).toHaveBeenCalledWith('ws-1', 'kaiden');
  });

  expect(router.goto).toHaveBeenCalledWith('/agent-workspaces');
});

test('Expect files tab is not present', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.queryByText('Files')).not.toBeInTheDocument();
  });
});

test('Expect settings tab is present', async () => {
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await waitFor(() => {
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });
});

function setWorkspacePhase(phase: GatewaySandboxes['sandboxes'][number]['phase']): void {
  openshellSandboxes.set([
    { ...workspaceSummary, sandboxes: workspaceSummary.sandboxes.map(sandbox => ({ ...sandbox, phase })) },
  ]);
}

test.each([
  { phase: 'Ready', name: 'Stop Workspace' },
  { phase: 'Stopped', name: 'Start Workspace' },
] as const)('Expect $name button for phase $phase', async ({ phase, name }) => {
  setWorkspacePhase(phase);
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  expect(await screen.findByRole('button', { name })).toBeEnabled();
});

test.each([
  'Starting',
  'Stopping',
  'Provisioning',
  'Deleting',
] as const)('Expect start/stop button disabled while phase is %s', async phase => {
  setWorkspacePhase(phase);
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  const button = await screen.findByRole('button', { name: /^(Start|Stop) Workspace$/ });
  expect(button).toBeDisabled();
});

test('Expect clicking stop button stops the sandbox on its gateway', async () => {
  vi.mocked(window.stopOpenshellSandbox).mockResolvedValue(undefined);
  setWorkspacePhase('Ready');
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await fireEvent.click(await screen.findByRole('button', { name: 'Stop Workspace' }));

  await waitFor(() => expect(window.stopOpenshellSandbox).toHaveBeenCalledWith('api-refactor', 'kaiden'));
  expect(window.startOpenshellSandbox).not.toHaveBeenCalled();
});

test('Expect clicking start button starts the sandbox on its gateway', async () => {
  vi.mocked(window.startOpenshellSandbox).mockResolvedValue(undefined);
  setWorkspacePhase('Stopped');
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await fireEvent.click(await screen.findByRole('button', { name: 'Start Workspace' }));

  await waitFor(() => expect(window.startOpenshellSandbox).toHaveBeenCalledWith('api-refactor', 'kaiden'));
  expect(window.stopOpenshellSandbox).not.toHaveBeenCalled();
});

test('Expect error dialog and re-enabled button when start fails', async () => {
  vi.mocked(window.startOpenshellSandbox).mockRejectedValue(new Error('start failed'));
  setWorkspacePhase('Stopped');
  render(AgentWorkspaceDetails, { workspaceId: 'ws-1' });

  await fireEvent.click(await screen.findByRole('button', { name: 'Start Workspace' }));

  await waitFor(() =>
    expect(window.showMessageBox).toHaveBeenCalledWith({
      title: 'Agent Workspace',
      type: 'error',
      message: 'Error while starting workspace "api-refactor": Error: start failed',
      buttons: ['OK'],
    }),
  );
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeEnabled());
});
