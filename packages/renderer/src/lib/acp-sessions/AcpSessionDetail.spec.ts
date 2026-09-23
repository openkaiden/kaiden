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
import type { AcpFlowToolCallEvent, AcpSessionInfo } from '/@api/acp-session-info';

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
  vi.mocked(window.getConfigurationValue).mockResolvedValue(20);
  vi.mocked(window.getPathForFile).mockReturnValue('');
  vi.mocked(window.removeTempFile).mockResolvedValue(undefined);
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

describe('scroll lock', () => {
  function getFlowContainer(): HTMLElement {
    return document.querySelector('.overflow-auto')!;
  }

  function mockScrollGeometry(el: HTMLElement, scrollTop: number, scrollHeight: number, clientHeight: number): void {
    Object.defineProperty(el, 'scrollTop', { value: scrollTop, writable: true, configurable: true });
    Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  }

  test('does not auto-scroll when user has scrolled away from bottom', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.getAcpSessionEvents).mockResolvedValue([{ kind: 'prompt', text: 'initial', timestamp: 1 }]);

    render(AcpSessionDetail, { sessionId: 'session-1' });
    await vi.waitFor(() => expect(screen.getByText('initial')).toBeInTheDocument());

    const container = getFlowContainer();
    mockScrollGeometry(container, 100, 500, 200);
    container.dispatchEvent(new Event('scroll'));

    const scrollTopSetter = vi.fn();
    Object.defineProperty(container, 'scrollTop', { set: scrollTopSetter, get: () => 100, configurable: true });

    vi.mocked(window.getAcpSessionEvents).mockResolvedValue([
      { kind: 'prompt', text: 'initial', timestamp: 1 },
      { kind: 'prompt', text: 'new prompt', timestamp: 2 },
    ]);

    const store = vi.mocked(acpSessionsStore).acpSessions as ReturnType<typeof writable<AcpSessionInfo[]>>;
    store.set([{ ...COMPLETED_SESSION, updatedAt: 3000 }]);

    await vi.waitFor(() => expect(screen.getByText('new prompt')).toBeInTheDocument());
    expect(scrollTopSetter).not.toHaveBeenCalled();
  });

  test('auto-scrolls when user is near bottom', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.getAcpSessionEvents).mockResolvedValue([{ kind: 'prompt', text: 'initial', timestamp: 1 }]);

    render(AcpSessionDetail, { sessionId: 'session-1' });
    await vi.waitFor(() => expect(screen.getByText('initial')).toBeInTheDocument());

    const container = getFlowContainer();
    mockScrollGeometry(container, 295, 500, 200);
    container.dispatchEvent(new Event('scroll'));

    const scrollTopSetter = vi.fn();
    Object.defineProperty(container, 'scrollTop', { set: scrollTopSetter, get: () => 295, configurable: true });

    vi.mocked(window.getAcpSessionEvents).mockResolvedValue([
      { kind: 'prompt', text: 'initial', timestamp: 1 },
      { kind: 'prompt', text: 'second prompt', timestamp: 2 },
    ]);

    const store = vi.mocked(acpSessionsStore).acpSessions as ReturnType<typeof writable<AcpSessionInfo[]>>;
    store.set([{ ...COMPLETED_SESSION, updatedAt: 3000 }]);

    await vi.waitFor(() => expect(screen.getByText('second prompt')).toBeInTheDocument());
    await vi.waitFor(() => expect(scrollTopSetter).toHaveBeenCalled());
  });

  test('resets scroll lock on successful send', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockResolvedValue(undefined);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const container = getFlowContainer();
    mockScrollGeometry(container, 100, 500, 200);
    container.dispatchEvent(new Event('scroll'));

    const scrollTopSetter = vi.fn();
    Object.defineProperty(container, 'scrollTop', { set: scrollTopSetter, get: () => 100, configurable: true });

    vi.mocked(window.getAcpSessionEvents).mockResolvedValue([
      { kind: 'prompt', text: 'response after send', timestamp: 2 },
    ]);

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'follow up');
    await userEvent.click(screen.getByTitle('Send'));

    await vi.waitFor(() => expect(screen.getByText('response after send')).toBeInTheDocument());
    await vi.waitFor(() => expect(scrollTopSetter).toHaveBeenCalled());
  });

  test('does not reset scroll lock on failed send', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockRejectedValue(new Error('send failed'));

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const container = getFlowContainer();
    mockScrollGeometry(container, 100, 500, 200);
    container.dispatchEvent(new Event('scroll'));

    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'will fail');
    await userEvent.click(screen.getByTitle('Send'));

    await vi.waitFor(() => expect(screen.getByText('send failed')).toBeInTheDocument());

    const scrollTopSetter = vi.fn();
    Object.defineProperty(container, 'scrollTop', { set: scrollTopSetter, get: () => 100, configurable: true });

    vi.mocked(window.getAcpSessionEvents).mockResolvedValue([{ kind: 'prompt', text: 'new event', timestamp: 3 }]);

    const store = vi.mocked(acpSessionsStore).acpSessions as ReturnType<typeof writable<AcpSessionInfo[]>>;
    store.set([{ ...COMPLETED_SESSION, updatedAt: 4000 }]);

    await vi.waitFor(() => expect(screen.getByText('new event')).toBeInTheDocument());
    expect(scrollTopSetter).not.toHaveBeenCalled();
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

