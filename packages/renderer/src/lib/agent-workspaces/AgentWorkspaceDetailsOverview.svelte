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

import { getAgentIcon } from '/@/lib/agent-workspaces/agent-utis';
import IconImage from '/@/lib/appearance/IconImage.svelte';
import { getModelId } from '/@/lib/models/models-utils';
import { agentInfos } from '/@/stores/agents';
import { catalogModels } from '/@/stores/models';
import type { SandboxInfoWithGateway } from '/@/stores/openshell-sandboxes';
import { skillInfos } from '/@/stores/skills';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';

import { getAgentId, getReferenceTime, isActiveWorkspace } from './workspace-utils';

interface Props {
  workspaceSummary: SandboxInfoWithGateway | undefined;
  configuration: AgentWorkspaceConfiguration;
}

let { workspaceSummary, configuration }: Props = $props();

const agentDef = $derived(getAgentId(workspaceSummary) ?? '');
const agentInfo = $derived(workspaceSummary ? $agentInfos.find(a => a.id === agentDef) : undefined);

const resolvedModel = $derived(
  // eslint-disable-next-line no-constant-condition
  false ? $catalogModels.find(m => getModelId(m) === '') : undefined,
);

const modelDisplayName = $derived.by(() => {
  if (!resolvedModel) return 'Not available';
  const name = resolvedModel.llmMetadata?.name;
  if (name) return `${name.charAt(0).toUpperCase()}${name.slice(1)} · ${resolvedModel.label}`;
  return resolvedModel.label;
});

const statusStyle = $derived.by(() => {
  const state = workspaceSummary?.phase;
  if (state === 'Ready') {
    return {
      stateColor: 'text-[var(--pd-status-running)]',
      sandboxLabel: 'Sandbox Active',
      sandboxColor: 'var(--pd-status-running)',
    };
  }
  if (state === 'Provisioning') {
    return {
      stateColor: 'text-[var(--pd-status-waiting)]',
      sandboxLabel: 'Sandbox Starting',
      sandboxColor: 'var(--pd-status-waiting)',
    };
  }
  if (state === 'Deleting') {
    return {
      stateColor: 'text-[var(--pd-status-terminated)]',
      sandboxLabel: 'Sandbox Stopping',
      sandboxColor: 'var(--pd-status-terminated)',
    };
  }
  return {
    stateColor: 'text-[var(--pd-status-terminated)]',
    sandboxLabel: 'Sandbox Stopped',
    sandboxColor: 'var(--pd-status-terminated)',
  };
});

const referenceTime = $derived(workspaceSummary ? getReferenceTime(workspaceSummary) : undefined);
const timeLabel = $derived(workspaceSummary && isActiveWorkspace(workspaceSummary) ? 'Started' : 'Created');

const networkMode = $derived(configuration?.network?.mode ?? 'deny');
const networkHosts = $derived(configuration?.network?.hosts ?? []);
const networkLabel = $derived.by(() => {
  if (networkMode === 'allow') return 'Allow all outbound';
  if (networkHosts.length > 0) return 'Developer Preset';
  return 'Deny All';
});

const skillsList = $derived(
  (configuration?.skills ?? []).map(path => {
    const match = $skillInfos.find(s => s.path === path);
    return match?.name ?? path;
  }),
);
const mcpServersList = $derived([
  ...(configuration?.mcp?.servers ?? []).map(s => ({ ...s, _key: `server:${s.name}` })),
  ...(configuration?.mcp?.commands ?? []).map(c => ({ ...c, _key: `command:${c.name}` })),
]);
const mountsList = $derived(configuration?.mounts ?? []);

const filesystemBadge = $derived.by(() => {
  const mounts = configuration?.mounts ?? [];
  if (mounts.length === 0) return 'Strict';
  const hasHomeMnt = mounts.some(m => m.host === '$HOME' || m.target === '$HOME');
  if (hasHomeMnt) return 'Home';
  return 'Custom';
});

function formatRelativeTime(ts: string | undefined): string {
  if (!ts) return '-';
  const date = new Date(ts);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}
</script>

