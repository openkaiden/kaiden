<script lang="ts">
import { faServer } from '@fortawesome/free-solid-svg-icons';
import { Checkbox } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

export interface McpServerItem {
  id: string;
  name: string;
  description?: string;
  recommended?: boolean;
}

interface Props {
  mcpItems: McpServerItem[];
  selectedMcpIds: string[];
}

let { mcpItems, selectedMcpIds = $bindable() }: Props = $props();

const recommendedItems = $derived(mcpItems.filter(m => m.recommended));
const availableItems = $derived(mcpItems.filter(m => !m.recommended));

function isSelected(id: string): boolean {
  return selectedMcpIds.includes(id);
}

function toggle(id: string): void {
  if (isSelected(id)) {
    selectedMcpIds = selectedMcpIds.filter(s => s !== id);
  } else {
    selectedMcpIds = [...selectedMcpIds, id];
  }
}
</script>

<div class="flex flex-col gap-5">
  <p class="text-sm text-(--pd-content-card-text) opacity-70 leading-relaxed">
    Based on your project analysis, we recommend the following MCP servers. Select the ones you want to enable for this
    project.
  </p>

  {#if mcpItems.length === 0}
    <div
      class="rounded-xl border border-(--pd-content-card-border) bg-(--pd-content-card-bg) px-5 py-8 text-center text-sm text-(--pd-content-card-text) opacity-50 italic">
      No MCP servers available. Set up servers in the MCP section first.
    </div>
  {:else}
    {#if recommendedItems.length > 0}
      <div class="flex flex-col gap-2">
        <span
          class="text-[11px] font-semibold uppercase tracking-wider text-(--pd-table-header-text)"
          >Recommended</span>
        {#each recommendedItems as item (item.id)}
          <button
            class="flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors cursor-pointer
              {isSelected(item.id)
              ? 'bg-(--pd-content-card-hover-inset-bg) border-(--pd-button-primary-bg)'
              : 'bg-(--pd-content-card-bg) border-(--pd-content-card-border) hover:bg-(--pd-content-card-hover-inset-bg)'}"
            onclick={(): void => toggle(item.id)}
            aria-label={item.name}>
            <div class="flex-shrink-0" onclick={(e): void => e.stopPropagation()}>
              <Checkbox checked={isSelected(item.id)} title={item.name} onclick={(): void => toggle(item.id)} />
            </div>
            <div
              class="w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0 bg-(--pd-label-quaternary-bg) text-(--pd-label-quaternary-text)">
              <Icon icon={faServer} class="text-base" />
            </div>
            <div class="flex-1 min-w-0 text-left">
              <div class="text-sm font-medium text-(--pd-table-body-text-highlight)">{item.name}</div>
              {#if item.description}
                <div class="text-xs text-(--pd-table-body-text) mt-px">{item.description}</div>
              {/if}
            </div>
            <span
              class="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md flex-shrink-0
                bg-(--pd-status-running)/15 text-(--pd-status-running)"
              >Recommended</span>
          </button>
        {/each}
      </div>
    {/if}

    {#if availableItems.length > 0}
      <div class="flex flex-col gap-2">
        <span
          class="text-[11px] font-semibold uppercase tracking-wider text-(--pd-table-header-text)"
          >Available</span>
        {#each availableItems as item (item.id)}
          <button
            class="flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors cursor-pointer
              {isSelected(item.id)
              ? 'bg-(--pd-content-card-hover-inset-bg) border-(--pd-button-primary-bg)'
              : 'bg-(--pd-content-card-bg) border-(--pd-content-card-border) hover:bg-(--pd-content-card-hover-inset-bg)'}"
            onclick={(): void => toggle(item.id)}
            aria-label={item.name}>
            <div class="flex-shrink-0" onclick={(e): void => e.stopPropagation()}>
              <Checkbox checked={isSelected(item.id)} title={item.name} onclick={(): void => toggle(item.id)} />
            </div>
            <div
              class="w-9 h-9 rounded-[9px] flex items-center justify-center flex-shrink-0 bg-(--pd-label-quaternary-bg) text-(--pd-label-quaternary-text)">
              <Icon icon={faServer} class="text-base" />
            </div>
            <div class="flex-1 min-w-0 text-left">
              <div class="text-sm font-medium text-(--pd-table-body-text-highlight)">{item.name}</div>
              {#if item.description}
                <div class="text-xs text-(--pd-table-body-text) mt-px">{item.description}</div>
              {/if}
            </div>
            <span
              class="text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-md flex-shrink-0
                bg-(--pd-content-card-bg) border border-(--pd-content-card-border) text-(--pd-content-card-text) opacity-60"
              >Optional</span>
          </button>
        {/each}
      </div>
    {/if}
  {/if}
</div>
