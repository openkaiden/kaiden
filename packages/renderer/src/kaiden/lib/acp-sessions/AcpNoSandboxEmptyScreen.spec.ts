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

import { NavigationPage } from '/@api/navigation-page';

import AcpNoSandboxEmptyScreen from './AcpNoSandboxEmptyScreen.svelte';

vi.mock(import('/@/navigation'));

beforeEach(() => {
  vi.resetAllMocks();
});

test('renders title and message', () => {
  render(AcpNoSandboxEmptyScreen);

  expect(screen.getByText('No ready sandboxes')).toBeInTheDocument();
  expect(
    screen.getByText('A ready sandbox is required to create an agent session. Create a workspace first.'),
  ).toBeInTheDocument();
});

test('renders Create Workspace button', () => {
  render(AcpNoSandboxEmptyScreen);

  expect(screen.getByRole('button', { name: 'Create Workspace' })).toBeInTheDocument();
});

test('clicking Create Workspace navigates to workspace creation', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(AcpNoSandboxEmptyScreen);

  const button = screen.getByRole('button', { name: 'Create Workspace' });
  await fireEvent.click(button);

  expect(handleNavigation).toHaveBeenCalledWith({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
});
