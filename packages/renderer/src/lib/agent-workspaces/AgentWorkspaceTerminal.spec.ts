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

import { render, screen, waitFor } from '@testing-library/svelte';
import { Terminal } from '@xterm/xterm';
import { tick } from 'svelte';
import { writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { openshellSandboxes } from '/@/stores/openshell-sandboxes';
import type { GatewaySandboxes } from '/@api/openshell-gateway-info';

import AgentWorkspaceTerminal from './AgentWorkspaceTerminal.svelte';

const workspace: GatewaySandboxes = {
  gateway: {
    name: 'kaiden',
    endpoint: 'http://localhost:18080',
  },
  sandboxes: [
    {
      id: 'ws-1',
      name: 'test-workspace',
      phase: 'Ready',
      created_at: Date.now().toString(),
    },
  ],
};

vi.mock(import('tinro'));

const routerStore = writable({
  path: '/agent-workspaces/ws-1/terminal-agent',
  url: '/agent-workspaces/ws-1/terminal-agent',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

let shellInAgentWorkspaceMock = vi.fn();

function setRoute(path: string): void {
  routerStore.update(route => ({ ...route, path, url: path }));
}

beforeEach(() => {
  vi.resetAllMocks();
  setRoute('/agent-workspaces/ws-1/terminal-agent');
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  vi.mocked(window.getConfigurationValue).mockImplementation(async (key: string) => {
    if (key === 'terminal.integrated.scrollback') {
      return 1000;
    }
    return undefined;
  });
  shellInAgentWorkspaceMock = vi.mocked(window.shellInAgentWorkspace);
  openshellSandboxes.set([]);
});

function getWorkspace(
  phase: 'Provisioning' | 'Ready' | 'Error' | 'Deleting' | 'Unknown' | 'Unspecified',
): GatewaySandboxes {
  return { gateway: workspace.gateway, sandboxes: [{ ...workspace.sandboxes[0], phase }] };
}

test('opens shell and refits terminal when workspace transitions from starting to running', async () => {
  openshellSandboxes.set([getWorkspace('Provisioning')]);

  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockResolvedValue(sendCallbackId);

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });

  expect(shellInAgentWorkspaceMock).not.toHaveBeenCalled();

  openshellSandboxes.set([getWorkspace('Ready')]);

  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(window.shellInAgentWorkspaceResize).toHaveBeenCalled());
});

test('shows empty screen when workspace is not running', async () => {
  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });

  await waitFor(() => {
    expect(screen.getByText('Workspace is not running')).toBeInTheDocument();
  });
});

test('calls shellInAgentWorkspace when workspace is running', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);

  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockResolvedValue(sendCallbackId);

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });

  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalled());
  expect(shellInAgentWorkspaceMock).toHaveBeenCalledWith(
    'ws-1',
    expect.any(Function),
    expect.any(Function),
    expect.any(Function),
    'agent',
  );
});

test('requests a plain shell when kind is shell and resizes it on its own route', async () => {
  setRoute('/agent-workspaces/ws-1/terminal-shell');
  openshellSandboxes.set([getWorkspace('Ready')]);
  shellInAgentWorkspaceMock.mockResolvedValue(42);

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', kind: 'shell', screenReaderMode: true });

  await waitFor(() =>
    expect(shellInAgentWorkspaceMock).toHaveBeenCalledWith(
      'ws-1',
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      'shell',
    ),
  );
  await waitFor(() => expect(window.shellInAgentWorkspaceResize).toHaveBeenCalled());
  vi.mocked(window.shellInAgentWorkspaceResize).mockClear();

  window.dispatchEvent(new Event('resize'));

  await waitFor(() =>
    expect(window.shellInAgentWorkspaceResize).toHaveBeenCalledWith(42, expect.anything(), expect.anything()),
  );
});

