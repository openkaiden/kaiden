<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { faTrash } from '@fortawesome/free-solid-svg-icons/faTrash';
import {
  Button,
  EmptyScreen,
  FilteredEmptyScreen,
  NavPage,
  SearchInput,
  Table,
  TableColumn,
  TableRow,
} from '@podman-desktop/ui-svelte';

import { withBulkConfirmation } from '/@/lib/actions/BulkActions';
import GatewayFilterDropdown from '/@/lib/gateways/GatewayFilterDropdown.svelte';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import {
  filteredSecretVaultInfos,
  secretVaultSearchPattern,
  selectedGateway as secretVaultSelectedGateway,
} from '/@/stores/secret-vault';
import { NavigationPage } from '/@api/navigation-page';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

import SecretVaultAccount from './columns/SecretVaultAccount.svelte';
import SecretVaultActions from './columns/SecretVaultActions.svelte';
import SecretVaultIntegration from './columns/SecretVaultIntegration.svelte';
import SecretVaultMaskedSecret from './columns/SecretVaultMaskedSecret.svelte';
import SecretVaultEmptyScreen from './SecretVaultEmptyScreen.svelte';

type SecretVaultSelectable = SecretVaultInfo & { selected: boolean };

let searchTerm = $state('');
let gatewayFilter = $state('');

$effect(() => {
  secretVaultSearchPattern.set(searchTerm);
});

$effect(() => {
  secretVaultSelectedGateway.set(gatewayFilter);
});

const row = new TableRow<SecretVaultSelectable>({
  selectable: (): boolean => true,
});

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

const actionsColumn = new TableColumn<SecretVaultSelectable>('', {
  align: 'right',
  width: '40px',
  renderer: SecretVaultActions,
  overflow: true,
});

const columns = [integrationColumn, accountColumn, secretColumn, actionsColumn];

const secrets: SecretVaultSelectable[] = $derived(
  $filteredSecretVaultInfos.map(secret => ({ ...secret, selected: false })),
);

let selectedItemsNumber: number = $state(0);
let bulkDeleteInProgress = $state(false);

async function deleteSelectedSecrets(): Promise<void> {
  const selectedSecrets = secrets.filter(secret => secret.selected);

  if (selectedSecrets.length === 0) {
    return;
  }

  bulkDeleteInProgress = true;

  try {
    const results = await Promise.allSettled(
      selectedSecrets.map(secret => window.removeSecret(secret.name, secret.gateway)),
    );

    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failures.length > 0) {
      await window.showMessageBox({
        title: 'Error',
        type: 'error',
        message: `Failed to delete ${failures.length} secret${failures.length > 1 ? 's' : ''}`,
        detail: failures.map(f => String(f.reason)).join('\n'),
        buttons: ['OK'],
      });
    }
  } finally {
    bulkDeleteInProgress = false;
  }
}

function addSecret(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT_CREATE });
}

function clearGatewayFilter(): void {
  gatewayFilter = '';
}
</script>

<NavPage bind:searchTerm={searchTerm} searchEnabled={false} title="Secret Vault">
  {#snippet additionalActions()}
    <Button icon={faPlus} onclick={addSecret}>
      Add Secret
    </Button>
  {/snippet}

  {#snippet content()}
    <div class="flex flex-col min-w-full h-full">
      <div class="px-5 pt-4 pb-4">
        <div class="flex flex-row items-center gap-3">
          <div class="w-72">
            <SearchInput bind:searchTerm={searchTerm} title="Secret Vault" />
          </div>
          <GatewayFilterDropdown bind:value={gatewayFilter} />
          {#if selectedItemsNumber > 0}
            <Button
              onclick={(): void =>
                withBulkConfirmation(
                  deleteSelectedSecrets,
                  `delete ${selectedItemsNumber} secret${selectedItemsNumber > 1 ? 's' : ''}`,
                )}
              title="Delete {selectedItemsNumber} selected items"
              aria-label="Delete selected secrets"
              inProgress={bulkDeleteInProgress}
              icon={faTrash} />
            <span class="text-[var(--pd-content-text)]">On {selectedItemsNumber} selected items.</span>
          {/if}
        </div>
      </div>

      <div class="flex min-w-full min-h-0 flex-1 overflow-auto">
        {#if secrets.length === 0}
          {#if searchTerm}
            <FilteredEmptyScreen icon={NoLogIcon} kind="secrets" bind:searchTerm={searchTerm} />
          {:else if gatewayFilter}
            <EmptyScreen
              icon={NoLogIcon}
              title="No secrets on gateway '{gatewayFilter}'"
              message="This gateway has no secrets yet. Add one or select a different gateway.">
              <Button type="link" onclick={clearGatewayFilter}>Show all gateways</Button>
            </EmptyScreen>
          {:else}
            <SecretVaultEmptyScreen onclick={addSecret} />
          {/if}
        {:else}
          <Table
            kind="secret-vault"
            bind:selectedItemsNumber={selectedItemsNumber}
            data={secrets}
            columns={columns}
            row={row}
            defaultSortColumn="Integration"
          />
        {/if}
      </div>
    </div>
  {/snippet}
</NavPage>
