<script lang="ts">
import { faBook, faServer, faWrench } from '@fortawesome/free-solid-svg-icons';
import { Button, Input, SettingsNavItem } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import AgentWorkspaceCreateStepFileSystem, {
  type CustomMount,
} from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepFileSystem.svelte';
import AgentWorkspaceCreateStepNetworking from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepNetworking.svelte';
import WorkspaceDescriptionField from '/@/lib/agent-workspaces/WorkspaceDescriptionField.svelte';
import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import ChecklistPanel from '/@/lib/ui/ChecklistPanel.svelte';
import { handleNavigation } from '/@/navigation';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import type { SandboxInfoWithGateway } from '/@/stores/openshell-sandboxes';
import { ragEnvironments } from '/@/stores/rag-environments';
import { skillInfos } from '/@/stores/skills';
import type {
  AgentWorkspaceConfiguration,
  AgentWorkspaceMcpConfig,
  AgentWorkspaceMount,
  NetworkConfiguration,
} from '/@api/agent-workspace-info';
import { NavigationPage } from '/@api/navigation-page';

type SettingsSection = 'general' | 'skills' | 'mcp' | 'knowledge' | 'file-access' | 'network' | 'advanced';

interface SectionConfig {
  id: SettingsSection;
  label: string;
}

interface Props {
  workspaceId: string;
  workspaceSummary: SandboxInfoWithGateway | undefined;
  configuration: AgentWorkspaceConfiguration;
}

let { workspaceId, workspaceSummary, configuration = $bindable() }: Props = $props();

const sections: SectionConfig[] = [
  { id: 'general', label: 'General' },
  { id: 'skills', label: 'Agent Skills' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'file-access', label: 'File Access' },
  { id: 'network', label: 'Network' },
  { id: 'advanced', label: 'Advanced' },
];

let activeSection: SettingsSection = $state('general');
const activeLabel = $derived(sections.find(s => s.id === activeSection)?.label ?? '');

const workspaceName = $derived(workspaceSummary?.name ?? '');

const originalDescription = $derived(configuration?.description ?? '');
let pendingDescription = $derived(originalDescription);

let skillItems: ChecklistItem[] = $derived(
  $skillInfos.map(s => ({
    id: s.name,
    name: s.name,
    description: s.description,
    group: s.managed ? 'Custom' : 'Pre-built',
  })),
);

const originalSkillIds = $derived(
  (configuration?.skills ?? [])
    .map(path => $skillInfos.find(s => s.path === path)?.name)
    .filter((name): name is string => name !== undefined),
);

let pendingSkillIds: string[] = $state([...originalSkillIds]);

function onSkillsChange(updated: string[]): void {
  pendingSkillIds = updated;
}

const hasSkillChanges = $derived(
  pendingSkillIds.length !== originalSkillIds.length || pendingSkillIds.some(id => !originalSkillIds.includes(id)),
);

// --- File Access section state ---

function deriveFileAccessSelection(mounts: AgentWorkspaceMount[] | undefined): string {
  if (!mounts || mounts.length === 0) return 'workspace';
  return 'custom';
}

function deriveMountsFromMounts(mounts: AgentWorkspaceMount[] | undefined): CustomMount[] {
  if (!mounts || mounts.length === 0) return [{ host: '', target: '', ro: false }];
  return mounts.map(m => ({ host: m.host, target: m.target, ro: m.ro }));
}

const originalFileAccess = $derived(deriveFileAccessSelection(configuration.mounts));
const originalCustomMounts = $derived(deriveMountsFromMounts(configuration.mounts));

let pendingFileAccess: string = $state(originalFileAccess);
let pendingCustomMounts: CustomMount[] = $state(originalCustomMounts.map(m => ({ ...m })));

function buildMountsFromSelection(fileAccess: string, mounts: CustomMount[]): AgentWorkspaceMount[] | undefined {
  if (fileAccess !== 'custom') {
    return undefined;
  }
  const filtered = mounts
    .filter(m => m.host.trim() !== '')
    .map(m => {
      const host = m.host.trim();
      const trimmedTarget = m.target.trim();
      const basename = host.split('/').filter(Boolean).pop();
      const target = trimmedTarget !== '' ? trimmedTarget : (basename ?? host);
      return { host, target, ro: m.ro };
    });
  return filtered.length > 0 ? filtered : undefined;
}

