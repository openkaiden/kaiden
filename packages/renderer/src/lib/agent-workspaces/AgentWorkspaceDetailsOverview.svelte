<script lang="ts">
import {
  faCode,
  faFolder,
  faServer,
  faShieldHalved,
  faTableCellsLarge,
  faWrench,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';

interface Props {
  workspaceSummary: AgentWorkspaceSummaryUI | undefined;
  configuration: AgentWorkspaceConfiguration;
}

let { workspaceSummary, configuration }: Props = $props();

const stateColor = $derived(
  workspaceSummary?.state === 'running'
    ? 'text-[var(--pd-status-running)]'
    : workspaceSummary?.state === 'starting' || workspaceSummary?.state === 'stopping'
      ? 'text-[var(--pd-status-waiting)]'
      : 'text-[var(--pd-status-terminated)]',
);

const sandboxLabel = $derived(
  workspaceSummary?.state === 'running'
    ? 'Sandbox Active'
    : workspaceSummary?.state === 'starting' || workspaceSummary?.state === 'stopping'
      ? 'Sandbox Starting'
      : 'Sandbox Stopped',
);

const sandboxColor = $derived(
  workspaceSummary?.state === 'running'
    ? 'var(--pd-status-running)'
    : workspaceSummary?.state === 'starting' || workspaceSummary?.state === 'stopping'
      ? 'var(--pd-status-waiting)'
      : 'var(--pd-status-terminated)',
);

const skillsList = $derived(configuration?.skills ?? []);
const mcpServersList = $derived([...(configuration?.mcp?.servers ?? []), ...(configuration?.mcp?.commands ?? [])]);
const mountsList = $derived(configuration?.mounts ?? []);

const filesystemBadge = $derived.by(() => {
  const mounts = configuration?.mounts ?? [];
  if (mounts.length === 0) return 'Strict';
  const hasHomeMnt = mounts.some(m => m.host === '$HOME' || m.target === '$HOME');
  if (hasHomeMnt) return 'Home';
  return 'Custom';
});
</script>

<div class="px-5 py-4 h-full overflow-auto">
  <div class="flex flex-col gap-4 max-w-[1400px] mx-auto">
    <!-- Agent Profile Card -->
    <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
      <div class="flex items-center gap-3.5 mb-3">
        <div
          class="w-10 h-10 rounded-[10px] flex items-center justify-center text-base font-bold shrink-0 bg-[var(--pd-status-running)] text-white">
          {workspaceSummary?.agent?.charAt(0).toUpperCase() ?? 'W'}
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-[15px] font-semibold text-[var(--pd-content-card-header-text)] m-0 mb-0.5">
            {workspaceSummary?.agent ?? ''}
          </h2>
          {#if workspaceSummary?.model}
            <p class="text-xs text-[var(--pd-link)] m-0">
              {workspaceSummary.model}
            </p>
          {/if}
        </div>
        <div
          class="inline-flex items-center gap-1.5 py-1 px-2.5 rounded-lg border shrink-0"
          style="background: color-mix(in srgb, {sandboxColor} 10%, transparent); border-color: color-mix(in srgb, {sandboxColor} 20%, transparent);">
          <span style="color: {sandboxColor}"><Icon icon={faShieldHalved} size="sm" /></span>
          <span class="text-[11px] font-medium" style="color: {sandboxColor}">{sandboxLabel}</span>
        </div>
      </div>
      {#if workspaceSummary?.project}
        <p class="text-[13px] text-[var(--pd-content-text)] leading-relaxed m-0">
          Project: {workspaceSummary.project}
        </p>
      {/if}
    </div>

    <!-- Details Card -->
    <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
      <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2 mb-3.5">
        Details
      </h3>
      <div class="flex gap-6">
        <div class="flex flex-col gap-0.5">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Status</div>
          <div class="text-[13px] font-semibold {stateColor}">
            {workspaceSummary?.state ?? 'unknown'}
          </div>
        </div>
        <div class="flex flex-col gap-0.5">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Started</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">-</div>
        </div>
        <div class="flex flex-col gap-0.5">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Directory</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {workspaceSummary?.paths.source ?? '-'}
          </div>
        </div>
        <div class="flex flex-col gap-0.5">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Modified</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">-</div>
        </div>
      </div>
    </div>

    <!-- Resources Strip -->
    <div class="flex gap-3">
      <!-- Skills Card -->
      <div class="flex-1 bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
        <div class="flex justify-between items-center mb-3.5">
          <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2">
            <Icon icon={faCode} size="sm" class="text-[var(--pd-link)]" />
            Skills
          </h3>
          <span
            class="text-[11px] font-semibold py-0.5 px-2 rounded-[10px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] text-[var(--pd-link)]">
            {skillsList.length}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if skillsList.length > 0}
            {#each skillsList as skill (skill)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-running)]/15 text-[var(--pd-status-running)]">
                  <Icon icon={faWrench} size="sm" />
                </div>
                <div class="flex-1 flex items-center gap-2">
                  <span class="text-[13px] font-medium text-[var(--pd-content-card-header-text)]">{skill}</span>
                  <span class="text-[11px] text-[var(--pd-status-running)]">Active</span>
                </div>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No skills configured</p>
          {/if}
        </div>
      </div>

      <!-- MCP Servers Card -->
      <div class="flex-1 bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
        <div class="flex justify-between items-center mb-3.5">
          <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2">
            <Icon icon={faTableCellsLarge} size="sm" class="text-[var(--pd-link)]" />
            MCP Servers
          </h3>
          <span
            class="text-[11px] font-semibold py-0.5 px-2 rounded-[10px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] text-[var(--pd-link)]">
            {mcpServersList.length}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if mcpServersList.length > 0}
            {#each mcpServersList as server (server.name)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-link)]/15 text-[var(--pd-link)]">
                  <Icon icon={faServer} size="sm" />
                </div>
                <div class="flex-1 flex items-center gap-2">
                  <span class="text-[13px] font-medium text-[var(--pd-content-card-header-text)]">{server.name}</span>
                  <span class="text-[11px] text-[var(--pd-status-running)]">Connected</span>
                </div>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No MCP servers configured</p>
          {/if}
        </div>
      </div>

      <!-- Filesystem Card -->
      <div class="flex-1 bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
        <div class="flex justify-between items-center mb-3.5">
          <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2">
            <Icon icon={faFolder} size="sm" class="text-[var(--pd-link)]" />
            Filesystem
          </h3>
          <span
            class="text-[11px] font-semibold py-0.5 px-2 rounded-[10px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] text-[var(--pd-link)]">
            {filesystemBadge}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if workspaceSummary?.paths.source}
            <div
              class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent">
              <div
                class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-amber-500/15 text-amber-400">
                <Icon icon={faFolder} size="sm" />
              </div>
              <div class="flex-1 flex items-center gap-2">
                <span class="text-[13px] font-medium text-[var(--pd-content-card-header-text)]">
                  {workspaceSummary.paths.source}
                </span>
                <span class="text-[11px] text-[var(--pd-status-running)]">read-write</span>
              </div>
            </div>
          {/if}
          {#each mountsList as mount (`${mount.host}:${mount.target}`)}
            <div
              class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent">
              <div
                class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-amber-500/15 text-amber-400">
                <Icon icon={faFolder} size="sm" />
              </div>
              <div class="flex-1 flex items-center gap-2">
                <span class="text-[13px] font-medium text-[var(--pd-content-card-header-text)]">
                  {mount.target}
                </span>
                <span class="text-[11px] {mount.ro ? 'text-[var(--pd-content-text)] opacity-60' : 'text-[var(--pd-status-running)]'}">
                  {mount.ro ? 'read-only' : 'read-write'}
                </span>
              </div>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
