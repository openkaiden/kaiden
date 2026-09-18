<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage } from '@podman-desktop/ui-svelte';

import type { SandboxInfoUI } from '/@/lib/agent-workspaces/SandboxInfoUI';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { clearSandboxActionError, setSandboxActionError } from '/@/stores/openshell-sandboxes';

interface Props {
  object: SandboxInfoUI;
}

let { object }: Props = $props();

const isDeleting = $derived(object.phase === 'Deleting');

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
<ListItemButtonIcon title="Remove workspace" icon={faTrash} onClick={handleRemove} enabled={!isDeleting} />
