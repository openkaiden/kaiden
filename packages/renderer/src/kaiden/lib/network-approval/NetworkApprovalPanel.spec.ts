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
import { beforeEach, expect, test, vi } from 'vitest';

import type { DraftPolicyChunk } from '/@api/draft-policy-info';

import NetworkApprovalPanel from './NetworkApprovalPanel.svelte';

function makeChunk(overrides?: Partial<DraftPolicyChunk>): DraftPolicyChunk {
  return {
    chunkId: 'chunk-1',
    ruleName: 'allow_example_443',
    status: 'pending',
    host: 'example.com',
    port: 443,
    binaries: ['/**'],
    rationale: 'Host not in allow list',
    hasSecurityNotes: false,
    isL7: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('renders pending L4 chunk with host:port and Allow/Reject buttons', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk()],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('example.com:443')).toBeInTheDocument();
  expect(screen.getByText('Policy')).toBeInTheDocument();
  expect(screen.getByText('— host not in allowed list')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
});

test('renders pending L7 chunk with informational message instead of buttons', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ isL7: true, method: 'POST', path: '/api/data' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('L7 rules are informational — approval is not supported yet.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
});

test('renders a generic request for L7 chunks without method and path', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ isL7: true })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('L7 request')).toBeInTheDocument();
});

test('calls onReject when L7 Dismiss is clicked', async () => {
  const onReject = vi.fn().mockResolvedValue(undefined);
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ isL7: true, method: 'POST', path: '/api/data' })],
    onApprove: vi.fn(),
    onReject,
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
  expect(onReject).toHaveBeenCalledWith('chunk-1');
});

test('renders the error when dismissing an L7 chunk fails', async () => {
  const onReject = vi.fn().mockRejectedValue(new Error('dismiss failed'));
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ isL7: true, method: 'POST', path: '/api/data' })],
    onApprove: vi.fn(),
    onReject,
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

  expect(await screen.findByText('dismiss failed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Dismiss' })).toBeEnabled();
});

test('resolved chunks are hidden by default', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'approved', chunkId: 'resolved-1' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('1 resolved')).toBeInTheDocument();
  expect(screen.queryByText('Allowed')).not.toBeInTheDocument();
});

test('shows resolved chunks after clicking toggle', async () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'approved', chunkId: 'resolved-1' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByText('1 resolved'));
  expect(screen.getByText('Allowed')).toBeInTheDocument();
});

test('shows Reject button for approved resolved chunk', async () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'approved', chunkId: 'approved-1' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByText('1 resolved'));
  expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
});

test('shows Allow button for rejected resolved chunk', async () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'rejected', chunkId: 'rejected-1' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByText('1 resolved'));
  expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
});

test('does not show buttons for resolved L7 chunks', async () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'approved', chunkId: 'l7-1', isL7: true })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByText('1 resolved'));
  expect(screen.getByText('Allowed')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Allow' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
});

test('calls onApprove when Allow button is clicked', async () => {
  const onApprove = vi.fn().mockResolvedValue(undefined);
  render(NetworkApprovalPanel, {
    chunks: [makeChunk()],
    onApprove,
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(onApprove).toHaveBeenCalledWith('chunk-1');
});

test('calls onReject when Reject button is clicked', async () => {
  const onReject = vi.fn().mockResolvedValue(undefined);
  render(NetworkApprovalPanel, {
    chunks: [makeChunk()],
    onApprove: vi.fn(),
    onReject,
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(onReject).toHaveBeenCalledWith('chunk-1');
});

test('renders applicationError message on pending chunk', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ applicationError: 'candidate invalid: credentialed endpoint' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('candidate invalid: credentialed endpoint')).toBeInTheDocument();
});

test('disables Allow button when applicationError is set on pending chunk', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ applicationError: 'candidate invalid' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
});

test('disables Allow button when applicationError is set on rejected resolved chunk', async () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'rejected', chunkId: 'rejected-err', applicationError: 'candidate invalid' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByText('1 resolved'));
  expect(screen.getByRole('button', { name: 'Allow' })).toBeDisabled();
});

test('renders applicationError message on resolved chunk', async () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ status: 'approved', chunkId: 'approved-err', applicationError: 'server error' })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByText('1 resolved'));
  expect(screen.getByText('server error')).toBeInTheDocument();
});

test('renders error and re-enables buttons when onApprove rejects', async () => {
  const onApprove = vi.fn().mockRejectedValue(new Error('RPC failed'));
  render(NetworkApprovalPanel, {
    chunks: [makeChunk()],
    onApprove,
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Allow' }));
  expect(await screen.findByText('RPC failed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
});

test('renders error and re-enables buttons when onReject rejects', async () => {
  const onReject = vi.fn().mockRejectedValue(new Error('reject failed'));
  render(NetworkApprovalPanel, {
    chunks: [makeChunk()],
    onApprove: vi.fn(),
    onReject,
    onClose: vi.fn(),
  });

  await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
  expect(await screen.findByText('reject failed')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
});

test('renders security notes when provided', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ securityNotes: 'May expose credentials', hasSecurityNotes: true })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('May expose credentials')).toBeInTheDocument();
});

test('renders generic security warning when hasSecurityNotes is true but text is absent', () => {
  render(NetworkApprovalPanel, {
    chunks: [makeChunk({ hasSecurityNotes: true })],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose: vi.fn(),
  });

  expect(screen.getByText('Security considerations — review carefully.')).toBeInTheDocument();
});

test('calls onClose when close button is clicked', async () => {
  const onClose = vi.fn();
  render(NetworkApprovalPanel, {
    chunks: [],
    onApprove: vi.fn(),
    onReject: vi.fn(),
    onClose,
  });

  await userEvent.click(screen.getByTitle('Close panel'));
  expect(onClose).toHaveBeenCalledOnce();
});
