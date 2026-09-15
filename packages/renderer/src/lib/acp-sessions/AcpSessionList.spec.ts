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
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import * as acpSessionsStore from '/@/stores/acp-sessions.svelte';
import type { SandboxInfoWithGateway } from '/@/stores/openshell-sandboxes';
import * as openshellSandboxesStore from '/@/stores/openshell-sandboxes';
import type { AcpSessionInfo } from '/@api/acp-session-info';

import AcpSessionList from './AcpSessionList.svelte';

vi.mock(import('/@/stores/acp-sessions.svelte'));
vi.mock(import('/@/stores/openshell-sandboxes'));
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(openshellSandboxesStore).allOpenshellSandboxes = writable<SandboxInfoWithGateway[]>([
    { id: 'sb-1', name: 'test-sandbox', phase: 'Ready', gatewayName: 'gw' },
  ]);
});

test('renders sessions when data is provided', () => {
  const session = makeSession({ createdAt: 1000, prompt: 'test session' });

  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([session]);

  render(AcpSessionList);

  // The page title is rendered
  expect(screen.getByText('Agents')).toBeInTheDocument();
});

test('sessions are displayed with most recent first', () => {
  const sessions = [
    makeSession({ createdAt: 1000, prompt: 'oldest prompt', status: 'completed' }),
    makeSession({ createdAt: 3000, prompt: 'newest prompt', status: 'completed' }),
    makeSession({ createdAt: 2000, prompt: 'middle prompt', status: 'completed' }),
  ];

  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>(sessions);

  render(AcpSessionList);

  const buttons = screen.getAllByRole('button').filter(b => b.textContent?.includes('prompt'));

  expect(buttons[0]!.textContent).toContain('newest prompt');
  expect(buttons[1]!.textContent).toContain('middle prompt');
  expect(buttons[2]!.textContent).toContain('oldest prompt');
});

test('sessions within a status group are sorted most recent first', () => {
  const sessions = [
    makeSession({ createdAt: 1000, prompt: 'oldest completed', status: 'completed' }),
    makeSession({ createdAt: 3000, prompt: 'newest completed', status: 'completed' }),
    makeSession({ createdAt: 2000, prompt: 'middle completed', status: 'completed' }),
    makeSession({ createdAt: 4000, prompt: 'running session', status: 'running' }),
  ];

  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>(sessions);

  render(AcpSessionList);

  const buttons = screen.getAllByRole('button').filter(b => b.textContent?.includes('completed'));

  expect(buttons[0]!.textContent).toContain('newest completed');
  expect(buttons[1]!.textContent).toContain('middle completed');
  expect(buttons[2]!.textContent).toContain('oldest completed');
});

test('error sessions are grouped under Failed, not Completed', () => {
  const sessions = [
    makeSession({ createdAt: 1000, prompt: 'good session', status: 'completed' }),
    makeSession({ createdAt: 2000, prompt: 'bad session', status: 'error' }),
    makeSession({ createdAt: 3000, prompt: 'active session', status: 'running' }),
  ];

  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>(sessions);

  render(AcpSessionList);

  // "Failed" only appears as the group header (the status badge shows "Error")
  expect(screen.getByText('Failed')).toBeInTheDocument();
  // "Completed" appears as group header AND as a status badge label
  expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
});

test('cancelled sessions remain in the Completed group', () => {
  const sessions = [
    makeSession({ createdAt: 1000, prompt: 'done session', status: 'completed' }),
    makeSession({ createdAt: 2000, prompt: 'stopped session', status: 'cancelled' }),
    makeSession({ createdAt: 3000, prompt: 'active session', status: 'running' }),
  ];

  vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>(sessions);

  render(AcpSessionList);

  // "Completed" appears as group header AND as a status badge label
  expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
  expect(screen.queryByText('Failed')).not.toBeInTheDocument();
});
