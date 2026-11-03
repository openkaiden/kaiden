<script lang="ts">
import type { CardSelectorOption } from '/@/lib/ui/CardSelector.svelte';
import CardSelector from '/@/lib/ui/CardSelector.svelte';
import type { OpenshellProfile } from '/@api/openshell-gateway-info';

import { getServiceIcon } from './secret-vault-utils';

interface Props {
  gateway: string;
  onSelect: (profile: OpenshellProfile | undefined) => void;
}

let { gateway, onSelect }: Props = $props();

async function loadServices(gatewayName: string): Promise<OpenshellProfile[]> {
  try {
    return (await window.listSecretServices(gatewayName)).filter(s => s.credentials?.length);
  } catch (err: unknown) {
    console.error(`Failed to load secret services for gateway ${gatewayName}`, err);
    return [];
  }
}

let services = $derived(await loadServices(gateway));
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

function select(value: string): void {
  selected = value;
  onSelect(serviceMap.get(value));
}
</script>

<CardSelector label="Secret type" options={typeOptions} bind:selected={(): string => selected, select} required />
