<script lang="ts" generics="T">
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faKey } from '@fortawesome/free-solid-svg-icons/faKey';
import type { components } from '@openkaiden/mcp-registry-types';
import Fa from 'svelte-fa';

import InputArgumentWithVariables from '/@/kaiden/lib/mcp/setup/InputArgumentWithVariables.svelte';

interface Props {
  title: string;
  description?: string;
  /**
   * Arguments must have a key to be unique.
   * E.g. header name is considered unique, as multiple headers cannot have the same name
   */
  args: Array<components['schemas']['InputWithVariables'] & { name?: string; key: T }>;
  updateArgumentValue(key: T, value: string): void;
  updateArgumentVariableValue(key: T, variable: string, value: string): void;
  icon?: IconDefinition;
}

let { title, description, icon = faKey, args, updateArgumentValue, updateArgumentVariableValue }: Props = $props();
</script>

<div class="bg-[var(--pd-content-bg)] rounded-md flex flex-col p-2 space-y-2">
  <div class="flex flex-row items-center gap-x-2">
    <Fa icon={icon} />
    <label for="runtime-arguments" class="text-xl font-bold text-[var(--pd-content-card-header-text)]">{title}</label>
  </div>

  {#if description}
    <span>{description}</span>
  {/if}

  {#each args as argument (argument.key)}
    {#if 'name' in argument}
      <label for="{title}-argument-{argument.name}" class="text-xl font-bold text-[var(--pd-content-card-header-text)]">{argument.name} {argument.isRequired ? '*' : ''}</label>
    {/if}
    <div class="border-2 border-dashed rounded-md p-4">
      <InputArgumentWithVariables
        onChange={updateArgumentValue.bind(undefined, argument.key)}
        onVariableChange={updateArgumentVariableValue.bind(undefined, argument.key)}
        object={argument}
      />
    </div>
  {/each}
</div>
