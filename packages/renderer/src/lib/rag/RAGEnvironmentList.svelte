<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, NavPage, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';

import RAGEnvironmentCreateModal from '/@/lib/rag/RAGEnvironmentCreateModal.svelte';
import { chunkProviders } from '/@/stores/chunk-providers';
import { providerInfos } from '/@/stores/providers';
import { ragEnvironments } from '/@/stores/rag-environments';
import type { RagEnvironment } from '/@api/rag/rag-environment';

import RAGEnvironmentActions from './columns/RAGEnvironmentActions.svelte';
import RAGEnvironmentChunker from './columns/RAGEnvironmentChunker.svelte';
import RAGEnvironmentDatabase from './columns/RAGEnvironmentDatabase.svelte';
import RAGEnvironmentName from './columns/RAGEnvironmentName.svelte';
import RAGEnvironmentSources from './columns/RAGEnvironmentSources.svelte';
import RAGEnvironmentStatus from './columns/RAGEnvironmentStatus.svelte';
import EmptyRAGEnvironmentScreen from './components/EmptyRAGEnvironmentScreen.svelte';

type RAGEnvironmentSelectable = RagEnvironment & { selected: boolean };

const row = new TableRow<RAGEnvironmentSelectable>({
  selectable: (_): boolean => true,
});

const statusColumn = new TableColumn<RAGEnvironmentSelectable>('Status', {
  width: '60px',
  renderer: RAGEnvironmentStatus,
});

const nameColumn = new TableColumn<RAGEnvironmentSelectable>('Environment Name', {
  width: '2fr',
  renderer: RAGEnvironmentName,
});

const databaseColumn = new TableColumn<RAGEnvironmentSelectable>('Database', {
  width: '1.5fr',
  renderer: RAGEnvironmentDatabase,
});

const chunkerColumn = new TableColumn<RAGEnvironmentSelectable>('Chunker', {
  width: '1.5fr',
  renderer: RAGEnvironmentChunker,
});

const sourcesColumn = new TableColumn<RAGEnvironmentSelectable>('Sources', {
  width: '80px',
  renderer: RAGEnvironmentSources,
});

const actionsColumn = new TableColumn<RAGEnvironmentSelectable>('Actions', {
  width: '120px',
  renderer: RAGEnvironmentActions,
});

const columns = [statusColumn, nameColumn, databaseColumn, chunkerColumn, sourcesColumn, actionsColumn];

function key(env: RAGEnvironmentSelectable): string {
  return env.name;
}

let showCreateModal = $state(false);

function openCreateModal(): void {
  showCreateModal = true;
}

function closeCreateModal(): void {
  showCreateModal = false;
}

async function handleCreateEnvironment(
  name: string,
  ragConnection: { name: string; providerId: string },
  chunkerId: string,
): Promise<void> {
  try {
    await window.createRagEnvironment(name, ragConnection, chunkerId);
    closeCreateModal();
  } catch (error: unknown) {
    console.error('Failed to create knowledge database:', error);
    window
      .showMessageBox({ title: 'Error', message: 'Error creating knowledge database', detail: String(error) })
      .catch(console.error);
  }
}
</script>

<NavPage searchEnabled={false} title="Knowledge Bases">
  {#snippet additionalActions()}
    <Button icon={faPlus} onclick={openCreateModal}>
      New Knowledge Base
    </Button>
  {/snippet}

  {#snippet content()}
    <div class="flex min-w-full h-full">
      {#if $ragEnvironments.length === 0}
        <EmptyRAGEnvironmentScreen />
      {:else}
        <Table
          kind="rag-environments"
          data={$ragEnvironments.map((env) => ({ ...env, selected: false }))}
          columns={columns}
          row={row}
          defaultSortColumn="Environment Name"
          key={key}
        />
      {/if}
    </div>
  {/snippet}
</NavPage>

{#if showCreateModal}
  <RAGEnvironmentCreateModal
    providers={$providerInfos}
    chunkProviders={$chunkProviders}
    closeCallback={closeCreateModal}
    onCreate={handleCreateEnvironment}
  />
{/if}

