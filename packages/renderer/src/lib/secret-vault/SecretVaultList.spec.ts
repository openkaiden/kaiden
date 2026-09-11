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
import { secretVaultInfos, secretVaultSearchPattern, selectedGateway } from '/@/stores/secret-vault';
import type { GatewayInfo } from '/@api/openshell-gateway-info';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import SecretVaultList from './SecretVaultList.svelte';

const localSecret: SecretVaultInfo = {
  id: 'local/github-pat',
  name: 'github-pat',
  type: 'github',
  gateway: 'local',
};

const remoteSecret: SecretVaultInfo = {
  id: 'remote/anthropic-key',
  name: 'anthropic-key',
  type: 'anthropic',
  gateway: 'remote',
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  secretVaultInfos.set([]);
  secretVaultSearchPattern.set('');
  selectedGateway.set('');
  openshellGateways.set([]);
});

test('Expect empty screen when no secrets', () => {
  render(SecretVaultList);

  expect(screen.getByText('No secrets')).toBeInTheDocument();
});

test('Expect page title to be Secret Vault', () => {
  render(SecretVaultList);

  expect(screen.getByText('Secret Vault')).toBeInTheDocument();
});

test('Expect secrets table when secrets exist', () => {
  secretVaultInfos.set([localSecret, remoteSecret]);

  render(SecretVaultList);

  expect(screen.getByText('github-pat')).toBeInTheDocument();
  expect(screen.getByText('anthropic-key')).toBeInTheDocument();
});

test('Expect gateway filter dropdown is not shown when there is only one connected gateway', async () => {
  render(SecretVaultList);
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

  render(SecretVaultList);
  openshellGateways.set(gateways);
  await tick();

  const dropdown = screen.getByLabelText('Filter by gateway');
  expect(dropdown).toBeInTheDocument();
});

test('Expect selecting a gateway filters the secrets list', async () => {
  render(SecretVaultList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  secretVaultInfos.set([localSecret, remoteSecret]);
  await tick();

  expect(screen.getByText('github-pat')).toBeInTheDocument();
  expect(screen.getByText('anthropic-key')).toBeInTheDocument();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'local' }));
  await tick();

  expect(screen.getByText('github-pat')).toBeInTheDocument();
  expect(screen.queryByText('anthropic-key')).not.toBeInTheDocument();
});

test('Expect "All" option shows all secrets', async () => {
  render(SecretVaultList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  secretVaultInfos.set([localSecret, remoteSecret]);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'local' }));
  await tick();

  expect(screen.queryByText('anthropic-key')).not.toBeInTheDocument();

  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'All' }));
  await tick();

  expect(screen.getByText('github-pat')).toBeInTheDocument();
  expect(screen.getByText('anthropic-key')).toBeInTheDocument();
});

test('Expect combined gateway and search filters are applied together', async () => {
  render(SecretVaultList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  secretVaultInfos.set([localSecret, remoteSecret]);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'local' }));
  await tick();

  expect(screen.getByText('github-pat')).toBeInTheDocument();

  const searchField = screen.getByPlaceholderText('Search Secret Vault...');
  await fireEvent.input(searchField, { target: { value: 'anthropic' } });
  await tick();

  expect(screen.queryByText('github-pat')).not.toBeInTheDocument();
  expect(screen.queryByText('anthropic-key')).not.toBeInTheDocument();
});

test('Expect empty screen when selected gateway has no secrets', async () => {
  render(SecretVaultList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  secretVaultInfos.set([localSecret]);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'remote' }));
  await tick();

  expect(screen.getByText(/No secrets on gateway 'remote'/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show all gateways' })).toBeInTheDocument();
});

test('Expect "Show all gateways" restores the full secrets list', async () => {
  render(SecretVaultList);
  openshellGateways.set([
    { name: 'local', endpoint: 'http://localhost:18080', gatewayState: { reachable: true, health: 'healthy' } },
    {
      name: 'remote',
      endpoint: 'https://remote.example.com:18080',
      gatewayState: { reachable: true, health: 'healthy' },
    },
  ]);
  secretVaultInfos.set([localSecret]);
  await tick();

  const dropdownTrigger = within(screen.getByLabelText('Filter by gateway')).getByRole('button');
  await fireEvent.click(dropdownTrigger);
  await fireEvent.click(screen.getByRole('button', { name: 'remote' }));
  await tick();

  await fireEvent.click(screen.getByRole('button', { name: 'Show all gateways' }));
  await tick();

  expect(screen.getByText('github-pat')).toBeInTheDocument();
  expect(screen.queryByText(/No secrets on gateway 'remote'/)).not.toBeInTheDocument();
});
