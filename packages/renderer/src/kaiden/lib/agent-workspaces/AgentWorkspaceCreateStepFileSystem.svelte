<script lang="ts">
import { faFolderOpen, faPlus, faShieldHalved } from '@fortawesome/free-solid-svg-icons';
import { Button, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

export interface FileAccessOption {
  value: string;
  name: string;
  description: string;
  access: string;
  notes: string;
  badge?: string;
}

export interface CustomMount {
  host: string;
  target: string;
  ro: boolean;
}

export const fileAccessOptions: FileAccessOption[] = [
  {
    value: 'workspace',
    name: 'No host filesystem access',
    description: 'The agent cannot read or write files on your host. Use for API-only or fully remote workflows.',
    access: 'None',
    notes: 'Strict isolation',
    badge: 'Recommended',
  },
  {
    value: 'custom',
    name: 'Custom Paths',
    description: 'Specify exact directories the agent can access.',
    access: 'Listed paths',
    notes: 'Set path below',
  },
];

interface Props {
  selectedFileAccess: string;
  customMounts: CustomMount[];
  onBrowseCustomPath: (index: number) => Promise<void>;
  onAddCustomMount: () => void;
  onRemoveCustomMount: (index: number) => void;
  onUpdateCustomMount: (index: number, field: keyof CustomMount, value: string | boolean) => void;
  onchange?: (selected: string) => void;
}

let {
  selectedFileAccess = $bindable(),
  customMounts,
  onBrowseCustomPath,
  onAddCustomMount,
  onRemoveCustomMount,
  onUpdateCustomMount,
  onchange,
}: Props = $props();

function selectOption(value: string): void {
  selectedFileAccess = value;
  onchange?.(value);
}
</script>

<div class="flex items-center gap-3 mb-5">
  <div class="w-9 h-9 rounded-[9px] flex items-center justify-center bg-[var(--pd-label-quaternary-bg)] text-[var(--pd-label-quaternary-text)]">
    <Icon icon={faShieldHalved} class="text-xl" />
  </div>
  <div>
    <span class="text-lg font-semibold text-[var(--pd-modal-text)]">File System Access</span>
    <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 mt-0.5">Pick one scope for agent read/write on the host</p>
  </div>
</div>

<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden">
  {#each fileAccessOptions as option, idx (option.value)}
    {#if idx > 0}
      <div class="mx-3 border-t border-[var(--pd-content-card-border)] opacity-30"></div>
    {/if}
    <button
      class="w-full flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors text-left
        {selectedFileAccess === option.value
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
          name="fileAccess"
          value={option.value}
          checked={selectedFileAccess === option.value}
          aria-label="Use {option.name}"
          class="accent-[var(--pd-button-primary-bg)] w-4 h-4 cursor-pointer pointer-events-none" />
      </div>
    </button>
  {/each}
</div>

{#if selectedFileAccess === 'custom'}
  <div class="mt-4 p-4 rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)]">
    <p class="text-xs text-[var(--pd-content-card-text)] opacity-70 mb-3">Mount host directories into the workspace. Target is optional (defaults to the host path).</p>
    {#each customMounts as mount, index (index)}
      <div class="flex flex-col gap-2 mb-3 p-3 rounded-lg bg-[var(--pd-content-card-inset-bg)] border border-[var(--pd-content-card-border)]">
        <div class="flex gap-3 items-center">
          <div class="flex-1 min-w-0">
            <span class="text-[11px] text-[var(--pd-table-body-text)] mb-1 block">Host path</span>
            <div class="flex gap-2 items-center">
              <Input
                value={mount.host}
                placeholder="/path/on/host"
                class="flex-1 font-mono text-sm"
                aria-label="Host path {index + 1}"
                oninput={(e: Event): void => onUpdateCustomMount(index, 'host', (e.target as HTMLInputElement).value)}
              />
              <Button onclick={(): Promise<void> => onBrowseCustomPath(index)} aria-label="Browse for directory" icon={faFolderOpen} />
            </div>
          </div>
        </div>
        <div class="flex gap-3 items-end">
          <div class="flex-1 min-w-0">
            <span class="text-[11px] text-[var(--pd-table-body-text)] mb-1 block">Target path in workspace</span>
            <Input
              value={mount.target}
              placeholder="Leave empty to use host path"
              class="flex-1 font-mono text-sm"
              aria-label="Target path {index + 1}"
              oninput={(e: Event): void => onUpdateCustomMount(index, 'target', (e.target as HTMLInputElement).value)}
            />
          </div>
          <Button
            type="secondary"
            aria-label="Toggle read-only for mount {index + 1}"
            onclick={(): void => onUpdateCustomMount(index, 'ro', !mount.ro)}>
            {mount.ro ? 'read-only' : 'read-write'}
          </Button>
          {#if customMounts.length > 1}
            <Button aria-label="Remove mount {index + 1}" onclick={(): void => onRemoveCustomMount(index)}>Remove</Button>
          {/if}
        </div>
      </div>
    {/each}
    <Button class="mt-2" icon={faPlus} onclick={onAddCustomMount}>Add Another Mount</Button>
  </div>
{/if}
