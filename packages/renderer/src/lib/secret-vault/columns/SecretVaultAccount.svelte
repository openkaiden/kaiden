<script lang="ts">
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

interface Props {
  object: SecretVaultInfo;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let { object }: Props = $props();
</script>

<div
  class="overflow-hidden text-ellipsis whitespace-nowrap max-w-full text-(--pd-table-body-text)"
  title="—">
  —
</div>
