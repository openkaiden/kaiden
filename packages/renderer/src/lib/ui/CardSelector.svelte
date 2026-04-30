<script lang="ts">
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

export interface CardSelectorOption {
  title: string;
  badge?: string;
  value: string;
  icon?: IconDefinition | string;
  description?: string;
}

interface Props {
  label?: string;
  options: CardSelectorOption[];
  selected?: string;
  required?: boolean;
}

let { label, options, selected = $bindable(''), required = false }: Props = $props();

function handleClick(value: string): void {
  selected = !required && selected === value ? '' : value;
}
</script>

<div class="flex flex-col" role="region" aria-label={label ?? 'Options'}>
  {#if label}
    <span class="block my-2 text-sm font-bold text-[var(--pd-modal-text)]">{label}</span>
  {/if}
  <div class="flex flex-row gap-2 w-full">
    {#each options as option (option.value)}
      <button
        class="rounded-md bg-[var(--pd-content-card-inset-bg)] p-3 flex-1 min-w-0 min-h-24 cursor-pointer
          hover:bg-[var(--pd-content-card-hover-inset-bg)]
          {selected === option.value ? 'border-[var(--pd-content-card-border-selected)]' : 'border-[var(--pd-content-card-border)]'}
          border-2 flex flex-col overflow-hidden"
        aria-label={option.title}
        aria-pressed={selected === option.value}
        onclick={():void => handleClick(option.value)}>
        <div class="flex flex-row items-start gap-2 min-w-0">
          <div class="flex-shrink-0 mt-0.5">
            <div
              class="w-4 h-4 rounded-full border-2 flex items-center justify-center
                {selected === option.value ? 'border-[var(--pd-content-card-border-selected)]' : 'border-[var(--pd-content-card-border)]'}">
              {#if selected === option.value}
                <div class="w-2 h-2 rounded-full bg-[var(--pd-content-card-border-selected)]"></div>
              {/if}
            </div>
          </div>
          <div class="flex-shrink-0 w-5 h-5">
            {#if option.icon}
              <Icon class="text-[var(--pd-content-card-icon)] w-full h-full object-contain" icon={option.icon} size="lg"/>
            {/if}
          </div>
          <div class="text-left min-w-0">
            <div class="text-sm font-medium text-[var(--pd-content-card-text)] truncate">{option.title}</div>
            {#if option.description}
              <div class="text-[11px] text-[var(--pd-content-card-text)] opacity-60 mt-0.5 leading-relaxed line-clamp-2">{option.description}</div>
            {/if}
          </div>
        </div>
        {#if option.badge}
          <div class="flex flex-row grow w-full mt-2 items-end">
            <div class="flex">
              <div
                class="text-[var(--pd-content-card-text)] border-[var(--pd-content-card-border-selected)] border text-xs font-medium me-2 px-2 py-0.5 rounded-xl truncate">
                {option.badge}
              </div>
            </div>
          </div>
        {/if}
      </button>
    {/each}
  </div>
</div>
