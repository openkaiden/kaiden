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

import assert from 'node:assert';

import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import * as acpSessionsStore from '/@/kaiden/stores/acp-sessions.svelte';
import type { SandboxInfoWithGateway } from '/@/kaiden/stores/openshell-sandboxes';
import * as openshellSandboxesStore from '/@/kaiden/stores/openshell-sandboxes';
import type { AcpSessionInfo } from '/@api/acp-session-info';

import { ACP_SESSION_STATUS_COLORS } from './acp-session-status';
import AcpSessionLayout from './AcpSessionLayout.svelte';

vi.mock(import('/@/kaiden/stores/acp-sessions.svelte'));
vi.mock(import('/@/kaiden/stores/openshell-sandboxes'));
vi.mock(import('tinro'));

function makeSession(overrides: Partial<AcpSessionInfo> & { createdAt: number }): AcpSessionInfo {
  return {
    id: `session-${overrides.createdAt}`,
    sandboxName: 'test-sandbox',
    sandboxId: 'sb-1',
    prompt: 'test prompt',
    status: 'idle',
    updatedAt: overrides.createdAt,
    ...overrides,
  };
}

const childrenSnippet = createRawSnippet((): { render: () => string } => ({
  render: (): string => '<div data-testid="children-content">content</div>',
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openshellSandboxesStore).allOpenshellSandboxes = writable<SandboxInfoWithGateway[]>([
    { id: 'sb-1', name: 'test-sandbox', phase: 'Ready', gatewayName: 'gw' },
  ]);
  vi.mocked(window.renameAcpSession).mockResolvedValue(undefined);
  vi.mocked(window.deleteAcpSession).mockResolvedValue(undefined);
});

test('sidebar dims session row when workspace is unavailable', () => {
  const session = makeSession({ createdAt: 1000, prompt: 'orphan', sandboxId: undefined });
  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([session]);

  render(AcpSessionLayout, { children: childrenSnippet });

  const sessionButton = screen.getByRole('button', { name: /orphan/ });
  const row = sessionButton.closest('[class*="group"]');
  assert(row);
  expect(row).toHaveClass('opacity-50');
});

test('sidebar tooltip includes workspace unavailable when sandboxId is missing', () => {
  const session = makeSession({ createdAt: 1000, prompt: 'orphan', sandboxId: undefined });
  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([session]);

  render(AcpSessionLayout, { children: childrenSnippet });

  const sessionButton = screen.getByRole('button', { name: /orphan/ });
  const nameSpan = sessionButton.querySelector('span.truncate');
  assert(nameSpan);
  expect(nameSpan).toHaveAttribute('title', expect.stringContaining('workspace unavailable'));
});

test('sidebar uses idle dot class for non-terminal session without workspace', () => {
  const session = makeSession({ createdAt: 1000, prompt: 'running orphan', sandboxId: undefined, status: 'running' });
  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([session]);

  render(AcpSessionLayout, { children: childrenSnippet });

  const sessionButton = screen.getByRole('button', { name: /running orphan/ });
  const dot = sessionButton.querySelector('span.rounded-full');
  assert(dot);
  expect(dot).toHaveClass(...ACP_SESSION_STATUS_COLORS.idle.split(' '));
});

test('sidebar does not dim session when workspace is available', () => {
  const session = makeSession({ createdAt: 1000, prompt: 'healthy' });
  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([session]);

  render(AcpSessionLayout, { children: childrenSnippet });

  const sessionButton = screen.getByRole('button', { name: /healthy/ });
  const row = sessionButton.closest('[class*="group"]');
  assert(row);
  expect(row).not.toHaveClass('opacity-50');
});
