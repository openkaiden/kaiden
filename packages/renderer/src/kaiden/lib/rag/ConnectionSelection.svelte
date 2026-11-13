<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import type { ComponentProps } from 'svelte';

import PreferencesConnectionCreationOrEditRendering from '/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte';
import { configurationProperties } from '/@/stores/configurationProperties';
import type { ProviderInfo } from '/@api/provider-info';

import type { ConnectionSelectionState } from './connection-selection-state.svelte';

type CreateCallback = ComponentProps<typeof PreferencesConnectionCreationOrEditRendering>['callback'];

interface Props {
  /** Group label shown above the section (e.g. "Vector Store"). */
  label: string;
  /** Selection state owned by the parent, which derives the selected connection from it. */
  selection: ConnectionSelectionState;
  /** Configuration scope passed to PreferencesConnectionCreationOrEditRendering. */
  propertyScope: string;
  /** Provider API callback for creating a connection. */
  createCallback: CreateCallback;
  /** Returns the display name for a factory provider's creation button. */
  factoryDisplayName: (provider: ProviderInfo) => string;
  /** Aria label for the "Create new" card. */
  createNewAriaLabel: string;
  /** data-testid for the factory picker row. */
  factoryPickerTestId: string;
  /** data-testid for the inline creation form wrapper. */
  inlineFormTestId: string;
  /** Message when no connections exist but a factory can create one. */
  emptyMessage: string;
  /** Message when no connections exist and no factory is available. */
  noProvidersMessage: string;
}

let {
  label,
  selection,
  propertyScope,
  createCallback,
  factoryDisplayName,
  createNewAriaLabel,
  factoryPickerTestId,
  inlineFormTestId,
  emptyMessage,
  noProvidersMessage,
}: Props = $props();

const wrappedCreateCallback: CreateCallback = async (...args) => {
  selection.startCreation();
  try {
    await createCallback(...args);
  } catch (error: unknown) {
    // Rethrow so PreferencesConnectionCreationOrEditRendering can display the failure.
    selection.failCreation();
    throw error;
  }
};
</script>

<div role="group" aria-label={label} class="flex flex-col space-y-3">
  <span class="text-sm font-medium text-(--pd-modal-text)">{label}</span>

  {#if selection.formVisible}
    <div class="flex flex-col gap-3">
      {#if selection.factoryProviders.length > 1}
        <div class="flex flex-wrap gap-3" data-testid={factoryPickerTestId}>
          {#each selection.factoryProviders as provider (provider.internalId)}
            {@const isActive = selection.activeFactoryProvider?.internalId === provider.internalId}
            <Button
              type={isActive ? 'primary' : 'secondary'}
              aria-label="Select {factoryDisplayName(provider)}"
              disabled={selection.creationPending}
              onclick={selection.selectFactoryProvider.bind(selection, provider.internalId)}>
              {factoryDisplayName(provider)}
            </Button>
          {/each}
        </div>
      {/if}

      {#if selection.activeFactoryProvider}
        {#key `${selection.activeFactoryProvider.internalId}-${selection.creationAttempt}`}
          <div
            class="rounded-lg border border-(--pd-content-card-border) bg-(--pd-content-card-bg) p-4"
            data-testid={inlineFormTestId}>
            <PreferencesConnectionCreationOrEditRendering
              providerInfo={selection.activeFactoryProvider}
              properties={$configurationProperties}
              {propertyScope}
              callback={wrappedCreateCallback}
              disableEmptyScreen={true}
              hideCloseButton={true} />
          </div>
        {/key}
      {/if}
    </div>
  {/if}

  {#if selection.options.length > 0}
    <div class="grid grid-cols-2 gap-4">
      {#if selection.factoryProviders.length > 0}
        <button
          type="button"
          aria-label={createNewAriaLabel}
          class="border-2 border-dashed rounded-lg p-4 text-left transition-all cursor-pointer {selection.formVisible
            ? 'border-(--pd-content-card-border-selected) bg-(--pd-content-card-hover-inset-bg)'
            : 'border-(--pd-content-card-border) bg-(--pd-content-card-bg) hover:border-(--pd-content-card-border-selected) hover:bg-(--pd-content-card-hover-inset-bg)'}"
          onclick={selection.openCreateForm.bind(selection)}>
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

      {#each selection.options as option (option.key)}
        <button
          type="button"
          class="border-2 rounded-lg p-4 text-left transition-all cursor-pointer {selection.selectedKey === option.key
            ? 'border-(--pd-content-card-border-selected) bg-(--pd-content-card-hover-inset-bg)'
            : 'border-(--pd-content-card-border) bg-(--pd-content-card-bg) hover:border-(--pd-content-card-border-selected) hover:bg-(--pd-content-card-hover-inset-bg)'}"
          onclick={selection.select.bind(selection, option.key)}>
          <div class="flex items-center gap-3 mb-2">
            <div
              class="w-8 h-8 rounded-md flex items-center justify-center text-(--pd-label-primary-text) text-xs font-bold bg-(--pd-label-primary-bg)">
              {option.displayName.charAt(0).toUpperCase()}
            </div>
            <div class="text-base font-medium text-(--pd-modal-text)">{option.displayName}</div>
          </div>
          <div class="text-xs text-(--pd-content-text) leading-relaxed">
            {option.providerName}
          </div>
        </button>
      {/each}
    </div>
  {:else if selection.factoryProviders.length > 0}
    <div class="flex flex-col items-center text-center py-4">
      <p class="text-xs text-(--pd-content-card-text) opacity-60 max-w-sm mb-4">
        {emptyMessage}
      </p>
    </div>
  {:else}
    <div class="flex flex-col items-center text-center py-4">
      <p class="text-xs text-(--pd-content-card-text) opacity-60 max-w-sm">
        {noProvidersMessage}
      </p>
    </div>
  {/if}
</div>
