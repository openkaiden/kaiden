<script lang="ts">
import { faSearch } from '@fortawesome/free-solid-svg-icons';
import { StatusIcon } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { modelSelectionKey } from '/@/kaiden/stores/model-catalog';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';

import type { CatalogModelInfo } from './models-utils';

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

interface Props {
  models: CatalogModelInfo[];
  selectedKey?: string;
  selectedKeys?: Set<string>;
  multiSelect?: boolean;
  showCatalogLink?: boolean;
  defaultModel?: CatalogModelInfo;
  onselect?: (model: CatalogModelInfo) => void;
  ontoggle?: (model: CatalogModelInfo) => void;
  ondefaultchange?: (model: CatalogModelInfo) => void;
}

let {
  models,
  selectedKey = '',
  selectedKeys,
  multiSelect = false,
  showCatalogLink = true,
  defaultModel,
  onselect,
  ontoggle,
  ondefaultchange,
}: Props = $props();

let defaultModelKey: string = $derived(defaultModel ? getKey(defaultModel) : '');
let showDefaultColumn: boolean = $derived(multiSelect && defaultModel !== undefined);

let searchTerm = $state('');

let displayedModels: CatalogModelInfo[] = $derived(filterBySearch(models, searchTerm));

let cloudModels: CatalogModelInfo[] = $derived(displayedModels.filter(m => m.type === 'cloud'));
let corporateModels: CatalogModelInfo[] = $derived(displayedModels.filter(m => m.type === 'self-hosted'));
let localModels: CatalogModelInfo[] = $derived(displayedModels.filter(m => m.type === 'local'));
let hasAnyModels: boolean = $derived(cloudModels.length > 0 || corporateModels.length > 0 || localModels.length > 0);

let selectedModel: CatalogModelInfo | undefined = $derived(
  multiSelect ? undefined : models.find(m => getKey(m) === selectedKey),
);
let selectedCount: number = $derived(
  multiSelect && selectedKeys ? models.filter(m => selectedKeys.has(getKey(m))).length : 0,
);

function isSelected(key: string): boolean {
  if (multiSelect) return selectedKeys?.has(key) ?? false;
  return selectedKey === key;
}

function filterBySearch(allModels: CatalogModelInfo[], term: string): CatalogModelInfo[] {
  if (!term.trim()) return allModels;
  const q = term.trim().toLowerCase();
  return allModels.filter(
    m =>
      m.label.toLowerCase().includes(q) ||
      m.providerName.toLowerCase().includes(q) ||
      m.connectionName.toLowerCase().includes(q),
  );
}

function getKey(model: CatalogModelInfo): string {
  return modelSelectionKey(model.providerId, model.connectionId, model.label);
}

function getModelStatus(model: CatalogModelInfo): string {
  return statusMap[model.connectionStatus] ?? 'RUNNING';
}

function navigateToModels(): void {
  handleNavigation({ page: NavigationPage.MODELS });
}

function onDefaultClick(event: MouseEvent, key: string): void {
  event.stopPropagation();
  if (defaultModelKey === key) {
    event.preventDefault();
  }
}
</script>

