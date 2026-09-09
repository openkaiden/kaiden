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
import { acpSessions } from '/@/stores/acp-sessions.svelte';
import { allOpenshellSandboxes } from '/@/stores/openshell-sandboxes';
import type { AcpSessionInfo, AcpSessionStatus } from '/@api/acp-session-info';

import AcpNoSandboxEmptyScreen from './AcpNoSandboxEmptyScreen.svelte';
import AcpSessionCreate from './AcpSessionCreate.svelte';
import AcpSessionEmptyScreen from './AcpSessionEmptyScreen.svelte';
import AcpSessionName from './columns/AcpSessionName.svelte';
import AcpSessionStatusBadge from './columns/AcpSessionStatusBadge.svelte';
import AcpSessionWorkspace from './columns/AcpSessionWorkspace.svelte';

type SessionSelectable = AcpSessionInfo & { selected: boolean };

let searchTerm = $state('');
let showCreateDialog = $state(false);

const hasReadySandboxes = $derived($allOpenshellSandboxes.some(s => s.phase === 'Ready'));

const STATUS_ORDER: Record<AcpSessionStatus, number> = {
  waiting_input: 0,
  running: 1,
  idle: 2,
  error: 3,
  completed: 4,
  cancelled: 5,
};

const filteredSessions: SessionSelectable[] = $derived.by(() => {
  const term = searchTerm.trim().toLowerCase();
  return $acpSessions
    .filter(
      s =>
        !term ||
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || is intentional: false must fall through to check prompt/sandbox
        s.name
          ?.toLowerCase()
          .includes(term) ||
        s.prompt.toLowerCase().includes(term) ||
        s.sandboxName.toLowerCase().includes(term),
    )
    .map(s => ({ ...s, selected: false }))
    .sort((a, b) => b.createdAt - a.createdAt);
});

const needsInputSessions = $derived(filteredSessions.filter(s => s.status === 'waiting_input'));
const runningSessions = $derived(filteredSessions.filter(s => s.status === 'running' || s.status === 'idle'));
const completedSessions = $derived(
  filteredSessions.filter(s => s.status === 'completed' || s.status === 'cancelled' || s.status === 'error'),
);

const hasMultipleGroups: boolean = $derived(
  [needsInputSessions.length > 0, runningSessions.length > 0, completedSessions.length > 0].filter(Boolean).length > 1,
);

const row = new TableRow<SessionSelectable>({});

const nameColumn = new TableColumn<SessionSelectable>('Session', {
  width: '3fr',
  renderer: AcpSessionName,
  comparator: (a, b): number => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99),
});

const statusColumn = new TableColumn<SessionSelectable>('Status', {
  width: '1fr',
  renderer: AcpSessionStatusBadge,
});

const sandboxColumn = new TableColumn<SessionSelectable>('Sandbox', {
  width: '1.5fr',
  renderer: AcpSessionWorkspace,
  comparator: (a, b): number => a.sandboxName.localeCompare(b.sandboxName),
});

const timeColumn = new TableColumn<SessionSelectable, Date | undefined>('Time', {
  renderer: TableDurationColumn,
  renderMapping: (s): Date | undefined => new Date(s.createdAt),
  comparator: (a, b): number => b.createdAt - a.createdAt,
});

const columns = [nameColumn, statusColumn, sandboxColumn, timeColumn];
</script>

<NavPage bind:searchTerm={searchTerm} searchEnabled={false} title="Agents">
  {#snippet additionalActions()}
    <Button icon={faPlus} disabled={!hasReadySandboxes} onclick={(): void => { showCreateDialog = true; }}>New Session</Button>
  {/snippet}

  {#snippet content()}
    <div class="flex flex-col min-w-full h-full">
      <div class="px-5 pt-4 pb-4">
        <SearchInput bind:searchTerm={searchTerm} title="Agent Sessions" />
      </div>

      <div class="flex flex-col min-w-full min-h-0 flex-1 overflow-auto">
        {#if filteredSessions.length === 0}
          {#if searchTerm}
            <FilteredEmptyScreen icon={NoLogIcon} kind="sessions" bind:searchTerm={searchTerm} />
          {:else if !hasReadySandboxes}
            <AcpNoSandboxEmptyScreen />
          {:else}
            <AcpSessionEmptyScreen oncreate={(): void => { showCreateDialog = true; }} />
          {/if}
        {:else if !hasMultipleGroups}
          <div class="flex min-w-full">
            <Table
              kind="acp-sessions"
              data={filteredSessions}
              columns={columns}
              row={row}
              defaultSortColumn="Time"
            />
          </div>
        {:else}
          <div class="flex flex-col w-full">
            {#if needsInputSessions.length > 0}
              <div class="mx-5 pt-2 text-sm font-semibold uppercase tracking-wider text-[var(--pd-status-waiting)]">Needs your input</div>
              <div class="flex min-w-full">
                <Table kind="acp-sessions-input" data={needsInputSessions} columns={columns} row={row} defaultSortColumn="Time" />
              </div>
            {/if}
            {#if runningSessions.length > 0}
              <div class="mx-5 pt-2 text-sm font-semibold uppercase tracking-wider text-[var(--pd-status-running)]">Running</div>
              <div class="flex min-w-full">
                <Table kind="acp-sessions-running" data={runningSessions} columns={columns} row={row} defaultSortColumn="Time" />
              </div>
            {/if}
            {#if completedSessions.length > 0}
              <div class="mx-5 pt-2 text-sm font-semibold uppercase tracking-wider text-[var(--pd-table-header-text)]">Completed</div>
              <div class="flex min-w-full">
                <Table kind="acp-sessions-completed" data={completedSessions} columns={columns} row={row} defaultSortColumn="Time" />
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/snippet}
</NavPage>

{#if showCreateDialog && hasReadySandboxes}
  <AcpSessionCreate onclose={(): void => { showCreateDialog = false; }} />
{/if}
