<script lang="ts">
import { faEllipsisVertical, faPlay, faRocket, faStop } from '@fortawesome/free-solid-svg-icons';

import type { CatalogModelInfo } from '/@/lib/models/models-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import SlideToggle from '/@/lib/ui/SlideToggle.svelte';
import { disabledModels, isModelEnabled, toggleModel } from '/@/stores/model-catalog';

interface Props {
  object: CatalogModelInfo;
}

let { object }: Props = $props();

let enabled: boolean = $derived(isModelEnabled($disabledModels, object.providerId, object.label));
let isLocal: boolean = $derived(object.type === 'local');
let isRunning: boolean = $derived(object.connectionStatus === 'started' || object.connectionStatus === 'unknown');

function onChecked(): void {
  toggleModel(object.providerId, object.label);
}

function handlePlayground(): void {
  // TODO: open model in playground/chat
}

function handleRunStop(): void {
  // TODO: start or stop the model
}

function handleSettings(): void {
  // TODO: navigate to model settings/runtime arguments page
}
</script>

{#if isLocal}
  <ListItemButtonIcon title="Open in playground" icon={faRocket} onClick={handlePlayground} />
  <ListItemButtonIcon
    title={isRunning ? 'Stop model' : 'Start model'}
    icon={isRunning ? faStop : faPlay}
    onClick={handleRunStop} />
  <ListItemButtonIcon title="Settings" tooltip="Configure runtime arguments" icon={faEllipsisVertical} onClick={handleSettings} />
{:else}
  <SlideToggle
    id="model-toggle-{object.providerId}-{object.label}"
    checked={enabled}
    on:checked={onChecked}
    aria-label={enabled ? `Disable ${object.label}` : `Enable ${object.label}`} />
{/if}
