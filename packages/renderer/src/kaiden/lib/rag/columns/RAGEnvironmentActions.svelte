<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { RagEnvironment } from '/@api/rag/rag-environment';

interface Props {
  object: RagEnvironment;
  onDelete?: () => void;
}

const { object, onDelete }: Props = $props();

function handleDelete(): void {
  withConfirmation(async (err?: unknown) => {
    if (err) {
      console.error('Confirmation dialog failed', err);
      return;
    }
    try {
      await window.deleteRagEnvironment(object.name);
      onDelete?.();
    } catch (error: unknown) {
      console.error('Failed to delete environment', error);
    }
  }, `delete environment ${object.name}`);
}
</script>

<div class="flex items-center gap-1">
  <ListItemButtonIcon title="Delete environment" icon={faTrash} onClick={handleDelete} />
</div>
