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

import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import SecretVaultActions from './SecretVaultActions.svelte';

const secret: SecretVaultInfo = {
  id: 'github-pat',
  name: 'GitHub',
  type: 'github',
  description: 'Personal access token',
  gateway: 'kaiden',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(window.removeSecret).mockResolvedValue({ name: 'github-pat' });
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });
});

test('should display remove button', () => {
  render(SecretVaultActions, { object: secret });

  expect(screen.getByRole('button', { name: 'Remove secret' })).toBeInTheDocument();
});

test('should show confirmation dialog when remove button clicked', async () => {
  render(SecretVaultActions, { object: secret });

  const removeButton = screen.getByRole('button', { name: 'Remove secret' });
  await fireEvent.click(removeButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();
});

test('should remove secret when user confirms removal', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(SecretVaultActions, { object: secret });

  const removeButton = screen.getByRole('button', { name: 'Remove secret' });
  await fireEvent.click(removeButton);

  await waitFor(() => {
    expect(window.removeSecret).toHaveBeenCalledWith('GitHub', 'kaiden');
  });
});

test('should not remove secret when user cancels removal', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  render(SecretVaultActions, { object: secret });

  const removeButton = screen.getByRole('button', { name: 'Remove secret' });
  await fireEvent.click(removeButton);

  expect(window.removeSecret).not.toHaveBeenCalled();
});

test('should display error when secret removal fails', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  vi.mocked(window.removeSecret).mockRejectedValue(new Error('secret is in use by sandbox'));

  render(SecretVaultActions, { object: secret });

  // no error icon before clicking
  expect(screen.queryByTestId('tooltip-trigger')).not.toBeInTheDocument();

  const removeButton = screen.getByRole('button', { name: 'Remove secret' });
  await fireEvent.click(removeButton);

  // error icon should appear after failed removal
  await waitFor(() => {
    expect(screen.getByTestId('tooltip-trigger')).toBeInTheDocument();
  });
});
