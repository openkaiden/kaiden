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
import { beforeEach, expect, test, vi } from 'vitest';

import { extensionInfos } from '/@/stores/extensions';
import { openshellGateways } from '/@/stores/openshell-gateways';
import type { GatewayInfo } from '/@api/openshell-gateway-info';

import PreferencesOpenshellGatewaysRendering from './PreferencesOpenshellGatewaysRendering.svelte';

function setOpenshellStarted(): void {
  extensionInfos.set([
    {
      id: 'kaiden.openshell',
      name: 'openshell',
      description: '',
      displayName: 'OpenShell',
      publisher: 'kaiden',
      removable: false,
      devMode: false,
      version: '0.4.0',
      state: 'started',
      path: '',
      readme: '',
    },
  ]);
}

beforeEach(() => {
  vi.resetAllMocks();
  extensionInfos.set([]);
  openshellGateways.set([]);
  vi.mocked(window.isFreePort).mockResolvedValue(true);
  vi.mocked(window.createLocalGateway).mockResolvedValue([]);
});

test.each([true, false])('stops a managed gateway (active: %s)', async active => {
  setOpenshellStarted();
  const gateway: GatewayInfo = { name: 'local-dev', endpoint: 'http://localhost:17675', active, canStop: true };
  openshellGateways.set([gateway]);
  const pending = Promise.withResolvers<void>();
  vi.mocked(window.stopOpenshellGateway).mockReturnValue(pending.promise);
  render(PreferencesOpenshellGatewaysRendering);
  const button = screen.getByRole('button', { name: 'Stop gateway local-dev' });
  expect(button).toHaveAttribute('title', 'Stop gateway local-dev');
  expect(button).not.toHaveTextContent('Stop');
  await fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(button).toHaveClass('disabled');
  await fireEvent.click(button);
  expect(window.stopOpenshellGateway).toHaveBeenCalledExactlyOnceWith('local-dev');
  openshellGateways.set([{ ...gateway, canStop: false }]);
  pending.resolve();
  await vi.waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Stop gateway local-dev' })).not.toBeInTheDocument(),
  );
  expect(screen.getByText('local-dev')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /restart|start gateway/i })).not.toBeInTheDocument();
});

test('does not offer stopping an unowned or stopped gateway', () => {
  setOpenshellStarted();
  openshellGateways.set([
    { canStop: false, name: 'remote', endpoint: 'https://example.com', is_remote: true },
    { name: 'stopped', endpoint: 'http://localhost:17675', canStop: false },
  ]);
  render(PreferencesOpenshellGatewaysRendering);
  expect(screen.queryByRole('button', { name: /Stop gateway/ })).not.toBeInTheDocument();
});

test('shows stop errors and permits retry', async () => {
  setOpenshellStarted();
  openshellGateways.set([{ name: 'local-dev', endpoint: 'http://localhost:17675', canStop: true }]);
  vi.mocked(window.stopOpenshellGateway).mockRejectedValueOnce(new Error('Permission denied'));
  render(PreferencesOpenshellGatewaysRendering);
  const button = screen.getByRole('button', { name: 'Stop gateway local-dev' });
  await fireEvent.click(button);
  expect(await screen.findByText(/Permission denied/)).toBeInTheDocument();
  expect(button).toBeEnabled();
  vi.mocked(window.stopOpenshellGateway).mockResolvedValue(undefined);
  await fireEvent.click(button);
  expect(window.stopOpenshellGateway).toHaveBeenCalledTimes(2);
});

test('creates a gateway after confirming the selected port is available', async () => {
  setOpenshellStarted();
  render(PreferencesOpenshellGatewaysRendering);
  await fireEvent.click(screen.getByRole('button', { name: 'Create local gateway' }));
  expect(screen.getByLabelText('Gateway bind address')).toBeDisabled();
  const createButton = await screen.findByRole('button', { name: 'Create' });
  await vi.waitFor(() => expect(createButton).toBeEnabled());
  await fireEvent.click(createButton);

  expect(window.isFreePort).toHaveBeenCalledWith(17675);
  expect(window.createLocalGateway).toHaveBeenCalledWith({
    name: 'local-gateway',
    bindAddress: '127.0.0.1',
    port: 17675,
    driver: 'podman',
  });
});

