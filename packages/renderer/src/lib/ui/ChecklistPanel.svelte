<script lang="ts">
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { Checkbox } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import type { Snippet } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';

export interface ChecklistItem {
  id: string;
  name: string;
  description?: string;
  group?: string;
}

interface Props {
  title: string;
  subtitle?: string;
  icon?: IconDefinition;
  items: readonly ChecklistItem[];
  selected?: string[];
  emptyMessage?: string;
  headerAction?: Snippet;
}

let {
  title,
  subtitle,
  icon,
  items,
  selected = $bindable<string[]>([]),
  emptyMessage = 'No items available.',
  headerAction,
}: Props = $props();

interface GroupedItems {
  label: string | undefined;
  items: readonly ChecklistItem[];
}

let groups: GroupedItems[] = $derived.by(() => {
  const map = new SvelteMap<string | undefined, ChecklistItem[]>();
  for (const item of items) {
    const key = item.group;
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return [...map.entries()].map(([label, groupItems]) => ({ label, items: groupItems }));
});

function isSelected(id: string): boolean {
  return selected.includes(id);
}

function toggle(id: string): void {
  if (isSelected(id)) {
    selected = selected.filter(s => s !== id);
  } else {
    selected = [...selected, id];
  }
}
</script>

<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-[var(--pd-content-card-border)]">
    <div class="flex items-center gap-3">
      {#if icon}
        <div class="w-9 h-9 rounded-[9px] flex items-center justify-center bg-[var(--pd-label-quaternary-bg)] text-[var(--pd-label-quaternary-text)]">
          <Icon {icon} class='text-xl'/>
        </div>
      {/if}
      <div>
        <div class="flex items-center gap-2">
          <span class="text-lg font-semibold text-[var(--pd-modal-text)]">{title}</span>
          {#if items.length > 0}
            <span class="text-xs text-[var(--pd-content-card-text)] opacity-50">{items.length} items</span>
          {/if}
        </div>
        {#if subtitle}
          <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 mt-0.5">{subtitle}</p>
        {/if}
      </div>
    </div>
    {#if headerAction}
      {@render headerAction()}
    {/if}
  </div>

  <!-- Items -->
  <div class="px-2 py-1">
    {#if items.length === 0}
      <div class="py-4 text-center text-sm text-[var(--pd-content-card-text)] opacity-50 italic">
        {emptyMessage}
      </div>
    {:else}
      {#each groups as group, groupIdx (group.label)}
        {#if group.label}
          <div class="px-3 pb-1.5 {groupIdx === 0 ? 'pt-1' : 'pt-3.5 mt-1'}">
            <span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--pd-table-header-text)]">{group.label}</span>
          </div>
        {/if}
        {#each group.items as item, itemIdx (item.id)}
          {#if itemIdx > 0}
            <div class="mx-3 border-t border-[var(--pd-content-card-border)] opacity-30"></div>
          {/if}
          <button
            class="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors
              {isSelected(item.id)
                ? 'bg-[var(--pd-content-card-hover-inset-bg)]'
                : 'hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
            onclick={(): void => toggle(item.id)}
            aria-label={item.name}>
            <div class="text-left min-w-0 flex-1">
              <div class="text-sm font-medium text-[var(--pd-table-body-text-highlight)]">{item.name}</div>
              {#if item.description}
                <div class="text-xs text-[var(--pd-table-body-text)] mt-px">{item.description}</div>
              {/if}
            </div>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <span class="flex-shrink-0" onclick={(e): void => e.stopPropagation()}>
              <Checkbox checked={isSelected(item.id)} title={item.name} onclick={(): void => toggle(item.id)} />
            </span>
          </button>
        {/each}
      {/each}
    {/if}
  </div>

  <!-- Footer -->
  {#if items.length > 0}
    <div class="px-4 py-2 border-t border-[var(--pd-content-card-border)] text-xs text-[var(--pd-content-card-text)] opacity-60">
      {selected.length} of {items.length} selected
    </div>
  {/if}
</div>
