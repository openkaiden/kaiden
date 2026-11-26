<script lang="ts">
import { faPlay, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage } from '@podman-desktop/ui-svelte';

import {
  getSandboxRunAction,
  isSandboxRunActionEnabled,
  isSandboxTransitioning,
  runSandboxAction,
} from '/@/kaiden/lib/agent-workspaces/workspace-utils';
import {
  clearSandboxActionError,
  type SandboxInfoWithGateway,
  setSandboxActionError,
} from '/@/kaiden/stores/openshell-sandboxes';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';

interface Props {
  object: SandboxInfoWithGateway;
}

let { object }: Props = $props();

const isDeleting = $derived(object.phase === 'Deleting');
const runAction = $derived(getSandboxRunAction(object.phase));
let runActionPending = $state(false);

async function handleStartStop(): Promise<void> {
  const action = runAction;
  clearSandboxActionError(object.id);
  runActionPending = true;
  try {
    await runSandboxAction(object, action);
  } catch (error: unknown) {
    setSandboxActionError(object.id, String(error));
  } finally {
    runActionPending = false;
  }
}

function handleRemove(): void {
  withConfirmation(async () => {
    clearSandboxActionError(object.id);
    try {
      await window.deleteOpenshellSandbox(object.name, object.gatewayName);
    } catch (error: unknown) {
      setSandboxActionError(object.id, String(error));
    }
  }, `remove workspace ${object.name}`);
}
</script>

{#if object.actionError}
  <ErrorMessage error={object.actionError} icon wrapMessage />
{/if}
<ListItemButtonIcon
  title={runAction === 'stop' ? 'Stop workspace' : 'Start workspace'}
  icon={runAction === 'stop' ? faStop : faPlay}
  onClick={handleStartStop}
  inProgress={runActionPending || isSandboxTransitioning(object.phase)}
  enabled={isSandboxRunActionEnabled(object.phase)} />
<ListItemButtonIcon title="Remove workspace" icon={faTrash} onClick={handleRemove} enabled={!isDeleting} />