test('does not resize a shell terminal while the agent terminal route is shown', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  shellInAgentWorkspaceMock.mockResolvedValue(42);

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', kind: 'shell', screenReaderMode: true });

  await waitFor(() => expect(window.shellInAgentWorkspaceResize).toHaveBeenCalled());
  vi.mocked(window.shellInAgentWorkspaceResize).mockClear();

  window.dispatchEvent(new Event('resize'));

  expect(window.shellInAgentWorkspaceResize).not.toHaveBeenCalled();
});

test('writes received data to xterm terminal', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onDataCallback: (data: string) => void = () => {};
  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, onData: (data: string) => void, _onError: (error: string) => void, _onEnd: () => void) => {
      onDataCallback = onData;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });

  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalled());

  onDataCallback('hello\nworld');

  await waitFor(() => {
    const liveRegion = renderObject.container.querySelector('div[aria-live="assertive"]');
    expect(liveRegion).toHaveTextContent('hello world');
  });
});

test('detaches from the agent session on unmount without closing it', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  shellInAgentWorkspaceMock.mockResolvedValue(42);

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalled());
  await waitFor(() => expect(window.shellInAgentWorkspaceResize).toHaveBeenCalled());

  renderObject.unmount();

  expect(window.shellInAgentWorkspaceClose).toHaveBeenCalledWith(42);
});

test('attaches again through shellInAgentWorkspace when remounted', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  shellInAgentWorkspaceMock.mockResolvedValue(42);

  const first = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));
  first.unmount();

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));
});

test('closes the previous attachment before reconnecting on a status transition', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  const calls: string[] = [];
  vi.mocked(window.shellInAgentWorkspaceClose).mockImplementation(async id => {
    calls.push(`close:${id}`);
  });
  shellInAgentWorkspaceMock.mockImplementation(async () => {
    calls.push('attach');
    return calls.filter(c => c === 'attach').length === 1 ? 42 : 43;
  });

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() =>
    expect(window.shellInAgentWorkspaceResize).toHaveBeenCalledWith(42, expect.anything(), expect.anything()),
  );

  // the workspace flickers through a non-ready phase and back while the callback is still attached
  openshellSandboxes.set([getWorkspace('Provisioning')]);
  await tick();
  openshellSandboxes.set([getWorkspace('Ready')]);
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  expect(calls).toEqual(['attach', 'close:42', 'attach']);
});

test('closes an attachment that completes after unmount', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  let resolveAttach: (id: number) => void = () => {};
  shellInAgentWorkspaceMock.mockImplementation(() => new Promise<number>(r => (resolveAttach = r)));

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalled());

  renderObject.unmount();
  expect(window.shellInAgentWorkspaceClose).not.toHaveBeenCalled();
  resolveAttach(42);

  await waitFor(() => expect(window.shellInAgentWorkspaceClose).toHaveBeenCalledWith(42));
  expect(window.shellInAgentWorkspaceResize).not.toHaveBeenCalled();
});

test('a status transition during the initial attach does not start a second attach', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  let resolveAttach: (id: number) => void = () => {};
  shellInAgentWorkspaceMock.mockImplementation(() => new Promise<number>(r => (resolveAttach = r)));

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  openshellSandboxes.set([getWorkspace('Provisioning')]);
  await tick();
  openshellSandboxes.set([getWorkspace('Ready')]);
  await tick();
  resolveAttach(42);
  await waitFor(() =>
    expect(window.shellInAgentWorkspaceResize).toHaveBeenCalledWith(42, expect.anything(), expect.anything()),
  );

  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1);
});

test('unmounting while the terminal settings load creates no terminal and no attachment', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  let resolveConfig: (value: number) => void = () => {};
  vi.mocked(window.getConfigurationValue).mockImplementation(() => new Promise<number>(r => (resolveConfig = r)));

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(window.getConfigurationValue).toHaveBeenCalled());
  renderObject.unmount();
  const settle = (): Promise<void> => new Promise(r => setTimeout(r, 0));
  for (let i = 0; i < 3; i++) {
    resolveConfig(1);
    await settle();
  }

  expect(shellInAgentWorkspaceMock).not.toHaveBeenCalled();
  expect(renderObject.container.querySelector('.xterm')).toBeNull();
});

