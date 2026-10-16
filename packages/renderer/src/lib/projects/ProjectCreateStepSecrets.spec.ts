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
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import * as secretVaultStore from '/@/kaiden/stores/secret-vault';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import ProjectCreateStepSecrets from './ProjectCreateStepSecrets.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/kaiden/stores/secret-vault'));

const SAMPLE_SECRETS: SecretVaultInfo[] = [
  { id: 'github-token', name: 'GitHub Token', type: 'github', description: 'Personal access token' },
  { id: 'anthropic-key', name: 'Anthropic Key', type: 'anthropic', description: 'API key' },
];

beforeEach(() => {
  vi.resetAllMocks();
  HTMLElement.prototype.animate = vi.fn().mockReturnValue({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    onfinish: null,
  });
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>(SAMPLE_SECRETS);
});

describe('summary card', () => {
  test('shows all-included message when all secrets selected', () => {
    render(ProjectCreateStepSecrets, {
      selectedSecretIds: ['github-token', 'anthropic-key'],
    });

    expect(screen.getByText(/All available secrets are included/)).toBeInTheDocument();
    expect(screen.getByText(/2\/2 secrets/)).toBeInTheDocument();
  });

  test('shows partial count when not all secrets selected', () => {
    render(ProjectCreateStepSecrets, {
      selectedSecretIds: ['github-token'],
    });

    expect(screen.getByText(/1\/2 secrets/)).toBeInTheDocument();
    expect(screen.getByText(/Expand/)).toBeInTheDocument();
  });

  test('shows empty vault message when no secrets exist', () => {
    vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([]);

    render(ProjectCreateStepSecrets, {
      selectedSecretIds: [],
    });

    expect(screen.getByText(/No secrets in your vault yet\./)).toBeInTheDocument();
    expect(screen.getByText('Create a secret')).toBeInTheDocument();
  });

  test('clicking Create a secret link navigates to secret vault', async () => {
    vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([]);
    const { handleNavigation } = await import('/@/navigation');

    render(ProjectCreateStepSecrets, {
      selectedSecretIds: [],
    });

    await fireEvent.click(screen.getByText('Create a secret'));

    expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
  });
});

describe('checklist panel', () => {
  async function expandCustomize(): Promise<void> {
    const expandButton = screen.getByText('Customize secrets').closest('button')!;
    await fireEvent.click(expandButton);
  }

  test('renders Secret Vault panel with correct title and subtitle after expanding', async () => {
    render(ProjectCreateStepSecrets, {
      selectedSecretIds: SAMPLE_SECRETS.map(s => s.id),
    });

    await expandCustomize();

    expect(screen.getByText('Secret Vault')).toBeInTheDocument();
    expect(screen.getByText('Select secrets from your vault to make available in this project')).toBeInTheDocument();
  });

  test('renders secret items with names and type/description', async () => {
    render(ProjectCreateStepSecrets, {
      selectedSecretIds: SAMPLE_SECRETS.map(s => s.id),
    });

    await expandCustomize();

    expect(screen.getByText('GitHub Token')).toBeInTheDocument();
    expect(screen.getByText('github · Personal access token')).toBeInTheDocument();
    expect(screen.getByText('Anthropic Key')).toBeInTheDocument();
    expect(screen.getByText('anthropic · API key')).toBeInTheDocument();
  });

  test('renders empty message when no secrets available', async () => {
    vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([]);

    render(ProjectCreateStepSecrets, {
      selectedSecretIds: [],
    });

    await expandCustomize();

    expect(screen.getAllByText('No secrets in your vault yet.').length).toBeGreaterThanOrEqual(1);
  });

  test('displays Open Vault button after expanding', async () => {
    render(ProjectCreateStepSecrets, {
      selectedSecretIds: SAMPLE_SECRETS.map(s => s.id),
    });

    await expandCustomize();

    expect(screen.getByRole('button', { name: 'Open Vault' })).toBeInTheDocument();
  });

  test('clicking Open Vault navigates to secret vault', async () => {
    const { handleNavigation } = await import('/@/navigation');

    render(ProjectCreateStepSecrets, {
      selectedSecretIds: SAMPLE_SECRETS.map(s => s.id),
    });

    await expandCustomize();
    await fireEvent.click(screen.getByRole('button', { name: 'Open Vault' }));

    expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
  });

  test('toggling a secret updates the footer count', async () => {
    render(ProjectCreateStepSecrets, {
      selectedSecretIds: SAMPLE_SECRETS.map(s => s.id),
    });

    await expandCustomize();

    expect(screen.getByText('2 of 2 selected')).toBeInTheDocument();

    const secretButton = screen.getByRole('button', { name: 'Anthropic Key' });
    await fireEvent.click(secretButton);

    expect(screen.getByText('1 of 2 selected')).toBeInTheDocument();
  });
});
