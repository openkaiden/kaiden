<script lang="ts">
import Fa from 'svelte-fa';

import { getSecretIcon, getServiceLabel } from '/@/lib/secret-vault/secret-vault-utils';
import Badge from '/@/lib/ui/Badge.svelte';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

interface Props {
  object: SecretVaultInfo;
}

let { object }: Props = $props();

const icon = $derived(getSecretIcon(object.type));
</script>

<div class="flex items-center gap-3 overflow-hidden max-w-full">
  <div class="shrink-0 flex items-center justify-center">
    <Fa {icon} size="1.1x" />
  </div>
  <div class="flex flex-col overflow-hidden min-w-0">
    <div class="flex items-center gap-2">
      <span
        class="text-(--pd-table-body-text-highlight) text-[14px] font-semibold leading-normal overflow-hidden text-ellipsis whitespace-nowrap"
        title={object.name}>
        {object.name}
      </span>
      {#if object.type}
        <Badge class="text-[6px] text-white" color="bg-(--pd-badge-sky)" label={getServiceLabel(object.type)} />
      {/if}
    </div>
    {#if object.description}
      <span
        class="text-(--pd-table-body-text) text-xs opacity-60 overflow-hidden text-ellipsis whitespace-nowrap"
        title={object.description}>
        {object.description}
      </span>
    {/if}
  </div>
</div>
