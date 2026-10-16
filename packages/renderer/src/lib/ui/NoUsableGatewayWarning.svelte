<script lang="ts">
import { Button } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import { openshellGateways, openshellGatewaysReady } from '/@/kaiden/stores/openshell-gateways';
import WarningMessage from '/@/lib/ui/WarningMessage.svelte';
import type { GatewayInfo } from '/@api/openshell-gateway-info';

const GATEWAY_SETTINGS_PATH = '/preferences/openshell/gateways';

function noUsableGateways(gateways: GatewayInfo[]): boolean {
  return !gateways.some(gateway => gateway.gatewayState?.reachable === true);
}
</script>

{#if $openshellGatewaysReady && noUsableGateways($openshellGateways)}
  <div class="shrink-0 px-3 py-2 bg-(--pd-content-card-bg) flex items-center justify-between gap-3">
    <WarningMessage error="No usable OpenShell gateways available." />
    {#if !$router.path.startsWith(GATEWAY_SETTINGS_PATH)}
      <Button type="secondary" onclick={(): void => router.goto(GATEWAY_SETTINGS_PATH)}>Open gateway settings</Button>
    {/if}
  </div>
{/if}
