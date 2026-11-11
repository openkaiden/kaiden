<script lang="ts">
import { Button } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import { openshellGateways, openshellGatewaysReady } from '/@/kaiden/stores/openshell-gateways';
import { GatewayStartAction } from '/@/lib/preferences/gateway-start-action.svelte';
import WarningMessage from '/@/lib/ui/WarningMessage.svelte';

import {
  getStartableGateway,
  getStartButtonLabel,
  getStartError,
  getWarningMessage,
  noUsableGateways,
} from './no-usable-gateway-warning';

const GATEWAY_SETTINGS_PATH = '/preferences/openshell/gateways';

const startAction = new GatewayStartAction();

let startableGateway = $derived(getStartableGateway($openshellGateways));
let startError = $derived(getStartError(startAction.errors, startableGateway));
let warningMessage = $derived(startError ?? getWarningMessage($openshellGateways));
</script>

{#if $openshellGatewaysReady && noUsableGateways($openshellGateways)}
  <div class="shrink-0 px-3 py-2 bg-(--pd-content-card-bg) flex items-center justify-between gap-3">
    <WarningMessage error={warningMessage} />
    <div class="flex items-center gap-2">
      {#if startableGateway}
        {@const gateway = startableGateway}
        <Button
          type="secondary"
          inProgress={startAction.startingGateways.includes(gateway.name)}
          onclick={(): Promise<void> => startAction.start(gateway.name)}>{getStartButtonLabel(gateway)}</Button>
      {/if}
      {#if !$router.path.startsWith(GATEWAY_SETTINGS_PATH)}
        <Button type="secondary" onclick={(): void => router.goto(GATEWAY_SETTINGS_PATH)}>Open gateway settings</Button>
      {/if}
    </div>
  </div>
{/if}
