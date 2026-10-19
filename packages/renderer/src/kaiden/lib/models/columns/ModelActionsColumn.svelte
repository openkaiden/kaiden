<script lang="ts">
import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import { disabledModels, isModelEnabled, toggleModel } from '/@/kaiden/stores/model-catalog';
import SlideToggle from '/@/lib/ui/SlideToggle.svelte';

interface Props {
  object: CatalogModelInfo;
}

let { object }: Props = $props();

let toggleId: string = $derived(`model-toggle-${object.providerId}-${object.label}`.replace(/[^A-Za-z0-9_-]/g, '-'));
let enabled: boolean = $derived(isModelEnabled($disabledModels, object.providerId, object.label));

function onChecked(): void {
  toggleModel(object.providerId, object.label);
}
</script>

<SlideToggle
  id={toggleId}
  checked={enabled}
  on:checked={onChecked}
  aria-label={enabled ? `Disable ${object.label}` : `Enable ${object.label}`} />
