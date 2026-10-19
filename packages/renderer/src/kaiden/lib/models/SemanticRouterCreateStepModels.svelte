<script lang="ts">
import { untrack } from 'svelte';
import { SvelteSet } from 'svelte/reactivity';

import { disabledModels, isModelEnabled, modelKey, modelSelectionKey } from '/@/kaiden/stores/model-catalog';
import { catalogModels } from '/@/kaiden/stores/models';

import type { CatalogModelInfo } from './models-utils';
import ModelSelectionTable from './ModelSelectionTable.svelte';

interface Props {
  selectedModels?: CatalogModelInfo[];
  defaultModel?: CatalogModelInfo;
}

let { selectedModels = $bindable([]), defaultModel = $bindable() }: Props = $props();

let selectedKeys = new SvelteSet<string>(
  selectedModels.map(m => modelSelectionKey(m.providerId, m.connectionId, m.label)),
);

let eligibleModels: CatalogModelInfo[] = $derived.by(() => {
  const enabled = $catalogModels.filter(m => isModelEnabled($disabledModels, m.providerId, m.label));
  const seen: Record<string, boolean> = {};
  return enabled.filter(m => {
    if (m.llmMetadata?.semanticRouter !== undefined) return false;
    const key = modelKey(m.providerId, m.label);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
});

$effect(() => {
  selectedModels = eligibleModels.filter(m =>
    selectedKeys.has(modelSelectionKey(m.providerId, m.connectionId, m.label)),
  );
});

$effect(() => {
  const models = selectedModels;
  if (models.length > 0) {
    const current = untrack(() => defaultModel);
    const defaultStillSelected =
      current !== undefined &&
      models.some(
        m =>
          modelSelectionKey(m.providerId, m.connectionId, m.label) ===
          modelSelectionKey(current.providerId, current.connectionId, current.label),
      );
    if (!defaultStillSelected) {
      defaultModel = models[0]!;
    }
  } else {
    defaultModel = undefined;
  }
});

function toggleModel(model: CatalogModelInfo): void {
  const key = modelSelectionKey(model.providerId, model.connectionId, model.label);
  if (selectedKeys.has(key)) {
    selectedKeys.delete(key);
  } else {
    selectedKeys.add(key);
  }
}

function setDefaultModel(model: CatalogModelInfo): void {
  defaultModel = model;
}
</script>

<div>
  <h2 class="text-lg font-semibold text-(--pd-modal-text) mb-1">Backend models</h2>
  <p class="text-sm text-(--pd-content-card-text) opacity-60 mb-5">
    Select one or more models the router can forward requests to. Models that are themselves
    semantic routers are excluded automatically.
  </p>

  <ModelSelectionTable
    models={eligibleModels}
    multiSelect={true}
    selectedKeys={selectedKeys}
    defaultModel={defaultModel}
    ontoggle={toggleModel}
    ondefaultchange={setDefaultModel} />
</div>
