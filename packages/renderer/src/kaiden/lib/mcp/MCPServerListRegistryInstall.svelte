<script lang="ts">
import { FilteredEmptyScreen, Spinner, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';
import SimpleColumn from '@podman-desktop/ui-svelte/TableSimpleColumn';

import {
  filteredMcpRegistriesServerInfos,
  mcpRegistriesServerInfos,
  mcpRegistriesServerInfosSearchPattern,
  mcpRegistryServersLoading,
} from '/@/kaiden/stores/mcp-registry-servers';
import McpIcon from '/@/lib/images/MCPIcon.svelte';
import MCPValidServerIndicatorIcon from '/@/lib/images/MCPValidServerIndicatorIcon.svelte';
import PreviousNext from '/@/lib/ui/PreviousNext.svelte';
import type { MCPServerDetail } from '/@api/mcp/mcp-server-info';

import { MCPServerDescriptionColumn } from './mcp-server-columns';
import McpEmptyScreen from './MCPRegistryEmptyScreen.svelte';
import McpServerListActions from './MCPServerRegistryListActions.svelte';

interface Props {
  filter?: string;
}

let { filter = $bindable() }: Props = $props();

type SelectableMCPRegistryServerDetailUI = MCPServerDetail & {
  selected?: boolean;
};

$effect(() => {
  mcpRegistriesServerInfosSearchPattern.set(filter ?? '');
});

const servers: SelectableMCPRegistryServerDetailUI[] = $derived(
  $filteredMcpRegistriesServerInfos
    .map(
      (server): SelectableMCPRegistryServerDetailUI => ({
        ...server,
        selected: false,
      }),
    )
    .filter(server => server.name.toLowerCase().includes(filter?.toLowerCase() ?? '')),
);

let table: Table<SelectableMCPRegistryServerDetailUI>;

// Pagination
const PAGE_SIZE = 25;
let currentPage = $state(0);

const totalPages = $derived(Math.ceil(servers.length / PAGE_SIZE));
const paginatedServers = $derived(servers.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));

// Reset to first page when servers change
$effect(() => {
  servers;
  if (currentPage >= totalPages) {
    currentPage = Math.max(0, totalPages - 1);
  }
});

function previousPage(): void {
  if (currentPage > 0) {
    currentPage--;
  }
}

function nextPage(): void {
  if (currentPage < totalPages - 1) {
    currentPage++;
  }
}

const statusColumn = new TableColumn<MCPServerDetail>('Status', {
  width: '60px',
  overflow: true,
  renderer: MCPValidServerIndicatorIcon,
});

const nameColumn = new TableColumn<MCPServerDetail, string>('Name', {
  width: '2fr',
  renderMapping: (obj): string => obj.name,
  renderer: SimpleColumn,
  comparator: (a, b): number => b.name.localeCompare(a.name),
});

const columns = [
  statusColumn,
  nameColumn,
  new MCPServerDescriptionColumn(),
  new TableColumn<MCPServerDetail>('Actions', {
    align: 'right',
    renderer: McpServerListActions,
    overflow: true,
  }),
];

const row = new TableRow<MCPServerDetail>({});
</script>

{#if servers.length === 0 && !$mcpRegistryServersLoading}
  {#if filter}
    <FilteredEmptyScreen icon={McpIcon} kind="MCP Servers" bind:searchTerm={filter}/>
  {:else}
    <McpEmptyScreen />
  {/if}
{:else}
  <div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
    {#if $mcpRegistryServersLoading}
      <div
        class="flex shrink-0 items-center gap-2 border-b border-[var(--pd-card-border)] px-3 py-2 text-sm text-[var(--pd-details-empty-sub-header)]"
        aria-busy="true"
        aria-live="polite">
        <Spinner size="12" />
        <span
          >{$mcpRegistriesServerInfos.length === 0
            ? 'Loading catalog…'
            : 'Refreshing catalog…'}</span>
      </div>
    {/if}
    {#if servers.length === 0}
      {#if filter}
        <FilteredEmptyScreen icon={McpIcon} kind="MCP Servers" bind:searchTerm={filter}/>
      {:else}
        <div class="flex min-h-0 flex-1 flex-col px-3 pt-3" aria-live="polite">
          <p class="text-pretty text-sm text-[var(--pd-details-empty-sub-header)]">
            Fetching entries from your registries. Large catalogs may take a few minutes.
          </p>
        </div>
      {/if}
    {:else}
      {#if totalPages > 1}
        <PreviousNext onPrevious={previousPage} onNext={nextPage} currentPage={currentPage} totalPages={totalPages}></PreviousNext>
      {/if}

      <div class="flex min-h-0 min-w-0 w-full flex-1 overflow-x-auto">
        <Table
          kind="mcpServer"
          bind:this={table}
          data={paginatedServers}
          columns={columns}
          row={row}
          defaultSortColumn="Name">
        </Table>
      </div>

      {#if totalPages > 1}
        <PreviousNext onPrevious={previousPage} onNext={nextPage} currentPage={currentPage} totalPages={totalPages}></PreviousNext>
      {/if}
    {/if}
  </div>
{/if}
