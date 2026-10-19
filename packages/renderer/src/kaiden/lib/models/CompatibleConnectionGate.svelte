<script lang="ts">
import { faPlug } from '@fortawesome/free-solid-svg-icons';
import type { ModelType } from '@openkaiden/api';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { inferenceConnectionSummariesData } from '/@/kaiden/stores/inference-connection-summaries';
import PreferencesConnectionCreationRendering from '/@/lib/preferences/PreferencesConnectionCreationOrEditRendering.svelte';
import { configurationProperties } from '/@/stores/configurationProperties';
import { providerInfos } from '/@/stores/providers';
import type { CatalogModelInfo } from '/@api/model-registry-info';
import type { ProviderInfo } from '/@api/provider-info';

import { getCompatibleModels, getCompatibleUnconfiguredConnections } from './compatible-connections';
import ModelSelectionTable from './ModelSelectionTable.svelte';

interface Props {
  models: readonly CatalogModelInfo[];
  supportedModelTypes: readonly ModelType[] | undefined;
  selectedKey?: string;
  onselect?: (model: CatalogModelInfo) => void;
}

let { models, supportedModelTypes, selectedKey = '', onselect }: Props = $props();

let compatibleModels = $derived(getCompatibleModels(models, supportedModelTypes));
let hasModels = $derived(compatibleModels.length > 0);

let unconfiguredConnections = $derived(
  getCompatibleUnconfiguredConnections($inferenceConnectionSummariesData, supportedModelTypes),
);

let selectedProviderInternalId: string | undefined = $state(undefined);

let autoSelectedProvider = $derived.by((): string | undefined => {
  if (unconfiguredConnections.length === 1) return unconfiguredConnections[0]!.providerInternalId;
  return undefined;
});

let activeProviderInternalId = $derived(selectedProviderInternalId ?? autoSelectedProvider);

let activeProviderInfo: ProviderInfo | undefined = $derived(
  activeProviderInternalId ? $providerInfos.find(p => p.internalId === activeProviderInternalId) : undefined,
);

let inProgress = $state(false);

function selectProvider(internalId: string): void {
  selectedProviderInternalId = internalId;
}
</script>

{#if hasModels}
  <ModelSelectionTable
    models={compatibleModels}
    {selectedKey}
    {onselect} />
{:else if unconfiguredConnections.length > 0}
  <div class="flex flex-col gap-4" data-testid="no-models-create-connection">
    <div class="flex flex-col items-center text-center py-4">
      <Icon icon={faPlug} size="2em" class="text-(--pd-content-card-text) opacity-40 mb-3" />
      <h3 class="text-sm font-semibold text-(--pd-content-card-text) mb-1">No compatible models available</h3>
      <p class="text-xs text-(--pd-content-card-text) opacity-60 max-w-sm">
        Create a compatible connection to make models available for this agent.
      </p>
    </div>

    <div class="flex flex-wrap gap-3 justify-center" data-testid="provider-picker">
      {#each unconfiguredConnections as connection (connection.providerId)}
        {@const isActive = activeProviderInternalId === connection.providerInternalId}
        <Button
          type={isActive ? 'primary' : 'secondary'}
          aria-label="Select {connection.providerName}"
          onclick={selectProvider.bind(undefined, connection.providerInternalId)}>
          {connection.creationDisplayName || connection.providerName}
        </Button>
      {/each}
    </div>

    {#if activeProviderInfo}
      {#key activeProviderInternalId}
        <div class="rounded-lg border border-(--pd-content-card-border) bg-(--pd-content-card-bg) p-4" data-testid="inline-connection-form">
          <PreferencesConnectionCreationRendering
            providerInfo={activeProviderInfo}
            properties={$configurationProperties}
            propertyScope="InferenceProviderConnectionFactory"
            callback={window.createInferenceProviderConnection}
            disableEmptyScreen={true}
            hideCloseButton={true}
            bind:inProgress={inProgress} />
        </div>
      {/key}
    {/if}
  </div>
{:else}
  <div class="flex flex-col items-center text-center py-6" data-testid="no-providers-available">
    <Icon icon={faPlug} size="2em" class="text-(--pd-content-card-text) opacity-40 mb-3" />
    <h3 class="text-sm font-semibold text-(--pd-content-card-text) mb-1">No compatible models or providers</h3>
    <p class="text-xs text-(--pd-content-card-text) opacity-60 max-w-sm">
      Install a compatible provider extension, then return here to select a model.
    </p>
  </div>
{/if}
