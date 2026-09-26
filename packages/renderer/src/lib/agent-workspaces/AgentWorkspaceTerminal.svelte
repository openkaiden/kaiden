<script lang="ts">
import '@xterm/xterm/css/xterm.css';

import { EmptyScreen } from '@podman-desktop/ui-svelte';
import { FitAddon } from '@xterm/addon-fit';
import type { IDisposable } from '@xterm/xterm';
import { Terminal } from '@xterm/xterm';
import { onDestroy, onMount } from 'svelte';
import { router } from 'tinro';

import { getTerminalTheme } from '/@/lib/terminal/terminal-theme';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { allOpenshellSandboxes } from '/@/stores/openshell-sandboxes';
import { TerminalSettings } from '/@api/terminal/terminal-settings';

const MAX_RECONNECT_ATTEMPTS = 30;

interface Props {
  workspaceId: string;
  // agent: the agent session of the workspace, shell: a plain shell of the workspace (both kept when the terminal closes)
  kind?: 'agent' | 'shell';
  screenReaderMode?: boolean;
  reconnectExhausted?: boolean;
  reconnect?: () => void;
}

let {
  workspaceId,
  kind = 'agent',
  screenReaderMode = false,
  reconnectExhausted = $bindable(false),
  reconnect = $bindable(),
}: Props = $props();
let terminalXtermDiv: HTMLDivElement;
let shellTerminal: Terminal;
let currentRouterPath: string;
let sendCallbackId: number | undefined;
let fitAddon: FitAddon;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let onDataDisposable: IDisposable | undefined;
let reconnecting = false;
let reconnectCount = 0;
let destroyed = false;
// set once an attachment has fed the xterm: the next attach then starts from a fresh one
let needsFreshTerminal = false;
let terminalSettings: { fontSize?: number; lineHeight?: number; scrollback?: number } = {};

const workspaceSummary = $derived($allOpenshellSandboxes.find(ws => ws.id === workspaceId));
const status = $derived(workspaceSummary?.phase ?? 'Provisioning');
const isRunning = $derived(status === 'Ready');
let lastStatus = $state('');

function registerInputHandler(callbackId: number): void {
  onDataDisposable?.dispose();
  onDataDisposable = shellTerminal?.onData(data => {
    window.shellInAgentWorkspaceSend(callbackId, data).catch((error: unknown) => console.log(String(error)));
  });
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
    reconnectExhausted = true;
    return;
  }
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    if (reconnecting) {
      // an attach is still in flight: keep the retry pending instead of letting restartTerminal drop it
      scheduleReconnect();
      return;
    }
    if (isRunning) {
      restartTerminal().catch((err: unknown) => {
        console.error(`Error reopening terminal for workspace ${workspaceId}`, err);
        scheduleReconnect();
      });
    }
  }, 2000);
}

async function restartTerminal(): Promise<void> {
  if (reconnecting) return;
  if (reconnectCount >= MAX_RECONNECT_ATTEMPTS) {
    reconnectExhausted = true;
    return;
  }
  reconnectCount++;
  reconnecting = true;
  try {
    clearReconnectTimer();
    await executeShellInWorkspace();
    window.dispatchEvent(new Event('resize'));
  } finally {
    reconnecting = false;
  }
}

function manualReconnect(): void {
  reconnectCount = 0;
  reconnectExhausted = false;
  restartTerminal().catch((err: unknown) => {
    console.error(`Error reconnecting terminal for workspace ${workspaceId}`, err);
    scheduleReconnect();
  });
}

$effect(() => {
  if (lastStatus !== '' && lastStatus !== 'Ready' && status === 'Ready') {
    reconnectCount = 0;
    reconnectExhausted = false;
    restartTerminal().catch((err: unknown) => {
      console.error(`Error starting terminal for workspace ${workspaceId}`, err);
      scheduleReconnect();
    });
  }
  lastStatus = status;
});

router.subscribe(route => {
  currentRouterPath = route.path;
});

function handleResize(): void {
  if (currentRouterPath === `/agent-workspaces/${encodeURIComponent(workspaceId)}/terminal-${kind}`) {
    fitAddon.fit();
    if (sendCallbackId) {
      window
        .shellInAgentWorkspaceResize(sendCallbackId, shellTerminal.cols, shellTerminal.rows)
        ?.catch((err: unknown) => console.error(`Error resizing terminal for workspace ${workspaceId}`, err));
    }
  }
}

function createDataCallback(): (data: string) => void {
  return (data: string) => {
    shellTerminal.write(data);
  };
}

function receiveEndCallback(): void {
  const callbackId = sendCallbackId;
  sendCallbackId = undefined;

  // the shell ended while a reconnect is in flight: schedule a safety-net retry so the terminal cannot freeze
  if (reconnecting) {
    scheduleReconnect();
    return;
  }

  if (!callbackId) return;

  if (isRunning) {
    restartTerminal().catch((err: unknown) => {
      console.error(`Error reopening terminal for workspace ${workspaceId}`, err);
      scheduleReconnect();
    });
  } else {
    scheduleReconnect();
  }
}

