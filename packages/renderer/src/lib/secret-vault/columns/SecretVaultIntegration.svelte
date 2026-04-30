<script lang="ts">
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { getSecretIcon, getServiceLabel } from '/@/lib/secret-vault/secret-vault-utils';
import Badge from '/@/lib/ui/Badge.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

interface Props {
  object: SecretVaultInfo;
}

let { object }: Props = $props();

const icon = $derived(getSecretIcon(object.type));

function openDetails(): void {
  handleNavigation({
    page: NavigationPage.SECRET_VAULT_DETAILS,
    parameters: { id: object.id },
  });
}
</script>

<button class="group flex items-center gap-3 overflow-hidden max-w-full" onclick={openDetails}>
  <div class="shrink-0 flex items-center justify-center">
    <Icon {icon} size="1.5x" />
  </div>
  <div class="flex flex-col overflow-hidden min-w-0 text-left">
    <div class="flex items-center gap-2">
      <span
        class="text-(--pd-table-body-text-highlight) text-[14px] font-semibold leading-normal overflow-hidden text-ellipsis whitespace-nowrap group-hover:text-(--pd-link)"
        title={object.name}>
        {object.name}
      </span>
      {#if object.type}
        <Badge class="text-white" color="bg-(--pd-badge-sky)" label={getServiceLabel(object.type)} />
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
</button>
