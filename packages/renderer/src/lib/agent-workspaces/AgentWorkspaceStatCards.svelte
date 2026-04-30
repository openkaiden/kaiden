<script lang="ts">
import { faCirclePlay, faRobot, faTableCells } from '@fortawesome/free-solid-svg-icons';
import Fa from 'svelte-fa';

import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

import { isActiveWorkspace } from './workspace-utils';

interface Props {
  workspaces: AgentWorkspaceSummaryUI[];
}

let { workspaces }: Props = $props();

const activeCount = $derived(workspaces.filter(isActiveWorkspace).length);
const totalCount = $derived(workspaces.length);
const agentCount = $derived(new Set(workspaces.map(ws => ws.agent)).size);
</script>

<div class="grid grid-cols-3 gap-3.5 mb-5">
  <div class="flex items-center gap-3.5 py-[18px] px-5 bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-xl">
    <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--pd-status-running)_15%,transparent)] text-[var(--pd-status-running)]">
      <Fa icon={faCirclePlay} size="1.1x" />
    </div>
    <div class="flex flex-col">
      <span class="text-4xl font-bold text-[var(--pd-content-text)]">{activeCount}</span>
      <span class="text-base text-[var(--pd-content-text)] opacity-60">Active Sessions</span>
    </div>
  </div>

  <div class="flex items-center gap-3.5 py-[18px] px-5 bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-xl">
    <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--pd-status-waiting)_15%,transparent)] text-[var(--pd-status-waiting)]">
      <Fa icon={faTableCells} size="1.1x" />
    </div>
    <div class="flex flex-col">
      <span class="text-4xl font-bold text-[var(--pd-content-text)]">{totalCount}</span>
      <span class="text-base text-[var(--pd-content-text)] opacity-60">Total Sessions</span>
    </div>
  </div>

  <div class="flex items-center gap-3.5 py-[18px] px-5 bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-xl">
    <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[color-mix(in_srgb,var(--pd-link)_15%,transparent)] text-[var(--pd-link)]">
      <Fa icon={faRobot} size="1.1x" />
    </div>
    <div class="flex flex-col">
      <span class="text-4xl font-bold text-[var(--pd-content-text)]">{agentCount}</span>
      <span class="text-base text-[var(--pd-content-text)] opacity-60">Configured Agents</span>
    </div>
  </div>
</div>