// --- Network section state ---
function deriveNetworkSelection(network: NetworkConfiguration | undefined): string {
  if (!network) return 'registries';
  if (network.mode === 'allow') return 'open';
  if (network.hosts && network.hosts.length > 0) return 'registries';
  return 'blocked';
}

function deriveNetworkHosts(network: NetworkConfiguration | undefined): string[] {
  if (!network?.hosts || network.hosts.length === 0) return [''];
  return [...network.hosts];
}

function mapNetworkSelection(value: string, hosts: string[]): NetworkConfiguration | undefined {
  const filtered = hosts.filter(h => h.trim() !== '');
  switch (value) {
    case 'registries':
    case 'blocked':
      return { mode: 'deny', hosts: filtered.length ? filtered : undefined };
    default:
      return undefined;
  }
}

const hasMountChanges: boolean = $derived(
  pendingFileAccess !== originalFileAccess ||
    (pendingFileAccess === 'custom' &&
      (pendingCustomMounts.length !== originalCustomMounts.length ||
        pendingCustomMounts.some(
          (m, i) =>
            m.host !== originalCustomMounts[i]?.host ||
            m.target !== originalCustomMounts[i]?.target ||
            m.ro !== originalCustomMounts[i]?.ro,
        ))),
);

// --- Knowledge section state ---
let knowledgeItems: ChecklistItem[] = $derived(
  $ragEnvironments
    .filter(r => r.mcpServer)
    .map(r => {
      const sourceCount = r.files.length;
      const sourcesLabel = sourceCount > 0 ? `${sourceCount} source${sourceCount !== 1 ? 's' : ''}` : '';
      return {
        id: r.name,
        name: r.name,
        description: [sourcesLabel, r.ragConnection?.name].filter(Boolean).join(' · '),
      };
    }),
);

const originalKnowledgeIds: string[] = $derived(
  $ragEnvironments
    .filter(r => r.mcpServer && (configuration.mcp?.servers ?? []).some(s => s.url === r.mcpServer?.url))
    .map(r => r.name),
);

let pendingKnowledgeIds: string[] = $state([...originalKnowledgeIds]);

const hasKnowledgeChanges: boolean = $derived(
  pendingKnowledgeIds.length !== originalKnowledgeIds.length ||
    pendingKnowledgeIds.some(id => !originalKnowledgeIds.includes(id)),
);

function onKnowledgeSelectionChange(selected: string[]): void {
  pendingKnowledgeIds = selected;
}

// --- MCP section state ---
let mcpItems: ChecklistItem[] = $derived(
  $mcpRemoteServerInfos.map(m => ({ id: m.id, name: m.name, description: m.description })),
);

const originalMcpIds: string[] = $derived(computeSelectedMcpIds(configuration, $mcpRemoteServerInfos));

let pendingMcpIds: string[] = $state([...originalMcpIds]);

function computeSelectedMcpIds(
  config: AgentWorkspaceConfiguration,
  servers: readonly { id: string; name: string; url: string; setupType?: string; commandSpec?: { command: string } }[],
): string[] {
  const configServers = config.mcp?.servers ?? [];
  const configCommands = config.mcp?.commands ?? [];
  return servers
    .filter(s => {
      if (s.setupType === 'package' && s.commandSpec) {
        return configCommands.some(c => c.name === s.name && c.command === s.commandSpec?.command);
      }
      return configServers.some(cs => cs.name === s.name && cs.url === s.url);
    })
    .map(s => s.id);
}

const hasMcpChanges: boolean = $derived(
  pendingMcpIds.length !== originalMcpIds.length || pendingMcpIds.some(id => !originalMcpIds.includes(id)),
);

function onMcpSelectionChange(selected: string[]): void {
  pendingMcpIds = selected;
}

const defaultRegistryHosts = ['registry.npmjs.org', 'pypi.python.org'];

const originalNetworkSelection = $derived(deriveNetworkSelection(configuration.network));
const originalNetworkHosts = $derived(deriveNetworkHosts(configuration.network));

