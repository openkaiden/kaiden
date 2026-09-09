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
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { openshellGateways, openshellGatewaysReady } from '/@/stores/openshell-gateways';

import NoUsableGatewayWarning from './NoUsableGatewayWarning.svelte';

vi.mock(import('tinro'));

beforeEach(() => {
  vi.resetAllMocks();
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
      name: 'stale-local',
      endpoint: 'http://127.0.0.1:17670',
      gatewayState: { reachable: false, health: 'unknown' },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('shows a warning when a gateway reachability state is unavailable', () => {
  openshellGateways.set([
    {
      name: 'loading-local',
      endpoint: 'http://127.0.0.1:17670',
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('hides the warning when a gateway becomes available', async () => {
  openshellGatewaysReady.set(true);
  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toBeInTheDocument();

  openshellGateways.set([
    {
      name: 'local',
      endpoint: 'http://127.0.0.1:17670',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);

  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('shows a warning when all gateways are below the minimum version', () => {
  openshellGateways.set([
    {
      name: 'gw1',
      endpoint: 'http://127.0.0.1:17670',
      version: '0.1.0',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.getByRole('alert')).toHaveTextContent('No usable OpenShell gateways available.');
});

test('hides the warning when a compatible gateway exists', () => {
  openshellGateways.set([
    {
      name: 'gw1',
      endpoint: 'http://127.0.0.1:17670',
      version: '0.4.0',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('treats a gateway without a version as compatible', () => {
  openshellGateways.set([
    {
      name: 'gw1',
      endpoint: 'http://127.0.0.1:17670',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  openshellGatewaysReady.set(true);

  render(NoUsableGatewayWarning);

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
