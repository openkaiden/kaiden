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
import { beforeEach, expect, test, vi } from 'vitest';

import type { SecretService } from '/@api/secret-info';

import SecretVaultCreate from './SecretVaultCreate.svelte';

vi.mock(import('/@/navigation'));

const MOCK_SERVICES: SecretService[] = [
  {
    name: 'github',
    hostPattern: 'api.github.com',
    headerName: 'Authorization',
    headerTemplate: 'Bearer ${value}',
    envVars: ['GH_TOKEN', 'GITHUB_TOKEN'],
  },
  {
    name: 'gemini',
    hostPattern: 'generativelanguage.googleapis.com',
    headerName: 'x-goog-api-key',
    headerTemplate: '${value}',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.createSecret).mockResolvedValue({ name: 'test' });
  vi.mocked(window.listSecretServices).mockResolvedValue(MOCK_SERVICES);
});

test('renders type options from fetched services plus Other', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Github')).toBeInTheDocument();
  });
  expect(screen.getByLabelText('Gemini')).toBeInTheDocument();
  expect(screen.getByLabelText('Other')).toBeInTheDocument();
});

test('defaults to Other type with full form fields', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  expect(screen.getByText('Other Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Secret value')).toBeInTheDocument();
  expect(screen.getByLabelText('Description')).toBeInTheDocument();
  expect(screen.getByLabelText('Host pattern')).toBeInTheDocument();
  expect(screen.getByText('Injection settings')).toBeInTheDocument();
  expect(screen.getByLabelText('Path pattern')).toBeInTheDocument();
  expect(screen.getByLabelText('Header name')).toBeInTheDocument();
  expect(screen.getByLabelText('Value format')).toBeInTheDocument();
});

test('hides injection fields when a predefined service type is selected', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Github')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('Github'));

  expect(screen.getByText('Github Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Secret value')).toBeInTheDocument();
  expect(screen.queryByLabelText('Host pattern')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection settings')).not.toBeInTheDocument();
});

test('shows subtitle with service details for predefined type', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Github')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('Github'));

  expect(screen.getByText(/Automatically injected as Authorization for api\.github\.com/)).toBeInTheDocument();
});

test('Add Secret button is disabled when required fields are empty', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('Add Secret button is disabled for Other type without host pattern', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'my-secret' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'secret-value' } });

  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('cancel navigates back to secret vault', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  const cancelButton = screen.getByRole('button', { name: 'Cancel' });
  await fireEvent.click(cancelButton);

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('submits Other secret with injection settings', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'my-api-key' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'sk-123' } });
  await fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Production API key' } });
  await fireEvent.input(screen.getByLabelText('Host pattern'), { target: { value: 'api.example.com' } });
  await fireEvent.input(screen.getByLabelText('Header name'), { target: { value: 'Authorization' } });
  await fireEvent.input(screen.getByLabelText('Value format'), { target: { value: 'Bearer {value}' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  expect(window.createSecret).toHaveBeenCalledWith({
    name: 'my-api-key',
    type: 'other',
    value: 'sk-123',
    description: 'Production API key',
    hosts: ['api.example.com'],
    header: 'Authorization',
    headerTemplate: 'Bearer ${value}',
  });

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('submits Other secret using default Authorization header when header name is not changed', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'custom-key' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'sk-abc' } });
  await fireEvent.input(screen.getByLabelText('Host pattern'), { target: { value: 'api.custom.io' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  expect(window.createSecret).toHaveBeenCalledWith({
    name: 'custom-key',
    type: 'other',
    value: 'sk-abc',
    hosts: ['api.custom.io'],
    header: 'Authorization',
  });

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('submits predefined service type without injection fields', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Github')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('Github'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'gh-token' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'ghp_abc123' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  expect(window.createSecret).toHaveBeenCalledWith({
    name: 'gh-token',
    type: 'github',
    value: 'ghp_abc123',
  });

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('displays error when createSecret fails', async () => {
  vi.mocked(window.createSecret).mockRejectedValueOnce(new Error('Storage unavailable'));

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Github')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('Github'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'test' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'val' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  await waitFor(() => {
    expect(screen.getByText('Storage unavailable')).toBeInTheDocument();
  });
});

test('injection settings section can be collapsed and expanded', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  expect(screen.getByLabelText('Path pattern')).toBeInTheDocument();

  await fireEvent.click(screen.getByText('Injection settings'));

  expect(screen.queryByLabelText('Path pattern')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByText('Injection settings'));

  expect(screen.getByLabelText('Path pattern')).toBeInTheDocument();
});

test('still renders form when listSecretServices fails', async () => {
  vi.mocked(window.listSecretServices).mockRejectedValueOnce(new Error('CLI not found'));

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Other')).toBeInTheDocument();
  });

  expect(screen.getByText('Other Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
});