let pendingNetworkSelection: string = $state(originalNetworkSelection);
let pendingHostsByMode: Record<string, string[]> = $state({
  [originalNetworkSelection]: [...originalNetworkHosts],
});

let pendingNetworkHosts = $derived(pendingHostsByMode[pendingNetworkSelection] ?? ['']);

const hasNetworkChanges: boolean = $derived(
  pendingNetworkSelection !== originalNetworkSelection ||
    ((pendingNetworkSelection === 'blocked' || pendingNetworkSelection === 'registries') &&
      (pendingNetworkHosts.length !== originalNetworkHosts.length ||
        pendingNetworkHosts.some((h, i) => h !== originalNetworkHosts[i]))),
);

function onNetworkModeChange(mode: string): void {
  pendingNetworkSelection = mode;
  if (!(mode in pendingHostsByMode)) {
    pendingHostsByMode = {
      ...pendingHostsByMode,
      [mode]: mode === 'registries' ? [...defaultRegistryHosts] : [''],
    };
  }
}

function addCustomHost(): void {
  const current = pendingHostsByMode[pendingNetworkSelection] ?? [''];
  pendingHostsByMode = { ...pendingHostsByMode, [pendingNetworkSelection]: [...current, ''] };
}

function removeCustomHost(index: number): void {
  const current = pendingHostsByMode[pendingNetworkSelection] ?? [''];
  if (current.length <= 1) return;
  pendingHostsByMode = { ...pendingHostsByMode, [pendingNetworkSelection]: current.filter((_, i) => i !== index) };
}

function updateCustomHost(index: number, value: string): void {
  const current = pendingHostsByMode[pendingNetworkSelection] ?? [''];
  pendingHostsByMode = {
    ...pendingHostsByMode,
    [pendingNetworkSelection]: current.map((h, i) => (i === index ? value : h)),
  };
}

const hasDescriptionChanges = $derived(pendingDescription !== originalDescription);

const hasChanges = $derived(
  hasDescriptionChanges ||
    hasMountChanges ||
    hasSkillChanges ||
    hasKnowledgeChanges ||
    hasMcpChanges ||
    hasNetworkChanges,
);

// --- Save / Discard ---
async function saveChanges(): Promise<void> {
  try {
    if (hasDescriptionChanges) {
      await window.updateAgentWorkspaceConfiguration(workspaceId, { description: pendingDescription });
      configuration = { ...configuration, description: pendingDescription };
    }
    if (hasMountChanges) {
      const newMounts = buildMountsFromSelection(pendingFileAccess, pendingCustomMounts);
      await window.updateAgentWorkspaceConfiguration(workspaceId, { mounts: newMounts });
      configuration = { ...configuration, mounts: newMounts };
      pendingFileAccess = deriveFileAccessSelection(configuration.mounts);
      pendingCustomMounts = deriveMountsFromMounts(configuration.mounts).map(m => ({ ...m }));
    }
    if (hasSkillChanges) {
      const selectedPaths = pendingSkillIds
        .map(name => $skillInfos.find(s => s.name === name)?.path)
        .filter((path): path is string => path !== undefined);
      const newSkills = selectedPaths.length > 0 ? selectedPaths : undefined;
      await window.updateAgentWorkspaceConfiguration(workspaceId, { skills: newSkills });
      configuration = { ...configuration, skills: newSkills };
    }
    if (hasKnowledgeChanges || hasMcpChanges) {
      const knowledgeConfig = buildMcpConfigWithKnowledge(pendingKnowledgeIds);
      const mcpConfig = buildMcpConfig(pendingMcpIds);
      const unmanagedConfig = buildUnmanagedMcpConfig();
      const allServers = [
        ...(unmanagedConfig.servers ?? []),
        ...(knowledgeConfig.servers ?? []),
        ...(mcpConfig.servers ?? []),
      ];
      const allCommands = [...(unmanagedConfig.commands ?? []), ...(mcpConfig.commands ?? [])];
      const newMcpConfig: AgentWorkspaceMcpConfig = {};
      if (allServers.length > 0) newMcpConfig.servers = allServers;
      if (allCommands.length > 0) newMcpConfig.commands = allCommands;
      await window.updateAgentWorkspaceConfiguration(workspaceId, { mcp: newMcpConfig });
      configuration = { ...configuration, mcp: newMcpConfig };
    }
    if (hasMcpChanges) {
      const mcpConfig = buildMcpConfig(pendingMcpIds);
      await window.updateAgentWorkspaceConfiguration(workspaceId, { mcp: mcpConfig });
      configuration = { ...configuration, mcp: mcpConfig };
    }
    if (hasNetworkChanges) {
      const newNetwork = mapNetworkSelection(pendingNetworkSelection, pendingNetworkHosts);
      await window.updateAgentWorkspaceConfiguration(workspaceId, { network: newNetwork });
      configuration = { ...configuration, network: newNetwork };
      const newSelection = deriveNetworkSelection(configuration.network);
      pendingNetworkSelection = newSelection;
      pendingHostsByMode = { [newSelection]: [...deriveNetworkHosts(configuration.network)] };
    }
  } catch (err: unknown) {
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Failed to save workspace settings: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ['OK'],
    });
    discardChanges();
  }
}

