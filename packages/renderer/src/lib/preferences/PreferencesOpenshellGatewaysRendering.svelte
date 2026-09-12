<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, EmptyScreen } from '@podman-desktop/ui-svelte';

import EngineIcon from '/@/lib/ui/EngineIcon.svelte';
import { extensionInfos } from '/@/stores/extensions';
import { openshellGateways } from '/@/stores/openshell-gateways';
import { isGatewayVersionCompatible, type GatewayInfo, KAIDEN_LOCAL_GATEWAY_NAME } from '/@api/openshell-gateway-info';

import PreferencesOpenshellGatewayCreate from './PreferencesOpenshellGatewayCreate.svelte';
import SettingsPage from './SettingsPage.svelte';

const OPENSHELL_EXTENSION_ID = 'kaiden.openshell';
let openshellStarted: boolean = $derived(
  $extensionInfos.some(ext => ext.id === OPENSHELL_EXTENSION_ID && ext.state === 'started'),
);

let activeGateway: GatewayInfo | undefined = $derived($openshellGateways.find(g => g.active));
let otherGateways: GatewayInfo[] = $derived($openshellGateways.filter(g => !g.active));
let showCreateGateway = $state(false);

function openCreateGateway(): void {
  showCreateGateway = true;
}

function closeCreateGateway(): void {
  showCreateGateway = false;
}

function getTypeBadge(gateway: GatewayInfo): string {
  if (gateway.name === KAIDEN_LOCAL_GATEWAY_NAME) {
    return 'Managed';
  }
  return 'Referenced';
}

function getDetails(gateway: GatewayInfo): string {
  const parts: string[] = [];
  if (gateway.type) {
    parts.push(gateway.type);
  }
  if (gateway.is_remote && gateway.type !== 'remote') {
    parts.push('remote');
  }
  parts.push(gateway.endpoint);

  if (gateway.version) {
    parts.push(`v${gateway.version}`);
  }

  if (!gateway.gatewayState) {
    parts.push('Unknown');
  } else if (!gateway.gatewayState.reachable) {
    parts.push('Disconnected');
  } else if (!isGatewayVersionCompatible(gateway.version)) {
    parts.push('Incompatible');
  } else {
    switch (gateway.gatewayState.health) {
      case 'healthy':
        parts.push('Connected');
        break;
      case 'degraded':
        parts.push('Degraded');
        break;
      case 'unhealthy':
        parts.push('Unhealthy');
        break;
      default:
        parts.push('Unknown');
    }
  }

  return parts.join(' · ');
}

function getStatusColor(gateway: GatewayInfo): string {
  if (!gateway.gatewayState) {
    return 'bg-(--pd-status-unknown)';
  }
  if (!gateway.gatewayState.reachable) {
    return 'bg-(--pd-status-stopped)';
  }
  if (!isGatewayVersionCompatible(gateway.version)) {
    return 'bg-(--pd-status-terminated)';
  }
  switch (gateway.gatewayState.health) {
    case 'healthy':
      return 'bg-(--pd-status-running)';
    case 'degraded':
      return 'bg-(--pd-status-degraded)';
    case 'unhealthy':
      return 'bg-(--pd-status-terminated)';
    default:
      return 'bg-(--pd-status-unknown)';
  }
}
</script>

<SettingsPage title="Gateways">
  {#snippet subtitle()}
    <span>The runtime that provisions sandboxes, enforces policy, and routes inference traffic.</span>
  {/snippet}
  <div class="h-full" role="region" aria-label="Gateways">
    {#if !openshellStarted}
      <EmptyScreen
        icon={EngineIcon}
        title="OpenShell extension is not running"
        message="Install and start the OpenShell extension to manage gateways" />
    {:else}
      <EmptyScreen
        icon={EngineIcon}
        title="No gateways found"
        message="Start the OpenShell extension to register a gateway"
        hidden={$openshellGateways.length > 0}>
        <div class="flex justify-center">
          <Button type="secondary" class="rounded-lg" icon={faPlus} onclick={openCreateGateway}>
            Create local gateway
          </Button>
        </div>
      </EmptyScreen>
    {/if}

    {#if openshellStarted && activeGateway}
      <div class="mb-6">
        <h3
          class="text-xs font-semibold uppercase tracking-wide text-(--pd-content-card-text) opacity-70 mb-2"
          aria-label="Active gateway section">
          Active Gateway
        </h3>
        <div
          class="bg-(--pd-content-card-bg) rounded-md p-4"
          role="region"
          aria-label="Active gateway {activeGateway.name}">
          <div class="flex items-center gap-3">
            <div class="w-2 h-2 rounded-full shrink-0 {getStatusColor(activeGateway)}" aria-label="Gateway state"></div>
            <span class="text-lg font-semibold text-(--pd-content-card-text)">{activeGateway.name}</span>
            <span
              class="text-xs font-medium px-2 py-0.5 rounded-full bg-(--pd-label-bg) text-(--pd-label-text)">
              {getTypeBadge(activeGateway)}
            </span>
            <span class="text-sm text-(--pd-content-card-text) opacity-70">{getDetails(activeGateway)}</span>
          </div>
        </div>
      </div>
    {/if}

    {#if openshellStarted && otherGateways.length > 0}
      <div>
        <h3
          class="text-xs font-semibold uppercase tracking-wide text-(--pd-content-card-text) opacity-70 mb-2"
          aria-label="Other gateways section">
          Other Gateways
        </h3>
        <div class="flex flex-col gap-2">
          {#each otherGateways as gateway (gateway.name)}
            <div
              class="bg-(--pd-content-card-bg) rounded-md p-4"
              role="region"
              aria-label="Gateway {gateway.name}">
              <div class="flex items-center gap-3">
                <div class="w-2 h-2 rounded-full shrink-0 {getStatusColor(gateway)}" aria-label="Gateway state"></div>
                <span class="font-semibold text-(--pd-content-card-text)">{gateway.name}</span>
                <span
                  class="text-xs font-medium px-2 py-0.5 rounded-full bg-(--pd-label-bg) text-(--pd-label-text)">
                  {getTypeBadge(gateway)}
                </span>
                <span class="text-sm text-(--pd-content-card-text) opacity-70">{getDetails(gateway)}</span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}

    {#if openshellStarted && $openshellGateways.length > 0}
      <div class="mt-3 flex">
        <Button type="secondary" class="rounded-lg" icon={faPlus} onclick={openCreateGateway}>
          Create local gateway
        </Button>
      </div>
    {/if}
  </div>
</SettingsPage>

{#if showCreateGateway}
  <PreferencesOpenshellGatewayCreate
    existingNames={$openshellGateways.map(gateway => gateway.name)}
    initialDriver={activeGateway?.driver ?? 'podman'}
    closeCallback={closeCreateGateway} />
{/if}
