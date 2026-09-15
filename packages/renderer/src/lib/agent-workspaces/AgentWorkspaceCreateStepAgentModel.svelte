<script lang="ts">
import { faChevronDown, faTerminal } from '@fortawesome/free-solid-svg-icons';
import { Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { untrack } from 'svelte';

import IconImage from '/@/lib/appearance/IconImage.svelte';
import { getCompatibleModels } from '/@/lib/models/compatible-connections';
import CompatibleConnectionGate from '/@/lib/models/CompatibleConnectionGate.svelte';
import type { CatalogModelInfo } from '/@/lib/models/models-utils';
import { agentInfos } from '/@/stores/agents';
import { disabledModels, isModelEnabled, modelKey, modelSelectionKey } from '/@/stores/model-catalog';
import { catalogModels } from '/@/stores/models';
import type { ModelInfo } from '/@api/model-registry-info';

interface Props {
  selectedAgent?: string;
  selectedModel?: ModelInfo;
  customImage?: string;
  customImageFieldOpen?: boolean;
}

let {
  selectedAgent = $bindable(''),
  selectedModel = $bindable(),
  customImage = $bindable(''),
  customImageFieldOpen = $bindable(false),
}: Props = $props();

let filteredAgents = $derived(
  $agentInfos.toSorted((a, b) => {
    const aRec = a.tags?.includes('Recommended') ? 1 : 0;
    const bRec = b.tags?.includes('Recommended') ? 1 : 0;
    if (aRec !== bRec) return bRec - aRec;
    return a.name.localeCompare(b.name);
  }),
);

let allModels: CatalogModelInfo[] = $derived.by(() => {
  const enabled = $catalogModels.filter(m => isModelEnabled($disabledModels, m.providerId, m.label));
  const seen: Record<string, boolean> = {};
  return enabled.filter(m => {
    const key = modelKey(m.providerId, m.label);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
});

let selectedAgentInfo = $derived(filteredAgents.find(a => a.id === selectedAgent));
let agentFilteredModels: CatalogModelInfo[] = $derived(
  getCompatibleModels(allModels, selectedAgentInfo?.supportedModelTypes),
);

let selectedAgentLabel: string = $derived(selectedAgentInfo?.name ?? 'the selected agent');

let selectedKey: string = $derived(
  selectedModel ? modelSelectionKey(selectedModel.providerId, selectedModel.connectionId, selectedModel.label) : '',
);

function handleModelSelect(model: CatalogModelInfo): void {
  selectedModel = model;
}

function selectAgent(value: string): void {
  if (selectedAgent === value) return;
  selectedAgent = value;
  customImage = filteredAgents.find(a => a.id === value)?.baseImage ?? '';
}

function toggleCustomImageField(): void {
  customImageFieldOpen = !customImageFieldOpen;
}

$effect(() => {
  const models = agentFilteredModels;
  const current = untrack(() => selectedModel);
  if (current) {
    const stillEligible = models.some(
      m =>
        modelSelectionKey(m.providerId, m.connectionId, m.label) ===
        modelSelectionKey(current.providerId, current.connectionId, current.label),
    );
    if (stillEligible) return;
  }
  if (models.length > 0) {
    selectedModel = models[0];
  } else if (current) {
    selectedModel = undefined;
  }
});
</script>

<div class="flex flex-col gap-6">
  <!-- Agent selection -->
  <div>
    <h3 class="text-base font-semibold text-[var(--pd-modal-text)] mb-1">Choose your coding agent</h3>
    <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 mb-3">
      API keys and providers are configured in Settings; the list below shows models that match the selected agent.
    </p>

    <div class="grid grid-cols-4 gap-3" role="listbox" aria-label="Coding agent">
      {#each filteredAgents as agent (agent.id)}
        {@const isSelected = selectedAgent === agent.id}
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          class="flex flex-col gap-3 p-4 rounded-xl border-2 cursor-pointer text-left transition-colors
            {isSelected
              ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
              : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
          onclick={(): void => selectAgent(agent.id)}>
          <div class="w-11 h-11 flex items-center justify-center">
            <IconImage image={agent.icon?.logo ?? agent.icon?.icon} alt={agent.name} class="w-11 h-11">
              <Icon icon={faTerminal} size="2x" />
            </IconImage>
          </div>
          <span class="font-bold text-sm text-[var(--pd-modal-text)]">{agent.name}</span>
          <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 leading-relaxed grow">
            {agent.description}
          </p>
          {#if agent.tags?.length}
            <div class="flex flex-wrap gap-1 self-start">
              {#each agent.tags as tag (tag)}
                <span class="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-[var(--pd-status-running)] text-[var(--pd-status-running)]">
                  {tag}
                </span>
              {/each}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Container image override -->
  <div class="rounded-xl border border-[var(--pd-content-card-border)]/85 bg-[var(--pd-content-card-bg)]/35 overflow-hidden">
    <button
      class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--pd-modal-text)] hover:bg-[var(--pd-content-card-inset-bg)]/50 transition-colors cursor-pointer"
      onclick={toggleCustomImageField}>
      <span>
        Container image <span class="text-xs font-normal opacity-50">(optional)</span>
      </span>
      <span
        class="transition-transform duration-150 {customImageFieldOpen ? 'rotate-180' : ''}"
        aria-hidden="true">
        <Icon icon={faChevronDown} size="xs" />
      </span>
    </button>
    {#if customImageFieldOpen}
      <div class="px-4 pb-4">
        <label for="workspace-custom-image" class="block text-xs text-[var(--pd-content-card-text)] opacity-60 mb-1.5">
          Override the base container image for the workspace.
        </label>
        <Input
          id="workspace-custom-image"
          bind:value={customImage}
          placeholder={selectedAgentInfo?.baseImage ?? 'Default agent image'}
          class="w-full font-mono text-sm"
        />
      </div>
    {/if}
  </div>

  <!-- Model catalog -->
  {#if selectedAgent}
    <div>
      <h3 class="text-base font-semibold text-[var(--pd-modal-text)] mb-1">Model for workspace</h3>
      <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 mb-3">
        Choose the default model <strong class="text-[var(--pd-modal-text)]">{selectedAgentLabel}</strong> will use
        here. Disabled rows cannot be selected; the table is filtered to models that fit the agent you picked above.
      </p>

      <CompatibleConnectionGate
        models={allModels}
        supportedModelTypes={selectedAgentInfo?.supportedModelTypes}
        selectedKey={selectedKey}
        onselect={handleModelSelect} />
    </div>
  {/if}
</div>
