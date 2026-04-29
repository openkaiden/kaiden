<script lang="ts">
import { faPlay, faStop, faTerminal, faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage, Tab } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import AgentWorkspaceDetailsSummary from '/@/lib/agent-workspaces/AgentWorkspaceDetailsSummary.svelte';
import AgentWorkspaceTerminal from '/@/lib/agent-workspaces/AgentWorkspaceTerminal.svelte';
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

function handleTerminal(): void {
  if (!isRunning && !inProgress) {
    startAgentWorkspace(workspaceId).catch(console.error);
  }
  router.goto(`/agent-workspaces/${encodeURIComponent(workspaceId)}/terminal`);
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
      title="Open Terminal"
      onClick={handleTerminal}
      icon={faTerminal} />
    <ListItemButtonIcon
      title="Remove Workspace"
      onClick={handleRemove}
      icon={faTrash} />
  {/snippet}
  {#snippet tabsSnippet()}
    <Tab title="Summary" selected={isTabSelected($router.path, 'summary')} url={getTabUrl($router.path, 'summary')} />
    <Tab title="Terminal" selected={isTabSelected($router.path, 'terminal')} url={getTabUrl($router.path, 'terminal')} />
  {/snippet}
  {#snippet contentSnippet()}
    <Route path="/summary" breadcrumb="Summary" navigationHint="tab">
      {#if configurationError}
        <ErrorMessage error={configurationError} />
      {/if}
      <AgentWorkspaceDetailsSummary {workspaceSummary} {configuration} />
    </Route>
    <Route path="/terminal" breadcrumb="Terminal" navigationHint="tab">
      <AgentWorkspaceTerminal workspaceId={workspaceId} />
    </Route>
  {/snippet}
</DetailsPage>
