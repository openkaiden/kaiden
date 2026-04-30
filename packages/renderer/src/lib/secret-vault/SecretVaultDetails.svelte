<script lang="ts">
import { faTrash } from '@fortawesome/free-solid-svg-icons';
import { Tab } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { router } from 'tinro';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import { getSecretIcon, getServiceLabel } from '/@/lib/secret-vault/secret-vault-utils';
import Badge from '/@/lib/ui/Badge.svelte';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import { secretVaultInfos } from '/@/stores/secret-vault';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import SecretVaultDetailsSummary from './SecretVaultDetailsSummary.svelte';

interface Props {
  id: string;
}

let { id }: Props = $props();

const secretInfo: SecretVaultInfo | undefined = $derived($secretVaultInfos.find(s => s.id === id));
const secretIcon = $derived(getSecretIcon(secretInfo?.type));

function handleRemove(): void {
  withConfirmation(
    async () => {
      try {
        await window.removeSecret(id);
        router.goto('/secret-vault');
      } catch (error: unknown) {
        console.error('Failed to remove secret', error);
      }
    },
    `remove secret ${secretInfo?.name ?? id}`,
  );
}
</script>

<DetailsPage title=" ">
  {#snippet iconSnippet()}
    <div class="flex items-center gap-3">
      <div class="shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-(--pd-content-card-inset-bg) border border-(--pd-content-divider)">
        <Icon icon={secretIcon} size="lg" />
      </div>
      <div class="flex flex-col">
        <div class="flex items-center gap-2">
          <h1 class="text-xl font-bold leading-tight text-[var(--pd-content-header)]">{secretInfo?.name ?? id}</h1>
          {#if secretInfo?.type}
            <Badge class="text-white" color="bg-(--pd-badge-sky)" label={getServiceLabel(secretInfo.type)} />
          {/if}
        </div>
        {#if secretInfo?.description}
          <span class="text-sm text-(--pd-content-card-text) opacity-60">{secretInfo.description}</span>
        {/if}
      </div>
    </div>
  {/snippet}
  {#snippet actionsSnippet()}
    <ListItemButtonIcon title="Remove Secret" onClick={handleRemove} icon={faTrash} />
  {/snippet}
  {#snippet tabsSnippet()}
    <Tab title="Summary" selected={isTabSelected($router.path, 'summary')} url={getTabUrl($router.path, 'summary')} />
  {/snippet}
  {#snippet contentSnippet()}
    <Route path="/summary" breadcrumb="Summary" navigationHint="tab">
      <SecretVaultDetailsSummary {secretInfo} />
    </Route>
  {/snippet}
</DetailsPage>
