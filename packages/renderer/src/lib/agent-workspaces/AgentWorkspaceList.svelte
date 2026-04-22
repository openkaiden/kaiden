<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, FilteredEmptyScreen, NavPage, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';

import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import { agentWorkspaces, type AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';
import { NavigationPage } from '/@api/navigation-page';

import AgentWorkspaceActions from './AgentWorkspaceActions.svelte';
import AgentWorkspaceEmptyScreen from './AgentWorkspaceEmptyScreen.svelte';
import AgentWorkspaceIcon from './columns/AgentWorkspaceIcon.svelte';
import AgentWorkspaceName from './columns/AgentWorkspaceName.svelte';
import AgentWorkspaceStatus from './columns/AgentWorkspaceStatus.svelte';

type AgentWorkspaceSelectable = AgentWorkspaceSummaryUI & { selected: boolean };

let searchTerm = $state('');

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}

const row = new TableRow<AgentWorkspaceSelectable>({});

const iconColumn = new TableColumn<AgentWorkspaceSelectable>('', {
  width: '40px',
  renderer: AgentWorkspaceIcon,
});

const nameColumn = new TableColumn<AgentWorkspaceSelectable>('Workspace', {
  width: '1fr',
  renderer: AgentWorkspaceName,
  comparator: (a, b): number => a.name.localeCompare(b.name),
});

const statusColumn = new TableColumn<AgentWorkspaceSelectable>('Status', {
  width: '100px',
  align: 'center',
  renderer: AgentWorkspaceStatus,
  comparator: (a, b): number => a.state.localeCompare(b.state),
});

const actionsColumn = new TableColumn<AgentWorkspaceSelectable>('Actions', {
  width: '90px',
  align: 'right',
  renderer: AgentWorkspaceActions,
  overflow: true,
});

const columns = [iconColumn, nameColumn, statusColumn, actionsColumn];

const filteredWorkspaces: AgentWorkspaceSelectable[] = $derived.by(() => {
  const term = searchTerm.toLowerCase();
  return $agentWorkspaces
    .filter(
      ws =>
        !term ||
        ws.name.toLowerCase().includes(term) ||
        ws.project.toLowerCase().includes(term) ||
        (ws.model?.toLowerCase().includes(term) ?? false),
    )
    .map(ws => ({ ...ws, selected: false }));
});
</script>

<NavPage bind:searchTerm={searchTerm} title="Agentic Workspaces">
  {#snippet additionalActions()}
  <Button icon={faPlus} onclick={navigateToCreate}>Create Workspace</Button>
  {/snippet}

  {#snippet content()}
    <div class="flex flex-col min-w-full h-full">
      <span class="text-sm text-(--pd-content-text) opacity-70 px-5 pt-4">{filteredWorkspaces.length} total {filteredWorkspaces.length === 1 ? 'session' : 'sessions'}</span>
      <div class="flex min-w-full min-h-0 flex-1">
        {#if filteredWorkspaces.length === 0}
          {#if searchTerm}
            <FilteredEmptyScreen icon={NoLogIcon} kind="sessions" bind:searchTerm={searchTerm} />
          {:else}
            <AgentWorkspaceEmptyScreen />
          {/if}
        {:else}
          <Table
            kind="agent-workspaces"
            data={filteredWorkspaces}
            columns={columns}
            row={row}
            defaultSortColumn="Workspace"
          />
        {/if}
      </div>
    </div>
  {/snippet}
</NavPage>
