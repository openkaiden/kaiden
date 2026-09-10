<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { SandboxInfoWithGateway } from '/@/stores/openshell-sandboxes';

interface Props {
  object: SandboxInfoWithGateway;
}

let { object }: Props = $props();

const isDeleting = $derived(object.phase === 'Deleting');

function handleRemove(): void {
  withConfirmation(
    () => window.deleteOpenshellSandbox(object.name, object.gatewayName).catch(console.error),
    `remove workspace ${object.name}`,
  );
}
</script>

<ListItemButtonIcon title="Remove workspace" icon={faTrash} onClick={handleRemove} enabled={!isDeleting} />
