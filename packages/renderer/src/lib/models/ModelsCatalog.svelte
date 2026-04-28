<script lang="ts">
import { faCloud, faDesktop, faIndustry } from '@fortawesome/free-solid-svg-icons';
import {
  FilteredEmptyScreen,
  SearchInput,
  SettingsNavItem,
  Table,
  TableColumn,
  TableRow,
} from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import ModelActionsColumn from '/@/lib/models/columns/ModelActionsColumn.svelte';
import ModelNameColumn from '/@/lib/models/columns/ModelNameColumn.svelte';
import ModelRuntimeColumn from '/@/lib/models/columns/ModelRuntimeColumn.svelte';
import ModelSizeColumn from '/@/lib/models/columns/ModelSizeColumn.svelte';
import ModelStatusColumn from '/@/lib/models/columns/ModelStatusColumn.svelte';
import LocalRuntimeTiles from '/@/lib/models/LocalRuntimeTiles.svelte';
import {
  type CatalogModelInfo,
  getCloudCatalogModels,
  getCloudConnectionSummaries,
  getLocalCatalogModels,
  getLocalConnectionSummaries,
  type InferenceConnectionSummary,
} from '/@/lib/models/models-utils';
import ModelsCatalogEmptyScreen from '/@/lib/models/ModelsCatalogEmptyScreen.svelte';
import ProviderConnectionTiles from '/@/lib/models/ProviderConnectionTiles.svelte';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { providerInfos } from '/@/stores/providers';

type ModelSelectable = CatalogModelInfo & { selected: boolean };
type Category = 'cloud' | 'corporate' | 'local';

interface CategoryInfo {
  id: Category;
  label: string;
  icon: typeof faCloud;
  subtitle: string;
}

const categories: CategoryInfo[] = [
  { id: 'cloud', label: 'LLM Providers', icon: faCloud, subtitle: 'API keys for hosted providers' },
  { id: 'corporate', label: 'In-house', icon: faIndustry, subtitle: 'In-house · OpenShift AI & models' },
  { id: 'local', label: 'Local', icon: faDesktop, subtitle: 'Host detection & loaded models' },
];

let activeCategory: Category = $state('cloud');
let searchTerm = $state('');

let cloudModels: CatalogModelInfo[] = $derived(getCloudCatalogModels($providerInfos));
let cloudConnections: InferenceConnectionSummary[] = $derived(getCloudConnectionSummaries($providerInfos));
let localModels: CatalogModelInfo[] = $derived(getLocalCatalogModels($providerInfos));
let localConnections: InferenceConnectionSummary[] = $derived(getLocalConnectionSummaries($providerInfos));

let filteredCloudModels: ModelSelectable[] = $derived(
  filterBySearch(cloudModels, searchTerm).map(m => ({ ...m, selected: false })),
);
let filteredCloudConnections: InferenceConnectionSummary[] = $derived(
  filterConnectionsBySearch(cloudConnections, searchTerm),
);
let filteredLocalModels: ModelSelectable[] = $derived(
  filterBySearch(localModels, searchTerm).map(m => ({ ...m, selected: false })),
);
let filteredLocalConnections: InferenceConnectionSummary[] = $derived(
  filterConnectionsBySearch(localConnections, searchTerm),
);

let activeSubtitle: string = $derived(categories.find(c => c.id === activeCategory)?.subtitle ?? '');

const row = new TableRow<ModelSelectable>({});

const statusColumn = new TableColumn<ModelSelectable>('Status', {
  width: '100px',
  renderer: ModelStatusColumn,
  comparator: (a, b): number => a.connectionStatus.localeCompare(b.connectionStatus),
});

const nameColumn = new TableColumn<ModelSelectable>('Name', {
  width: '2fr',
  renderer: ModelNameColumn,
  comparator: (a, b): number => a.label.localeCompare(b.label),
});

const sizeColumn = new TableColumn<ModelSelectable>('Size', {
  width: '100px',
  renderer: ModelSizeColumn,
});

const runtimeColumn = new TableColumn<ModelSelectable>('Runtime', {
  width: '1fr',
  renderer: ModelRuntimeColumn,
  comparator: (a, b): number => a.providerName.localeCompare(b.providerName),
});

const actionsColumn = new TableColumn<ModelSelectable>('Actions', {
  align: 'right',
  renderer: ModelActionsColumn,
  overflow: true,
});

const columns = [statusColumn, nameColumn, sizeColumn, runtimeColumn, actionsColumn];

function filterBySearch(models: CatalogModelInfo[], term: string): CatalogModelInfo[] {
  if (!term.trim()) return models;
  const q = term.trim().toLowerCase();
  return models.filter(
    m =>
      m.label.toLowerCase().includes(q) ||
      m.providerId.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q) ||
      m.connectionName.toLowerCase().includes(q),
  );
}

