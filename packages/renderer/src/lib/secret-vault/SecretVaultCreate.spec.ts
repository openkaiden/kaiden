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

import SecretVaultCreate from './SecretVaultCreate.svelte';

vi.mock(import('/@/navigation'));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.createSecret).mockResolvedValue({ name: 'test' });
});

test('renders type selector with GitHub, Gemini, and Other options', () => {
  render(SecretVaultCreate);

  expect(screen.getByLabelText('GitHub')).toBeInTheDocument();
  expect(screen.getByLabelText('Gemini')).toBeInTheDocument();
  expect(screen.getByLabelText('Other')).toBeInTheDocument();
});

test('defaults to Generic type with appropriate form fields', () => {
  render(SecretVaultCreate);

  expect(screen.getByText('Other Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Secret value')).toBeInTheDocument();
  expect(screen.getByLabelText('Host pattern')).toBeInTheDocument();
  expect(screen.getByText('Injection settings')).toBeInTheDocument();
  expect(screen.getByLabelText('Path pattern')).toBeInTheDocument();
  expect(screen.getByLabelText('Header name')).toBeInTheDocument();
  expect(screen.getByLabelText('Value format')).toBeInTheDocument();
});

test('hides injection fields when a predefined type is selected', async () => {
  render(SecretVaultCreate);

  const githubCard = screen.getByLabelText('GitHub');
  await fireEvent.click(githubCard);

  expect(screen.getByText('GitHub Secret')).toBeInTheDocument();
  expect(screen.getByLabelText('Name')).toBeInTheDocument();
  expect(screen.getByLabelText('Secret value')).toBeInTheDocument();
  expect(screen.queryByLabelText('Host pattern')).not.toBeInTheDocument();
  expect(screen.queryByText('Injection settings')).not.toBeInTheDocument();
});

test('Add Secret button is disabled when required fields are empty', () => {
  render(SecretVaultCreate);

  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('Add Secret button is disabled for generic type without host pattern', async () => {
  render(SecretVaultCreate);

  const nameInput = screen.getByLabelText('Name');
  const secretInput = screen.getByLabelText('Secret value');

  await fireEvent.input(nameInput, { target: { value: 'my-secret' } });
  await fireEvent.input(secretInput, { target: { value: 'secret-value' } });

  expect(screen.getByRole('button', { name: 'Add Secret' })).toBeDisabled();
});

test('cancel navigates back to secret vault', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  const cancelButton = screen.getByRole('button', { name: 'Cancel' });
  await fireEvent.click(cancelButton);

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('submits generic secret with injection settings', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'my-api-key' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'sk-123' } });
  await fireEvent.input(screen.getByLabelText('Host pattern'), { target: { value: 'api.example.com' } });
  await fireEvent.input(screen.getByLabelText('Header name'), { target: { value: 'Authorization' } });
  await fireEvent.input(screen.getByLabelText('Value format'), { target: { value: 'Bearer {value}' } });

  const addButton = screen.getByRole('button', { name: 'Add Secret' });
  await fireEvent.click(addButton);

  expect(window.createSecret).toHaveBeenCalledWith({
    name: 'my-api-key',
    type: 'other',
    value: 'sk-123',
    hosts: ['api.example.com'],
    header: 'Authorization',
    headerTemplate: 'Bearer ${value}',
  });

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('submits predefined type secret without injection fields', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(SecretVaultCreate);

  await fireEvent.click(screen.getByLabelText('GitHub'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'gh-token' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'ghp_abc123' } });

  const addButton = screen.getByRole('button', { name: 'Add Secret' });
  await fireEvent.click(addButton);

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

  await fireEvent.click(screen.getByLabelText('GitHub'));
  await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'test' } });
  await fireEvent.input(screen.getByLabelText('Secret value'), { target: { value: 'val' } });

  await fireEvent.click(screen.getByRole('button', { name: 'Add Secret' }));

  expect(screen.getByText('Storage unavailable')).toBeInTheDocument();
});

test('injection settings section can be collapsed and expanded', async () => {
  render(SecretVaultCreate);

  expect(screen.getByLabelText('Path pattern')).toBeInTheDocument();

  const toggleButton = screen.getByText('Injection settings');
  await fireEvent.click(toggleButton);

  expect(screen.queryByLabelText('Path pattern')).not.toBeInTheDocument();

  await fireEvent.click(toggleButton);

  expect(screen.getByLabelText('Path pattern')).toBeInTheDocument();
});
