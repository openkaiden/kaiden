<script lang="ts">
import { Button, Input } from '@podman-desktop/ui-svelte';

import Dialog from '/@/lib/dialogs/Dialog.svelte';
import type { ProviderInfo } from '/@api/provider-info';

import { ConnectionSelectionState } from './connection-selection-state.svelte';
import ConnectionSelection from './ConnectionSelection.svelte';

interface Props {
  providers: ProviderInfo[];
  closeCallback: () => void;
  onCreate: (
    name: string,
    ragConnection: { name: string; providerId: string },
    chunkerConnection: { id: string; providerId: string },
  ) => void;
}

let { providers, closeCallback, onCreate }: Props = $props();

let environmentName = $state('');

let ragConnectionOptions = $derived(
  providers.flatMap(provider =>
    provider.ragConnections.map(connection => ({
      key: `${provider.id}:${connection.name}`,
      providerId: provider.id,
      connection: connection,
      displayName: connection.name,
      providerName: provider.name,
    })),
  ),
);

let ragFactoryProviders = $derived(providers.filter(p => p.ragProviderConnectionCreation === true));

const ragSelection = new ConnectionSelectionState(
  () => ragConnectionOptions,
  () => ragFactoryProviders,
);

let chunkConnectionOptions = $derived(
  providers.flatMap(provider =>
    provider.chunkConnections.map(connection => ({
      key: `${provider.id}:${connection.id}`,
      providerId: provider.id,
      connection: connection,
      displayName: connection.name,
      providerName: provider.name,
    })),
  ),
);

let chunkFactoryProviders = $derived(providers.filter(p => p.chunkProviderConnectionCreation === true));

const chunkSelection = new ConnectionSelectionState(
  () => chunkConnectionOptions,
  () => chunkFactoryProviders,
);

const selectedRagOption = $derived(ragConnectionOptions.find(option => option.key === ragSelection.selectedKey));
const selectedChunkOption = $derived(chunkConnectionOptions.find(option => option.key === chunkSelection.selectedKey));

let isFormValid = $derived(
  environmentName.trim() !== '' && selectedRagOption !== undefined && selectedChunkOption !== undefined,
);

function handleCreate(): void {
  if (!isFormValid) return;

  if (!selectedRagOption || !selectedChunkOption) return;

  onCreate(
    environmentName.trim(),
    {
      name: selectedRagOption.connection.name,
      providerId: selectedRagOption.providerId,
    },
    {
      id: selectedChunkOption.connection.id,
      providerId: selectedChunkOption.providerId,
    },
  );
}

function onNameInput(
  event: Event & {
    currentTarget: EventTarget & HTMLInputElement;
  },
): void {
  environmentName = event.currentTarget.value;
}
</script>

<Dialog title="New Knowledge Environment" onclose={closeCallback}>
  {#snippet content()}
    <div class="flex flex-col space-y-8" aria-label="create knowledge environment">
      <!-- Environment Name -->
      <div class="flex flex-col space-y-2">
        <label for="environmentName" class="text-sm font-medium text-[var(--pd-modal-text)]">Environment Name</label>
        <Input
          id="environmentName"
          value={environmentName}
          oninput={onNameInput}
          placeholder="Enter knowledge environment name"
          required
          class="w-full" />
      </div>

      <!-- Vector Store Selection -->
      <ConnectionSelection
        label="Vector Store"
        selection={ragSelection}
        propertyScope="RagProviderConnectionFactory"
        createCallback={window.createRagProviderConnection}
        factoryDisplayName={(provider): string => provider.ragProviderConnectionCreationDisplayName ?? provider.name}
        createNewAriaLabel="Create new vector store"
        factoryPickerTestId="rag-factory-picker"
        inlineFormTestId="inline-rag-creation-form"
        emptyMessage="No vector stores available. Create one to continue."
        noProvidersMessage="No vector store providers installed. Install a compatible extension to create knowledge environments." />

      <!-- Embedding Model Selection -->
      <ConnectionSelection
        label="Embedding Model"
        selection={chunkSelection}
        propertyScope="ChunkProviderConnectionFactory"
        createCallback={window.createChunkProviderConnection}
        factoryDisplayName={(provider): string => provider.chunkProviderConnectionCreationDisplayName ?? provider.name}
        createNewAriaLabel="Create new embedding model"
        factoryPickerTestId="chunk-factory-picker"
        inlineFormTestId="inline-chunk-creation-form"
        emptyMessage="No embedding models available. Create one to continue."
        noProvidersMessage="No embedding model providers installed. Install a compatible extension to create knowledge environments." />
    </div>
  {/snippet}

  {#snippet buttons()}
    <Button type="secondary" onclick={closeCallback}>Cancel</Button>
    <Button aria-label="Create Environment" disabled={!isFormValid} onclick={handleCreate}>Create Environment</Button>
  {/snippet}
</Dialog>
