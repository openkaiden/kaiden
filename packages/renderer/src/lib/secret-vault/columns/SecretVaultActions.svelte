<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage } from '@podman-desktop/ui-svelte';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

interface Props {
  object: SecretVaultInfo;
}

let { object }: Props = $props();

let actionError = $state('');

function handleRemove(): void {
  withConfirmation(async () => {
    actionError = '';
    try {
      await window.removeSecret(object.name, object.gateway);
    } catch (e) {
      actionError = String(e);
    }
  }, `remove secret ${object.name}`);
}
</script>

{#if actionError}
  <ErrorMessage error={actionError} icon wrapMessage />
{/if}
<ListItemButtonIcon
  title="Remove secret"
  icon={faTrash}
  onClick={handleRemove} />
