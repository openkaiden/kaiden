<script lang="ts">
import { router } from 'tinro';

import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

function openDetails(): void {
  router.goto(`/agent-workspaces/${encodeURIComponent(object.id)}/summary`);
}
</script>

<button class="flex flex-col whitespace-nowrap max-w-full items-start" onclick={openDetails}>
  <div
    class="text-[var(--pd-table-body-text-highlight)] text-[13px] font-medium leading-normal overflow-hidden text-ellipsis group-hover:text-[var(--pd-link)]"
    title={object.name}>
    {object.name}
  </div>
  <div class="text-(--pd-content-text) opacity-70 text-sm overflow-hidden text-ellipsis">
    {#if object.model}{object.model} - {/if}{object.paths.source}
  </div>
</button>
