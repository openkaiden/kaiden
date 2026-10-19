<script lang="ts">
import type { AcpSlashCommand } from '/@api/acp-session-info';

interface Props {
  commands: AcpSlashCommand[];
  query: string;
  onselect: (command: AcpSlashCommand) => void;
  oncancel: () => void;
}

let { commands, query, onselect, oncancel }: Props = $props();

let selectedIndex = $state(0);

const filtered = $derived(commands.filter(c => c.name.toLowerCase().startsWith(query.toLowerCase())));

$effect(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, sonarjs/no-unused-vars
  const _items = filtered;
  selectedIndex = 0;
});

export function handleKey(e: KeyboardEvent): boolean {
  if (!filtered.length) return false;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % filtered.length;
    scrollSelected();
    return true;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
    scrollSelected();
    return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    const cmd = filtered[selectedIndex];
    if (cmd) onselect(cmd);
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    oncancel();
    return true;
  }
  return false;
}

let listEl: HTMLElement | undefined = $state(undefined);

function scrollSelected(): void {
  requestAnimationFrame(() => {
    const items = listEl?.querySelectorAll('[data-completion-item]');
    items?.[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  });
}
</script>

{#if filtered.length > 0}
  <div
    bind:this={listEl}
    class="absolute bottom-full left-0 right-0 mb-1 max-h-48 overflow-auto rounded-lg border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] shadow-lg z-10"
  >
    {#each filtered as cmd, i (cmd.name)}
      <button
        data-completion-item
        class="flex w-full items-start gap-2 px-3 py-2 text-left text-sm transition-colors {i === selectedIndex ? 'bg-[var(--pd-content-card-hover-bg)]' : 'hover:bg-[var(--pd-content-card-hover-bg)]/50'}"
        onmouseenter={(): void => { selectedIndex = i; }}
        onclick={(): void => onselect(cmd)}
      >
        <span class="font-mono font-medium text-[var(--pd-content-header-text)] shrink-0">/{cmd.name}</span>
        <span class="text-[var(--pd-content-text)] opacity-60 truncate">{cmd.description}</span>
        {#if cmd.inputHint}
          <span class="ml-auto text-xs text-[var(--pd-content-text)] opacity-40 shrink-0 italic">{cmd.inputHint}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}