describe('input history navigation', () => {
  test('should navigate back through sent messages with ArrowUp', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockResolvedValue(undefined);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Send two messages
    await userEvent.type(textarea, 'first message');
    await userEvent.click(screen.getByTitle('Send'));
    await vi.waitFor(() => expect(textarea).toHaveValue(''));

    await userEvent.type(textarea, 'second message');
    await userEvent.click(screen.getByTitle('Send'));
    await vi.waitFor(() => expect(textarea).toHaveValue(''));

    // Focus the textarea and place cursor at start before pressing ArrowUp
    textarea.focus();
    textarea.setSelectionRange(0, 0);
    await userEvent.keyboard('{ArrowUp}');
    expect(textarea).toHaveValue('second message');

    // Press ArrowUp again — should show oldest message
    textarea.setSelectionRange(0, 0);
    await userEvent.keyboard('{ArrowUp}');
    expect(textarea).toHaveValue('first message');
  });

  test('should navigate forward and restore draft with ArrowDown', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockResolvedValue(undefined);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Send a message
    await userEvent.type(textarea, 'sent msg');
    await userEvent.click(screen.getByTitle('Send'));
    await vi.waitFor(() => expect(textarea).toHaveValue(''));

    // Type a draft, then navigate back
    await userEvent.type(textarea, 'my draft');
    textarea.setSelectionRange(0, 0);
    await userEvent.keyboard('{ArrowUp}');
    expect(textarea).toHaveValue('sent msg');

    // Navigate forward — should restore the draft
    const len = 'sent msg'.length;
    textarea.setSelectionRange(len, len);
    await userEvent.keyboard('{ArrowDown}');
    expect(textarea).toHaveValue('my draft');
  });

  test('should not trigger history when cursor is not on first line', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.sendAcpFollowUp).mockResolvedValue(undefined);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;

    // Send a message
    await userEvent.type(textarea, 'sent');
    await userEvent.click(screen.getByTitle('Send'));
    await vi.waitFor(() => expect(textarea).toHaveValue(''));

    // Type multi-line text (Shift+Enter inserts newline without sending)
    await userEvent.type(textarea, 'line1{Shift>}{Enter}{/Shift}line2');
    // Place cursor on second line
    textarea.setSelectionRange(8, 8);
    await userEvent.keyboard('{ArrowUp}');
    // Should NOT navigate — cursor is not on the first line
    expect(textarea).toHaveValue('line1\nline2');
  });
});