test('detaches the new callback when the initial resize fails', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  shellInAgentWorkspaceMock.mockResolvedValue(42);
  vi.mocked(window.shellInAgentWorkspaceResize).mockRejectedValueOnce(new Error('resize failed'));

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });

  await waitFor(() => expect(window.shellInAgentWorkspaceClose).toHaveBeenCalledWith(42));
});

test('a retry that fires while an attach is in flight stays pending until the attach settles', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  let resolveShell: ((id: number) => void) | undefined;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return 42;
    },
  );
  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  // wait for the initial attachment to be fully established, not only requested
  await vi.waitFor(() => expect(window.shellInAgentWorkspaceResize).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(0);

  // the reconnect attach takes longer than the retry delay
  shellInAgentWorkspaceMock.mockImplementation(() => new Promise<number>(resolve => (resolveShell = resolve)));
  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));
  // a second end while that attach is in flight schedules the safety-net retry
  onEndCallback();
  await vi.advanceTimersByTimeAsync(2000);
  // the retry fired during the in-flight attach: it must stay pending rather than being consumed
  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2);

  shellInAgentWorkspaceMock.mockResolvedValue(43);
  resolveShell?.(42);
  await vi.advanceTimersByTimeAsync(2000);

  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(3));

  renderObject.unmount();
  vi.useRealTimers();
});

test('reattaches into a fresh xterm so the replayed screen is not duplicated', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);
  const disposeSpy = vi.spyOn(Terminal.prototype, 'dispose');
  let onDataCallback: (data: string) => void = () => {};
  let onEndCallback: () => void = () => {};
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onDataCallback = onData;
      onEndCallback = onEnd;
      return 42;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));
  onDataCallback('old output');
  await waitFor(() =>
    expect(renderObject.container.querySelector('div[aria-live="assertive"]')).toHaveTextContent('old output'),
  );

  const oldTextarea = renderObject.container.querySelector<HTMLTextAreaElement>('.xterm textarea');
  oldTextarea?.focus();
  expect(document.activeElement).toBe(oldTextarea);

  onEndCallback();
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  expect(disposeSpy).toHaveBeenCalledTimes(1);
  expect(renderObject.container.querySelectorAll('.xterm')).toHaveLength(1);
  expect(renderObject.container.querySelector('div[aria-live="assertive"]')).not.toHaveTextContent('old output');
  // keyboard focus moves to the replacement so keystrokes keep reaching the agent
  const newTextarea = renderObject.container.querySelector<HTMLTextAreaElement>('.xterm textarea');
  expect(newTextarea).not.toBe(oldTextarea);
  expect(document.activeElement).toBe(newTextarea);
  disposeSpy.mockRestore();
});

test('receiveEndCallback reconnects when shell ends while workspace is running', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  onEndCallback();
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  expect(window.shellInAgentWorkspaceResize).toHaveBeenCalledTimes(3);
});

test('receiveEndCallback schedules reconnect when workspace is not running', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  openshellSandboxes.set([getWorkspace('Unknown')]);
  await tick();
  onEndCallback();

  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1);

  openshellSandboxes.set([getWorkspace('Ready')]);
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));
});

test('terminal reconnects via scheduleReconnect when immediate reconnect fails', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockRejectedValueOnce(new Error('workspace is restarting'));

  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(3));

  renderObject.unmount();
  vi.useRealTimers();
});

test('scheduleReconnect retries when restartTerminal fails inside the timer callback', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockRejectedValueOnce(new Error('first failure'));
  shellInAgentWorkspaceMock.mockRejectedValueOnce(new Error('second failure'));

  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(3));

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(4));

  renderObject.unmount();
  vi.useRealTimers();
});

