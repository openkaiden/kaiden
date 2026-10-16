<script lang="ts">
import { faBoxOpen } from '@fortawesome/free-solid-svg-icons';

import type { CardSelectorOption } from '/@/lib/ui/CardSelector.svelte';
import CardSelector from '/@/lib/ui/CardSelector.svelte';

interface Props {
  selected?: string;
}

let { selected = $bindable('') }: Props = $props();

const FALLBACK_ICON = faBoxOpen;

const folders = $derived(await window.listSkillFolders());

const options: CardSelectorOption[] = $derived(
  folders.map(f => ({
    title: f.label,
    badge: f.badge,
    value: f.baseDirectory,
    icon: f.icon ?? FALLBACK_ICON,
  })),
);

$effect(() => {
  if (!selected && options.length > 0) {
    selected = options[0]!.value;
  }
});
</script>

{#if options.length > 0}
  <CardSelector label="Target" {options} bind:selected />
{/if}
