<script lang="ts">
import { FilteredEmptyScreen, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';
import SimpleColumn from '@podman-desktop/ui-svelte/TableSimpleColumn';

import MCPNameColumn from '/@/kaiden/lib/mcp/column/MCPNameColumn.svelte';
import MCPStatusColumn from '/@/kaiden/lib/mcp/column/MCPStatusColumn.svelte';
import { filteredMcpRemoteServerInfos, mcpRemoteServerInfoSearchPattern } from '/@/kaiden/stores/mcp-remote-servers';
import McpIcon from '/@/lib/images/MCPIcon.svelte';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

import { MCPServerDescriptionColumn } from './mcp-server-columns';
import MCPServerEmptyScreen from './MCPServerEmptyScreen.svelte';
import McpServerRemoteListActions from './MCPServerRemoteListActions.svelte';

interface Props {
  filter?: string;
}

let { filter = $bindable() }: Props = $props();

interface SelectableMCPRemoteServerInfo extends MCPRemoteServerInfo {
  selected?: boolean;
}

$effect(() => {
  mcpRemoteServerInfoSearchPattern.set(filter ?? '');
});

const servers: SelectableMCPRemoteServerInfo[] = $derived(
  $filteredMcpRemoteServerInfos.map(server => ({
    ...server,
    selected: false,
  })),
);

const statusColumn = new TableColumn<MCPRemoteServerInfo>('Status', {
  width: '150px',
  renderer: MCPStatusColumn,
});

const nameColumn = new TableColumn<MCPRemoteServerInfo>('Name', {
  width: '2fr',
  renderer: MCPNameColumn,
  comparator: (a, b): number => b.name.localeCompare(a.name),
});

const typeColumn = new TableColumn<MCPRemoteServerInfo, string>('Type', {
  width: '100px',
  renderMapping: (server): string => (server.setupType === 'remote' ? 'Remote' : 'Local'),
  renderer: SimpleColumn,
  comparator: (a, b): number => (b.setupType ?? '').localeCompare(a.setupType ?? ''),
});

const actionsColumn = new TableColumn<MCPRemoteServerInfo>('Actions', {
  align: 'right',
  renderer: McpServerRemoteListActions,
  overflow: true,
});

const columns = [statusColumn, nameColumn, typeColumn, new MCPServerDescriptionColumn(), actionsColumn];

const row = new TableRow<MCPRemoteServerInfo>({});
</script>

{#if servers.length === 0}
  {#if filter}
    <FilteredEmptyScreen icon={McpIcon} kind="MCP Servers" bind:searchTerm={filter}/>
  {:else}
    <MCPServerEmptyScreen />
  {/if}
{:else}
  <div class="flex min-h-0 min-w-0 w-full flex-1 overflow-x-auto">
    <Table
      kind="mcp"
      data={servers}
      columns={columns}
      row={row}
      defaultSortColumn="Name">
    </Table>
  </div>
{/if}