test('disables creation while the selected port is in use', async () => {
  vi.mocked(window.isFreePort).mockImplementation(port =>
    port === 17676 ? Promise.reject(new Error('Port 17676 is already in use.')) : Promise.resolve(true),
  );
  setOpenshellStarted();
  render(PreferencesOpenshellGatewaysRendering);
  await fireEvent.click(screen.getByRole('button', { name: 'Create local gateway' }));
  await fireEvent.input(screen.getByLabelText('Gateway port'), { target: { value: '17676' } });

  await screen.findByText('Port 17676 is already in use');
  expect(window.isFreePort).toHaveBeenLastCalledWith(17676);
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  expect(window.createLocalGateway).not.toHaveBeenCalled();
});

test('prevents creating the reserved Kaiden gateway name', async () => {
  setOpenshellStarted();
  render(PreferencesOpenshellGatewaysRendering);
  await fireEvent.click(screen.getByRole('button', { name: 'Create local gateway' }));
  await fireEvent.input(screen.getByLabelText('Gateway name'), { target: { value: 'kaiden-local' } });

  expect(await screen.findByText('"kaiden-local" is reserved by Kaiden')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  expect(window.createLocalGateway).not.toHaveBeenCalled();
});

test('shows not-running message when OpenShell extension is not started', () => {
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('OpenShell extension is not running')).toBeInTheDocument();
});

test('shows empty screen when extension is started but no gateways are registered', () => {
  setOpenshellStarted();
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('No gateways found')).toBeInTheDocument();
});

test('create gateway button is visible inside empty screen when no gateways exist', () => {
  setOpenshellStarted();
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('No gateways found')).toBeInTheDocument();
  const createButton = screen.getByRole('button', { name: 'Create local gateway' });
  expect(createButton).toBeVisible();
});

test('displays active gateway in the Active Gateway section', () => {
  setOpenshellStarted();
  const activeGateway: GatewayInfo = {
    canStop: false,
    name: 'kaiden-local',
    endpoint: 'http://127.0.0.1:17670',
    active: true,
    type: 'local',
    gatewayState: { reachable: true, health: 'healthy' },
  };
  openshellGateways.set([activeGateway]);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('Active Gateway')).toBeInTheDocument();
  expect(screen.getByText('kaiden-local')).toBeInTheDocument();
  expect(screen.getByText('Managed')).toBeInTheDocument();
  expect(screen.getByText('local · http://127.0.0.1:17670 · Connected')).toBeInTheDocument();

  const statusDot = screen.getAllByLabelText('Gateway state')[0];
  expect(statusDot).toHaveClass('bg-(--pd-status-running)');

  expect(screen.queryByText('Other Gateways')).not.toBeInTheDocument();
});

test('displays non-active gateways in Other Gateways section', () => {
  setOpenshellStarted();
  const gateways: GatewayInfo[] = [
    { canStop: false, name: 'kaiden-local', endpoint: 'http://127.0.0.1:17670', active: true, type: 'local' },
    {
      canStop: false,
      name: 'production',
      endpoint: 'https://gateway.example.com',
      active: false,
      type: 'remote',
      is_remote: true,
      remote_host: 'user@gateway.example.com',
    },
  ];
  openshellGateways.set(gateways);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('Active Gateway')).toBeInTheDocument();
  expect(screen.getByText('Other Gateways')).toBeInTheDocument();
  expect(screen.getByText('production')).toBeInTheDocument();
  expect(screen.getByText('Referenced')).toBeInTheDocument();
  expect(screen.getByText('remote · https://gateway.example.com · Unknown')).toBeInTheDocument();
});

