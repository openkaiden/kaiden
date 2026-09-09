<script lang="ts">
import { ErrorMessage, FormPage } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import MCPValidServerIndicatorIcon from '/@/lib/images/MCPValidServerIndicatorIcon.svelte';
import type { MCPTarget } from '/@/lib/mcp/setup/mcp-target';
import MCPSetupDropdown from '/@/lib/mcp/setup/MCPSetupDropdown.svelte';
import PackageSetupForm from '/@/lib/mcp/setup/PackageSetupForm.svelte';
import RemoteSetupForm from '/@/lib/mcp/setup/RemoteSetupForm.svelte';
import { mcpRegistriesServerInfos } from '/@/stores/mcp-registry-servers';
import type { MCPSetupOptions, MCPSetupPackageOptions } from '/@api/mcp/mcp-setup';

interface Props {
  serverId: string;
}

const { serverId }: Props = $props();

let loading: boolean = $state(false);
let error: string | undefined = $state(undefined);

const mcpRegistryServerDetail = $derived($mcpRegistriesServerInfos.find(server => server.serverId === serverId));

let targets: Array<MCPTarget> = $derived([
  ...(mcpRegistryServerDetail?.remotes ?? []).map((remote, index) => ({ ...remote, index })),
  ...(mcpRegistryServerDetail?.packages ?? []).map((pack, index) => ({ ...pack, index })),
]);
let mcpTarget: MCPTarget | undefined = $state();

$effect(() => {
  // select default at index 0
  if (mcpTarget === undefined && targets.length > 0) {
    mcpTarget = targets[0];
  }
});

async function submit(options: MCPSetupOptions): Promise<void> {
  try {
    loading = true;
    error = undefined;
    await window.setupMCP(serverId, options);
    return navigateToMcps();
  } catch (err: unknown) {
    error = String(err);
  } finally {
    loading = false;
  }
}

async function register(options: MCPSetupPackageOptions): Promise<void> {
  try {
    loading = true;
    error = undefined;
    await window.registerMCP(serverId, options);
    return navigateToMcps();
  } catch (err: unknown) {
    error = String(err);
  } finally {
    loading = false;
  }
}

async function navigateToMcps(): Promise<void> {
  router.goto('/preferences/mcps?tab=READY');
}

async function close(): Promise<void> {
  router.goto('/preferences/mcps?tab=INSTALL');
}
</script>

{#if mcpRegistryServerDetail}
  <FormPage title="Adding {mcpRegistryServerDetail.name}" inProgress={loading} onclose={navigateToMcps}>
    {#snippet icon()}<MCPValidServerIndicatorIcon size={24} object={mcpRegistryServerDetail} />{/snippet}
    {#snippet content()}

      <div class="p-5 min-w-full h-full">

        <div class="bg-[var(--pd-content-card-bg)] p-6 space-y-2 lg:p-8 rounded-lg">
          <div class="flex flex-col gap-y-4">
            {#if error}
              <ErrorMessage error={error} />
            {/if}

            <!-- selecting which remote / package to use -->
            {#if targets.length > 1}
              <div class="bg-[var(--pd-content-bg)] rounded-md flex flex-col p-2 space-y-2">
                <label class="block mb-2 text-xl font-bold text-[var(--pd-content-card-header-text)]">MCP Server Type</label>
                <MCPSetupDropdown
                  bind:selected={mcpTarget}
                  targets={targets}
                />
              </div>
            {/if}

            <!-- display form -->
            {#if mcpTarget !== undefined}
              {#key mcpTarget}
                {#if 'url' in mcpTarget}  <!-- remote -->
                  <RemoteSetupForm submit={submit} remoteIndex={mcpTarget.index} bind:loading={loading} object={mcpTarget} cancel={close}/>
                {:else} <!-- package -->
                  <PackageSetupForm submit={submit} register={register} packageIndex={mcpTarget.index} bind:loading={loading} object={mcpTarget} cancel={close}/>
                {/if}
              {/key}
            {/if}
          </div>
        </div>
      </div>
    {/snippet}
  </FormPage>
{/if}
