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
import { writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { openshellGateways, openshellGatewaysReady } from '/@/kaiden/stores/openshell-gateways';
import { MIN_GATEWAY_VERSION } from '/@api/openshell-gateway-info';

import NoUsableGatewayWarning from './NoUsableGatewayWarning.svelte';

vi.mock(import('tinro'));

const routerStore = writable({ path: '/', url: '/', from: '/', query: {} as Record<string, string>, hash: '' });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  routerStore.set({ path: '/', url: '/', from: '/', query: {} as Record<string, string>, hash: '' });
  openshellGateways.set([]);
  openshellGatewaysReady.set(false);
});

test('does not show a warning before gateways are loaded', () => {
  render(NoUsableGatewayWarning);

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('shows a warning after gateways load with no results', async () => {
  render(NoUsableGatewayWarning);

  openshellGatewaysReady.set(true);

  expect(await screen.findByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('opens gateway settings from the warning', async () => {
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  await fireEvent.click(screen.getByRole('button', { name: 'Open gateway settings' }));

  expect(router.goto).toHaveBeenCalledWith('/preferences/openshell/gateways');
});

test('shows a warning when all discoverable gateways are unreachable', () => {
  openshellGateways.set([
    {
      canStop: false,
      canStart: false,
      name: 'stale-local',
      endpoint: 'http://127.0.0.1:17670',
      gatewayState: { reachable: false, health: 'unknown', compatible: true },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('shows a warning when a gateway reachability state is unavailable', () => {
  openshellGateways.set([
    { canStop: false, canStart: false, name: 'loading-local', endpoint: 'http://127.0.0.1:17670' },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('hides the settings button when already on the gateway settings page', () => {
  routerStore.set({
    path: '/preferences/openshell/gateways',
    url: '/',
    from: '/',
    query: {} as Record<string, string>,
    hash: '',
  });
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Open gateway settings' })).not.toBeInTheDocument();
});

test('hides the warning when a gateway becomes available', async () => {
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toBeInTheDocument();

  openshellGateways.set([
    {
      canStop: false,
      canStart: false,
      name: 'local',
      endpoint: 'http://127.0.0.1:17670',
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);

  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('shows a warning with minimum version when all gateways are below the minimum version', () => {
  openshellGateways.set([
    {
      name: 'gw1',
      endpoint: 'http://127.0.0.1:17670',
      canStop: false,
      canStart: false,
      version: '0.0.100',
      gatewayState: { reachable: true, health: 'healthy', compatible: false },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent(
    `No usable OpenShell gateways available. Minimum required version: ${MIN_GATEWAY_VERSION}.`,
  );
});

test('hides the warning when a compatible gateway exists', () => {
  openshellGateways.set([
    {
      name: 'gw1',
      endpoint: 'http://127.0.0.1:17670',
      canStop: false,
      canStart: false,
      version: MIN_GATEWAY_VERSION,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('reports a PID conflict without offering to start until the previous process stops', () => {
  openshellGateways.set([
    {
      name: 'kaiden-local',
      endpoint: 'http://127.0.0.1:29670',
      canStop: false,
      canStart: false,
      gatewayState: {
        reachable: false,
        health: 'unknown',
        compatible: true,
        process: { pid: 4242, status: 'running' },
      },
    },
  ]);
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent(
    'A conflicting process (PID 4242) is blocking the default kaiden-local gateway. Please wait for it to exit before restarting, clear it, or create a new gateway.',
  );
  expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
});

test('shows a start error, and the conflict instead once the gateway enters a PID conflict', async () => {
  vi.mocked(window.startOpenshellGateway).mockRejectedValue(new Error('Port 29670 is busy'));
  const stoppedDefault = {
    name: 'kaiden-local',
    endpoint: 'http://127.0.0.1:29670',
    canStop: false,
    canStart: true,
    gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
  } as const;
  openshellGateways.set([{ ...stoppedDefault }]);
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  await fireEvent.click(screen.getByRole('button', { name: 'Start default gateway' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Port 29670 is busy'));

  openshellGateways.set([
    {
      ...stoppedDefault,
      canStart: false,
      gatewayState: { ...stoppedDefault.gatewayState, process: { pid: 4242, status: 'running' } },
    },
  ]);
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A conflicting process (PID 4242)'));
  expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
});

test('starts a stopped gateway from the warning and shows the start in progress', async () => {
  vi.mocked(window.startOpenshellGateway).mockReturnValue(Promise.withResolvers<void>().promise);
  openshellGateways.set([
    {
      name: 'kaiden-local',
      endpoint: 'http://127.0.0.1:29670',
      canStop: false,
      canStart: true,
      gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
    },
  ]);
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  await fireEvent.click(screen.getByRole('button', { name: 'Start default gateway' }));

  expect(window.startOpenshellGateway).toHaveBeenCalledExactlyOnceWith('kaiden-local');
  expect(screen.getByRole('button', { name: 'Start default gateway' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('does not offer to start when no gateway can be started', () => {
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.queryByRole('button', { name: /^Start/ })).not.toBeInTheDocument();
});

test('names a non-default gateway on the start button', async () => {
  vi.mocked(window.startOpenshellGateway).mockResolvedValue(undefined);
  openshellGateways.set([
    {
      name: 'local-dev',
      endpoint: 'http://127.0.0.1:17675',
      canStop: false,
      canStart: true,
      gatewayState: { reachable: false, health: 'unknown', compatible: true, process: { status: 'not-running' } },
    },
  ]);
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  await fireEvent.click(screen.getByRole('button', { name: 'Start gateway local-dev' }));

  expect(window.startOpenshellGateway).toHaveBeenCalledExactlyOnceWith('local-dev');
});
