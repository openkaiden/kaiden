<script lang="ts">
import { onMount } from 'svelte';

import type { CardSelectorOption } from '/@/lib/ui/CardSelector.svelte';
import CardSelector from '/@/lib/ui/CardSelector.svelte';
import type { OpenshellProfile } from '/@api/openshell-gateway-info';

import { getServiceIcon } from './secret-vault-utils';

interface Props {
  onSelect: (profile: OpenshellProfile | undefined) => void;
}

let { onSelect }: Props = $props();

let services = $state<OpenshellProfile[]>([]);
let loading = $state(true);
let selected = $state('');

let serviceMap = $derived(new Map(services.map(s => [s.id, s])));

let typeOptions = $derived<CardSelectorOption[]>(
  services.map(s => ({
    title: s.display_name,
    badge: s.display_name,
    value: s.id,
    icon: getServiceIcon(s.id),
  })),
);

onMount(async () => {
  try {
    services = (await window.listSecretServices()).filter(s => s.credentials?.length);
  } catch (err: unknown) {
    console.error('Failed to load secret services', err);
  } finally {
    loading = false;
  }
});

function select(value: string): void {
  selected = value;
  onSelect(serviceMap.get(value));
}
</script>

{#if loading}
  <p class="text-sm text-(--pd-content-card-text) opacity-70">Loading secret types…</p>
{:else}
  <CardSelector label="Secret type" options={typeOptions} bind:selected={(): string => selected, select} required />
{/if}
