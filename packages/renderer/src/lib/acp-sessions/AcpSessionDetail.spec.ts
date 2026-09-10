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
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import * as acpSessionsStore from '/@/stores/acp-sessions.svelte';
import type { AcpSessionInfo } from '/@api/acp-session-info';

import AcpSessionDetail from './AcpSessionDetail.svelte';

vi.mock(import('/@/stores/acp-sessions.svelte'));
vi.mock(import('tinro'));

const COMPLETED_SESSION: AcpSessionInfo = {
  id: 'session-1',
  sandboxName: 'test-sandbox',
  sandboxId: 'sb-1',
  prompt: 'hello',
  status: 'completed',
  createdAt: 1000,
  updatedAt: 2000,
  agentId: 'openclaw',
  agentName: 'OpenClaw',
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.getAcpSessionEvents).mockResolvedValue([]);
});

describe('optimistic input clearing on send', () => {
  test('should clear input immediately on send, before server responds', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);

    let resolveFollowUp!: () => void;
    vi.mocked(window.sendAcpFollowUp).mockImplementation(
      () =>
        new Promise<void>(resolve => {
          resolveFollowUp = resolve;
        }),
    );

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'hello agent');
    expect(textarea).toHaveValue('hello agent');

    const sendButton = screen.getByTitle('Send');
    await userEvent.click(sendButton);

    // Input should be cleared immediately, before the server responds
    await vi.waitFor(() => {
      expect(textarea).toHaveValue('');
    });

    // Resolve the server call
    resolveFollowUp();
  });

  test('should restore input on send failure', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockRejectedValue(new Error('network error'));

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'important message');

    const sendButton = screen.getByTitle('Send');
    await userEvent.click(sendButton);

    // Input should be restored after failure
    await vi.waitFor(() => {
      expect(textarea).toHaveValue('important message');
    });
    expect(await screen.findByText('network error')).toBeInTheDocument();
  });
});

describe('sendFollowUp error display', () => {
  test('displays error when sendFollowUp fails', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockRejectedValue(new Error('Session "session-1" not found or not initialized'));

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'follow up message');

    const sendButton = screen.getByTitle('Send');
    await userEvent.click(sendButton);

    expect(await screen.findByText('Session "session-1" not found or not initialized')).toBeInTheDocument();
  });

  test('clears error on successful sendFollowUp', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp)
      .mockRejectedValueOnce(new Error('transient failure'))
      .mockResolvedValueOnce(undefined);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'first attempt');

    const sendButton = screen.getByTitle('Send');
    await userEvent.click(sendButton);

    expect(await screen.findByText('transient failure')).toBeInTheDocument();

    await userEvent.type(textarea, 'second attempt');
    await userEvent.click(sendButton);

    await vi.waitFor(() => {
      expect(screen.queryByText('transient failure')).not.toBeInTheDocument();
    });
  });
});

describe('createSession error display', () => {
  test('displays error when createSession fails', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([]);
    vi.mocked(window.createAcpSession).mockRejectedValue(new Error('Sandbox "gone" not found'));

    render(AcpSessionDetail, { sessionId: 'new', draftSandboxName: 'gone' });

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'start session');

    const sendButton = screen.getByTitle('Send');
    await userEvent.click(sendButton);

    expect(await screen.findByText('Sandbox "gone" not found')).toBeInTheDocument();
  });
});

describe('state reset on session change', () => {
  test('clears error and input when sessionId changes', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockRejectedValue(new Error('something broke'));

    const { rerender } = render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'some text');

    const sendButton = screen.getByTitle('Send');
    await userEvent.click(sendButton);

    expect(await screen.findByText('something broke')).toBeInTheDocument();
    expect(textarea).toHaveValue('some text');

    await rerender({ sessionId: 'new', draftSandboxName: 'sb' });

    await vi.waitFor(() => {
      expect(screen.queryByText('something broke')).not.toBeInTheDocument();
    });
    expect(screen.getByRole('textbox')).toHaveValue('');
  });
});