test('concurrent receiveEndCallback calls do not create duplicate connections', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  let resolveShell: ((id: number) => void) | undefined;
  const sendCallbackId = 42;

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockImplementation(
    () =>
      new Promise<number>(resolve => {
        resolveShell = resolve;
      }),
  );

  onEndCallback();
  onEndCallback();

  resolveShell?.(sendCallbackId);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2);

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(3));

  renderObject.unmount();
  vi.useRealTimers();
});

test('receiveEndCallback during reconnect schedules safety-net retry to prevent freeze', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  let resolveShell: ((id: number) => void) | undefined;
  const sendCallbackId = 42;

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockImplementation(
    () =>
      new Promise<number>(resolve => {
        resolveShell = resolve;
      }),
  );

  onEndCallback();
  onEndCallback();

  resolveShell?.(sendCallbackId);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(3));

  renderObject.unmount();
  vi.useRealTimers();
});

test('$effect schedules reconnect when restartTerminal fails', async () => {
  openshellSandboxes.set([getWorkspace('Ready')]);

  const sendCallbackId = 42;
  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, _onEnd: () => void) => {
      return sendCallbackId;
    },
  );

  render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  openshellSandboxes.set([getWorkspace('Unknown')]);
  await tick();

  shellInAgentWorkspaceMock.mockRejectedValueOnce(new Error('not ready yet'));
  openshellSandboxes.set([getWorkspace('Ready')]);

  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, _onEnd: () => void) => {
      return sendCallbackId;
    },
  );

  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(3), { timeout: 5000 });
});

async function drainReconnectAttempts(mock: ReturnType<typeof vi.fn>, fromCall: number, toCall: number): Promise<void> {
  for (let i = fromCall; i <= toCall; i++) {
    await vi.advanceTimersByTimeAsync(2000);
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(i));
  }
}

test('restartTerminal stops reconnecting after MAX_RECONNECT_ATTEMPTS failures', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockRejectedValue(new Error('connection refused'));

  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  await drainReconnectAttempts(shellInAgentWorkspaceMock, 3, 31);

  await vi.advanceTimersByTimeAsync(4000);
  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(31);

  renderObject.unmount();
  vi.useRealTimers();
});

test('$effect resets reconnect counter when workspace transitions to running after exhaustion', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockRejectedValue(new Error('connection refused'));
  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  await drainReconnectAttempts(shellInAgentWorkspaceMock, 3, 31);

  await vi.advanceTimersByTimeAsync(4000);
  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(31);

  vi.useRealTimers();

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  openshellSandboxes.set([getWorkspace('Unknown')]);
  await tick();
  openshellSandboxes.set([getWorkspace('Ready')]);

  await waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(32));

  renderObject.unmount();
});

test('reconnect timer is cleared on unmount during retry loop', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockRejectedValueOnce(new Error('connection refused'));
  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));
  await vi.advanceTimersByTimeAsync(100);

  renderObject.unmount();

  await vi.advanceTimersByTimeAsync(4000);
  expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2);

  vi.useRealTimers();
});

test('reconnectExhausted remains false while reconnect count is below MAX_RECONNECT_ATTEMPTS', async () => {
  vi.useFakeTimers();
  openshellSandboxes.set([getWorkspace('Ready')]);

  let onEndCallback: () => void = () => {};
  const sendCallbackId = 42;

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  const renderObject = render(AgentWorkspaceTerminal, { workspaceId: 'ws-1', screenReaderMode: true });
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(1));

  shellInAgentWorkspaceMock.mockRejectedValue(new Error('connection refused'));
  onEndCallback();
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(2));

  await drainReconnectAttempts(shellInAgentWorkspaceMock, 3, 6);

  shellInAgentWorkspaceMock.mockImplementation(
    async (_id: string, _onData: (data: string) => void, _onError: (error: string) => void, onEnd: () => void) => {
      onEndCallback = onEnd;
      return sendCallbackId;
    },
  );

  await vi.advanceTimersByTimeAsync(2000);
  await vi.waitFor(() => expect(shellInAgentWorkspaceMock).toHaveBeenCalledTimes(7));

  renderObject.unmount();
  vi.useRealTimers();
});
