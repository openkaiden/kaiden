<script lang="ts" module>
import type { ModelInfo } from '/@api/model-registry-info';

export function groupAndSortModels(models: Array<ModelInfo>): Map<string, Array<ModelInfo>> {
  return new Map(
    Array.from(Map.groupBy(models, ({ providerId, connectionId }) => `${providerId}:${connectionId}`).entries()).map(
      ([key, models]) => [key, models.toSorted((a, b) => a.label.localeCompare(b.label))],
    ),
  );
}
</script>

<script lang="ts">
import type { ClassValue } from 'svelte/elements';

import { cn } from '/@/lib/chat/utils/shadcn';

import CheckCircleFillIcon from './icons/check-circle-fill.svelte';
import ChevronDownIcon from './icons/chevron-down.svelte';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuGroupHeading,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

let {
  class: c,
  models,
  menuSide = 'bottom',
  value = $bindable<ModelInfo | undefined>(),
}: {
  class?: ClassValue;
  value: ModelInfo | undefined;
  models: Array<ModelInfo>;
  menuSide?: 'top' | 'bottom';
} = $props();

let groups: Map<string, Array<ModelInfo>> = $derived(groupAndSortModels(models));

let open = $state(false);
let contentContainer: HTMLElement | null = $state(null);

const selectedChatModelDetails = $derived(
  models
    .values()
    .find(
      model =>
        model.label === value?.label &&
        model.providerId === value?.providerId &&
        model.connectionId === value?.connectionId,
    ),
);

function onSelect(model: ModelInfo): void {
  open = false;
  value = model;
}

// Scroll to the selected model when dropdown opens
$effect(() => {
  if (open && contentContainer) {
    // Use setTimeout to ensure the dropdown is fully rendered before scrolling
    const timeoutId = setTimeout(() => {
      // Re-check conditions before scrolling
      if (open && contentContainer) {
        const activeMenuItem = contentContainer.querySelector('[data-active="true"]');
        if (activeMenuItem) {
          activeMenuItem.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        }
      }
    }, 0);

    // Cleanup function to cancel timeout if dropdown closes or component unmounts
    return (): void => clearTimeout(timeoutId);
  }
});
</script>

<DropdownMenu {open} onOpenChange={(val): boolean => (open = val)}>
	<DropdownMenuTrigger>
		{#snippet child({ props })}
			<Button
				{...props}
				aria-label="Select model"
				variant="outline"
				class={cn(
					'data-[state=open]:bg-accent data-[state=open]:text-accent-foreground w-fit h-8 px-2',
					c
				)}
			>
				{selectedChatModelDetails?.label}
				<ChevronDownIcon />
			</Button>
		{/snippet}
	</DropdownMenuTrigger>
	<DropdownMenuContent bind:ref={contentContainer} align="start" side={menuSide} class="min-w-[300px] max-h-[400px] overflow-y-auto">
    {#each groups.entries() as [key, mModels] (key)}

      <DropdownMenuGroup>
        <DropdownMenuGroupHeading>
          {key}
        </DropdownMenuGroupHeading>
        {#each mModels as model (model.label)}
          <DropdownMenuItem
            onSelect={onSelect.bind(undefined, model)}
            class="group/item flex flex-row items-center justify-between gap-4"
            data-active={model.label === value?.label && model.providerId === value?.providerId && model.connectionId === value?.connectionId}
          >
            <div class="flex flex-col items-start gap-1">
              <div>{model.label}</div>
            </div>

            <div
              class="text-foreground dark:text-foreground opacity-0 group-data-[active=true]/item:opacity-100"
            >
              <CheckCircleFillIcon />
            </div>
          </DropdownMenuItem>
        {/each}
        <DropdownMenuSeparator/>
      </DropdownMenuGroup>
    {/each}
	</DropdownMenuContent>
</DropdownMenu>
