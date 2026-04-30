<script lang="ts">
import Fa from 'svelte-fa';
import { router } from 'tinro';

import { getAgentDefinition } from '/@/lib/guided-setup/agent-registry';
import Badge from '/@/lib/ui/Badge.svelte';
import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

const agentDef = $derived(getAgentDefinition(object.agent));
const agentLabel = $derived(agentDef.title);

function openDetails(): void {
  router.goto(`/agent-workspaces/${encodeURIComponent(object.id)}/summary`);
}
</script>

<div class="flex items-start gap-3 overflow-hidden max-w-full">
  <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 {agentDef.colorClass}">
    <Fa icon={agentDef.icon} size="0.9x" color="#fff" />
  </div>
  <div class="flex flex-col gap-1 overflow-hidden min-w-0">
    <button class="items-start" onclick={openDetails}>
      <span
        class="text-(--pd-table-body-text-highlight) text-[14px] font-semibold leading-normal overflow-hidden text-ellipsis whitespace-nowrap"
        title={object.name}>
        {object.name}
      </span>
    </button>
    <div class="flex items-center gap-1.5 flex-wrap">
      <Badge class="text-white" color="bg-(--pd-badge-sky)" label={agentLabel} />
    </div>
  </div>
</div>
