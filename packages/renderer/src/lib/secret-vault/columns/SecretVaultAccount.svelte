<script lang="ts">
import type { SecretVaultInfoUI } from '/@/lib/secret-vault/SecretVaultInfoUI';

interface Props {
  object: SecretVaultInfoUI;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
let { object }: Props = $props();
</script>

<div
  class="overflow-hidden text-ellipsis whitespace-nowrap max-w-full text-(--pd-table-body-text)"
  title="—">
  —
</div>
