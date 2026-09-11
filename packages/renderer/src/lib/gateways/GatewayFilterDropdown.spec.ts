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

import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import { openshellGateways } from '/@/stores/openshell-gateways';
import type { GatewayInfo } from '/@api/openshell-gateway-info';

import GatewayFilterDropdown from './GatewayFilterDropdown.svelte';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  openshellGateways.set([]);
});

test('should not render when there is only one connected gateway', async () => {
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
  ]);

  render(GatewayFilterDropdown);
  await tick();

  expect(screen.queryByLabelText('Filter by gateway')).not.toBeInTheDocument();
});

test('should not render when there are no gateways', () => {
  render(GatewayFilterDropdown);

  expect(screen.queryByLabelText('Filter by gateway')).not.toBeInTheDocument();
});

test('should render when there are multiple connected gateways', async () => {
  const gateways: GatewayInfo[] = [
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ];
  openshellGateways.set(gateways);

  render(GatewayFilterDropdown);
  await tick();

  expect(screen.getByLabelText('Filter by gateway')).toBeInTheDocument();
});

test('should include All option and each connected gateway name', async () => {
  const gateways: GatewayInfo[] = [
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ];
  openshellGateways.set(gateways);

  render(GatewayFilterDropdown);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);

  expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'local' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'remote' })).toBeInTheDocument();
});

test('should not render when multiple gateways exist but only one is connected', async () => {
  const gateways: GatewayInfo[] = [
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: false, health: 'unhealthy' },
    },
  ];
  openshellGateways.set(gateways);

  render(GatewayFilterDropdown);
  await tick();

  expect(screen.queryByLabelText('Filter by gateway')).not.toBeInTheDocument();
});

test('should exclude disconnected gateways from dropdown options', async () => {
  const gateways: GatewayInfo[] = [
    { name: 'gw-a', endpoint: 'http://a:18080', gatewayState: { reachable: true, health: 'healthy' } },
    { name: 'gw-b', endpoint: 'http://b:18080', gatewayState: { reachable: false, health: 'unhealthy' } },
    { name: 'gw-c', endpoint: 'http://c:18080', gatewayState: { reachable: true, health: 'healthy' } },
  ];
  openshellGateways.set(gateways);

  render(GatewayFilterDropdown);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);

  expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'gw-a' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'gw-b' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'gw-c' })).toBeInTheDocument();
});

test('should not render when all gateways lack gatewayState', async () => {
  const gateways: GatewayInfo[] = [
    { name: 'local', endpoint: 'http://localhost:18080' },
    { name: 'remote', endpoint: 'https://remote.example.com:18080' },
  ];
  openshellGateways.set(gateways);

  render(GatewayFilterDropdown);
  await tick();

  expect(screen.queryByLabelText('Filter by gateway')).not.toBeInTheDocument();
});
