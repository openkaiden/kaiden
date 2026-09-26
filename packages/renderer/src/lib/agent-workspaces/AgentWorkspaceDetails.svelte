<script lang="ts">
import { faArrowsRotate, faTerminal, faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage, Tab } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import AgentWorkspaceDetailsOverview from '/@/lib/agent-workspaces/AgentWorkspaceDetailsOverview.svelte';
import AgentWorkspaceDetailsSettings from '/@/lib/agent-workspaces/AgentWorkspaceDetailsSettings.svelte';
import AgentWorkspaceTerminal from '/@/lib/agent-workspaces/AgentWorkspaceTerminal.svelte';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import { allOpenshellSandboxes } from '/@/stores/openshell-sandboxes';

interface Props {
  workspaceId: string;
}

let { workspaceId }: Props = $props();

let configuration: Awaited<ReturnType<typeof window.getAgentWorkspaceConfiguration>> = $state({});
let configurationError: string | undefined = $state(undefined);

const workspaceSummary = $derived($allOpenshellSandboxes.find(ws => ws.id === workspaceId));

const status = $derived(workspaceSummary?.phase ?? 'Unknown');
const isRunning = $derived(status === 'Ready' || status === 'Deleting');
const inProgress = $derived(status === 'Provisioning' || status === 'Deleting');

let agentTerminalReconnectExhausted = $state(false);
let agentTerminalReconnect: (() => void) | undefined = $state(undefined);
let shellTerminalReconnectExhausted = $state(false);
let shellTerminalReconnect: (() => void) | undefined = $state(undefined);
// the reconnect action of the terminal tab currently shown, if its reconnect attempts are exhausted
const terminalReconnect = $derived.by(() => {
  if (isTabSelected($router.path, 'terminal-agent') && agentTerminalReconnectExhausted) return agentTerminalReconnect;
  if (isTabSelected($router.path, 'terminal-shell') && shellTerminalReconnectExhausted) return shellTerminalReconnect;
  return undefined;
});

let wasFound = false;
$effect(() => {
  if (workspaceSummary) {
    wasFound = true;
  } else if (wasFound) {
    router.goto('/agent-workspaces');
  }
});

$effect(() => {
  configurationError = undefined;
  let current = true;
  window
    .getAgentWorkspaceConfiguration(workspaceId)
    .then(config => {
      if (current) configuration = config;
    })
    .catch((err: unknown) => {
      if (current) configurationError = String(err);
    });
  return (): void => {
    current = false;
  };
});

async function handleTerminal(): Promise<void> {
  if (!isRunning && !inProgress) {
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Error can't open terminal on workspace "${workspaceSummary?.name}"`,
      buttons: ['OK'],
    });
  }
  router.goto(`/agent-workspaces/${encodeURIComponent(workspaceId)}/terminal-agent`);
}

function handleRemove(): void {
  withConfirmation(
    () => {
      if (workspaceSummary) {
        window.removeAgentWorkspace(workspaceId, workspaceSummary.gatewayName).catch((error: unknown) => {
          console.error('Failed to remove agent workspace', error);
        });
      }
      router.goto('/agent-workspaces');
    },
    `remove workspace ${workspaceSummary?.name ?? workspaceId}`,
  );
}
</script>

<DetailsPage title={workspaceSummary?.name ?? ''}>
  {#snippet actionsSnippet()}
    {#if isRunning && terminalReconnect}
      <ListItemButtonIcon
        title="Reconnect"
        onClick={terminalReconnect}
        icon={faArrowsRotate} />
    {/if}
    <ListItemButtonIcon
      title="Open Terminal"
      onClick={handleTerminal}
      icon={faTerminal} />
    <ListItemButtonIcon
      title="Remove Workspace"
      onClick={handleRemove}
      icon={faTrash} />
  {/snippet}
  {#snippet tabsSnippet()}
    <Tab title="Overview" selected={isTabSelected($router.path, 'overview')} url={getTabUrl($router.path, 'overview')} />
    <Tab
      title="Agent's Terminal"
      selected={isTabSelected($router.path, 'terminal-agent')}
      url={getTabUrl($router.path, 'terminal-agent')} />
    <Tab
      title="Shell Terminal"
      selected={isTabSelected($router.path, 'terminal-shell')}
      url={getTabUrl($router.path, 'terminal-shell')} />
    <!-- <Tab title="Files" selected={isTabSelected($router.path, 'files')} url={getTabUrl($router.path, 'files')} /> -->
    <Tab title="Settings" selected={isTabSelected($router.path, 'settings')} url={getTabUrl($router.path, 'settings')} />
  {/snippet}
  {#snippet contentSnippet()}
    <Route path="/overview" breadcrumb="Overview" navigationHint="tab">
      {#if configurationError}
        <ErrorMessage error={configurationError} />
      {/if}
      <AgentWorkspaceDetailsOverview {workspaceSummary} {configuration} />
    </Route>
    <Route path="/terminal-agent" breadcrumb="Agent's Terminal" navigationHint="tab">
      <AgentWorkspaceTerminal
        workspaceId={workspaceId}
        bind:reconnectExhausted={agentTerminalReconnectExhausted}
        bind:reconnect={agentTerminalReconnect} />
    </Route>
    <Route path="/terminal-shell" breadcrumb="Shell Terminal" navigationHint="tab">
      <AgentWorkspaceTerminal
        workspaceId={workspaceId}
        kind="shell"
        bind:reconnectExhausted={shellTerminalReconnectExhausted}
        bind:reconnect={shellTerminalReconnect} />
    </Route>
    <!-- <Route path="/files" breadcrumb="Files" navigationHint="tab">
      <AgentWorkspaceDetailsFiles />
    </Route> -->
    <Route path="/settings" breadcrumb="Settings" navigationHint="tab">
      <AgentWorkspaceDetailsSettings {workspaceId} {workspaceSummary} bind:configuration />
    </Route>
  {/snippet}
</DetailsPage>