test('shows Referenced badge for non-local gateways', () => {
  setOpenshellStarted();
  const gateways: GatewayInfo[] = [
    { canStop: false, name: 'remote-gw', endpoint: 'https://remote.example.com', active: false, type: 'remote' },
  ];
  openshellGateways.set(gateways);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('Referenced')).toBeInTheDocument();
});

test('shows Referenced badge for a local gateway not managed by Kaiden', () => {
  setOpenshellStarted();
  const gateways: GatewayInfo[] = [
    { canStop: false, name: 'local-gw', endpoint: 'http://localhost:17670', active: true, type: 'local' },
  ];
  openshellGateways.set(gateways);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('Referenced')).toBeInTheDocument();
});

test('hides empty screen when gateways exist', () => {
  setOpenshellStarted();
  openshellGateways.set([{ canStop: false, name: 'gw', endpoint: 'http://localhost:17670', active: true }]);
  render(PreferencesOpenshellGatewaysRendering);

  const emptyTitle = screen.queryByText('No gateways found');
  expect(emptyTitle).toBeInTheDocument();
  expect(emptyTitle?.closest('[hidden]') ?? emptyTitle?.closest('.hidden')).toBeTruthy();
});

test('renders multiple non-active gateways', () => {
  setOpenshellStarted();
  const gateways: GatewayInfo[] = [
    { canStop: false, name: 'active-gw', endpoint: 'http://localhost:17670', active: true, type: 'local' },
    {
      canStop: false,
      name: 'team-shared',
      endpoint: 'https://team.example.com',
      active: false,
      type: 'remote',
      is_remote: true,
    },
    { canStop: false, name: 'dev-remote', endpoint: 'https://dev.example.com', active: false, type: 'remote' },
  ];
  openshellGateways.set(gateways);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('team-shared')).toBeInTheDocument();
  expect(screen.getByText('dev-remote')).toBeInTheDocument();
});

test('shows unknown state text and color when gatewayState is undefined', () => {
  setOpenshellStarted();
  openshellGateways.set([{ canStop: false, name: 'no-state-gw', endpoint: 'http://localhost:17670', active: true }]);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('http://localhost:17670 · Unknown')).toBeInTheDocument();
  const statusDot = screen.getByLabelText('Gateway state');
  expect(statusDot).toHaveClass('bg-(--pd-status-unknown)');
});

test('shows disconnected state text and stopped color when gateway is unreachable', () => {
  setOpenshellStarted();
  openshellGateways.set([
    {
      canStop: false,
      name: 'unreachable-gw',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: false, health: 'unknown' },
    },
  ]);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('http://localhost:17670 · Disconnected')).toBeInTheDocument();
  const statusDot = screen.getByLabelText('Gateway state');
  expect(statusDot).toHaveClass('bg-(--pd-status-stopped)');
});

test('shows degraded state text and color for degraded gateway', () => {
  setOpenshellStarted();
  openshellGateways.set([
    {
      canStop: false,
      name: 'degraded-gw',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'degraded' },
    },
  ]);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('http://localhost:17670 · Degraded')).toBeInTheDocument();
  const statusDot = screen.getByLabelText('Gateway state');
  expect(statusDot).toHaveClass('bg-(--pd-status-degraded)');
});

test('shows unhealthy state text and terminated color for unhealthy gateway', () => {
  setOpenshellStarted();
  openshellGateways.set([
    {
      canStop: false,
      name: 'unhealthy-gw',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'unhealthy' },
    },
  ]);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('http://localhost:17670 · Unhealthy')).toBeInTheDocument();
  const statusDot = screen.getByLabelText('Gateway state');
  expect(statusDot).toHaveClass('bg-(--pd-status-terminated)');
});

test('shows connected state text and running color for healthy gateway', () => {
  setOpenshellStarted();
  openshellGateways.set([
    {
      canStop: false,
      name: 'healthy-gw',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  render(PreferencesOpenshellGatewaysRendering);

  expect(screen.getByText('http://localhost:17670 · Connected')).toBeInTheDocument();
  const statusDot = screen.getByLabelText('Gateway state');
  expect(statusDot).toHaveClass('bg-(--pd-status-running)');
});
