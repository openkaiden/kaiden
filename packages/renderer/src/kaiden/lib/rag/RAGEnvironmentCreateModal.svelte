<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { untrack } from 'svelte';

import Dialog from '/@/lib/dialogs/Dialog.svelte';
import PreferencesConnectionCreationRendering from '/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte';
import { configurationProperties } from '/@/stores/configurationProperties';
import type { ProviderInfo } from '/@api/provider-info';

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
let selectedRagConnectionKey = $state('');
let selectedChunkerConnectionKey = $state('');
let showCreateRagConnection = $state(false);
let selectedFactoryProviderId: string | undefined = $state(undefined);
let creationInProgress = $state(false);
let creationAttempt = $state(0);

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

let activeFactoryProvider = $derived.by((): ProviderInfo | undefined => {
  if (selectedFactoryProviderId) return ragFactoryProviders.find(p => p.internalId === selectedFactoryProviderId);
  if (ragFactoryProviders.length === 1) return ragFactoryProviders[0];
  return undefined;
});

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

const selectedRagOption = $derived(ragConnectionOptions.find(option => option.key === selectedRagConnectionKey));
const selectedChunkOption = $derived(
  chunkConnectionOptions.find(option => option.key === selectedChunkerConnectionKey),
);

let isFormValid = $derived(
  environmentName.trim() !== '' && selectedRagOption !== undefined && selectedChunkOption !== undefined,
);

let prevOptionsLength = $state(-1);

$effect(() => {
  const options = ragConnectionOptions;
  const prevLength = untrack(() => prevOptionsLength);
  const currentKey = untrack(() => selectedRagConnectionKey);
  prevOptionsLength = options.length;

  if (currentKey && !options.find(o => o.key === currentKey)) {
    selectedRagConnectionKey = '';
  }

  if (prevLength >= 0 && options.length > prevLength) {
    const factoryId = untrack(() => activeFactoryProvider?.id);
    const created = factoryId ? options.filter(o => o.providerId === factoryId).at(-1) : options.at(-1);
    if (created) {
      selectedRagConnectionKey = created.key;
      showCreateRagConnection = false;
    }
  }
});

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

function selectRagConnection(key: string): void {
  selectedRagConnectionKey = key;
  showCreateRagConnection = false;
}

function selectChunkConnection(key: string): void {
  selectedChunkerConnectionKey = key;
}

function openCreateRagConnection(): void {
  showCreateRagConnection = true;
  selectedRagConnectionKey = '';
  creationInProgress = false;
  creationAttempt++;
}

function selectFactoryProvider(internalId: string): void {
  selectedFactoryProviderId = internalId;
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
      <div role="group" aria-label="Vector Store" class="flex flex-col space-y-3">
        <span class="text-sm font-medium text-[var(--pd-modal-text)]">Vector Store</span>

        {#if showCreateRagConnection || (ragConnectionOptions.length === 0 && ragFactoryProviders.length > 0)}
          <div class="flex flex-col gap-3">
            {#if ragFactoryProviders.length > 1}
              <div class="flex flex-wrap gap-3" data-testid="rag-factory-picker">
                {#each ragFactoryProviders as provider (provider.internalId)}
                  {@const isActive = activeFactoryProvider?.internalId === provider.internalId}
                  <Button
                    type={isActive ? 'primary' : 'secondary'}
                    aria-label="Select {provider.ragProviderConnectionCreationDisplayName ?? provider.name}"
                    onclick={selectFactoryProvider.bind(undefined, provider.internalId)}>
                    {provider.ragProviderConnectionCreationDisplayName ?? provider.name}
                  </Button>
                {/each}
              </div>
            {/if}

            {#if activeFactoryProvider}
              {#key `${activeFactoryProvider.internalId}-${creationAttempt}`}
                <div class="rounded-lg border border-(--pd-content-card-border) bg-(--pd-content-card-bg) p-4" data-testid="inline-rag-creation-form">
                  <PreferencesConnectionCreationRendering
                    providerInfo={activeFactoryProvider}
                    properties={$configurationProperties}
                    propertyScope="RagProviderConnectionFactory"
                    callback={window.createRagProviderConnection}
                    disableEmptyScreen={true}
                    hideCloseButton={true}
                    bind:inProgress={creationInProgress} />
                </div>
              {/key}
            {/if}
          </div>
        {/if}

        {#if ragConnectionOptions.length > 0}
          <div class="grid grid-cols-2 gap-4">
            {#if ragFactoryProviders.length > 0}
              <button
                type="button"
                aria-label="Create new vector store"
                class="border-2 border-dashed rounded-lg p-4 text-left transition-all cursor-pointer {showCreateRagConnection
                  ? 'border-(--pd-content-card-border-selected) bg-(--pd-content-card-hover-inset-bg)'
                  : 'border-(--pd-content-card-border) bg-(--pd-content-card-bg) hover:border-(--pd-content-card-border-selected) hover:bg-(--pd-content-card-hover-inset-bg)'}"
                onclick={openCreateRagConnection}>
                <div class="flex items-center gap-3 mb-2">
                  <div
                    class="w-8 h-8 rounded-md flex items-center justify-center text-(--pd-label-primary-text) text-xs font-bold bg-(--pd-label-primary-bg)">
                    <Icon icon={faPlus} size="1x" />
                  </div>
                  <div class="text-base font-medium text-(--pd-modal-text)">Create new</div>
                </div>
                <div class="text-xs text-(--pd-content-text) leading-relaxed">
                  Set up a new connection
                </div>
              </button>
            {/if}

            {#each ragConnectionOptions as option (option.key)}
              <button
                type="button"
                class="border-2 rounded-lg p-4 text-left transition-all cursor-pointer {selectedRagConnectionKey ===
                option.key
                  ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
                  : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] hover:border-[var(--pd-content-card-border-selected)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
                onclick={selectRagConnection.bind(undefined, option.key)}>
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
        {:else if ragFactoryProviders.length > 0}
          <div class="flex flex-col items-center text-center py-4">
            <p class="text-xs text-(--pd-content-card-text) opacity-60 max-w-sm mb-4">
              No vector stores available. Create one to continue.
            </p>
          </div>
        {:else}
          <div class="flex flex-col items-center text-center py-4">
            <p class="text-xs text-(--pd-content-card-text) opacity-60 max-w-sm">
              No vector store providers installed. Install a compatible extension to create knowledge environments.
            </p>
          </div>
        {/if}
      </div>

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
