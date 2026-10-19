<script lang="ts">
import { faPlus, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { Button, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

export interface NetworkAccessOption {
  value: string;
  name: string;
  description: string;
  access: string;
  notes: string;
  badge?: string;
  disabled?: boolean;
}

const networkOptions: NetworkAccessOption[] = [
  {
    value: 'blocked',
    name: 'Deny All',
    description: 'No outbound HTTP/HTTPS from the sandbox.',
    access: 'None',
    notes: 'Strict',
    disabled: false,
  },
  {
    value: 'registries',
    name: 'Developer Preset',
    description: 'Allow npm, PyPI, and similar registries — not arbitrary public hosts.',
    access: 'Registries',
    notes: 'Balanced default',
    badge: 'Recommended',
    disabled: false,
  },
  {
    value: 'agent_mode',
    name: 'Agent mode',
    description: 'The agent requests each outbound access; you approve before traffic leaves the sandbox.',
    access: 'Per request',
    notes: 'Human in the loop',
    disabled: true,
  },
];

/** Shown only for existing workspaces with mode: allow — not selectable for new configs. */
const legacyAllowAllOutboundOption: NetworkAccessOption = {
  value: 'open',
  name: 'Allow all outbound',
  description: 'No outbound allowlist. The sandbox stays isolated from the host.',
  access: 'All hosts',
  notes: 'Legacy',
  disabled: true,
};

interface Props {
  selectedNetwork: string;
  customHosts: string[];
  onAddCustomHost: () => void;
  onRemoveCustomHost: (index: number) => void;
  onUpdateCustomHost: (index: number, value: string) => void;
  onchange?: (selected: string) => void;
}

let {
  selectedNetwork = $bindable(),
  customHosts,
  onAddCustomHost,
  onRemoveCustomHost,
  onUpdateCustomHost,
  onchange,
}: Props = $props();

let displayedNetworkOptions = $derived(
  selectedNetwork === 'open' ? [...networkOptions, legacyAllowAllOutboundOption] : networkOptions,
);

let showCustomHosts = $derived(selectedNetwork === 'blocked' || selectedNetwork === 'registries');
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
  {#each displayedNetworkOptions as option, idx (option.value)}
    {#if idx > 0}
      <div class="mx-3 border-t border-[var(--pd-content-card-border)] opacity-30"></div>
    {/if}
    <label
      class="w-full flex items-center gap-3 px-4 py-3 transition-colors text-left
        {option.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        {selectedNetwork === option.value
          ? 'bg-[var(--pd-content-card-hover-inset-bg)]'
          : option.disabled ? '' : 'hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
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
          bind:group={selectedNetwork}
          disabled={option.disabled}
          onchange={(): void => onchange?.(option.value)}
          aria-label="Use {option.name}"
          class="accent-[var(--pd-button-primary-bg)] w-4 h-4 {option.disabled ? 'cursor-not-allowed' : 'cursor-pointer'}" />
      </div>
    </label>
  {/each}
</div>

{#if showCustomHosts}
  <div class="mt-4 p-4 rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)]">
    <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 mb-3">
      Additional destinations to allow outbound access to. Add an optional port with <code>host:port</code>; destinations without a port allow HTTP and HTTPS.
    </p>
    {#each customHosts as host, index (index)}
      <div class="flex gap-3 mb-2 items-center">
        <Input
          value={host}
          placeholder="e.g. api.example.com"
          class="flex-1 font-mono text-sm"
          aria-label="Custom host {index + 1}"
          oninput={(e: Event): void => onUpdateCustomHost(index, (e.target as HTMLInputElement).value)}
        />
        {#if customHosts.length > 1}
          <Button onclick={(): void => onRemoveCustomHost(index)} aria-label="Remove host {index + 1}">Remove</Button>
        {/if}
      </div>
    {/each}
    <Button class="mt-2" icon={faPlus} onclick={onAddCustomHost}>Add Another Host</Button>
  </div>
{:else}
  <p class="mt-4 text-xs text-[var(--pd-content-card-text)] opacity-70 leading-relaxed max-w-2xl">
    <strong class="text-[var(--pd-modal-text)]">Allowlists and more</strong> — Fine-grained host allowlists and static egress rules live in project or workspace settings when you need them.
  </p>
{/if}
