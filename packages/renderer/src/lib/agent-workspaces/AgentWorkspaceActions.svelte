<script lang="ts">
import { faPlay, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import {
  type AgentWorkspaceSummaryUI,
  startAgentWorkspace,
  stopAgentWorkspace,
} from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

const state = $derived(object.state);
const isRunning = $derived(state === 'running' || state === 'stopping');
const inProgress = $derived(state === 'starting' || state === 'stopping');

async function handleStartStop(): Promise<void> {
  if (inProgress) return;
  try {
    if (isRunning) {
      await stopAgentWorkspace(object.id);
    } else {
      await startAgentWorkspace(object.id);
    }
  } catch (error: unknown) {
    const action = isRunning ? 'stopping' : 'starting';
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Error while ${action} workspace "${object.name}": ${error}`,
      buttons: ['OK'],
    });
  }
}

function handleRemove(): void {
  withConfirmation(
    () => window.removeAgentWorkspace(object.id).catch(console.error),
    `remove workspace ${object.name}`,
  );
}
</script>

<ListItemButtonIcon
  title={isRunning ? 'Stop workspace' : 'Start workspace'}
  icon={isRunning ? faStop : faPlay}
  inProgress={inProgress}
  onClick={handleStartStop} />
<ListItemButtonIcon
  title="Remove workspace"
  icon={faTrash}
  onClick={handleRemove} />
