<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import {
  Button,
  FilteredEmptyScreen,
  NavPage,
  SearchInput,
  Table,
  TableColumn,
  TableDurationColumn,
  TableRow,
} from '@podman-desktop/ui-svelte';

import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import { agentWorkspaces, type AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';
import { NavigationPage } from '/@api/navigation-page';

import AgentWorkspaceEmptyScreen from './AgentWorkspaceEmptyScreen.svelte';
import AgentWorkspaceStatCards from './AgentWorkspaceStatCards.svelte';
import AgentWorkspaceActions from './columns/AgentWorkspaceActions.svelte';
import AgentWorkspaceContext from './columns/AgentWorkspaceContext.svelte';
import AgentWorkspaceName from './columns/AgentWorkspaceName.svelte';
import { getReferenceTime, isActiveWorkspace } from './workspace-utils';

type WorkspaceSelectable = AgentWorkspaceSummaryUI & { selected: boolean };

let searchTerm = $state('');

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}

const filteredWorkspaces: WorkspaceSelectable[] = $derived.by(() => {
  const term = searchTerm.trim().toLowerCase();
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

const activeWorkspaces = $derived(filteredWorkspaces.filter(isActiveWorkspace));
const stoppedWorkspaces = $derived(filteredWorkspaces.filter(ws => !isActiveWorkspace(ws)));

function workspaceKey(ws: WorkspaceSelectable): string {
  return ws.id;
}

const row = new TableRow<WorkspaceSelectable>({});

const nameColumn = new TableColumn<WorkspaceSelectable>('Workspace', {
  width: '3fr',
  renderer: AgentWorkspaceName,
  comparator: (a, b): number => a.name.localeCompare(b.name),
});

const contextColumn = new TableColumn<WorkspaceSelectable>('Context', {
  width: '2fr',
  renderer: AgentWorkspaceContext,
});

const timeColumn = new TableColumn<WorkspaceSelectable, Date | undefined>('Time', {
  renderer: TableDurationColumn,
  renderMapping: (ws): Date | undefined => {
    const refTime = getReferenceTime(ws);
    return refTime ? new Date(refTime) : undefined;
  },
  comparator: (a, b): number => {
    return (getReferenceTime(a) ?? 0) - (getReferenceTime(b) ?? 0);
  },
});

const actionsColumn = new TableColumn<WorkspaceSelectable>('', {
  align: 'right',
  width: '60px',
  renderer: AgentWorkspaceActions,
  overflow: true,
});

const columns = [nameColumn, contextColumn, timeColumn, actionsColumn];
</script>

<NavPage bind:searchTerm={searchTerm} searchEnabled={false} title="Agentic Workspaces">
  {#snippet additionalActions()}
    <Button icon={faPlus} onclick={navigateToCreate}>Create Workspace</Button>
  {/snippet}

  {#snippet content()}
    <div class="flex flex-col min-w-full h-full">
      <div class="px-5 pt-4 pb-4">
        <AgentWorkspaceStatCards workspaces={$agentWorkspaces} />
        <SearchInput bind:searchTerm={searchTerm} title="Agentic Workspaces" />
      </div>

      <div class="flex flex-col min-w-full min-h-0 flex-1 overflow-auto">
        {#if filteredWorkspaces.length === 0}
          {#if searchTerm}
            <FilteredEmptyScreen icon={NoLogIcon} kind="sessions" bind:searchTerm={searchTerm} />
          {:else}
            <AgentWorkspaceEmptyScreen />
          {/if}
        {:else}
          {#if activeWorkspaces.length > 0}
            <div class="table-section">
              <div class="section-header" aria-label="Active workspaces">Active</div>
              <Table
                kind="agent-workspaces-active"
                data={activeWorkspaces}
                columns={columns}
                row={row}
                defaultSortColumn="Workspace"
                key={workspaceKey}
              />
            </div>
          {/if}
          {#if stoppedWorkspaces.length > 0}
            <div class="table-section">
              <div class="section-header" aria-label="Stopped workspaces">Stopped</div>
              <Table
                kind="agent-workspaces-stopped"
                data={stoppedWorkspaces}
                columns={columns}
                row={row}
                defaultSortColumn="Workspace"
                key={workspaceKey}
              />
            </div>
          {/if}
        {/if}
      </div>
    </div>
  {/snippet}
</NavPage>

<style>
  .table-section {
    margin: 0 1.25rem 1rem;
    border: 1px solid var(--pd-content-table-border);
    border-radius: 14px;
    overflow: hidden;
    background: var(--pd-content-card-bg);
  }

  .table-section :global([role='table']) {
    margin: 0;
  }

  .table-section :global([role='rowgroup'] > div) {
    border: none;
    border-radius: 0;
    margin-bottom: 0;
    background: transparent;
  }

  .table-section :global([role='rowgroup'] > div > [role='row']) {
    border-radius: 0;
  }

  .table-section :global([role='rowgroup'] > div:not(:last-child)) {
    border-bottom: 1px solid var(--pd-content-table-border);
  }

  .section-header {
    padding: 16px 22px 10px;
    font-size: 10px;
    font-weight: 700;
    color: var(--pd-content-text);
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    border-bottom: 1px solid var(--pd-content-table-border);
  }
</style>
