<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { RagEnvironment } from '/@api/rag/rag-environment';

interface Props {
  object: RagEnvironment;
}

const { object }: Props = $props();

function handleDelete(): void {
  withConfirmation(
    () => window.deleteRagEnvironment(object.name).catch(console.error),
    `delete environment ${object.name}`,
  );
}
</script>

<div class="flex items-center gap-1">
  <ListItemButtonIcon title="Delete" icon={faTrash} onClick={handleDelete} />
</div>
