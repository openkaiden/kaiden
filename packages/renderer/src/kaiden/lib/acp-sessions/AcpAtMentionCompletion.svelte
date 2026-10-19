<script lang="ts">
import { faPaperclip } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

interface Props {
  query: string;
  onselect: () => void;
  oncancel: () => void;
}

let { query, onselect, oncancel }: Props = $props();

const visible = $derived(!/\s/.test(query));

export function handleKey(e: KeyboardEvent): boolean {
  if (!visible) return false;

  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    onselect();
    return true;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    oncancel();
    return true;
  }
  return false;
}
</script>

{#if visible}
  <div class="absolute bottom-full left-0 right-0 mb-1 rounded-lg border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] shadow-lg z-10">
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm bg-[var(--pd-content-card-hover-bg)] transition-colors"
      onclick={(): void => onselect()}
    >
      <Icon icon={faPaperclip} class="text-xs text-[var(--pd-content-text)] opacity-60" />
      <span class="text-[var(--pd-content-header-text)]">Attach file…</span>
      <span class="ml-auto text-xs text-[var(--pd-content-text)] opacity-40 italic">Browse files</span>
    </button>
  </div>
{/if}
