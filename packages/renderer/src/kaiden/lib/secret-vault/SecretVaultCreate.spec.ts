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

import type { OpenshellProfile } from '/@api/openshell-gateway-info';

import SecretVaultCreate from './SecretVaultCreate.svelte';

vi.mock(import('/@/navigation'));

const MOCK_SERVICES: OpenshellProfile[] = [
  {
    id: 'github',
    display_name: 'GitHub',
    description: 'GitHub API provider',
    credentials: [
      { name: 'token', required: true, description: 'Personal access token', env_vars: ['GH_TOKEN', 'GITHUB_TOKEN'] },
    ],
  },
  {
    id: 'gemini',
    display_name: 'Gemini',
    description: 'Google Gemini API provider',
    credentials: [
      { name: 'api_key', required: true, description: 'API key', env_vars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'] },
    ],
  },
];

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
  vi.mocked(window.createSecret).mockResolvedValue({ name: 'test' });
  vi.mocked(window.listSecretServices).mockResolvedValue(MOCK_SERVICES);
});

test('renders fetched service types without Other and requires a service selection', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });
  expect(screen.getByLabelText('Gemini')).toBeInTheDocument();
  expect(screen.queryByLabelText('Other')).not.toBeInTheDocument();
  expect(screen.getByLabelText('GitHub')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.queryByLabelText('Token')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Secret value')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Host pattern')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection settings')).not.toBeInTheDocument();
});

test('hides injection fields and shows credential fields when a predefined service type is selected', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('GitHub'));

  expect(screen.getByText('GitHub Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Token')).toBeInTheDocument();
  expect(screen.getByText('Token (Personal access token)')).toBeInTheDocument();
  expect(screen.queryByLabelText('Secret value')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Host pattern')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection settings')).not.toBeInTheDocument();
});

test('shows profile description as subtitle for predefined service type', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('GitHub'));

  expect(screen.queryByText(/Configure a custom secret/)).not.toBeInTheDocument();
  expect(screen.getByText('GitHub API provider')).toBeInTheDocument();
});

test('Add Secret button is disabled when required fields are empty', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('cancel navigates back to secret vault', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  const cancelButton = screen.getByRole('button', { name: 'Cancel' });
  await fireEvent.click(cancelButton);

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('submits predefined service type with credential fields as SecretValue', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('GitHub'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'gh-token' } });
  await fireEvent.input(screen.getByLabelText('Token'), { target: { value: 'ghp_abc123' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  expect(window.createSecret).toHaveBeenCalledWith({
    name: 'gh-token',
    type: 'github',
    value: {
      credentials: {
        GH_TOKEN: 'ghp_abc123',
        GITHUB_TOKEN: 'ghp_abc123',
      },
    },
  });

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('displays error when createSecret fails', async () => {
  vi.mocked(window.createSecret).mockRejectedValueOnce(new Error('Storage unavailable'));

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('GitHub'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'test' } });
  await fireEvent.input(screen.getByLabelText('Token'), { target: { value: 'val' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  await waitFor(() => {
    expect(screen.getByText('Storage unavailable')).toBeInTheDocument();
  });
});

test('does not offer an unsupported fallback type when listSecretServices fails', async () => {
  vi.mocked(window.listSecretServices).mockRejectedValueOnce(new Error('CLI not found'));

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.queryByText('Loading secret types…')).not.toBeInTheDocument();
  });

  expect(screen.queryByLabelText('Other')).not.toBeInTheDocument();
  expect(screen.getByText('Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('Add Secret button is disabled when required credentials are empty for predefined type', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('GitHub'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'gh-token' } });

  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('credentials reset when switching between service types', async () => {
  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('GitHub'));
  await fireEvent.input(screen.getByLabelText('Token'), { target: { value: 'ghp_abc123' } });

  await fireEvent.click(screen.getByLabelText('Gemini'));

  expect(screen.getByLabelText('Api Key')).toHaveValue('');
});

test('filters out profiles without credentials from type options', async () => {
  const services: OpenshellProfile[] = [
    {
      id: 'has-creds',
      display_name: 'With Creds',
      credentials: [{ name: 'key', required: true }],
    },
    {
      id: 'no-creds',
      display_name: 'No Creds',
    },
    {
      id: 'empty-creds',
      display_name: 'Empty Creds',
      credentials: [],
    },
  ];
  vi.mocked(window.listSecretServices).mockResolvedValue(services);

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('With Creds')).toBeInTheDocument();
  });

  expect(screen.queryByLabelText('No Creds')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Empty Creds')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Other')).not.toBeInTheDocument();
});

test('uses credential name as fallback key when env_vars is empty', async () => {
  const services: OpenshellProfile[] = [
    {
      id: 'custom-provider',
      display_name: 'Custom',
      credentials: [{ name: 'secret_key', required: true }],
    },
  ];
  vi.mocked(window.listSecretServices).mockResolvedValue(services);

  render(SecretVaultCreate);

  await waitFor(() => {
    expect(screen.getByLabelText('Custom')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('Custom'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'my-custom' } });
  await fireEvent.input(screen.getByLabelText('Secret Key'), { target: { value: 'sk-123' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  expect(window.createSecret).toHaveBeenCalledWith({
    name: 'my-custom',
    type: 'custom-provider',
    value: {
      credentials: {
        secret_key: 'sk-123',
      },
    },
  });
});
