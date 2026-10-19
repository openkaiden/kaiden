<script lang="ts">
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { untrack } from 'svelte';

import { getCompatibleModels } from '/@/kaiden/lib/models/compatible-connections';
import CompatibleConnectionGate from '/@/kaiden/lib/models/CompatibleConnectionGate.svelte';
import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import { agentInfos } from '/@/kaiden/stores/agents';
import { disabledModels, isModelEnabled, modelSelectionKey } from '/@/kaiden/stores/model-catalog';
import { catalogModels } from '/@/kaiden/stores/models';
import IconImage from '/@/lib/appearance/IconImage.svelte';
import type { DefaultWorkspaceModelSettings } from '/@api/onboarding-settings-info';

import type { GuidedSetupStepProps } from './guided-setup-steps';

let { title, description, onboarding = $bindable() }: GuidedSetupStepProps = $props();

let validationError = $state('');

let filteredAgents = $derived(
  $agentInfos.toSorted((a, b) => {
    const aRecommended = a.tags?.includes('Recommended') ? 1 : 0;
    const bRecommended = b.tags?.includes('Recommended') ? 1 : 0;
    if (aRecommended !== bRecommended) return bRecommended - aRecommended;
    return a.name.localeCompare(b.name);
  }),
);

let selectedAgentInfo = $derived(filteredAgents.find(agent => agent.id === onboarding.agent) ?? filteredAgents[0]);
let selectedAgentLabel = $derived(selectedAgentInfo?.name ?? 'the selected agent');

let allModels: CatalogModelInfo[] = $derived.by(() => {
  const enabledModels = $catalogModels.filter(model => isModelEnabled($disabledModels, model.providerId, model.label));
  const seen: Record<string, boolean> = {};

  return enabledModels.filter(model => {
    const key = modelSelectionKey(model.providerId, model.connectionId, model.label);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
});

let compatibleModels = $derived(getCompatibleModels(allModels, selectedAgentInfo?.supportedModelTypes));
let selectedKey = $derived(
  onboarding.model
    ? modelSelectionKey(onboarding.model.providerId, onboarding.model.connectionId, onboarding.model.label)
    : '',
);

$effect(() => {
  const nextAgent = selectedAgentInfo?.id;
  if (!nextAgent || onboarding.agent === nextAgent) return;
  onboarding.agent = nextAgent;
});

$effect(() => {
  const compatible = compatibleModels;
  const current = untrack(() => onboarding.model);

  if (current) {
    const stillCompatible = compatible.some(
      model =>
        modelSelectionKey(model.providerId, model.connectionId, model.label) ===
        modelSelectionKey(current.providerId, current.connectionId, current.label),
    );
    if (stillCompatible) return;
  }

  if (compatible.length === 0) {
    onboarding.model = undefined;
    return;
  }

  const nextModel: DefaultWorkspaceModelSettings = {
    providerId: compatible[0]!.providerId,
    connectionId: compatible[0]!.connectionId,
    label: compatible[0]!.label,
  };
  onboarding.model = nextModel;
  validationError = '';
});

async function requireCompatibleModel(): Promise<boolean> {
  if (onboarding.model) return true;
  validationError = `Create or select a compatible model for ${selectedAgentLabel} before continuing.`;
  return false;
}

$effect(() => {
  onboarding.beforeAdvance = requireCompatibleModel;
  return (): void => {
    if (onboarding.beforeAdvance === requireCompatibleModel) {
      onboarding.beforeAdvance = undefined;
    }
  };
});

function selectAgent(agentId: string): void {
  if (onboarding.agent === agentId) return;
  validationError = '';
  onboarding.agent = agentId;
}

function handleModelSelect(model: CatalogModelInfo): void {
  validationError = '';
  onboarding.model = {
    providerId: model.providerId,
    connectionId: model.connectionId,
    label: model.label,
  };
}
</script>

<div class="flex flex-col gap-5">
  <div>
    <h3 class="text-base font-semibold text-(--pd-modal-text) mb-1">{title}</h3>
    <p class="text-xs text-(--pd-content-card-text) opacity-70 mb-3">
      {description}
    </p>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="listbox" aria-label="Coding agent">
      {#each filteredAgents as agent (agent.id)}
        {@const isSelected = onboarding.agent === agent.id}
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          aria-label={agent.name}
          class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer text-left transition-colors
            {isSelected
              ? 'border-(--pd-content-card-border-selected) bg-(--pd-content-card-hover-inset-bg)'
              : 'border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg) hover:bg-(--pd-content-card-hover-inset-bg)'}"
          onclick={(): void => selectAgent(agent.id)}>
          <div class="w-8 h-8 flex items-center justify-center shrink-0">
            <IconImage image={agent.icon?.logo ?? agent.icon?.icon} alt={agent.name} class="w-8 h-8">
              <Icon icon={faTerminal} size="1.5x" />
            </IconImage>
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-semibold text-sm text-(--pd-modal-text)">{agent.name}</span>
              {#if agent.tags?.length}
                {#each agent.tags as tag (tag)}
                  <span class="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full border border-(--pd-status-running) text-(--pd-status-running)">
                    {tag}
                  </span>
                {/each}
              {/if}
            </div>
            <p class="text-xs text-(--pd-content-card-text) opacity-70 leading-relaxed mt-1">{agent.description}</p>
          </div>
        </button>
      {/each}
    </div>
  </div>

  {#if selectedAgentInfo}
    <div class="rounded-lg border border-(--pd-content-card-border) bg-(--pd-content-bg) p-5">
      <h3 class="text-base font-semibold text-(--pd-modal-text) mb-1">Default model</h3>
      <p class="text-xs text-(--pd-content-card-text) opacity-70 mb-4">
        Choose the default model <strong class="text-(--pd-modal-text)">{selectedAgentLabel}</strong> should use.
      </p>

      <CompatibleConnectionGate
        models={allModels}
        supportedModelTypes={selectedAgentInfo.supportedModelTypes}
        {selectedKey}
        onselect={handleModelSelect} />

      {#if validationError}
        <div class="mt-4">
          <ErrorMessage error={validationError} />
        </div>
      {/if}
    </div>
  {/if}
</div>
