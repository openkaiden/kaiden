<script lang="ts">
import { faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

export interface NetworkAccessOption {
  value: string;
  name: string;
  description: string;
  access: string;
  notes: string;
  badge?: string;
}

interface Props {
  networkOptions: NetworkAccessOption[];
  selectedNetwork: string;
}

let { networkOptions, selectedNetwork = $bindable() }: Props = $props();

function selectOption(value: string): void {
  selectedNetwork = value;
}
</script>

<div class="flex items-center gap-3 mb-5">
  <div class="w-9 h-9 rounded-[9px] flex items-center justify-center bg-[var(--pd-label-quaternary-bg)] text-[var(--pd-label-quaternary-text)]">
    <Icon icon={faShieldHalved} class="text-xl" />
  </div>
  <div>
    <span class="text-lg font-semibold text-[var(--pd-modal-text)]">Network Policy</span>
    <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 mt-0.5">Outbound network for this workspace sandbox</p>
  </div>
</div>

<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
  {#each networkOptions as option, idx (option.value)}
    {#if idx > 0}
      <div class="mx-3 border-t border-[var(--pd-content-card-border)] opacity-30"></div>
    {/if}
    <button
      class="w-full flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors text-left
        {selectedNetwork === option.value
          ? 'bg-[var(--pd-content-card-hover-inset-bg)]'
          : 'hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
      onclick={selectOption.bind(null, option.value)}
      aria-label={option.name}>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-[13px] font-medium text-[var(--pd-table-body-text-highlight)]">{option.name}</span>
          {#if option.badge}
            <span class="text-[10px] text-[var(--pd-table-body-text)] bg-[var(--pd-content-card-inset-bg)] rounded px-1.5 py-0.5">{option.badge}</span>
          {/if}
        </div>
        <div class="text-[11px] text-[var(--pd-table-body-text)] mt-0.5">{option.description}</div>
      </div>
      <div class="flex items-center gap-4 flex-shrink-0 text-xs text-[var(--pd-table-body-text)]">
        <span class="w-20">{option.access}</span>
        <span class="w-24">{option.notes}</span>
        <input
          type="radio"
          name="networkAccess"
          value={option.value}
          checked={selectedNetwork === option.value}
          aria-label="Use {option.name}"
          class="accent-[var(--pd-button-primary-bg)] w-4 h-4 cursor-pointer pointer-events-none" />
      </div>
    </button>
  {/each}
</div>

<p class="mt-4 text-xs text-[var(--pd-content-card-text)] opacity-70 leading-relaxed max-w-2xl">
  <strong class="text-[var(--pd-modal-text)]">Allowlists and more</strong> — Fine-grained host allowlists and static egress rules live in project or workspace settings when you need them.
</p>
