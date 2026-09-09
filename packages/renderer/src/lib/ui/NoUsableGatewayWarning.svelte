<script lang="ts">
import { Button } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import WarningMessage from '/@/lib/ui/WarningMessage.svelte';
import { openshellGateways, openshellGatewaysReady } from '/@/stores/openshell-gateways';
import { isGatewayVersionCompatible, MIN_GATEWAY_VERSION, type GatewayInfo } from '/@api/openshell-gateway-info';

const GATEWAY_SETTINGS_PATH = '/preferences/openshell/gateways';

function noUsableGateways(gateways: GatewayInfo[]): boolean {
  return !gateways.some(
    gateway => gateway.gatewayState?.reachable === true && isGatewayVersionCompatible(gateway.version),
  );
}

function getWarningMessage(gateways: GatewayInfo[]): string {
  const hasReachableButIncompatible = gateways.some(
    gateway => gateway.gatewayState?.reachable === true && !isGatewayVersionCompatible(gateway.version),
  );
  if (hasReachableButIncompatible) {
    return `No usable OpenShell gateways available. Minimum required version: ${MIN_GATEWAY_VERSION}.`;
  }
  return 'No usable OpenShell gateways available.';
}
</script>

{#if $openshellGatewaysReady && noUsableGateways($openshellGateways)}
  <div class="shrink-0 px-3 py-2 bg-(--pd-content-card-bg) flex items-center justify-between gap-3">
    <WarningMessage error={getWarningMessage($openshellGateways)} />
    <Button type="secondary" onclick={(): void => router.goto(GATEWAY_SETTINGS_PATH)}>Open gateway settings</Button>
  </div>
{/if}
