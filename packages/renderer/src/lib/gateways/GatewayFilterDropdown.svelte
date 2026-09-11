<script lang="ts">
import { Dropdown } from '@podman-desktop/ui-svelte';

import { openshellGateways } from '/@/stores/openshell-gateways';

interface Props {
  value?: string;
}

let { value = $bindable('') }: Props = $props();

const connectedGateways = $derived($openshellGateways.filter(g => g.gatewayState?.reachable === true));

$effect(() => {
  if (connectedGateways.length < 2 || (value && !connectedGateways.some(g => g.name === value))) {
    value = '';
  }
});

const gatewayOptions = $derived.by(() => {
  const options: { label: string; value: string }[] = [{ label: 'All', value: '' }];
  for (const gateway of connectedGateways) {
    options.push({ label: gateway.name, value: gateway.name });
  }
  return options;
});

const longestGatewayLabel = $derived(
  gatewayOptions.reduce((longest, option) => (option.label.length > longest.length ? option.label : longest), ''),
);
</script>

{#if connectedGateways.length > 1}
  <div class="inline-grid max-w-64">
    <div class="invisible col-start-1 row-start-1 flex items-center px-1 py-1 whitespace-nowrap" aria-hidden="true">
      <span class="mr-1">Gateway:</span>
      <span class="truncate">{longestGatewayLabel}</span>
      <span class="w-4 shrink-0"></span>
    </div>
    <Dropdown
      ariaLabel="Filter by gateway"
      id="gateway-filter"
      name="gateway-filter"
      class="col-start-1 row-start-1 whitespace-nowrap grow-0!"
      bind:value={value}
      options={gatewayOptions}>
      {#snippet left()}
        <div class="mr-1 text-(--pd-input-field-placeholder-text)">Gateway:</div>
      {/snippet}
    </Dropdown>
  </div>
{/if}