<div class="px-5 py-4 h-full overflow-auto">
  <div class="flex flex-col gap-4 max-w-[1400px] mx-auto">
    <!-- Agent Profile Card -->
    <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Agent profile">
      <div class="flex items-center gap-3.5 mb-3">
        {#if agentInfo?.icon?.logo ?? agentInfo?.icon?.icon}
          <IconImage image={agentInfo.icon.logo ?? agentInfo.icon.icon} alt={agentInfo.name} class="w-10 h-10 rounded-[10px]">
            <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0">
              <Icon icon={getAgentIcon(agentInfo)} size="1.5x" class="text-white" />
            </div>
          </IconImage>
        {:else}
          <div class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0">
            <Icon icon={getAgentIcon(agentInfo)} size="1.5x" class="text-white" />
          </div>
        {/if}
        <div class="flex-1 min-w-0">
          <h2 class="text-[15px] font-semibold text-[var(--pd-content-card-header-text)] m-0 mb-0.5">
            {agentInfo?.name}
          </h2>
          {#if modelDisplayName}
            <p class="text-xs text-[var(--pd-link)] m-0">
              {modelDisplayName}
            </p>
          {/if}
        </div>
        <div
          class="inline-flex items-center gap-1.5 py-1 px-2.5 rounded-lg border shrink-0"
          aria-label="Sandbox status"
          style="background: color-mix(in srgb, {statusStyle.sandboxColor} 10%, transparent); border-color: color-mix(in srgb, {statusStyle.sandboxColor} 20%, transparent);">
          <span style="color: {statusStyle.sandboxColor}"><Icon icon={faShieldHalved} size="sm" /></span>
          <span class="text-[11px] font-medium" style="color: {statusStyle.sandboxColor}">{statusStyle.sandboxLabel}</span>
        </div>
      </div>
      {#if configuration?.description}
        <p
          tabindex="0"
          role="region"
          aria-label="Workspace description"
          class="text-[13px] text-[var(--pd-content-text)] leading-relaxed m-0 whitespace-pre-line max-h-[calc(6*1.625em)] overflow-y-auto">
          {configuration.description}
        </p>
      {/if}
      {#if workspaceSummary?.sourcePath}
        <div class="flex items-center gap-1.5 mt-1 text-[var(--pd-content-text)] opacity-60">
          <Icon icon={faFolder} size="xs" />
          <span class="text-xs font-mono">{workspaceSummary.sourcePath}</span>
        </div>
      {/if}
    </div>

    <!-- Details Card -->
    <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
      <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2 mb-3.5">
        Details
      </h3>
      <div class="flex gap-6">
        <div class="flex flex-col gap-0.5" aria-label="Status">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Status</div>
          <div class="text-[13px] font-semibold {statusStyle.stateColor}">
            {workspaceSummary?.phase ?? 'unknown'}
          </div>
        </div>
        <div class="flex flex-col gap-0.5" aria-label="Started">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">{timeLabel}</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {formatRelativeTime(referenceTime)}
          </div>
        </div>
        <div class="flex flex-col gap-0.5" aria-label="Network">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Network</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {networkLabel}
          </div>
        </div>
      </div>
    </div>

    <!-- Resources Strip -->
    <div class="flex flex-wrap gap-3">
      <!-- Skills Card -->
      <div class="flex-1 min-w-[300px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Skills card">
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
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-running)]/15 text-[var(--pd-status-running)]">
                  <Icon icon={faWrench} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">{skill}</span>
                <span class="text-[11px] text-[var(--pd-status-running)] shrink-0">Active</span>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No skills configured</p>
          {/if}
        </div>
      </div>

      <!-- MCP Servers Card -->
      <div class="flex-1 min-w-[300px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="MCP Servers card">
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
            {#each mcpServersList as server (server._key)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-link)]/15 text-[var(--pd-link)]">
                  <Icon icon={faServer} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">{server.name}</span>
                <span class="text-[11px] text-[var(--pd-status-running)] shrink-0">Connected</span>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No MCP servers configured</p>
          {/if}
        </div>
      </div>

      <!-- Filesystem Card -->
      <div class="flex-1 min-w-[300px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Filesystem card">
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
          {#if workspaceSummary?.sourcePath}
            <div
              class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
              <div
                class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-waiting)]/15 text-[var(--pd-status-waiting)]">
                <Icon icon={faFolder} size="sm" />
              </div>
              <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">
                {workspaceSummary.sourcePath}
              </span>
              <span class="text-[11px] text-[var(--pd-status-running)] shrink-0">read-write</span>
            </div>
          {/if}
          {#each mountsList as mount (`${mount.host}:${mount.target}`)}
            <div
              class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
              <div
                class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-waiting)]/15 text-[var(--pd-status-waiting)]">
                <Icon icon={faFolder} size="sm" />
              </div>
              <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">
                {mount.host}
              </span>
              <span class="text-[11px] shrink-0 {mount.ro ? 'text-[var(--pd-content-text)] opacity-60' : 'text-[var(--pd-status-running)]'}">
                {mount.ro ? 'read-only' : 'read-write'}
              </span>
            </div>
          {/each}
        </div>
      </div>
    </div>
  </div>
</div>
