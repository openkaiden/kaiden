<script lang="ts">
import { agentDefinitions } from '/@/lib/guided-setup/agent-registry';
import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

const definitionsByAgent = new Map<string, (typeof agentDefinitions)[number]>(
  agentDefinitions.map(d => [d.cliName, d]),
);

let definition = $derived(definitionsByAgent.get(object.agent));
</script>

<div class="flex items-center justify-center" title={object.agent}>
  {#if definition?.iconComponent}
    <definition.iconComponent size={28} />
  {/if}
</div>
