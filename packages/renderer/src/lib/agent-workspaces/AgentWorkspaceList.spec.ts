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

import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import { notificationQueue } from '/@/stores/notifications';
import { openshellGateways } from '/@/stores/openshell-gateways';
import { openshellSandboxes, selectedGateway } from '/@/stores/openshell-sandboxes';
import type { NotificationCard } from '/@api/notification';
import type { GatewayInfo, GatewaySandboxes } from '/@api/openshell-gateway-info';

import AgentWorkspaceList from './AgentWorkspaceList.svelte';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  openshellSandboxes.set([]);
  openshellGateways.set([]);
  selectedGateway.set('');
  notificationQueue.set([]);
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
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: {
        name: 'kaiden',
        endpoint: 'http://localhost:18080',
      },
      sandboxes: [
        {
          id: 'ws-1',
          name: 'api-refactor',
          phase: 'Unknown',
          sourcePath: '/home/user/projects/backend',
          created_at: Date.now().toString(),
        },
      ],
    },
    {
      gateway: {
        name: 'kaiden',
        endpoint: 'http://localhost:18080',
      },
      sandboxes: [
        {
          id: 'ws-2',
          name: 'frontend-redesign',
          phase: 'Ready',
          sourcePath: '/home/user/projects/frontend',
          created_at: Date.now().toString(),
        },
      ],
    },
  ];
  openshellSandboxes.set(workspaces);

  render(AgentWorkspaceList);

  expect(screen.getByText('api-refactor')).toBeInTheDocument();
  expect(screen.getByText('frontend-redesign')).toBeInTheDocument();
  const activeCard = screen.getByText('Active Sessions').closest('div')!;
  const totalCard = screen.getByText('Total Sessions').closest('div')!;
  const agentsCard = screen.getByText('Configured Agents').closest('div')!;

  expect(within(activeCard).getByText('1')).toBeInTheDocument();
  expect(within(totalCard).getByText('2')).toBeInTheDocument();
  expect(within(agentsCard).getByText('0')).toBeInTheDocument();
});

test('Expect page title to be Agentic Workspaces', () => {
  render(AgentWorkspaceList);

  expect(screen.getByText('Agentic Workspaces')).toBeInTheDocument();
});

test('Expect NotificationsBox to be hidden when there are no notifications', () => {
  render(AgentWorkspaceList);

  const notificationsBox = screen.queryByLabelText('Notifications Box');
  expect(notificationsBox).not.toBeInTheDocument();
});

test('Expect NotificationsBox to be visible when there are highlighted notifications', () => {
  const notification: NotificationCard = {
    id: 1,
    extensionId: 'extension',
    title: 'Test notification',
    body: 'Test body',
    type: 'info',
    highlight: true,
  };
  notificationQueue.set([notification]);

  render(AgentWorkspaceList);

  const notificationsBox = screen.queryByLabelText('Notifications Box');
  expect(notificationsBox).toBeInTheDocument();
});

test('Expect gateway filter dropdown is not shown when there is only one connected gateway', async () => {
  render(AgentWorkspaceList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
  ]);
  await tick();

  expect(screen.queryByLabelText('Filter by gateway')).not.toBeInTheDocument();
});

test('Expect gateway filter dropdown is shown when there are multiple connected gateways', async () => {
  const gateways: GatewayInfo[] = [
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ];

  render(AgentWorkspaceList);
  openshellGateways.set(gateways);
  await tick();

  const dropdown = screen.getByLabelText('Filter by gateway');
  expect(dropdown).toBeInTheDocument();
});

test('Expect selecting a gateway filters the workspace list', async () => {
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: { name: 'local', endpoint: 'http://localhost:18080' },
      sandboxes: [{ id: 'ws-1', name: 'local-workspace', phase: 'Ready', created_at: Date.now().toString() }],
    },
    {
      gateway: { name: 'remote', endpoint: 'https://remote.example.com:18080' },
      sandboxes: [{ id: 'ws-2', name: 'remote-workspace', phase: 'Ready', created_at: Date.now().toString() }],
    },
  ];

  render(AgentWorkspaceList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  openshellSandboxes.set(workspaces);
  await tick();

  expect(screen.getByText('local-workspace')).toBeInTheDocument();
  expect(screen.getByText('remote-workspace')).toBeInTheDocument();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'local' }));
  await tick();

  expect(screen.getByText('local-workspace')).toBeInTheDocument();
  expect(screen.queryByText('remote-workspace')).not.toBeInTheDocument();
});

