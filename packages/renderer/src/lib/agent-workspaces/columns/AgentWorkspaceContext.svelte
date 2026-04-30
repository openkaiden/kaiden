<script lang="ts">
import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

const statusLabel = $derived(object.state.charAt(0).toUpperCase() + object.state.slice(1));

const dotColor = $derived(
  object.state === 'running'
    ? 'bg-[var(--pd-status-running)]'
    : object.state === 'starting' || object.state === 'stopping'
      ? 'bg-[var(--pd-status-waiting)]'
      : 'bg-[var(--pd-status-terminated)]',
);

const textColor = $derived(
  object.state === 'running'
    ? 'text-[var(--pd-status-running)]'
    : object.state === 'starting' || object.state === 'stopping'
      ? 'text-[var(--pd-status-waiting)]'
      : 'text-[var(--pd-table-body-text)] opacity-60',
);
</script>

<div class="flex flex-col gap-1.5 overflow-hidden max-w-full">
  <span class="text-(--pd-table-body-text) opacity-40 text-xs">—</span>
  <div class="flex items-center gap-1.5">
    <span class="w-[7px] h-[7px] rounded-full shrink-0 {dotColor}"></span>
    <span class="text-xs font-medium {textColor}">{statusLabel}</span>
  </div>
</div>
