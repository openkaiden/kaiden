<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage } from '@podman-desktop/ui-svelte';

import type { SecretVaultInfoUI } from '/@/kaiden/lib/secret-vault/SecretVaultInfoUI';
import { clearSecretActionError, setSecretActionError } from '/@/kaiden/stores/secret-vault';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';

interface Props {
  object: SecretVaultInfoUI;
}

let { object }: Props = $props();

function handleRemove(): void {
  withConfirmation(async () => {
    clearSecretActionError(object.id);
    try {
      await window.removeSecret(object.name, object.gateway);
    } catch (error: unknown) {
      setSecretActionError(object.id, String(error));
    }
  }, `remove secret ${object.name}`);
}
</script>

{#if object.actionError}
  <ErrorMessage error={object.actionError} icon wrapMessage />
{/if}
<ListItemButtonIcon
  title="Remove secret"
  icon={faTrash}
  onClick={handleRemove} />