test('Expect "All" option shows all workspaces', async () => {
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: { name: 'local', endpoint: 'http://localhost:18080' },
      sandboxes: [{ id: 'ws-1', name: 'local-workspace', phase: 'Ready', created_at: Date.now().toString() }],
    },
    {
      gateway: { name: 'remote', endpoint: 'https://remote.example.com:18080' },
      sandboxes: [{ id: 'ws-2', name: 'remote-workspace', phase: 'Ready', created_at: Date.now().toString() }],
    },
  ];

  render(AgentWorkspaceList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  openshellSandboxes.set(workspaces);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'local' }));
  await tick();

  expect(screen.queryByText('remote-workspace')).not.toBeInTheDocument();

  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await tick();

  expect(screen.getByText('local-workspace')).toBeInTheDocument();
  expect(screen.getByText('remote-workspace')).toBeInTheDocument();
});

test('Expect checkboxes rendered for each workspace', async () => {
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: { name: 'local', endpoint: 'http://localhost:18080' },
      sandboxes: [
        { id: 'ws-1', name: 'workspace-1', phase: 'Ready', created_at: Date.now().toString() },
        { id: 'ws-2', name: 'workspace-2', phase: 'Ready', created_at: Date.now().toString() },
      ],
    },
  ];

  openshellSandboxes.set(workspaces);
  render(AgentWorkspaceList);
  await tick();

  const checkboxes = screen.getAllByRole('checkbox', { name: 'Toggle openshell-workspaces' });
  expect(checkboxes).toHaveLength(2);
  expect(checkboxes[0]).not.toBeDisabled();
  expect(checkboxes[1]).not.toBeDisabled();
});

test('Expect checkbox disabled for workspace in Deleting phase', async () => {
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: { name: 'local', endpoint: 'http://localhost:18080' },
      sandboxes: [
        { id: 'ws-1', name: 'workspace-1', phase: 'Ready', created_at: Date.now().toString() },
        { id: 'ws-2', name: 'workspace-2', phase: 'Deleting', created_at: Date.now().toString() },
      ],
    },
  ];

  openshellSandboxes.set(workspaces);
  render(AgentWorkspaceList);
  await tick();

  const checkboxes = screen.getAllByRole('checkbox', { name: 'Toggle openshell-workspaces' });
  expect(checkboxes).toHaveLength(2);
  expect(checkboxes[0]).not.toBeDisabled();
  expect(checkboxes[1]).toBeDisabled();
});

test('Expect bulk delete button appears after selecting a workspace', async () => {
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: { name: 'local', endpoint: 'http://localhost:18080' },
      sandboxes: [{ id: 'ws-1', name: 'workspace-1', phase: 'Ready', created_at: Date.now().toString() }],
    },
  ];

  openshellSandboxes.set(workspaces);
  render(AgentWorkspaceList);
  await tick();

  expect(screen.queryByRole('button', { name: /Delete .* selected items/ })).not.toBeInTheDocument();

  const checkbox = screen.getByRole('checkbox', { name: 'Toggle openshell-workspaces' });
  await fireEvent.click(checkbox);

  expect(screen.getByRole('button', { name: 'Delete 1 selected items' })).toBeInTheDocument();
  expect(screen.getByText('On 1 selected items.')).toBeInTheDocument();
});

test('Expect user confirmation for bulk delete when required', async () => {
  const workspaces: GatewaySandboxes[] = [
    {
      gateway: { name: 'local', endpoint: 'http://localhost:18080' },
      sandboxes: [{ id: 'ws-1', name: 'workspace-1', phase: 'Ready', created_at: Date.now().toString() }],
    },
  ];

  openshellSandboxes.set(workspaces);
  render(AgentWorkspaceList);
  await tick();

  const checkbox = screen.getByRole('checkbox', { name: 'Toggle openshell-workspaces' });
  await fireEvent.click(checkbox);

  vi.mocked(window.getConfigurationValue).mockResolvedValue(true);
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  const deleteButton = screen.getByRole('button', { name: 'Delete 1 selected items' });
  await fireEvent.click(deleteButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();

  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  await fireEvent.click(deleteButton);
  expect(window.showMessageBox).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(window.deleteOpenshellSandbox).toHaveBeenCalledWith('workspace-1', 'local'));
});