function buildMcpConfigWithKnowledge(selectedIds: string[]): AgentWorkspaceMcpConfig {
  const selectedServers = selectedIds
    .map(name => $ragEnvironments.find(r => r.name === name)?.mcpServer)
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .map(s => ({ name: s.name, url: s.url }));

  return {
    ...(selectedServers.length > 0 ? { servers: selectedServers } : {}),
  };
}

function buildMcpConfig(ids: string[]): AgentWorkspaceMcpConfig {
  const servers: AgentWorkspaceMcpConfig['servers'] = [];
  const commands: AgentWorkspaceMcpConfig['commands'] = [];

  for (const id of ids) {
    const info = $mcpRemoteServerInfos.find(m => m.id === id);
    if (!info) continue;
    if (info.setupType === 'package' && info.commandSpec) {
      commands.push({
        name: info.name,
        command: info.commandSpec.command,
        args: info.commandSpec.args,
        env: info.commandSpec.env,
      });
    } else {
      servers.push({ name: info.name, url: info.url });
    }
  }

  return {
    ...(servers.length > 0 ? { servers } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  };
}

function buildUnmanagedMcpConfig(): AgentWorkspaceMcpConfig {
  const knowledgeUrls = new Set($ragEnvironments.filter(r => r.mcpServer).map(r => r.mcpServer!.url));
  const mcpServerUrls = new Set(
    $mcpRemoteServerInfos.filter(m => !m.setupType || m.setupType !== 'package').map(m => m.url),
  );
  const mcpCommandNames = new Set(
    $mcpRemoteServerInfos.filter(m => m.setupType === 'package' && m.commandSpec).map(m => m.name),
  );

  const servers = (configuration.mcp?.servers ?? []).filter(
    s => !knowledgeUrls.has(s.url) && !mcpServerUrls.has(s.url),
  );
  const commands = (configuration.mcp?.commands ?? []).filter(c => !mcpCommandNames.has(c.name));

  return {
    ...(servers.length > 0 ? { servers } : {}),
    ...(commands.length > 0 ? { commands } : {}),
  };
}

function discardChanges(): void {
  pendingDescription = originalDescription;
  pendingFileAccess = originalFileAccess;
  pendingCustomMounts = originalCustomMounts.map(m => ({ ...m }));
  pendingSkillIds = [...originalSkillIds];
  pendingKnowledgeIds = [...originalKnowledgeIds];
  pendingMcpIds = [...originalMcpIds];
  pendingNetworkSelection = originalNetworkSelection;
  pendingHostsByMode = { [originalNetworkSelection]: [...originalNetworkHosts] };
}

function addCustomMount(): void {
  pendingCustomMounts = [...pendingCustomMounts, { host: '', target: '', ro: false }];
}

function removeCustomMount(index: number): void {
  pendingCustomMounts = pendingCustomMounts.filter((_, i) => i !== index);
}

function updateCustomMount(index: number, field: keyof CustomMount, value: string | boolean): void {
  pendingCustomMounts = pendingCustomMounts.map((m, i) => (i === index ? { ...m, [field]: value } : m));
}

async function handleBrowseCustomPath(index: number): Promise<void> {
  try {
    const result = await window.openDialog({ title: 'Select a directory', selectors: ['openDirectory'] });
    const selected = result?.[0];
    if (selected) updateCustomMount(index, 'host', selected);
  } catch (err: unknown) {
    await window.showMessageBox({
      title: 'Agent Workspace',
      type: 'error',
      message: `Failed to browse for directory: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ['OK'],
    });
  }
}

function navigateToKnowledges(): void {
  handleNavigation({ page: NavigationPage.RAG_ENVIRONMENTS });
}

function navigateToSkills(): void {
  handleNavigation({ page: NavigationPage.SKILLS });
}

function navigateToMcp(): void {
  router.goto('/preferences/mcps');
}

function handleDeleteWorkspace(): void {
  withConfirmation(
    (err?: unknown) => {
      if (err) {
        console.error('Confirmation dialog failed', err);
        return;
      }
      if (workspaceSummary) {
        window.removeAgentWorkspace(workspaceId, workspaceSummary.gatewayName).catch((error: unknown) => {
          console.error('Failed to remove agent workspace', error);
        });
      }
      router.goto('/agent-workspaces');
    },
    `remove workspace ${workspaceSummary?.name ?? workspaceId}`,
  );
}
</script>

<div class="flex flex-row w-full h-full">
  <nav
    class="z-1 w-leftsidebar min-w-leftsidebar flex flex-col bg-[var(--pd-secondary-nav-bg)] border-[var(--pd-global-nav-bg-border)] border-r-[1px]"
    aria-label="Settings sections">
    <div class="pt-4 px-3 mb-5">
      <p class="text-xl font-semibold text-[color:var(--pd-secondary-nav-header-text)] border-l-[4px] border-transparent">
        Settings
      </p>
    </div>
    <div class="h-full overflow-y-auto" style="margin-bottom:auto">
      {#each sections as section (section.id)}
        <SettingsNavItem
          title={section.label}
          href={$router.path}
          selected={activeSection === section.id}
          onClick={(): void => {
            activeSection = section.id;
          }} />
      {/each}
    </div>
  </nav>

  <div class="flex flex-col flex-1 min-w-0 h-full bg-[var(--pd-content-bg)]">
    <div class="flex flex-row items-center gap-3 px-8 py-3 bg-[var(--pd-content-card-bg)] border-b border-[var(--pd-content-card-border)]">
      <span class="text-sm text-[var(--pd-content-text)]">{hasChanges ? 'You have unsaved changes' : 'No changes to save'}</span>
      <div class="flex flex-row gap-2 ml-auto">
        <Button type="secondary" onclick={discardChanges} disabled={!hasChanges}>Discard changes</Button>
        <Button onclick={saveChanges} disabled={!hasChanges}>Save changes</Button>
      </div>
    </div>
    <div class="p-8 overflow-auto h-full">
      <div class="max-w-[800px]">
        <h2 class="text-xl font-semibold text-[var(--pd-content-header)] mb-2">{activeLabel}</h2>

        {#if activeSection === 'general'}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Configure the basic settings for your workspace.
          </p>

          <div class="flex flex-col gap-5">
            <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-6">
              <div class="mb-5">
                <h3 class="text-[15px] font-semibold text-[var(--pd-content-card-header-text)] mb-1">Workspace Information</h3>
                <p class="text-[13px] text-[var(--pd-content-text)] opacity-60 m-0">Basic details about this workspace</p>
              </div>
              <div class="flex flex-col gap-5">
                <div class="flex flex-col gap-2">
                  <label for="input-workspace-name" class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">Workspace Name</label>
                  <Input
                    id="input-workspace-name"
                    aria-label="Workspace Name"
                    value={workspaceName}
                    readonly />
                </div>
                <div class="flex flex-col gap-2">
                  <label for="input-workspace-description" class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">Description</label>
                  <WorkspaceDescriptionField id="input-workspace-description" bind:value={pendingDescription} />
                </div>
                <div class="flex flex-col gap-2">
                  <label for="input-working-directory" class="text-[13px] font-semibold text-[var(--pd-content-card-header-text)]">Working Directory</label>
                  <Input
                    id="input-working-directory"
                    aria-label="Working Directory"
                    value={workspaceSummary?.sourcePath ?? ''}
                    readonly />
                  <p class="text-[12px] text-[var(--pd-content-text)] opacity-50 m-0">The directory where the agent will operate</p>
                </div>
              </div>
            </div>
          </div>

        {:else if activeSection === 'file-access'}
          <AgentWorkspaceCreateStepFileSystem
            bind:selectedFileAccess={pendingFileAccess}
            customMounts={pendingCustomMounts}
            onBrowseCustomPath={handleBrowseCustomPath}
            onAddCustomMount={addCustomMount}
            onRemoveCustomMount={removeCustomMount}
            onUpdateCustomMount={updateCustomMount} />
        {:else if activeSection === 'skills'}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Configure agent skills settings for this workspace.
          </p>
          <ChecklistPanel
            title="Skills"
            subtitle="Select the capabilities your agent should have"
            icon={faWrench}
            items={skillItems}
            selected={pendingSkillIds}
            onchange={onSkillsChange}
            emptyMessage="No skills available yet.">
            {#snippet headerAction()}
              <Button type="secondary" onclick={navigateToSkills}>Manage Skills</Button>
            {/snippet}
          </ChecklistPanel>
        {:else if activeSection === 'knowledge'}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Select which knowledge bases are available in this workspace.
          </p>

          <ChecklistPanel
            title="Knowledge Bases"
            subtitle="Optional retrieval context for the agent"
            icon={faBook}
            items={knowledgeItems}
            selected={pendingKnowledgeIds}
            onchange={onKnowledgeSelectionChange}
            emptyMessage="No knowledge bases available yet.">
            {#snippet headerAction()}
              <Button type="secondary" onclick={navigateToKnowledges}>Manage Knowledges</Button>
            {/snippet}
          </ChecklistPanel>
        {:else if activeSection === 'mcp'}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Select which MCP servers are available in this workspace.
          </p>

          <ChecklistPanel
            title="MCP Servers"
            subtitle="Connect to Model Context Protocol servers for extended capabilities"
            icon={faServer}
            items={mcpItems}
            selected={pendingMcpIds}
            onchange={onMcpSelectionChange}
            emptyMessage="No MCP servers available yet.">
            {#snippet headerAction()}
              <Button type="secondary" onclick={navigateToMcp}>Manage Servers</Button>
            {/snippet}
          </ChecklistPanel>
        {:else if activeSection === 'network'}
          <AgentWorkspaceCreateStepNetworking
            bind:selectedNetwork={pendingNetworkSelection}
            customHosts={pendingNetworkHosts}
            onchange={onNetworkModeChange}
            onAddCustomHost={addCustomHost}
            onRemoveCustomHost={removeCustomHost}
            onUpdateCustomHost={updateCustomHost} />

        {:else if activeSection === 'advanced'}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Advanced configuration options for this workspace.
          </p>

          <div class="bg-[var(--pd-content-card-bg)] border border-[color-mix(in_srgb,var(--pd-danger-action-text,#f87171)_30%,transparent)] rounded-lg p-6">
            <div class="mb-5">
              <h3 class="text-[15px] font-semibold text-[var(--pd-danger-action-text,#f87171)] mb-1">Danger Zone</h3>
              <p class="text-[13px] text-[var(--pd-content-text)] opacity-60 m-0">Irreversible and destructive actions</p>
            </div>
            <div class="flex items-center justify-between py-4">
              <div class="flex-1">
                <div class="text-sm font-medium text-[var(--pd-content-card-header-text)]">Delete Workspace</div>
                <div class="text-xs text-[var(--pd-content-text)] opacity-60">Permanently delete this workspace and all its data</div>
              </div>
              <Button type="danger" aria-label="Delete workspace" onclick={handleDeleteWorkspace}>Delete</Button>
            </div>
          </div>

        {:else}
          <p class="text-sm text-[var(--pd-content-text)] mb-7">
            Configure {activeLabel.toLowerCase()} settings for this workspace.
          </p>
          <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-6">
            <p class="text-sm text-[var(--pd-content-text)] opacity-60">
              {activeLabel} settings will be available in a future update.
            </p>
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
