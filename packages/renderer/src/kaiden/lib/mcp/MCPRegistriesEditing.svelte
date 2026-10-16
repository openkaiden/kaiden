<script lang="ts">
import { faPlusCircle, faTrash } from '@fortawesome/free-solid-svg-icons';
import type * as containerDesktopAPI from '@openkaiden/api';
import { Button, ErrorMessage, Input, Link } from '@podman-desktop/ui-svelte';

import { mcpRegistriesInfos, mcpRegistriesSuggestedInfos } from '/@/kaiden/stores/mcp-registries';
import IconImage from '/@/lib/appearance/IconImage.svelte';
import Dialog from '/@/lib/dialogs/Dialog.svelte';

// contains the original instances of MCP registries when user clicks
let originRegistries = $state<containerDesktopAPI.MCPRegistry[]>([]);

// login error responses
let errorResponses = $state<{ serverUrl: string; error: string }[]>([]);

interface Props {
  // show or hide new registry form
  showNewRegistryForm?: boolean;
}

let { showNewRegistryForm = false }: Props = $props();

// Busy flag while attempting login
let adding = $state(false);

// used when user tries to add new registry
const newRegistryRequest = $state<containerDesktopAPI.MCPRegistry>({
  serverUrl: '',
});

function setErrorResponse(serverUrl: string, message: string | undefined): void {
  if (message) {
    errorResponses = [...errorResponses, { serverUrl: serverUrl, error: message }];
  } else {
    errorResponses = errorResponses.filter(o => o.serverUrl !== serverUrl);
  }
}

async function addToMCPRegistry(registry: containerDesktopAPI.MCPRegistry): Promise<void> {
  adding = true;
  try {
    // use ... to avoid to give the proxy object
    await window.createMCPRegistry({ ...registry });
    setNewRegistryFormVisible(false);
  } catch (error: unknown) {
    setErrorResponse(registry.serverUrl, String(error));
  }
  adding = false;
}

function setNewRegistryFormVisible(visible: boolean): void {
  // Show the new registry form
  showNewRegistryForm = visible;
}

async function removeExistingRegistry(registry: containerDesktopAPI.MCPRegistry): Promise<void> {
  await window.unregisterMCPRegistry(registry);
}
</script>
<div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col" role="region">
  <div class="min-w-0 w-full shrink-0 px-5 py-4" role="region" aria-label="Header">
    <div class="flex flex-row">
      <Button onclick={(): void => setNewRegistryFormVisible(true)} icon={faPlusCircle} disabled={showNewRegistryForm}>
        Add MCP registry
      </Button>
    </div>
  </div>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-5 py-4" role="region" aria-label="Content">
    <div class="flex w-full min-w-0 flex-1 flex-col">
      <div class="w-full min-w-0 rounded-md bg-[var(--pd-invert-content-card-bg)] p-3">
      <table
        class="registries-table w-full table-fixed border-collapse border-y border-[var(--pd-content-text)] text-[var(--pd-invert-content-card-text)] text-sm"
        aria-label="Registries">
        <colgroup>
          <col class="w-[32%]" />
          <col />
          <col class="w-28" />
        </colgroup>
        <thead>
          <tr class="border-b border-[var(--pd-content-text)] text-xs font-semibold uppercase tracking-wide text-[var(--pd-table-header-text)]">
            <th class="py-3 pl-5 text-left font-semibold" scope="col">Registry</th>
            <th class="py-3 pr-3 text-left font-semibold" scope="col">URL</th>
            <th class="py-3 pr-5 text-right font-semibold" scope="col"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
        {#each $mcpRegistriesInfos as registry, index (index)}
          <tr class="border-t border-[var(--pd-content-text)] align-top" aria-label={registry.name ?? registry.serverUrl}>
            <td class="py-3 pl-5 pr-2">
              <div class="flex items-start gap-2">
                <span class="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center" aria-hidden="true">
                  {#if registry.icon}
                    <IconImage image={registry.icon} class="h-6 w-6" alt={registry.name ?? ''}></IconImage>
                  {/if}
                </span>
                <span class="min-w-0 break-words font-medium leading-snug">
                  {#if registry.name}
                    {registry.name}
                  {:else}
                    {registry.serverUrl.replace(/^https:\/\//, '')}
                  {/if}
                </span>
              </div>
            </td>
            <td class="py-3 pr-3 align-top break-words">
              <Link
                class="leading-snug"
                on:click={(): Promise<void> => window.openExternal(registry.serverUrl)}>{registry.serverUrl}</Link>
            </td>
            <td class="py-3 pr-5 text-right align-top">
              <Button
                icon={faTrash}
                title="Remove MCP registry"
                onclick={(): Promise<void> => removeExistingRegistry(registry)}
                disabled={adding || originRegistries.some(r => r.serverUrl === registry.serverUrl)}>Remove</Button>
            </td>
          </tr>
          {#if originRegistries.some(r => r.serverUrl === registry.serverUrl) && errorResponses.find(o => o.serverUrl === registry.serverUrl)?.error}
            <tr>
              <td class="pb-3 pl-[calc(1.25rem+1.5rem)] pr-2 text-sm font-semibold text-[var(--pd-state-error)]" colspan="3">
                {errorResponses.find(o => o.serverUrl === registry.serverUrl)?.error ?? ''}
              </td>
            </tr>
          {/if}
        {/each}

        {#each $mcpRegistriesSuggestedInfos as registry, i (i)}
          <tr class="border-t border-[var(--pd-content-text)] align-top" aria-label={registry.name ? registry.name : registry.url}>
            <td class="py-3 pl-5 pr-2">
              <div class="flex items-start gap-2">
                <span class="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center" aria-hidden="true">
                  {#if registry.icon}
                    <IconImage image={registry.icon} class="h-6 w-6" alt={registry.name ?? ''}></IconImage>
                  {/if}
                </span>
                <span class="min-w-0 break-words font-medium leading-snug">{registry.name}</span>
              </div>
            </td>
            <td class="py-3 pr-3 align-top break-words">
              <Link class="leading-snug" on:click={(): Promise<void> => window.openExternal(registry.url)}>{registry.url}</Link>
            </td>
            <td class="py-3 pr-5 align-top"></td>
          </tr>
        {/each}
        </tbody>
      </table>
      </div>
    </div>
  </div>
</div>

{#if showNewRegistryForm}
  <Dialog
    title="Add MCP Registry"
    onclose={(): void => {
      setNewRegistryFormVisible(false);
    }}>
    {#snippet content()}
        <div  class="flex flex-col text-[var(--pd-modal-text)] space-y-5">
        <div>
          <div>URL (HTTPS only)</div>
          <Input placeholder="Enter the URL of a registry" bind:value={newRegistryRequest.serverUrl}></Input>
        </div>

      </div>
      {/snippet}
    {#snippet validation()}
        <ErrorMessage error={errorResponses.find(o => o.serverUrl === newRegistryRequest.serverUrl)?.error ?? ''}
        ></ErrorMessage
        >
      {/snippet}
    {#snippet buttons()}

        <Button type="link" onclick={(): boolean => (showNewRegistryForm = false)}>Cancel</Button>
        <Button
          type="primary"
          disabled={!newRegistryRequest.serverUrl.trim()}
          inProgress={adding}
          onclick={(): Promise<void> => addToMCPRegistry(newRegistryRequest)}>Add</Button>

      {/snippet}
  </Dialog>
{/if}
