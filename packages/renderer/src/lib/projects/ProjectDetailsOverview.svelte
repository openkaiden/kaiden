<script lang="ts">
import {
  faBook,
  faCode,
  faFolder,
  faKey,
  faNetworkWired,
  faServer,
  faTableCellsLarge,
} from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { mcpRemoteServerInfos } from '/@/kaiden/stores/mcp-remote-servers';
import { secretVaultInfos } from '/@/kaiden/stores/secret-vault';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

interface Props {
  project: WorkspaceProjectInfo;
}

let { project }: Props = $props();

const networkLabel = $derived(project.network.mode === 'allow' ? 'Unrestricted' : 'Deny All');

function mcpServerName(id: string): string {
  return $mcpRemoteServerInfos.find(s => s.id === id)?.name ?? id;
}

function secretName(id: string): string {
  return $secretVaultInfos.find(s => s.id === id)?.name ?? id;
}

function secretType(id: string): string | undefined {
  return $secretVaultInfos.find(s => s.id === id)?.type;
}

const filesystemBadge = $derived.by((): string => {
  const mounts = project.filesystem.mounts;
  if (mounts.length === 0) return 'Strict';
  const hasHomeMnt = mounts.some(m => m.host === '$HOME' || m.target === '$HOME');
  if (hasHomeMnt) return 'Home';
  return 'Custom';
});
</script>

<div class="px-5 py-4 h-full overflow-auto">
  <div class="flex flex-col gap-4 max-w-[1400px] mx-auto">
    <!-- Project Info Card -->
    <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Project info">
      <div class="flex items-center gap-3.5 mb-3">
        <div
          class="w-10 h-10 rounded-[10px] flex items-center justify-center shrink-0 bg-[var(--pd-link)]/15 text-[var(--pd-link)]">
          <Icon icon={faFolder} size="1.5x" />
        </div>
        <div class="flex-1 min-w-0">
          <h2 class="text-[15px] font-semibold text-[var(--pd-content-card-header-text)] m-0 mb-0.5">
            {project.name}
          </h2>
          <p class="text-xs text-[var(--pd-content-text)] opacity-60 m-0 font-mono truncate">
            {project.folder}
          </p>
        </div>
      </div>
    </div>

    <!-- Details Card -->
    <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5">
      <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2 mb-3.5">
        Details
      </h3>
      <div class="flex gap-6">
        <div class="flex flex-col gap-0.5" aria-label="Filesystem">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Filesystem</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {filesystemBadge}
          </div>
        </div>
        <div class="flex flex-col gap-0.5" aria-label="Network">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Network</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {networkLabel}
          </div>
        </div>
        <div class="flex flex-col gap-0.5" aria-label="Skills count">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Skills</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {project.skills.length}
          </div>
        </div>
        <div class="flex flex-col gap-0.5" aria-label="MCP count">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">MCP Servers</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {project.mcpServers.length}
          </div>
        </div>
        <div class="flex flex-col gap-0.5" aria-label="Secrets count">
          <div class="text-[10px] text-[var(--pd-content-text)] opacity-60 uppercase tracking-wider">Secrets</div>
          <div class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">
            {project.secrets.length}
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
            {project.skills.length}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if project.skills.length > 0}
            {#each project.skills as skill (skill)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-running)]/15 text-[var(--pd-status-running)]">
                  <Icon icon={faCode} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">{skill}</span>
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
            {project.mcpServers.length}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if project.mcpServers.length > 0}
            {#each project.mcpServers as server (server)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-link)]/15 text-[var(--pd-link)]">
                  <Icon icon={faServer} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">{mcpServerName(server)}</span>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No MCP servers configured</p>
          {/if}
        </div>
      </div>

      <!-- Knowledge Bases Card -->
      <div class="flex-1 min-w-[300px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Knowledge card">
        <div class="flex justify-between items-center mb-3.5">
          <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2">
            <Icon icon={faBook} size="sm" class="text-[var(--pd-link)]" />
            Knowledge Bases
          </h3>
          <span
            class="text-[11px] font-semibold py-0.5 px-2 rounded-[10px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] text-[var(--pd-link)]">
            {project.knowledges.length}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if project.knowledges.length > 0}
            {#each project.knowledges as knowledge (knowledge)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-waiting)]/15 text-[var(--pd-status-waiting)]">
                  <Icon icon={faBook} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">{knowledge}</span>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No knowledge bases configured</p>
          {/if}
        </div>
      </div>

      <!-- Secrets Card -->
      <div class="flex-1 min-w-[300px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Secrets card">
        <div class="flex justify-between items-center mb-3.5">
          <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2">
            <Icon icon={faKey} size="sm" class="text-[var(--pd-link)]" />
            Secrets
          </h3>
          <span
            class="text-[11px] font-semibold py-0.5 px-2 rounded-[10px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] text-[var(--pd-link)]">
            {project.secrets.length}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          {#if project.secrets.length > 0}
            {#each project.secrets as secret (secret)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-terminated)]/15 text-[var(--pd-status-terminated)]">
                  <Icon icon={faKey} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">{secretName(secret)}</span>
                {#if secretType(secret)}
                  <span class="text-[11px] shrink-0 text-[var(--pd-content-text)] opacity-60">{secretType(secret)}</span>
                {/if}
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No secrets configured</p>
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
          {#if project.filesystem.mounts.length > 0}
            {#each project.filesystem.mounts as mount (`${mount.host}:${mount.target}`)}
              <div
                class="flex items-center gap-2.5 py-2 px-2.5 rounded-lg bg-[var(--pd-content-bg)] border border-transparent overflow-hidden">
                <div
                  class="w-7 h-7 rounded-md flex items-center justify-center shrink-0 bg-[var(--pd-status-waiting)]/15 text-[var(--pd-status-waiting)]">
                  <Icon icon={faFolder} size="sm" />
                </div>
                <span class="flex-1 min-w-0 text-[13px] font-medium text-[var(--pd-content-card-header-text)] truncate">
                  {mount.target}
                </span>
                <span class="text-[11px] shrink-0 {mount.ro ? 'text-[var(--pd-content-text)] opacity-60' : 'text-[var(--pd-status-running)]'}">
                  {mount.ro ? 'read-only' : 'read-write'}
                </span>
              </div>
            {/each}
          {:else}
            <p class="text-xs text-[var(--pd-content-text)] opacity-60">No custom mounts</p>
          {/if}
        </div>
      </div>

      <!-- Network Card -->
      <div class="flex-1 min-w-[300px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] rounded-lg p-5" aria-label="Network card">
        <div class="flex justify-between items-center mb-3.5">
          <h3 class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)] flex items-center gap-2">
            <Icon icon={faNetworkWired} size="sm" class="text-[var(--pd-link)]" />
            Network
          </h3>
          <span
            class="text-[11px] font-semibold py-0.5 px-2 rounded-[10px] bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-table-border)] text-[var(--pd-link)]">
            {networkLabel}
          </span>
        </div>
        <div class="flex flex-col gap-1.5">
          <p class="text-xs text-[var(--pd-content-text)] opacity-60">
            {networkLabel === 'Unrestricted' ? 'All outbound traffic permitted' : 'All outbound traffic blocked'}
          </p>
        </div>
      </div>
    </div>
  </div>
</div>
