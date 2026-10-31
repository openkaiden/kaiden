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

import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { assert, beforeEach, expect, test, vi } from 'vitest';

import NetworkApprovalBadge from './NetworkApprovalBadge.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

test('renders nothing when no pending and no total', () => {
  const { container } = render(NetworkApprovalBadge, { pendingCount: 0, totalCount: 0, onclick: vi.fn() });
  expect(container.querySelector('button')).not.toBeInTheDocument();
});

test('renders pending badge with count when pendingCount > 0', () => {
  render(NetworkApprovalBadge, { pendingCount: 3, totalCount: 5, onclick: vi.fn() });
  expect(screen.getByText('3')).toBeInTheDocument();
});

test('renders dimmed shield button when pendingCount is 0 but totalCount > 0', () => {
  const { container } = render(NetworkApprovalBadge, { pendingCount: 0, totalCount: 2, onclick: vi.fn() });
  const button = container.querySelector('button');
  expect(button).toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

test('calls onclick when pending badge is clicked', async () => {
  const onclick = vi.fn();
  render(NetworkApprovalBadge, { pendingCount: 2, totalCount: 2, onclick });
  await userEvent.click(screen.getByText('2'));
  expect(onclick).toHaveBeenCalledOnce();
});

test('calls onclick when resolved shield button is clicked', async () => {
  const onclick = vi.fn();
  const { container } = render(NetworkApprovalBadge, { pendingCount: 0, totalCount: 1, onclick });
  const button = container.querySelector('button');
  expect(button).toBeInTheDocument();
  assert(button);
  await userEvent.click(button);
  expect(onclick).toHaveBeenCalledOnce();
});