describe('permission request focus management', () => {
  test('should move focus to permission button when events load after initial effect', async () => {
    Element.prototype.scrollIntoView = vi.fn();

    const waitingSession: AcpSessionInfo = {
      id: 'session-1',
      sandboxName: 'test-sandbox',
      sandboxId: 'sb-1',
      prompt: 'hello',
      status: 'waiting_input',
      createdAt: 1000,
      updatedAt: 2000,
      agentId: 'openclaw',
      agentName: 'OpenClaw',
    };

    const toolCallEvent: AcpFlowToolCallEvent = {
      kind: 'tool_call',
      toolCallId: 'tc-1',
      title: 'Run shell command',
      toolName: 'bash',
      command: 'ls -la',
      status: 'running',
      timestamp: 1500,
      permissionRequest: {
        requestId: 'req-1',
        options: [
          { name: 'Allow', kind: 'allow', optionId: 'allow' },
          { name: 'Deny', kind: 'deny', optionId: 'deny' },
        ],
        resolved: false,
      },
    };

    // Use a deferred promise so events load after the initial effect fires
    let resolveEvents!: (value: AcpFlowToolCallEvent[]) => void;
    vi.mocked(window.getAcpSessionEvents).mockImplementation(
      () =>
        new Promise(resolve => {
          resolveEvents = resolve;
        }),
    );

    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([waitingSession]);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    // Resolve events after initial render so the focus effect must rerun
    resolveEvents([toolCallEvent]);

    await vi.waitFor(() => {
      expect(document.activeElement).toBeInstanceOf(HTMLButtonElement);
      expect(document.activeElement?.closest('.permission-actions')).toBeTruthy();
      expect(document.activeElement?.textContent?.trim()).toMatch(/^(Allow|Deny)$/);
    });
  });
});

function makeDragEvent(type: string, files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: ['Files'],
      files: Object.assign(files, { item: (i: number): File | null => files[i] ?? null }),
    },
  });
  return event;
}

describe('drag-and-drop attachments', () => {
  test('should attach dropped files using native path without base64', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.getPathForFile).mockReturnValue('/Users/me/screenshots/screenshot.png');

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const dropZone = document.querySelector('[class*="rounded-lg border"]')!;
    const file = new File(['pixels'], 'screenshot.png', { type: 'image/png' });

    dropZone.dispatchEvent(makeDragEvent('dragenter', [file]));
    dropZone.dispatchEvent(makeDragEvent('drop', [file]));

    await vi.waitFor(() => {
      expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    });
    expect(window.saveTempAttachment).not.toHaveBeenCalled();
  });

  test('should reject oversized dropped files', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const dropZone = document.querySelector('[class*="rounded-lg border"]')!;
    const bigContent = new Uint8Array(21 * 1024 * 1024);
    const file = new File([bigContent], 'huge.bin', { type: 'application/octet-stream' });

    dropZone.dispatchEvent(makeDragEvent('dragenter', [file]));
    dropZone.dispatchEvent(makeDragEvent('drop', [file]));

    await vi.waitFor(() => {
      expect(screen.queryByText('huge.bin')).not.toBeInTheDocument();
    });
    expect(window.saveTempAttachment).not.toHaveBeenCalled();
  });
});

describe('clipboard paste attachments', () => {
  function makePasteEvent(data: {
    items?: Array<{ kind: string; getAsFile?: () => File }>;
    files?: File[];
    types?: string[];
    getData?: (type: string) => string;
  }): Event {
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: data.items ?? [],
        files: data.files ?? [],
        types: data.types ?? [],
        getData: data.getData ?? ((): string => ''),
      },
    });
    return event;
  }

  test('should attach pasted image files', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.saveTempAttachment).mockResolvedValue('/tmp/attachment-pasted.png');

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');
    const file = new File(['img-data'], 'image.png', { type: 'image/png' });

    textarea.dispatchEvent(
      makePasteEvent({
        items: [{ kind: 'file', getAsFile: (): File => file }],
        files: [file],
      }),
    );

    await vi.waitFor(() => {
      expect(window.saveTempAttachment).toHaveBeenCalled();
    });
  });

  test('should not intercept paste when clipboard has text', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const textarea = screen.getByRole('textbox');

    textarea.dispatchEvent(
      makePasteEvent({
        items: [],
        files: [],
        types: ['text/plain'],
        getData: (): string => 'some text',
      }),
    );

    expect(window.saveTempAttachment).not.toHaveBeenCalled();
  });
});

