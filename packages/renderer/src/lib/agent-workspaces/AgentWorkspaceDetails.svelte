<script lang="ts">
import { faPlay, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage, Tab } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import AgentWorkspaceDetailsFiles from '/@/lib/agent-workspaces/AgentWorkspaceDetailsFiles.svelte';
import AgentWorkspaceDetailsOverview from '/@/lib/agent-workspaces/AgentWorkspaceDetailsOverview.svelte';
import AgentWorkspaceDetailsSettings from '/@/lib/agent-workspaces/AgentWorkspaceDetailsSettings.svelte';
import AgentWorkspaceDetailsTerminal from '/@/lib/agent-workspaces/AgentWorkspaceDetailsTerminal.svelte';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import { agentWorkspaces, startAgentWorkspace, stopAgentWorkspace } from '/@/stores/agent-workspaces.svelte';

interface Props {
  workspaceId: string;
}

let { workspaceId }: Props = $props();

let configuration: Awaited<ReturnType<typeof window.getAgentWorkspaceConfiguration>> = $state({});
let configurationError: string | undefined = $state(undefined);

const workspaceSummary = $derived($agentWorkspaces.find(ws => ws.id === workspaceId));

const status = $derived(workspaceSummary?.state ?? 'stopped');
const isRunning = $derived(status === 'running' || status === 'stopping');
const inProgress = $derived(status === 'starting' || status === 'stopping');

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

async function handleStartStop(): Promise<void> {
  if (inProgress || workspaceSummary === undefined) return;
  const name = workspaceSummary?.name ?? workspaceId;
  try {
    if (isRunning) {
      await stopAgentWorkspace(workspaceSummary.id);
    } else {
      await startAgentWorkspace(workspaceSummary.id);
    }
  } catch (error: unknown) {
    const action = isRunning ? 'stopping' : 'starting';
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Error while ${action} workspace "${name}": ${error}`,
      buttons: ['OK'],
    });
  }
}

function handleRemove(): void {
  withConfirmation(
    async () => {
      try {
        await window.removeAgentWorkspace(workspaceId);
        router.goto('/agent-workspaces');
      } catch (error: unknown) {
        console.error('Failed to remove agent workspace', error);
      }
    },
    `remove workspace ${workspaceSummary?.name ?? workspaceId}`,
  );
}
</script>

<DetailsPage title={workspaceSummary?.name ?? ''}>
  {#snippet actionsSnippet()}
    <ListItemButtonIcon
      title={isRunning ? 'Stop Workspace' : 'Start Workspace'}
      onClick={handleStartStop}
      icon={isRunning ? faStop : faPlay}
      inProgress={inProgress} />
    <ListItemButtonIcon
      title="Remove Workspace"
      onClick={handleRemove}
      icon={faTrash} />
  {/snippet}
  {#snippet tabsSnippet()}
    <Tab title="Overview" selected={isTabSelected($router.path, 'overview')} url={getTabUrl($router.path, 'overview')} />
    <Tab title="Terminal" selected={isTabSelected($router.path, 'terminal')} url={getTabUrl($router.path, 'terminal')} />
    <Tab title="Files" selected={isTabSelected($router.path, 'files')} url={getTabUrl($router.path, 'files')} />
    <Tab title="Settings" selected={isTabSelected($router.path, 'settings')} url={getTabUrl($router.path, 'settings')} />
  {/snippet}
  {#snippet contentSnippet()}
    <Route path="/overview" breadcrumb="Overview" navigationHint="tab">
      {#if configurationError}
        <ErrorMessage error={configurationError} />
      {/if}
      <AgentWorkspaceDetailsOverview {workspaceSummary} {configuration} />
    </Route>
    <Route path="/terminal" breadcrumb="Terminal" navigationHint="tab">
      <AgentWorkspaceDetailsTerminal />
    </Route>
    <Route path="/files" breadcrumb="Files" navigationHint="tab">
      <AgentWorkspaceDetailsFiles />
    </Route>
    <Route path="/settings" breadcrumb="Settings" navigationHint="tab">
      <AgentWorkspaceDetailsSettings />
    </Route>
  {/snippet}
</DetailsPage>
