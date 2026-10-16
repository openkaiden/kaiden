<script lang="ts">
import type { components } from '@openkaiden/mcp-registry-types';
import { Input } from '@podman-desktop/ui-svelte';

import InputArgument from '/@/kaiden/lib/mcp/setup/InputArgument.svelte';
import Markdown from '/@/lib/markdown/Markdown.svelte';

interface Props {
  object: components['schemas']['InputWithVariables'];
  onChange: (value: string) => void;
  onVariableChange: (variable: string, value: string) => void;
}

let { object, onChange, onVariableChange }: Props = $props();

let variables: Array<[string, components['schemas']['Input']]> = Object.entries(object.variables ?? {});
</script>

<!-- no variable => let's use InputArgument directly -->
{#if variables.length === 0}
  <InputArgument onChange={onChange} object={{...object, value: object.value ?? object.default}} />
{:else if object.value}
  <InputArgument onChange={onChange} object={object} readonly />
{/if}

{#if variables.length > 0}
  <label for="variables" class="text-xl font-bold text-[var(--pd-content-card-header-text)]">Variables</label>
  {#each variables as [key, value] (key)}
    <div class="flex flex-col p-2 gap-2">
      <div class="grid grid-cols-2 gap-4">
        <!-- variable name -->
        <div class="flex flex-col">
          <label for="variable-{key}-name" class="text-base font-bold text-[var(--pd-content-card-header-text)]">Name</label>
          <Input readonly value={key}/>
        </div>

        <!-- variable value input -->
        <div class="flex flex-col">
          <label for="variable-{key}-value"  class="text-base font-bold text-[var(--pd-content-card-header-text)]">Value</label>
          <InputArgument placeholder={value.default} onChange={onVariableChange.bind(undefined, key)} object={{...value, description: undefined }} />
        </div>
      </div>
      <Markdown markdown={value.description}/>
    </div>
  {/each}
{/if}
