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

import type { OpenshellProfile } from '/@api/openshell-gateway-info';

import SecretTypeSelector from './SecretTypeSelector.svelte';

const GITHUB: OpenshellProfile = {
  id: 'github',
  display_name: 'GitHub',
  description: 'GitHub API provider',
  credentials: [{ name: 'token', required: true }],
};

const NO_CREDENTIALS: OpenshellProfile = {
  id: 'nocreds',
  display_name: 'No Creds',
  description: 'Profile without credentials',
  credentials: [],
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.listSecretServices).mockResolvedValue([GITHUB, NO_CREDENTIALS]);
});

test('loads the secret types of the given gateway', async () => {
  render(SecretTypeSelector, { gateway: 'remote', onSelect: vi.fn() });

  expect(await screen.findByLabelText('GitHub')).toBeInTheDocument();
  expect(window.listSecretServices).toHaveBeenCalledWith('remote');
});

test('only offers secret types that have credentials', async () => {
  render(SecretTypeSelector, { gateway: 'kaiden', onSelect: vi.fn() });

  expect(await screen.findByLabelText('GitHub')).toBeInTheDocument();
  expect(screen.queryByLabelText('No Creds')).not.toBeInTheDocument();
});

test('offers no secret type when fetching them fails', async () => {
  vi.mocked(window.listSecretServices).mockRejectedValue(new Error('CLI not found'));

  render(SecretTypeSelector, { gateway: 'kaiden', onSelect: vi.fn() });

  expect(await screen.findByText('Secret type')).toBeInTheDocument();
  expect(screen.queryByLabelText('GitHub')).not.toBeInTheDocument();
});

test('reports the selected secret type profile', async () => {
  const onSelect = vi.fn();
  render(SecretTypeSelector, { gateway: 'kaiden', onSelect });

  await fireEvent.click(await screen.findByLabelText('GitHub'));

  expect(onSelect).toHaveBeenCalledWith(GITHUB);
  expect(screen.getByLabelText('GitHub')).toHaveAttribute('aria-pressed', 'true');
});
