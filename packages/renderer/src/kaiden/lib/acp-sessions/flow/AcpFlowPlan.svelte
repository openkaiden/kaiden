<script lang="ts">
import { faCheck, faCircleNotch, faLock, faMinus } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { AcpFlowPlanEvent, AcpPlanStep } from '/@api/acp-session-info';

interface Props {
  event: AcpFlowPlanEvent;
}

let { event }: Props = $props();

function stepIcon(step: AcpPlanStep): typeof faCheck {
  switch (step.state) {
    case 'done':
      return faCheck;
    case 'running':
      return faCircleNotch;
    case 'blocked':
      return faLock;
    default:
      return faMinus;
  }
}

function stepColor(step: AcpPlanStep): string {
  switch (step.state) {
    case 'done':
      return 'text-[var(--pd-status-running)]';
    case 'running':
      return 'text-[var(--pd-status-waiting)] animate-spin';
    case 'blocked':
      return 'text-[var(--pd-status-dead)]';
    default:
      return 'text-[var(--pd-content-text)] opacity-40';
  }
}
</script>

<div class="rounded-lg border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] px-4 py-3">
  <div class="flex items-center justify-between mb-3">
    <span class="text-sm font-medium text-[var(--pd-content-text)]">Plan</span>
    <span class="text-xs text-[var(--pd-content-text)] opacity-60">{event.progress}%</span>
  </div>

  <div class="w-full h-1.5 rounded-full bg-[var(--pd-content-divider)] mb-3 overflow-hidden">
    <div class="h-full rounded-full bg-[var(--pd-status-running)] transition-all" style="width: {event.progress}%"></div>
  </div>

  <div class="flex flex-col gap-1.5">
    {#each event.steps as step (step.title)}
      <div class="flex items-center gap-2 text-sm">
        <Icon icon={stepIcon(step)} class="{stepColor(step)} text-xs" />
        <span class="text-[var(--pd-content-text)]" class:opacity-50={step.state === 'queued'}>{step.title}</span>
      </div>
    {/each}
  </div>
</div>
