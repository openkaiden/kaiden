<script lang="ts">
import { faCirclePlay, faRobot, faTableCells } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import Card from '/@/kaiden/lib/components/Card.svelte';
import type { SandboxInfoWithGateway } from '/@/kaiden/stores/openshell-sandboxes';

import { getAgentId } from './workspace-utils';

interface Props {
  sandboxes: SandboxInfoWithGateway[];
}

let { sandboxes }: Props = $props();

const activeSandboxCount = $derived(
  sandboxes.filter(s => s.phase.toLowerCase() === 'ready' || s.phase.toLowerCase() === 'running').length,
);

const configuredAgentCount = $derived(new Set(sandboxes.map(getAgentId).filter(Boolean)).size);
</script>

<div class="grid grid-cols-3 gap-3.5 mb-5">
  <Card class="flex items-center gap-3.5 py-[18px] px-5">
    <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--pd-status-running)_15%,transparent)] text-[var(--pd-status-running)]">
      <Icon icon={faCirclePlay} size="1.1x" />
    </div>
    <div class="flex flex-col">
      <span class="text-4xl font-bold text-[var(--pd-content-text)]">{activeSandboxCount}</span>
      <span class="text-base text-[var(--pd-content-text)] opacity-60">Active Sessions</span>
    </div>
  </Card>

  <Card class="flex items-center gap-3.5 py-[18px] px-5">
    <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--pd-status-waiting)_15%,transparent)] text-[var(--pd-status-waiting)]">
      <Icon icon={faTableCells} size="1.1x" />
    </div>
    <div class="flex flex-col">
      <span class="text-4xl font-bold text-[var(--pd-content-text)]">{sandboxes.length}</span>
      <span class="text-base text-[var(--pd-content-text)] opacity-60">Total Sessions</span>
    </div>
  </Card>

  <Card class="flex items-center gap-3.5 py-[18px] px-5">
    <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--pd-link)_15%,transparent)] text-[var(--pd-link)]">
      <Icon icon={faRobot} size="1.1x" />
    </div>
    <div class="flex flex-col">
      <span class="text-4xl font-bold text-[var(--pd-content-text)]">{configuredAgentCount}</span>
      <span class="text-base text-[var(--pd-content-text)] opacity-60">Configured Agents</span>
    </div>
  </Card>
</div>
