<script lang="ts">
import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { StatusIcon } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { agentDefinitions } from '/@/lib/guided-setup/agent-registry';
import { type CatalogModelInfo, getCatalogModels } from '/@/lib/models/models-utils';
import { handleNavigation } from '/@/navigation';
import { disabledModels, isModelEnabled, modelKey } from '/@/stores/model-catalog';
import { providerInfos } from '/@/stores/providers';
import { NavigationPage } from '/@api/navigation-page';

interface Props {
  selectedAgent?: string;
  selectedModel?: string;
}

let { selectedAgent = $bindable(''), selectedModel = $bindable('') }: Props = $props();

type ModelCategory = 'cloud' | 'corporate' | 'local';

const categoryLabels: Record<ModelCategory, string> = {
  cloud: 'Cloud · LLM providers',
  corporate: 'In-house · OpenShift AI',
  local: 'Local · Ollama & Ramalama',
};

const statusMap: Record<string, string> = {
  started: 'RUNNING',
  starting: 'STARTING',
  stopped: 'CREATED',
  stopping: 'DELETING',
  failed: 'DEGRADED',
  unknown: 'RUNNING',
};

let searchTerm = $state('');

let allModels: CatalogModelInfo[] = $derived(
  getCatalogModels($providerInfos).filter(m => isModelEnabled($disabledModels, m.providerId, m.label)),
);

let agentFilteredModels: CatalogModelInfo[] = $derived(filterByAgent(allModels, selectedAgent));

let displayedModels: CatalogModelInfo[] = $derived(filterBySearch(agentFilteredModels, searchTerm));

let selectedAgentLabel: string = $derived(
  agentDefinitions.find(a => a.cliName === selectedAgent)?.title ?? 'the selected agent',
);

let cloudModels: CatalogModelInfo[] = $derived(displayedModels.filter(m => m.type === 'cloud'));
let corporateModels: CatalogModelInfo[] = $derived(displayedModels.filter(m => m.type === 'self-hosted'));
let localModels: CatalogModelInfo[] = $derived(displayedModels.filter(m => m.type === 'local'));

let hasAnyModels: boolean = $derived(cloudModels.length > 0 || corporateModels.length > 0 || localModels.length > 0);

function filterByAgent(models: CatalogModelInfo[], agent: string): CatalogModelInfo[] {
  if (!agent || agent === 'opencode' || agent === 'cursor' || agent === 'goose') return models;
  if (agent === 'claude') {
    return models.filter(m => m.type === 'cloud' && m.providerId === 'claude');
  }
  return models;
}

function filterBySearch(models: CatalogModelInfo[], term: string): CatalogModelInfo[] {
  if (!term.trim()) return models;
  const q = term.trim().toLowerCase();
  return models.filter(
    m =>
      m.label.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q) ||
      m.connectionName.toLowerCase().includes(q),
  );
}

function getModelStatus(model: CatalogModelInfo): string {
  return statusMap[model.connectionStatus] ?? 'RUNNING';
}

function selectModel(model: CatalogModelInfo): void {
  selectedModel = modelKey(model.providerId, model.label);
}

function selectAgent(value: string): void {
  if (selectedAgent === value) return;
  selectedAgent = value;
  selectedModel = '';
}

$effect(() => {
  if (!selectedModel) return;
  const stillEligible = agentFilteredModels.some(m => modelKey(m.providerId, m.label) === selectedModel);
  if (!stillEligible) selectedModel = '';
});

function navigateToModels(): void {
  handleNavigation({ page: NavigationPage.MODELS });
}
</script>

