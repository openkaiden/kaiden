<script lang="ts">
import type { MCPTarget } from '/@/kaiden/lib/mcp/setup/mcp-target';

interface Props {
  targets: Array<MCPTarget>;
  selected: MCPTarget | undefined;
}

let { targets, selected = $bindable() }: Props = $props();
</script>

<select
  class="text-sm rounded-lg block w-full p-2.5 bg-[var(--pd-dropdown-bg)] pl-6 border-r-8 border-transparent outline"
  bind:value={selected}
  name="mcp type"
  >
  {#each targets as target, index (index)}
    {#if 'url' in target}
      <option value={target}>{target.url} (remote)</option>
    {:else}
      <option value={target}>{target.identifier} (local)</option>
    {/if}
  {/each}
</select>