<!-- Toolbar -->
<div class="flex items-center justify-between mb-3 gap-3">
  <div
    class="flex items-center gap-2 px-3 py-1.5 rounded-md border border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg) flex-1 max-w-xs">
    <Icon icon={faSearch} size="sm" class="text-(--pd-content-card-text) opacity-50" />
    <input
      type="search"
      bind:value={searchTerm}
      placeholder="Filter models…"
      autocomplete="off"
      aria-label="Filter catalog models"
      class="bg-transparent border-none outline-none text-sm text-(--pd-content-card-text) placeholder:opacity-50 w-full" />
  </div>
  {#if showCatalogLink}
    <button
      type="button"
      class="text-xs text-(--pd-link) hover:underline whitespace-nowrap"
      onclick={navigateToModels}>
      Open Models catalog
    </button>
  {/if}
</div>

{#if !hasAnyModels}
  <div class="text-sm text-(--pd-content-card-text) opacity-70 py-4 text-center" data-testid="no-models">
    No model sources match your settings.
    <button type="button" class="text-(--pd-link) hover:underline" onclick={navigateToModels}>
      Enable a provider in Models
    </button>, then return here.
  </div>
{:else}
  <div class="flex flex-col gap-4">
    {#each ([['cloud', cloudModels], ['corporate', corporateModels], ['local', localModels]] as const) as [category, catModels] (category)}
      {#if catModels.length > 0}
        <div>
          <h4 class="text-xs font-semibold text-(--pd-content-card-text) opacity-60 uppercase tracking-wide mb-2">
            {categoryLabels[category]}
          </h4>
          <div class="rounded-md border border-(--pd-content-card-border) overflow-x-auto">
            <table class="w-full text-sm table-fixed" aria-label="{categoryLabels[category]} models">
              <colgroup>
                <col class="w-14" />
                <col />
                <col class="w-16" />
                <col class="w-24" />
                <col class="w-14" />
                {#if showDefaultColumn}<col class="w-16" />{/if}
              </colgroup>
              <thead>
                <tr class="border-b border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg)">
                  <th class="px-3 py-2 text-left text-xs font-medium text-(--pd-content-card-text) opacity-60">Status</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-(--pd-content-card-text) opacity-60">Name</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-(--pd-content-card-text) opacity-60">Size</th>
                  <th class="px-3 py-2 text-left text-xs font-medium text-(--pd-content-card-text) opacity-60">Runtime</th>
                  <th class="px-3 py-2 text-center text-xs font-medium text-(--pd-content-card-text) opacity-60">Use</th>
                  {#if showDefaultColumn}
                    <th class="px-3 py-2 text-center text-xs font-medium text-(--pd-content-card-text) opacity-60">Default</th>
                  {/if}
                </tr>
              </thead>
              <tbody>
                {#each catModels as model (getKey(model))}
                  {@const key = getKey(model)}
                  {@const selected = isSelected(key)}
                  <tr
                    role="button"
                    tabindex="0"
                    class="border-b border-(--pd-content-card-border) last:border-b-0 transition-colors
                      cursor-pointer hover:bg-(--pd-content-card-hover-inset-bg)
                      {selected ? 'bg-(--pd-content-card-hover-inset-bg)' : ''}"
                    onclick={(multiSelect ? ontoggle : onselect)?.bind(undefined, model)}
                    onkeydown={(e: KeyboardEvent): void => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        (multiSelect ? ontoggle : onselect)?.(model);
                      }
                    }}
                    data-testid="model-row-{model.label}">
                    <td class="px-3 py-2">
                      <StatusIcon status={getModelStatus(model)} />
                    </td>
                    <td class="px-3 py-2">
                      <div class="font-medium text-(--pd-table-body-text-highlight)">{model.label}</div>
                      <div class="text-[11px] text-(--pd-content-card-text) opacity-60">{model.connectionName}</div>
                    </td>
                    <td class="px-3 py-2 text-(--pd-table-body-text)">—</td>
                    <td class="px-3 py-2 text-(--pd-table-body-text)">{model.providerName}</td>
                    <td class="px-3 py-2 text-center">
                      {#if multiSelect}
                        <input
                          type="checkbox"
                          checked={selected}
                          aria-label="Use {model.label}"
                          onclick={(e: MouseEvent): void => e.stopPropagation()}
                          onchange={ontoggle?.bind(undefined, model)} />
                      {:else}
                        <input
                          type="radio"
                          name="modelSelection"
                          value={key}
                          checked={selected}
                          aria-label="Use {model.label}"
                          onclick={(e: MouseEvent): void => e.stopPropagation()}
                          onchange={onselect?.bind(undefined, model)} />
                      {/if}
                    </td>
                    {#if showDefaultColumn}
                      <td class="px-3 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={defaultModelKey === key}
                          disabled={!selected}
                          aria-label="Set {model.label} as default"
                          onclick={(event): void => onDefaultClick(event, key)}
                          onchange={ondefaultchange?.bind(undefined, model)} />
                      </td>
                    {/if}
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    {/each}
  </div>

  {#if multiSelect && selectedCount > 0}
    <p class="text-xs text-(--pd-state-success) mt-4" data-testid="selected-count">
      {selectedCount} model{selectedCount !== 1 ? 's' : ''} selected
    </p>
  {:else if !multiSelect && selectedModel}
    <p class="text-xs text-(--pd-state-success) mt-4" data-testid="selected-model">
      Selected: {selectedModel.label}
    </p>
  {/if}
{/if}