<div class="flex flex-col gap-6">
  <!-- Agent selection -->
  <div>
    <h3 class="text-base font-semibold text-[var(--pd-modal-text)] mb-1">Choose your coding agent</h3>
    <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 mb-3">
      Pick one runtime for <code class="text-[11px] bg-purple-500/10 text-purple-300 px-1.5 py-0.5 rounded">kdn</code> in
      this workspace. API keys and providers are configured in Settings; the list below shows models that match the
      selected agent.
    </p>

    <div class="grid grid-cols-4 gap-3" role="listbox" aria-label="Coding agent">
      {#each agentDefinitions as agent (agent.cliName)}
        {@const isSelected = selectedAgent === agent.cliName}
        <button
          type="button"
          role="option"
          aria-selected={isSelected}
          class="flex flex-col gap-3 p-4 rounded-xl border-2 cursor-pointer text-left transition-colors
            {isSelected
              ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
              : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
          onclick={(): void => selectAgent(agent.cliName)}>
          {#if agent.iconComponent}
            <agent.iconComponent size={44} />
          {/if}
          <span class="font-bold text-sm text-[var(--pd-modal-text)]">{agent.title}</span>
          <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 leading-relaxed grow">
            {agent.description}
          </p>
          {#if agent.badge}
            <span class="self-start text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-[var(--pd-status-running)] text-[var(--pd-status-running)]">
              {agent.badge}
            </span>
          {/if}
        </button>
      {/each}
    </div>
  </div>

  <!-- Model catalog -->
  {#if selectedAgent}
    <div>
      <h3 class="text-base font-semibold text-[var(--pd-modal-text)] mb-1">Model for this workspace</h3>
      <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 mb-3">
        Choose the default model <strong class="text-[var(--pd-modal-text)]">{selectedAgentLabel}</strong> will use
        here. Disabled rows cannot be selected; the table is filtered to models that fit the agent you picked above.
      </p>

      <!-- Toolbar -->
      <div class="flex items-center justify-between mb-3 gap-3">
        <div
          class="flex items-center gap-2 px-3 py-1.5 rounded-md border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] flex-1 max-w-xs">
          <Icon icon={faSearch} size="sm" class="text-[var(--pd-content-card-text)] opacity-50" />
          <input
            type="search"
            bind:value={searchTerm}
            placeholder="Filter models…"
            autocomplete="off"
            aria-label="Filter catalog models"
            class="bg-transparent border-none outline-none text-sm text-[var(--pd-content-card-text)] placeholder:opacity-50 w-full" />
        </div>
        <button
          type="button"
          class="text-xs text-[var(--pd-link)] hover:underline whitespace-nowrap"
          onclick={navigateToModels}>
          Open Models catalog
        </button>
      </div>

      {#if !hasAnyModels}
        <div class="text-sm text-[var(--pd-content-card-text)] opacity-70 py-4 text-center">
          No model sources match your settings.
          <button type="button" class="text-[var(--pd-link)] hover:underline" onclick={navigateToModels}>
            Enable a provider in Models
          </button>, then return here.
        </div>
      {:else}
        <div class="flex flex-col gap-4">
          {#each ([['cloud', cloudModels], ['corporate', corporateModels], ['local', localModels]] as const) as [category, models] (category)}
            {#if models.length > 0}
              <div>
                <h4 class="text-xs font-semibold text-[var(--pd-content-card-text)] opacity-60 uppercase tracking-wide mb-2">
                  {categoryLabels[category]}
                </h4>
                <div class="rounded-md border border-[var(--pd-content-card-border)] overflow-hidden">
                  <table class="w-full text-sm" aria-label="{categoryLabels[category]} models">
                    <thead>
                      <tr class="border-b border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)]">
                        <th class="w-10 px-3 py-2 text-left text-xs font-medium text-[var(--pd-content-card-text)] opacity-60">Status</th>
                        <th class="px-3 py-2 text-left text-xs font-medium text-[var(--pd-content-card-text)] opacity-60">Name</th>
                        <th class="w-20 px-3 py-2 text-left text-xs font-medium text-[var(--pd-content-card-text)] opacity-60">Size</th>
                        <th class="w-28 px-3 py-2 text-left text-xs font-medium text-[var(--pd-content-card-text)] opacity-60">Runtime</th>
                        <th class="w-12 px-3 py-2 text-center text-xs font-medium text-[var(--pd-content-card-text)] opacity-60">Use</th>
                      </tr>
                    </thead>
                    <tbody>
                      {#each models as model (modelKey(model.providerId, model.label))}
                        {@const key = modelKey(model.providerId, model.label)}
                        {@const isSelected = selectedModel === key}
                        <tr
                          role="button"
                          tabindex="0"
                          class="border-b border-[var(--pd-content-card-border)] last:border-b-0 transition-colors
                            cursor-pointer hover:bg-[var(--pd-content-card-hover-inset-bg)]
                            {isSelected ? 'bg-[var(--pd-content-card-hover-inset-bg)]' : ''}"
                          onclick={(): void => selectModel(model)}
                          onkeydown={(e: KeyboardEvent): void => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              selectModel(model);
                            }
                          }}>
                          <td class="px-3 py-2">
                            <StatusIcon status={getModelStatus(model)} />
                          </td>
                          <td class="px-3 py-2">
                            <div class="font-medium text-[var(--pd-table-body-text-highlight)]">{model.label}</div>
                            <div class="text-[11px] text-[var(--pd-content-card-text)] opacity-60">{model.connectionName}</div>
                          </td>
                          <td class="px-3 py-2 text-[var(--pd-table-body-text)]">—</td>
                          <td class="px-3 py-2 text-[var(--pd-table-body-text)]">{model.providerName}</td>
                          <td class="px-3 py-2 text-center">
                            <input
                              type="radio"
                              name="workspaceModel"
                              value={key}
                              checked={isSelected}
                              aria-label="Use {model.label}"
                              onclick={(e: MouseEvent): void => e.stopPropagation()}
                              onchange={(): void => selectModel(model)} />
                          </td>
                        </tr>
                      {/each}
                    </tbody>
                  </table>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>
