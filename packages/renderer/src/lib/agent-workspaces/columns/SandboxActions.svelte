<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { type SandboxInfoWithGateway, setSandboxPhase } from '/@/stores/openshell-sandboxes';

interface Props {
  object: SandboxInfoWithGateway;
}

let { object }: Props = $props();

const isDeleting = $derived(object.phase === 'Deleting');

function handleRemove(): void {
  withConfirmation(async () => {
    const previousPhase = object.phase;
    // DeleteSandbox resolves after the gateway has removed the sandbox row,
    // so a post-RPC refresh cannot normally expose its transient Deleting phase.
    // Show the user's accepted delete intent immediately; the final refresh
    // removes the row, while a failed request restores the authoritative phase.
    setSandboxPhase(object.name, object.gatewayName, 'Deleting');
    try {
      await window.deleteOpenshellSandbox(object.name, object.gatewayName);
    } catch (error: unknown) {
      setSandboxPhase(object.name, object.gatewayName, previousPhase);
      console.error(error);
    }
  }, `remove workspace ${object.name}`);
}
</script>

<ListItemButtonIcon title="Remove workspace" icon={faTrash} onClick={handleRemove} enabled={!isDeleting} />
