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

import * as secretVaultStore from '/@/stores/secret-vault';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import SecretVaultDetails from './SecretVaultDetails.svelte';

vi.mock(import('tinro'));
vi.mock(import('/@/stores/secret-vault'));

const routerStore = writable({
  path: '/secret-vault/github-pat/summary',
  url: '/secret-vault/github-pat/summary',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

const githubSecret: SecretVaultInfo = {
  id: 'github-pat',
  name: 'GitHub',
  type: 'github',
  description: 'Repos, pull requests, and issues across the organization.',
  hosts: ['github.com', 'api.github.com'],
  path: '/v3',
  header: 'Authorization',
  headerTemplate: 'token {{secret}}',
};

const minimalSecret: SecretVaultInfo = {
  id: 'my-other-secret',
  name: 'Other secret',
  type: 'other',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([githubSecret, minimalSecret]);
  vi.mocked(window.removeSecret).mockResolvedValue({ name: 'github-pat' });
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });
});

test('should display secret name as page title', () => {
  render(SecretVaultDetails, { id: 'github-pat' });

  expect(screen.getByRole('heading', { name: 'GitHub', level: 1 })).toBeInTheDocument();
});

test('should show Summary tab', () => {
  render(SecretVaultDetails, { id: 'github-pat' });

  expect(screen.getByText('Summary')).toBeInTheDocument();
});

test.each(['nonexistent', 'some-missing-id'])('should fallback to id when secret is not found (%s)', id => {
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([]);

  render(SecretVaultDetails, { id });

  expect(screen.getByRole('heading', { name: id, level: 1 })).toBeInTheDocument();
});

test('should display remove button', () => {
  render(SecretVaultDetails, { id: 'github-pat' });

  expect(screen.getByRole('button', { name: 'Remove Secret' })).toBeInTheDocument();
});

test('should show confirmation dialog when remove button clicked', async () => {
  render(SecretVaultDetails, { id: 'github-pat' });

  const removeButton = screen.getByRole('button', { name: 'Remove Secret' });
  await fireEvent.click(removeButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();
});

test('should remove secret and navigate to list when user confirms removal', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(SecretVaultDetails, { id: 'github-pat' });

  const removeButton = screen.getByRole('button', { name: 'Remove Secret' });
  await fireEvent.click(removeButton);

  await waitFor(() => {
    expect(window.removeSecret).toHaveBeenCalledWith('github-pat');
  });

  expect(router.goto).toHaveBeenCalledWith('/secret-vault');
});

test('should not remove secret when user cancels removal', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  render(SecretVaultDetails, { id: 'github-pat' });

  const removeButton = screen.getByRole('button', { name: 'Remove Secret' });
  await fireEvent.click(removeButton);

  expect(window.removeSecret).not.toHaveBeenCalled();
  expect(router.goto).not.toHaveBeenCalled();
});
