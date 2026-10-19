<script lang="ts">
import type { SandboxInfo } from '/@api/openshell-gateway-info';

interface Props {
  object: SandboxInfo;
}

let { object }: Props = $props();

// Map "Ready" phase to "Running" for display
const statusLabel = $derived(
  object.phase.toLowerCase() === 'ready' ? 'Running' : object.phase.charAt(0).toUpperCase() + object.phase.slice(1),
);

const phaseCategory = $derived(
  object.phase.toLowerCase() === 'ready' || object.phase.toLowerCase() === 'running'
    ? 'running'
    : object.phase.toLowerCase() === 'pending' || object.phase.toLowerCase() === 'creating'
      ? 'waiting'
      : 'terminated',
);

const dotColor = $derived(
  phaseCategory === 'running'
    ? 'bg-[var(--pd-status-running)]'
    : phaseCategory === 'waiting'
      ? 'bg-[var(--pd-status-waiting)]'
      : 'bg-[var(--pd-status-terminated)]',
);

const textColor = $derived(
  phaseCategory === 'running'
    ? 'text-[var(--pd-status-running)]'
    : phaseCategory === 'waiting'
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
