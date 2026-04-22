<script lang="ts">
import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

const statusColor = $derived(
  object.state === 'running'
    ? 'text-[var(--pd-status-running)]'
    : object.state === 'starting' || object.state === 'stopping'
      ? 'text-[var(--pd-status-waiting)]'
      : 'text-[var(--pd-status-terminated)]',
);

const label = $derived(object.state.charAt(0).toUpperCase() + object.state.slice(1));
</script>

<div
  class="overflow-hidden text-ellipsis whitespace-nowrap max-w-full {statusColor}"
  title={label}>
  {label}
</div>