describe('file size validation for dialog', () => {
  test('should reject oversized files from dialog', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.openDialog).mockResolvedValue(['/path/to/huge-file.bin']);
    vi.mocked(window.pathFileSize).mockResolvedValue(25 * 1024 * 1024);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const attachButton = screen.getByTitle('Attach file');
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.queryByText('huge-file.bin')).not.toBeInTheDocument();
    });
  });

  test('should accept files within size limit from dialog', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.openDialog).mockResolvedValue(['/path/to/small-file.txt']);
    vi.mocked(window.pathFileSize).mockResolvedValue(100);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const attachButton = screen.getByTitle('Attach file');
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.getByText('small-file.txt')).toBeInTheDocument();
    });
  });

  test('should skip duplicate files from dialog', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.openDialog).mockResolvedValue(['/path/to/file.txt']);
    vi.mocked(window.pathFileSize).mockResolvedValue(100);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const attachButton = screen.getByTitle('Attach file');
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.getByText('file.txt')).toBeInTheDocument();
    });

    vi.mocked(window.openDialog).mockResolvedValue(['/path/to/file.txt']);
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.getAllByText('file.txt')).toHaveLength(1);
    });
  });

  test('should respect configured max file size from settings', async () => {
    vi.mocked(window.getConfigurationValue).mockResolvedValue(5);
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.openDialog).mockResolvedValue(['/path/to/medium-file.bin']);
    vi.mocked(window.pathFileSize).mockResolvedValue(6 * 1024 * 1024);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    await vi.waitFor(() => {
      expect(window.getConfigurationValue).toHaveBeenCalled();
    });

    const attachButton = screen.getByTitle('Attach file');
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.queryByText('medium-file.bin')).not.toBeInTheDocument();
    });
  });
});

describe('cross-method duplicate detection', () => {
  const FILE_CONTENT = 'pixels';

  test('should skip dialog file already attached via drag-and-drop', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.getPathForFile).mockReturnValue('/Users/me/photos/photo.png');

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const dropZone = document.querySelector('[class*="rounded-lg border"]')!;
    const file = new File([FILE_CONTENT], 'photo.png', { type: 'image/png' });

    dropZone.dispatchEvent(makeDragEvent('dragenter', [file]));
    dropZone.dispatchEvent(makeDragEvent('drop', [file]));

    await vi.waitFor(() => {
      expect(screen.getByText('photo.png')).toBeInTheDocument();
    });

    vi.mocked(window.openDialog).mockResolvedValue(['/Users/me/photos/photo.png']);
    vi.mocked(window.pathFileSize).mockResolvedValue(FILE_CONTENT.length);

    const attachButton = screen.getByTitle('Attach file');
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.getAllByText('photo.png')).toHaveLength(1);
    });
  });

  test('should skip drag-and-drop file already attached via dialog', async () => {
    vi.mocked(acpSessionsStore).acpSessions = writable<AcpSessionInfo[]>([COMPLETED_SESSION]);
    vi.mocked(window.openDialog).mockResolvedValue(['/Users/me/photos/photo.png']);
    vi.mocked(window.pathFileSize).mockResolvedValue(FILE_CONTENT.length);

    render(AcpSessionDetail, { sessionId: 'session-1' });

    const attachButton = screen.getByTitle('Attach file');
    await userEvent.click(attachButton);

    await vi.waitFor(() => {
      expect(screen.getByText('photo.png')).toBeInTheDocument();
    });

    vi.mocked(window.getPathForFile).mockReturnValue('/Users/me/photos/photo.png');
    const dropZone = document.querySelector('[class*="rounded-lg border"]')!;
    const file = new File([FILE_CONTENT], 'photo.png', { type: 'image/png' });

    dropZone.dispatchEvent(makeDragEvent('dragenter', [file]));
    dropZone.dispatchEvent(makeDragEvent('drop', [file]));

    await vi.waitFor(() => {
      expect(screen.getAllByText('photo.png')).toHaveLength(1);
    });
    expect(window.saveTempAttachment).not.toHaveBeenCalled();
  });
});
