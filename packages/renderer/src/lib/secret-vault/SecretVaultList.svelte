<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { Button, FilteredEmptyScreen, NavPage, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';

import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import { filteredSecretVaultInfos, secretVaultSearchPattern } from '/@/stores/secret-vault';
import { NavigationPage } from '/@api/navigation-page';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import SecretVaultAccount from './columns/SecretVaultAccount.svelte';
import SecretVaultIntegration from './columns/SecretVaultIntegration.svelte';
import SecretVaultMaskedSecret from './columns/SecretVaultMaskedSecret.svelte';
import { isKnownService, KNOWN_GROUP_LABEL, OTHER_GROUP_LABEL } from './secret-vault-utils';
import SecretVaultEmptyScreen from './SecretVaultEmptyScreen.svelte';

type SecretVaultSelectable = SecretVaultInfo & { selected: boolean };

let searchTerm = $state('');

$effect(() => {
  secretVaultSearchPattern.set(searchTerm);
});

const row = new TableRow<SecretVaultSelectable>({});

const integrationColumn = new TableColumn<SecretVaultSelectable>('Integration', {
  width: '3fr',
  renderer: SecretVaultIntegration,
  comparator: (a, b): number => a.name.localeCompare(b.name),
});

const accountColumn = new TableColumn<SecretVaultSelectable>('Account', {
  width: '2fr',
  renderer: SecretVaultAccount,
  comparator: (): number => 0,
});

const secretColumn = new TableColumn<SecretVaultSelectable>('Secret', {
  width: '1fr',
  renderer: SecretVaultMaskedSecret,
});

const columns = [integrationColumn, accountColumn, secretColumn];

const secrets: SecretVaultSelectable[] = $derived(
  $filteredSecretVaultInfos.map(secret => ({ ...secret, selected: false })),
);

const knownSecrets: SecretVaultSelectable[] = $derived(secrets.filter(s => isKnownService(s.type)));

const otherSecrets: SecretVaultSelectable[] = $derived(secrets.filter(s => !isKnownService(s.type)));

const hasBothGroups: boolean = $derived(knownSecrets.length > 0 && otherSecrets.length > 0);

function addSecret(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT_CREATE });
}
</script>

<NavPage bind:searchTerm={searchTerm} title="Secret Vault">
  {#snippet additionalActions()}
    <Button icon={faPlus} onclick={addSecret}>
      Add Secret
    </Button>
  {/snippet}

  {#snippet content()}
    <div class="flex min-w-full h-full">
      {#if secrets.length === 0}
        {#if searchTerm}
          <FilteredEmptyScreen icon={NoLogIcon} kind="secrets" bind:searchTerm={searchTerm} />
        {:else}
          <SecretVaultEmptyScreen onclick={addSecret} />
        {/if}
      {:else if !hasBothGroups}
        <Table
          kind="secret-vault"
          data={secrets}
          columns={columns}
          row={row}
          defaultSortColumn="Integration"
        />
      {:else}
        <div class="flex flex-col w-full">
          <div class="mx-5 pt-2 text-sm font-semibold uppercase tracking-wider text-[var(--pd-table-header-text)]">{KNOWN_GROUP_LABEL}</div>
          <div class="flex min-w-full">
            <Table
              kind="secret-vault"
              data={knownSecrets}
              columns={columns}
              row={row}
              defaultSortColumn="Integration"
            />
          </div>
          <div class="mx-5 pt-2 text-sm font-semibold uppercase tracking-wider text-[var(--pd-table-header-text)]">{OTHER_GROUP_LABEL}</div>
          <div class="flex min-w-full">
            <Table
              kind="secret-vault"
              data={otherSecrets}
              columns={columns}
              row={row}
              defaultSortColumn="Integration"
            />
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</NavPage>
