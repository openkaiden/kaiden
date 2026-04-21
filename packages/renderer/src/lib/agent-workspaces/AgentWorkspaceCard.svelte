<script lang="ts">
import { faBrain, faCubes, faFolder, faGear, faPlay, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { router } from 'tinro';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import LoadingIcon from '/@/lib/ui/LoadingIcon.svelte';
import {
  type AgentWorkspaceSummaryUI,
  startAgentWorkspace,
  stopAgentWorkspace,
} from '/@/stores/agent-workspaces.svelte';

interface Props {
  workspace: AgentWorkspaceSummaryUI;
}

let { workspace }: Props = $props();

const state = $derived(workspace.state);
const isRunning = $derived(state === 'running' || state === 'stopping');
const inProgress = $derived(state === 'starting' || state === 'stopping');

function handleOpen(): void {
  router.goto(`/agent-workspaces/${encodeURIComponent(workspace.id)}/summary`);
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    handleOpen();
  }
}

function handleActionKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' || e.key === ' ') {
    e.stopPropagation();
  }
}

function handleStartStopClick(e: MouseEvent): void {
  e.stopPropagation();
  handleStartStop().catch(console.error);
}

async function handleStartStop(): Promise<void> {
  if (inProgress) return;
  try {
    if (isRunning) {
      await stopAgentWorkspace(workspace.id);
    } else {
      await startAgentWorkspace(workspace.id);
    }
  } catch (error: unknown) {
    const action = isRunning ? 'stopping' : 'starting';
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Error while ${action} workspace "${workspace.name}": ${error}`,
      buttons: ['OK'],
    });
  }
}

function handleRemoveClick(e: MouseEvent): void {
  e.stopPropagation();
  handleRemove();
}

function handleRemove(): void {
  withConfirmation(
    () => window.removeAgentWorkspace(workspace.id).catch(console.error),
    `remove workspace ${workspace.name}`,
  );
}
</script>

<div
  class="flex flex-col gap-3 p-4 bg-(--pd-content-card-carousel-card-bg) hover:bg-(--pd-content-card-carousel-card-hover-bg) rounded-md cursor-pointer overflow-hidden"
  role="button"
  aria-label="workspace {workspace.name}"
  onclick={handleOpen}
  onkeydown={handleKeydown}
  tabindex="0">
  <div class="flex items-center justify-between text-start gap-2 min-w-0">
    <span class="text-(--pd-invert-content-card-text) font-semibold text-base truncate min-w-0">{workspace.name}</span>
    <span class="flex items-center gap-1 text-xs text-(--pd-invert-content-card-text) opacity-70 shrink-0 max-w-[50%]">
      <Icon icon={faCubes} class="shrink-0" />
      <span class="truncate">{workspace.project}</span>
    </span>
  </div>
  <div class="flex flex-col gap-2 text-sm">
    <div class="flex items-center gap-2 text-(--pd-invert-content-card-text) min-w-0" title={workspace.paths.source}>
      <Icon icon={faFolder} class="shrink-0 opacity-70" />
      <span class="truncate">{workspace.paths.source}</span>
    </div>
    <div class="flex items-center gap-2 text-(--pd-invert-content-card-text) min-w-0" title={workspace.paths.configuration}>
      <Icon icon={faGear} class="shrink-0 opacity-70" />
      <span class="truncate">{workspace.paths.configuration}</span>
    </div>
    {#if workspace.model}
      <div class="flex items-center gap-2 text-(--pd-invert-content-card-text) min-w-0" title={workspace.model}>
        <Icon icon={faBrain} class="shrink-0 opacity-70" />
        <span class="truncate">{workspace.model}</span>
      </div>
    {/if}
  </div>
  <div class="flex justify-end gap-1">
    <button
      onclick={handleStartStopClick}
      onkeydown={handleActionKeydown}
      class="inline-flex items-center justify-center w-7 h-7 rounded-full text-(--pd-action-button-text) hover:bg-(--pd-action-button-hover-bg) hover:text-(--pd-action-button-hover-text) transition-colors"
      class:disabled={inProgress}
      disabled={inProgress}
      title={isRunning ? 'Stop workspace' : 'Start workspace'}
      aria-label="{isRunning ? 'Stop' : 'Start'} workspace {workspace.name}">
      <LoadingIcon icon={isRunning ? faStop : faPlay} loading={inProgress} />
    </button>
    <button
      onclick={handleRemoveClick}
      onkeydown={handleActionKeydown}
      class="inline-flex items-center justify-center w-7 h-7 rounded-full text-(--pd-action-button-text) hover:bg-(--pd-action-button-hover-bg) hover:text-(--pd-action-button-hover-text) transition-colors"
      title="Remove workspace"
      aria-label="Remove workspace {workspace.name}">
      <Icon icon={faTrash} />
    </button>
  </div>
</div>
