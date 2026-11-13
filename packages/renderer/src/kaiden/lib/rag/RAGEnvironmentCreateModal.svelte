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
let selectedChunkerConnectionKey = $state('');

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

const selectedRagOption = $derived(ragConnectionOptions.find(option => option.key === ragSelection.selectedKey));
const selectedChunkOption = $derived(
  chunkConnectionOptions.find(option => option.key === selectedChunkerConnectionKey),
);

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

function selectChunkConnection(key: string): void {
  selectedChunkerConnectionKey = key;
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
      <div role="group" aria-label="Embedding Model" class="flex flex-col space-y-3">
        <span class="text-sm font-medium text-[var(--pd-modal-text)]">Embedding Model</span>
        <div class="grid grid-cols-2 gap-4">
          {#each chunkConnectionOptions as option (option.key)}
            <button
              type="button"
              class="border-2 rounded-lg p-4 text-left transition-all cursor-pointer {selectedChunkerConnectionKey ===
              option.key
                ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
                : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] hover:border-[var(--pd-content-card-border-selected)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
              onclick={selectChunkConnection.bind(undefined, option.key)}>
              <div class="flex items-center gap-3 mb-2">
                <div
                  class="w-8 h-8 rounded-md flex items-center justify-center text-[var(--pd-label-primary-text)] text-xs font-bold bg-[var(--pd-label-primary-bg)]">
                  {option.displayName.charAt(0).toUpperCase()}
                </div>
                <div class="text-base font-medium text-[var(--pd-modal-text)]">{option.displayName}</div>
              </div>
              <div class="text-xs text-[var(--pd-content-text)] leading-relaxed">
                {option.providerName}
              </div>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/snippet}

  {#snippet buttons()}
    <Button type="secondary" onclick={closeCallback}>Cancel</Button>
    <Button aria-label="Create Environment" disabled={!isFormValid} onclick={handleCreate}>Create Environment</Button>
  {/snippet}
</Dialog>