function filterConnectionsBySearch(conns: InferenceConnectionSummary[], term: string): InferenceConnectionSummary[] {
  if (!term.trim()) return conns;
  const q = term.trim().toLowerCase();
  return conns.filter(
    c =>
      c.providerName.toLowerCase().includes(q) ||
      c.connectionName.toLowerCase().includes(q) ||
      (c.connectionType?.toLowerCase().includes(q) ?? false),
  );
}

function selectCategory(cat: Category): void {
  activeCategory = cat;
}
</script>

<div class="flex flex-row w-full h-full">
  <!-- Sidebar -->
  <nav
    class="z-1 w-leftsidebar min-w-leftsidebar flex flex-col transition-all duration-500 ease-in-out bg-[var(--pd-secondary-nav-bg)] border-[var(--pd-global-nav-bg-border)] border-r-[1px]"
    aria-label="Model categories">
    <div class="flex items-center">
      <div class="pt-4 px-3 mb-5">
        <p class="text-xl font-semibold text-[color:var(--pd-secondary-nav-header-text)] border-l-[4px] border-transparent">
          Models
        </p>
      </div>
    </div>
    <div class="h-full overflow-y-auto" style="margin-bottom:auto">
      {#each categories as cat (cat.id)}
        <SettingsNavItem
          title={cat.label}
          href="/models"
          icon={cat.icon}
          selected={activeCategory === cat.id}
          onClick={(): void => selectCategory(cat.id)} />
      {/each}
    </div>
  </nav>

  <!-- Main content -->
  <div class="flex flex-col flex-1 min-w-0 h-full bg-[var(--pd-content-bg)]">
    <div class="flex flex-col pt-4" role="region" aria-label="Models">
      <div class="flex pb-2 px-5">
        <div>
          <h1 class="text-xl font-bold capitalize text-[var(--pd-content-header)]">Models</h1>
          <p class="text-xs text-[var(--pd-content-text)] mt-0.5">{activeSubtitle}</p>
        </div>
      </div>
      <div class="flex flex-row pb-4 px-5">
        <div class="w-72">
          <SearchInput bind:searchTerm title="Models" />
        </div>
      </div>
    </div>

    <div class="flex-1 overflow-auto">
      {#if activeCategory === 'cloud'}
        <div class="px-5 pb-3">
          <p class="text-xs text-[var(--pd-content-text)] opacity-70">
            Connection status for each provider is shown here. API keys and endpoints are configured on a dedicated page per provider.
          </p>
        </div>
        <div class="flex min-w-full h-full">
          <div class="flex flex-col w-full">
            {#if cloudModels.length === 0 && cloudConnections.length === 0}
              <ModelsCatalogEmptyScreen />
            {:else if searchTerm && filteredCloudModels.length === 0 && filteredCloudConnections.length === 0}
              <FilteredEmptyScreen icon={NoLogIcon} kind="models" bind:searchTerm />
            {:else}
              {#if filteredCloudConnections.length > 0}
                <div class="px-5 pt-4 pb-2">
                  <ProviderConnectionTiles connections={filteredCloudConnections} />
                </div>
              {/if}

              <div class="flex min-w-full">
                <Table kind="models" data={filteredCloudModels} columns={columns} row={row} defaultSortColumn="Name" />
              </div>
            {/if}
          </div>
        </div>
      {:else if activeCategory === 'corporate'}
        <div class="flex items-center justify-center h-full">
          <div class="text-center text-[var(--pd-content-text)]">
            <Icon icon={faIndustry} class="mb-3 opacity-40" size="2.5em" />
            <p class="text-sm">In-house models coming soon</p>
            <p class="text-xs mt-1 opacity-60">OpenShift AI integration will be available here</p>
          </div>
        </div>
      {:else if activeCategory === 'local'}
        <div class="px-5 pb-3">
          <p class="text-xs text-[var(--pd-content-text)] opacity-70">
            Local runtimes detected on this host. Models from Ollama and RamaLama are listed below.
          </p>
        </div>
        <div class="flex min-w-full h-full">
          <div class="flex flex-col w-full">
            {#if localModels.length === 0 && localConnections.length === 0}
              <div class="flex items-center justify-center h-full">
                <div class="text-center text-[var(--pd-content-text)]">
                  <Icon icon={faDesktop} class="mb-3 opacity-40" size="2.5em" />
                  <p class="text-sm">No local runtimes detected</p>
                  <p class="text-xs mt-1 opacity-60">Install Ollama or RamaLama to manage local models</p>
                </div>
              </div>
            {:else if searchTerm && filteredLocalModels.length === 0 && filteredLocalConnections.length === 0}
              <FilteredEmptyScreen icon={NoLogIcon} kind="models" bind:searchTerm />
            {:else}
              {#if filteredLocalConnections.length > 0}
                <div class="px-5 pt-4 pb-2">
                  <LocalRuntimeTiles connections={filteredLocalConnections} />
                </div>
              {/if}

              {#if filteredLocalModels.length > 0}
                <div class="flex min-w-full">
                  <Table kind="models" data={filteredLocalModels} columns={columns} row={row} defaultSortColumn="Name" />
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