async function executeShellInWorkspace(): Promise<void> {
  if (!isRunning) {
    return;
  }

  // a reconnect while still attached (e.g. a status transition) must not leave two callbacks feeding this xterm
  const previousCallbackId = sendCallbackId;
  sendCallbackId = undefined;
  if (previousCallbackId !== undefined) {
    // keystrokes typed while the new attach is pending must not go to the closed id
    onDataDisposable?.dispose();
    onDataDisposable = undefined;
    detach(previousCallbackId).catch(() => {});
  }
  // the main process replays the whole screen on attach: reattach into a fresh xterm so nothing is duplicated
  // (only when the current one was used: a failing reconnect loop must not rebuild it on every retry)
  if (needsFreshTerminal) {
    createTerminal();
  }

  // the agent session lives in the main process: this attaches to it and replays its recent output
  const callbackId = await window.shellInAgentWorkspace(
    workspaceId,
    createDataCallback(),
    () => {},
    receiveEndCallback,
    kind,
  );
  if (destroyed) {
    // the component went away while attaching: do not keep a callback bound to a disposed terminal
    await detach(callbackId);
    return;
  }
  try {
    await window.shellInAgentWorkspaceResize(callbackId, shellTerminal.cols, shellTerminal.rows);
  } catch (err: unknown) {
    // the attachment is registered on the main side: release it before the caller retries
    await detach(callbackId);
    throw err;
  }
  if (destroyed) {
    await detach(callbackId);
    return;
  }
  registerInputHandler(callbackId);
  sendCallbackId = callbackId;
  needsFreshTerminal = true;
}

// only detaches: the agent keeps running in the workspace
async function detach(callbackId: number): Promise<void> {
  try {
    await window.shellInAgentWorkspaceClose(callbackId);
  } catch (err: unknown) {
    console.error(`Error detaching terminal for workspace ${workspaceId}`, err);
  }
}

async function refreshTerminal(): Promise<void> {
  if (!terminalXtermDiv) {
    return;
  }

  const fontSize = await window.getConfigurationValue<number>(
    TerminalSettings.SectionName + '.' + TerminalSettings.FontSize,
  );
  const lineHeight = await window.getConfigurationValue<number>(
    TerminalSettings.SectionName + '.' + TerminalSettings.LineHeight,
  );
  const scrollback = await window.getConfigurationValue<number>(
    TerminalSettings.SectionName + '.' + TerminalSettings.Scrollback,
  );
  if (destroyed) {
    // torn down while the settings were loading: nothing to create
    return;
  }
  terminalSettings = { fontSize, lineHeight, scrollback };
  createTerminal();
}

// replaces any previous xterm (reattach): its element is removed from the container on dispose
function createTerminal(): void {
  needsFreshTerminal = false;
  // disposing removes the focused textarea: give the replacement the focus back so keystrokes keep flowing
  const hadFocus = shellTerminal?.textarea !== undefined && shellTerminal.textarea === document.activeElement;
  onDataDisposable?.dispose();
  onDataDisposable = undefined;
  shellTerminal?.dispose();
  shellTerminal = new Terminal({
    ...terminalSettings,
    screenReaderMode,
    theme: getTerminalTheme(),
  });

  fitAddon = new FitAddon();
  shellTerminal.loadAddon(fitAddon);

  shellTerminal.open(terminalXtermDiv);
  fitAddon.fit();
  if (hadFocus) {
    shellTerminal.focus();
  }
  window.dispatchEvent(new Event('resize'));
}

onMount(async () => {
  reconnect = manualReconnect;
  reconnectExhausted = false;
  reconnectCount = 0;
  // the initial attach counts as a reconnect so that a status transition cannot start a second one meanwhile
  reconnecting = true;
  try {
    await refreshTerminal();
    if (destroyed) {
      return;
    }
    window.addEventListener('resize', handleResize);
    await executeShellInWorkspace();
  } catch (err: unknown) {
    console.error(`Error starting terminal for workspace ${workspaceId}`, err);
    scheduleReconnect();
  } finally {
    reconnecting = false;
  }
});

onDestroy(() => {
  destroyed = true;
  clearReconnectTimer();
  window.removeEventListener('resize', handleResize);
  onDataDisposable?.dispose();
  if (sendCallbackId !== undefined) {
    detach(sendCallbackId).catch(() => {});
  }
  shellTerminal?.dispose();
  sendCallbackId = undefined;
});
</script>

<div
  class="h-full p-[5px] pr-0 bg-[var(--pd-terminal-background)]"
  bind:this={terminalXtermDiv}
  class:hidden={!isRunning}>
</div>

<EmptyScreen
  hidden={isRunning}
  icon={NoLogIcon}
  title="No Terminal"
  message="Workspace is not running" />
