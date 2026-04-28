<script lang="ts">
import { faChevronLeft, faChevronRight, faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { Checkbox } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

export interface ScrollableCardItem {
  id: string;
  name: string;
  description?: string;
}

interface Props {
  items: readonly ScrollableCardItem[];
  selected?: string[];
  placeholder?: string;
  columns?: number;
}

let { items, selected = $bindable<string[]>([]), placeholder = 'Search...', columns = 3 }: Props = $props();

const ROWS = 3;

let searchQuery = $state('');
let currentPage = $state(0);

let filteredItems = $derived(
  searchQuery.trim()
    ? items.filter(
        item =>
          item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          item.description?.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : items,
);

let pageSize = $derived(columns * ROWS);
let totalPages = $derived(Math.max(1, Math.ceil(filteredItems.length / pageSize)));
let safePage = $derived(Math.min(currentPage, totalPages - 1));
let pageItems = $derived(filteredItems.slice(safePage * pageSize, (safePage + 1) * pageSize));

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

function prevPage(): void {
  if (safePage > 0) currentPage = safePage - 1;
}

function nextPage(): void {
  if (safePage < totalPages - 1) currentPage = safePage + 1;
}

$effect(() => {
  // Reset to first page when search changes
  searchQuery;
  currentPage = 0;
});
</script>

<div class="flex flex-col gap-2">
  <!-- Search bar -->
  <div class="relative">
    <div class="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--pd-content-card-text)] opacity-50">
      <Icon icon={faMagnifyingGlass} size="sm" />
    </div>
    <input
      type="text"
      bind:value={searchQuery}
      placeholder={placeholder}
      class="w-full pl-9 pr-3 py-1.5 rounded-lg text-xs
        bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)]
        text-[var(--pd-content-card-text)] placeholder:text-[var(--pd-content-card-text)] placeholder:opacity-50
        focus:outline-none focus:border-[var(--pd-content-card-border-selected)]" />
  </div>

  <!-- Paginated grid with arrow buttons -->
  <div class="flex items-center gap-2">
    <button
      class="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
        text-[var(--pd-content-card-text)] hover:bg-[var(--pd-content-card-hover-inset-bg)]
        cursor-pointer disabled:opacity-20 disabled:cursor-default transition-opacity"
      onclick={prevPage}
      disabled={safePage === 0}
      aria-label="Previous page">
      <Icon icon={faChevronLeft} size="sm" />
    </button>

    <div class="flex-1 min-w-0">
      {#if filteredItems.length === 0}
        <div class="text-xs text-[var(--pd-content-card-text)] opacity-50 italic py-4 text-center">
          {searchQuery.trim() ? 'No results found.' : 'No items available.'}
        </div>
      {:else}
        <div
          class="grid gap-2"
          style="grid-template-columns: repeat({columns}, minmax(0, 1fr));">
          {#each pageItems as item (item.id)}
            <button
              class="flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all duration-150
                {isSelected(item.id)
                  ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
                  : 'border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)]'}
                hover:bg-[var(--pd-content-card-hover-inset-bg)]"
              onclick={(): void => toggle(item.id)}
              aria-label={item.name}>
              <div class="flex-shrink-0" onclick={(e): void => e.stopPropagation()}>
                <Checkbox checked={isSelected(item.id)} title={item.name} onclick={(): void => toggle(item.id)} />
              </div>
              <div class="text-left min-w-0 flex-1">
                <div class="text-xs font-medium text-[var(--pd-content-card-text)] truncate">{item.name}</div>
                {#if item.description}
                  <div class="text-[10px] text-[var(--pd-content-card-text)] opacity-55 truncate mt-0.5">{item.description}</div>
                {/if}
              </div>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <button
      class="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
        text-[var(--pd-content-card-text)] hover:bg-[var(--pd-content-card-hover-inset-bg)]
        cursor-pointer disabled:opacity-20 disabled:cursor-default transition-opacity"
      onclick={nextPage}
      disabled={safePage >= totalPages - 1}
      aria-label="Next page">
      <Icon icon={faChevronRight} size="sm" />
    </button>
  </div>

  <!-- Footer: selection count + page indicator -->
  <div class="flex items-center justify-between text-xs text-[var(--pd-content-card-text)] opacity-60">
    <span>{selected.length} selected</span>
    {#if totalPages > 1}
      <span>{safePage + 1} / {totalPages}</span>
    {/if}
  </div>
</div>
