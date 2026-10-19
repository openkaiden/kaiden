<script lang="ts">
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { getCompatibleModels } from '/@/kaiden/lib/models/compatible-connections';
import CompatibleConnectionGate from '/@/kaiden/lib/models/CompatibleConnectionGate.svelte';
import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import { modelSelectionKey } from '/@/kaiden/stores/model-catalog';
import { catalogModels } from '/@/kaiden/stores/models';
import IconImage from '/@/lib/appearance/IconImage.svelte';
import type { AgentInfo } from '/@api/agent-info';
import type { DefaultPerAgentWorkspaceSettings, DefaultWorkspaceSettings } from '/@api/onboarding-settings-info';

interface Props {
  agentInfo: AgentInfo;
}

let { agentInfo }: Props = $props();

let compatibleModels: CatalogModelInfo[] = $derived(getCompatibleModels($catalogModels, agentInfo.supportedModelTypes));
let hasModels = $derived(compatibleModels.length > 0);

let savedModelKey = $state('');
let selectedModelKey = $state('');
let saving = $state(false);

let hasChanges = $derived(selectedModelKey !== '' && selectedModelKey !== savedModelKey);
let selectedModel: CatalogModelInfo | undefined = $derived(
  compatibleModels.find(m => modelSelectionKey(m.providerId, m.connectionId, m.label) === selectedModelKey),
);

async function loadSavedModel(): Promise<void> {
  try {
    const existing = await window.getConfigurationValue<DefaultWorkspaceSettings>(
      'onboarding.defaultWorkspaceSettings',
    );
    const agentSettings = existing?.defaultAgentSettings?.[agentInfo.id];
    if (agentSettings?.defaultModel) {
      const key = modelSelectionKey(
        agentSettings.defaultModel.providerId,
        agentSettings.defaultModel.connectionId,
        agentSettings.defaultModel.label,
      );
      savedModelKey = key;
      selectedModelKey = key;
    }
  } catch {
    // ignore — no saved model
  }
}

$effect(() => {
  loadSavedModel().catch(() => {});
});

function selectModel(model: CatalogModelInfo): void {
  selectedModelKey = modelSelectionKey(model.providerId, model.connectionId, model.label);
}

function discardChanges(): void {
  selectedModelKey = savedModelKey;
}

async function saveSelection(): Promise<void> {
  if (!selectedModel) return;
  saving = true;
  try {
    const existing = await window.getConfigurationValue<DefaultWorkspaceSettings>(
      'onboarding.defaultWorkspaceSettings',
    );
    const settings: DefaultWorkspaceSettings = existing ?? {};
    settings.defaultAgentSettings ??= {};

    const agentSettings: DefaultPerAgentWorkspaceSettings = settings.defaultAgentSettings[agentInfo.id] ?? {};
    agentSettings.defaultModel = {
      providerId: selectedModel.providerId,
      connectionId: selectedModel.connectionId,
      label: selectedModel.label,
    };
    settings.defaultAgentSettings[agentInfo.id] = agentSettings;

    await window.updateConfigurationValue('onboarding.defaultWorkspaceSettings', settings);
    savedModelKey = selectedModelKey;
  } catch (err: unknown) {
    console.error('Failed to save agent model selection', err);
    await window.showMessageBox({
      title: 'Coding agents',
      type: 'error',
      message: `Failed to save default model: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ['OK'],
    });
  } finally {
    saving = false;
  }
}

function getAgentSubtitle(agent: AgentInfo): string {
  return agent.tags?.join(' · ') ?? '';
}
</script>

<div class="flex flex-col h-full overflow-y-auto">
  <div class="pt-6 px-8">
    <div class="flex items-center gap-3 mb-1">
      <IconImage image={agentInfo.icon?.logo ?? agentInfo.icon?.icon} alt={agentInfo.name} class="w-8 h-8">
        <Icon icon={faTerminal} size="2x" />
      </IconImage>
      <h1 class="text-2xl font-bold text-(--pd-content-header)">{agentInfo.name}</h1>
    </div>
    {#if getAgentSubtitle(agentInfo)}
      <p class="text-sm text-(--pd-link) mb-2">{getAgentSubtitle(agentInfo)}</p>
    {/if}
    {#if agentInfo.description}
      <p class="text-sm text-(--pd-content-text) opacity-70 mb-6">{agentInfo.description}</p>
    {/if}
  </div>

  <div class="px-8 pb-8 flex-1">
    <div class="rounded-xl border border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg) p-6">
      <h2 class="text-sm font-semibold text-(--pd-content-card-text) mb-1">Default model</h2>
      <p class="text-xs text-(--pd-content-card-text) opacity-60 mb-4">
        Select the default model for this agent. You can override per workspace later.
      </p>

      <CompatibleConnectionGate
        models={$catalogModels}
        supportedModelTypes={agentInfo.supportedModelTypes}
        selectedKey={selectedModelKey}
        onselect={selectModel} />

      {#if hasModels}
        <div class="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-(--pd-content-divider)">
          <span class="text-xs text-(--pd-content-card-text) opacity-60 mr-auto">
            {hasChanges ? 'You have unsaved changes' : ''}
          </span>
          <Button type="secondary" onclick={discardChanges} disabled={!hasChanges}>Discard</Button>
          <Button onclick={saveSelection} disabled={!hasChanges || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      {/if}
    </div>
  </div>
</div>
