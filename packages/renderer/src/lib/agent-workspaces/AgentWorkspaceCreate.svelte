<script lang="ts">
import { faLock } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { onMount, untrack } from 'svelte';
import { toast } from 'svelte-sonner';

import type { ModelInfo } from '/@/lib/chat/components/model-info';
import { getModelId } from '/@/lib/models/models-utils';
import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import WizardStepper from '/@/lib/ui/WizardStepper.svelte';
import { handleNavigation } from '/@/navigation';
import { resetDraft, wizard } from '/@/stores/agent-workspace-create-draft.svelte';
import { agentInfos } from '/@/stores/agents';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { disabledModels, isModelEnabled, modelKey } from '/@/stores/model-catalog';
import { catalogModels } from '/@/stores/models';
import { openshellGateways } from '/@/stores/openshell-gateways';
import { isGatewayVersionCompatible } from '/@api/openshell-gateway-info';
import { allOpenshellSandboxes } from '/@/stores/openshell-sandboxes';
import { providerInfos } from '/@/stores/providers';
import { ragEnvironments } from '/@/stores/rag-environments';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { skillInfos } from '/@/stores/skills';
import { workspaceProjectInfos } from '/@/stores/workspace-projects';
import type {
  AgentWorkspaceConfiguration,
  AgentWorkspaceMount,
  NetworkConfiguration,
} from '/@api/agent-workspace-info';
import { getSandboxNameValidationError, sanitizeDns1123Label } from '/@api/agent-workspace-info';
import { NavigationPage } from '/@api/navigation-page';
import type { DefaultWorkspaceSettings } from '/@api/onboarding-settings-info';
import type { FilesystemConfiguration, WorkspaceProjectInfo } from '/@api/workspace-project-info';

import AgentWorkspaceCreateStepAgentModel from './AgentWorkspaceCreateStepAgentModel.svelte';
import type { CustomMount } from './AgentWorkspaceCreateStepFileSystem.svelte';
import AgentWorkspaceCreateStepFileSystem from './AgentWorkspaceCreateStepFileSystem.svelte';
import AgentWorkspaceCreateStepNetworking from './AgentWorkspaceCreateStepNetworking.svelte';
import AgentWorkspaceCreateStepToolsSecrets from './AgentWorkspaceCreateStepToolsSecrets.svelte';
import AgentWorkspaceCreateStepWorkspace from './AgentWorkspaceCreateStepWorkspace.svelte';

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

const wizardSteps = [
  { id: 'workspace', title: 'Workspace' },
  { id: 'agent-model', title: 'Agent & Model' },
  { id: 'tools-secrets', title: 'Tools & Secrets' },
  { id: 'filesystem', title: 'File System' },
  { id: 'networking', title: 'Networking' },
];

function applyFilesystemFromProject(fs: FilesystemConfiguration): void {
  const hasMounts = fs.mounts.length > 0;
  if (!hasMounts) {
    wizard.draft.selectedFileAccess = 'workspace';
    wizard.draft.customMounts = [{ host: '', target: '', ro: false }];
    return;
  }
  wizard.draft.selectedFileAccess = 'custom';
  wizard.draft.customMounts = fs.mounts.map(m => ({ host: m.host, target: m.target, ro: m.ro ?? false }));
}

const REGISTRY_PRESET = ['registry.npmjs.org', 'pypi.python.org'];

function isRegistryPreset(hosts: string[]): boolean {
  return hosts.length === REGISTRY_PRESET.length && hosts.every((h, i) => h === REGISTRY_PRESET[i]);
}

function applyNetworkFromProject(net: NetworkConfiguration | undefined): void {
  if (!net) return;
  // mode: allow is no longer offered in the UI; fall back to the recommended preset.
  if (net.mode === 'allow') {
    wizard.draft.selectedNetwork = 'registries';
    wizard.draft.hostsByMode = {
      ...wizard.draft.hostsByMode,
      registries: [...REGISTRY_PRESET],
    };
    return;
  }
  const hosts = net.hosts ?? [];
  if (hosts.length > 0 && isRegistryPreset(hosts)) {
    wizard.draft.selectedNetwork = 'registries';
    wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, registries: [...hosts] };
  } else if (hosts.length > 0) {
    wizard.draft.selectedNetwork = 'blocked';
    wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, blocked: [...hosts] };
  } else {
    wizard.draft.selectedNetwork = 'blocked';
    wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, blocked: [''] };
  }
}

function applyProject(project: WorkspaceProjectInfo): void {
  wizard.draft.selectedProjectId = project.id;
  wizard.draft.sourcePath = project.folder;
  wizard.draft.sessionName = sanitizeDns1123Label(project.name);
  wizard.draft.nameManuallyEdited = true;
  wizard.draft.selectedSkillIds = [...project.skills];
  wizard.draft.selectedMcpIds = [...project.mcpServers];
  wizard.draft.selectedSecretIds = [...project.secrets];
  wizard.draft.selectedKnowledgeIds = [...project.knowledges];
  applyFilesystemFromProject(project.filesystem);
  applyNetworkFromProject(project.network);
}

function clearProject(): void {
  wizard.draft.selectedProjectId = undefined;
  wizard.draft.sourcePath = '';
  wizard.draft.sessionName = '';
  wizard.draft.nameManuallyEdited = false;
  wizard.draft.selectedSkillIds = $skillInfos.filter(s => s.enabled).map(s => s.name);
  wizard.draft.selectedMcpIds = $mcpRemoteServerInfos.map(m => m.id);
  wizard.draft.selectedSecretIds = $secretVaultInfos.map(s => s.id);
  wizard.draft.selectedKnowledgeIds = $ragEnvironments.filter(r => r.mcpServer).map(r => r.name);
  wizard.draft.selectedFileAccess = 'workspace';
  wizard.draft.selectedNetwork = 'registries';
  wizard.draft.customMounts = [{ host: '', target: '', ro: false }];
  wizard.draft.hostsByMode = { registries: ['registry.npmjs.org', 'pypi.python.org'], blocked: [''] };
  const agentInfo = $agentInfos.find(a => a.id === wizard.draft.selectedAgent);
  wizard.draft.customImage = agentInfo?.baseImage ?? '';
}

function handleProjectSelect(project: WorkspaceProjectInfo | undefined): void {
  if (project) {
    applyProject(project);
  } else {
    clearProject();
  }
}

let skillItems: ChecklistItem[] = $derived(
  $skillInfos
    .filter(s => s.enabled)
    .map(s => ({
      id: s.name,
      name: s.name,
      description: s.description,
      group: s.managed ? 'Custom' : 'Pre-built',
    })),
);
let mcpItems: ChecklistItem[] = $derived(
  $mcpRemoteServerInfos.map(m => ({ id: m.id, name: m.name, description: m.description })),
);
let knowledgeItems: ChecklistItem[] = $derived(
  $ragEnvironments
    .filter(r => r.mcpServer)
    .map(r => {
      const sourceCount = r.files.length;
      const sourcesLabel = sourceCount > 0 ? `${sourceCount} source${sourceCount !== 1 ? 's' : ''}` : '';
      const providerName =
        $providerInfos.find(p => p.id === r.ragConnection?.providerId)?.name ?? r.ragConnection?.providerId;
      return {
        id: r.name,
        name: r.name,
        description: [providerName, sourcesLabel].filter(Boolean).join(' · '),
      };
    }),
);

// --- Form state (backed by persistent draft store) ---
let defaultSettings = $state<DefaultWorkspaceSettings | undefined>(undefined);

onMount(async () => {
  defaultSettings = await window.getConfigurationValue<DefaultWorkspaceSettings>('onboarding.defaultWorkspaceSettings');

  if (!wizard.draft.initialized) {
    const defaultAgent = defaultSettings?.defaultAgent;
    if (defaultAgent && $agentInfos.some(a => a.id === defaultAgent)) {
      wizard.draft.selectedAgent = defaultAgent;
    }

    if (
      defaultAgent &&
      defaultSettings?.defaultAgentSettings?.[defaultAgent]?.defaultModel?.providerId &&
      defaultSettings?.defaultAgentSettings?.[defaultAgent]?.defaultModel?.label
    ) {
      const allModels = $catalogModels;
      const match = allModels.find(
        m =>
          m.providerId === defaultSettings?.defaultAgentSettings?.[defaultAgent]?.defaultModel?.providerId &&
          m.label === defaultSettings?.defaultAgentSettings?.[defaultAgent]?.defaultModel?.label,
      );
      if (match) {
        wizard.draft.selectedModel = match;
      }
    }
    if (!wizard.draft.selectedModel) {
      const firstModel = getFirstCompatibleModel();
      if (firstModel) {
        wizard.draft.selectedModel = firstModel;
      }
    }

    const agentInfo = $agentInfos.find(a => a.id === wizard.draft.selectedAgent);
    wizard.draft.customImage = agentInfo?.baseImage ?? '';

    wizard.draft.initialized = true;
  }
});
let customHosts = $derived(wizard.draft.hostsByMode[wizard.draft.selectedNetwork] ?? []);
let reachableGateways = $derived(
  $openshellGateways.filter(
    gateway => gateway.gatewayState?.reachable === true && isGatewayVersionCompatible(gateway.version),
  ),
);

$effect.pre(() => {
  const gateways = reachableGateways;
  if (gateways.length === 0) {
    wizard.draft.selectedGateway = '';
    return;
  }

  const selected = untrack(() => wizard.draft.selectedGateway);
  if (selected && gateways.some(gateway => gateway.name === selected)) {
    return;
  }

  const activeGateway = gateways.find(gateway => gateway.active);
  wizard.draft.selectedGateway = activeGateway?.name ?? (gateways.length === 1 ? (gateways[0]?.name ?? '') : '');
});

function getDefaultSessionName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

function getEffectiveWorkspaceName(): string {
  const trimmed = wizard.draft.sessionName.trim();
  if (wizard.draft.nameManuallyEdited) return trimmed;
  return trimmed || getDefaultSessionName(wizard.draft.sourcePath);
}

function getEffectiveWorkspaceNameFromSnapshot(draft: { sessionName: string; sourcePath: string }): string {
  return draft.sessionName.trim() || getDefaultSessionName(draft.sourcePath);
}

function isWorkspaceNameValid(): boolean {
  return getSandboxNameValidationError(getEffectiveWorkspaceName()) === undefined;
}

let previousSourcePath = '';
$effect(() => {
  const currentPath = wizard.draft.sourcePath;
  const pathChanged = currentPath !== previousSourcePath;
  previousSourcePath = currentPath;
  if (wizard.draft.nameManuallyEdited && !(pathChanged && !wizard.draft.sessionName.trim())) return;
  const last = getDefaultSessionName(currentPath);
  if (!last) return;
  wizard.draft.nameManuallyEdited = false;
  wizard.draft.sessionName = sanitizeDns1123Label(last);
});

let configCheckToken = 0;

$effect(() => {
  const trimmed = wizard.draft.sourcePath.trim();
  const token = ++configCheckToken;
  if (trimmed) {
    window
      .checkAgentWorkspaceConfigExists(trimmed)
      .then(exists => {
        if (token === configCheckToken) {
          wizard.draft.configExists = exists;
        }
      })
      .catch(() => {
        if (token === configCheckToken) {
          wizard.draft.configExists = false;
        }
      });
  } else {
    const name = getEffectiveWorkspaceName();
    const gateway = wizard.draft.selectedGateway;
    if (name && gateway && !getSandboxNameValidationError(name)) {
      window
        .checkAgentWorkspaceGlobalConfigExists(gateway, name)
        .then(exists => {
          if (token === configCheckToken) {
            wizard.draft.configExists = exists;
          }
        })
        .catch(() => {
          if (token === configCheckToken) {
            wizard.draft.configExists = false;
          }
        });
    } else {
      wizard.draft.configExists = false;
    }
  }
});

// --- Wizard navigation ---
let currentStepIndex = $derived(wizard.draft.currentStepIndex);
let error = $state('');
let secretsLoading = $state(false);

let currentStepId = $derived(wizardSteps[wizard.draft.currentStepIndex]?.id ?? '');
let isLastStep = $derived(wizard.draft.currentStepIndex === wizardSteps.length - 1);
let hasModel = $derived(wizard.draft.selectedModel !== undefined);
let validationErrors = $derived.by(() => {
  const errors: { name?: string } = {};
  const name = wizard.draft.sessionName.trim().toLowerCase();
  if (
    name &&
    $allOpenshellSandboxes.some(
      sandbox => sandbox.gatewayName === wizard.draft.selectedGateway && sandbox.name.toLowerCase() === name,
    )
  ) {
    errors.name = 'A workspace with this name already exists. Please choose a different name.';
  }
  return errors;
});
let isCurrentStepComplete = $derived.by(() => {
  if (currentStepId === 'workspace') {
    return (
      wizard.draft.selectedGateway !== '' &&
      getEffectiveWorkspaceName() !== '' &&
      isWorkspaceNameValid() &&
      !validationErrors.name
    );
  }
  if (currentStepId === 'agent-model') {
    return hasModel;
  }
  if (currentStepId === 'tools-secrets') {
    return !secretsLoading;
  }
  return true;
});

function goNext(): void {
  if (wizard.draft.currentStepIndex < wizardSteps.length - 1) wizard.draft.currentStepIndex++;
}

function goBack(): void {
  if (wizard.draft.currentStepIndex > 0) wizard.draft.currentStepIndex--;
}

function handleStepClick(index: number): void {
  wizard.draft.currentStepIndex = index;
}

function addCustomMount(): void {
  wizard.draft.customMounts = [...wizard.draft.customMounts, { host: '', target: '', ro: false }];
}

function removeCustomMount(index: number): void {
  if (wizard.draft.customMounts.length <= 1) return;
  wizard.draft.customMounts = wizard.draft.customMounts.filter((_, i) => i !== index);
}

function updateCustomMount(index: number, field: keyof CustomMount, value: string | boolean): void {
  wizard.draft.customMounts = wizard.draft.customMounts.map((m, i) => (i === index ? { ...m, [field]: value } : m));
}

function addCustomHost(): void {
  const current = wizard.draft.hostsByMode[wizard.draft.selectedNetwork] ?? [];
  wizard.draft.hostsByMode = { ...wizard.draft.hostsByMode, [wizard.draft.selectedNetwork]: [...current, ''] };
}

function removeCustomHost(index: number): void {
  const current = wizard.draft.hostsByMode[wizard.draft.selectedNetwork] ?? [];
  if (current.length <= 1) return;
  wizard.draft.hostsByMode = {
    ...wizard.draft.hostsByMode,
    [wizard.draft.selectedNetwork]: current.filter((_, i) => i !== index),
  };
}

function updateCustomHost(index: number, value: string): void {
  const current = wizard.draft.hostsByMode[wizard.draft.selectedNetwork] ?? [];
  wizard.draft.hostsByMode = {
    ...wizard.draft.hostsByMode,
    [wizard.draft.selectedNetwork]: current.map((h, i) => (i === index ? value : h)),
  };
}

async function handleBrowseCustomPath(index: number): Promise<void> {
  try {
    const result = await window.openDialog({ title: 'Select a directory', selectors: ['openDirectory'] });
    const selected = result?.[0];
    if (selected) updateCustomMount(index, 'host', selected);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error = message;
    toast.error(`Failed to browse for directory: ${message}`);
  }
}

async function handleBrowseSource(): Promise<void> {
  try {
    const result = await window.openDialog({ title: 'Select a working directory', selectors: ['openDirectory'] });
    const selected = result?.[0];
    if (selected) {
      wizard.draft.sourcePath = selected;
      if (!wizard.draft.nameManuallyEdited) {
        const lastSegment = getDefaultSessionName(selected);
        if (lastSegment) wizard.draft.sessionName = sanitizeDns1123Label(lastSegment);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error = message;
    toast.error(`Failed to browse for directory: ${message}`);
  }
}

function cancel(): void {
  resetDraft();
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACES });
}

function normalizeTildeToHome(p: string): string {
  return p.startsWith('~/') ? `$HOME/${p.slice(2)}` : p;
}

function getAgentWorkspaceConfiguration(agent: string): AgentWorkspaceConfiguration | undefined {
  const config = defaultSettings?.defaultAgentSettings?.[agent]?.workspaceConfiguration;
  if (!config) return undefined;
  const snapshot = $state.snapshot(config);
  if (snapshot.mounts) {
    snapshot.mounts = snapshot.mounts.map(m => ({
      ...m,
      host: normalizeTildeToHome(m.host),
      target: normalizeTildeToHome(m.target),
    }));
  }
  return snapshot;
}

function getFirstCompatibleModel(): ModelInfo | undefined {
  const agentInfo = $agentInfos.find(a => a.id === wizard.draft.selectedAgent);
  const enabled = $catalogModels.filter(m => isModelEnabled($disabledModels, m.providerId, m.label));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const seen = new Set<string>();
  const unique = enabled.filter(m => {
    const key = modelKey(m.providerId, m.label);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!agentInfo?.supportedModelTypes || agentInfo.supportedModelTypes.length === 0) return unique[0];
  const typeNames = new Set(agentInfo.supportedModelTypes.map(t => t.name));
  return unique.filter(m => m.llmMetadata?.name !== undefined && typeNames.has(m.llmMetadata.name))[0];
}

function buildMountsFrom(fileAccess: string, mounts: CustomMount[]): AgentWorkspaceMount[] | undefined {
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

function startAsIs(): void {
  if (
    !wizard.draft.selectedGateway ||
    !wizard.draft.selectedModel ||
    !isWorkspaceNameValid() ||
    validationErrors.name
  ) {
    return;
  }

  const draftSnapshot = $state.snapshot(wizard.draft);

  window
    .createAgentWorkspace({
      sourcePath: draftSnapshot.sourcePath.trim() || undefined,
      agent: draftSnapshot.selectedAgent,
      image: draftSnapshot.customImage.trim() || undefined,
      model: getModelId(draftSnapshot.selectedModel!),
      gateway: draftSnapshot.selectedGateway,
      name: getEffectiveWorkspaceNameFromSnapshot(draftSnapshot),
      description: draftSnapshot.description || undefined,
      project: draftSnapshot.selectedProjectId,
    })
    .then(() => resetDraft())
    .catch((err: unknown) => {
      console.error('Failed to create agent workspace (as-is)', err);
      window
        .showMessageBox({
          title: 'Agent Workspace',
          type: 'error',
          message: `Error while creating workspace: ${err instanceof Error ? err.message : String(err)}`,
          buttons: ['OK'],
        })
        .catch(console.error);
    });
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACES });
}

function startWorkspace(): void {
  if (
    !wizard.draft.selectedGateway ||
    !getEffectiveWorkspaceName() ||
    !wizard.draft.selectedModel ||
    !isWorkspaceNameValid() ||
    validationErrors.name
  ) {
    return;
  }

  const draftSnapshot = $state.snapshot(wizard.draft);

  const selectedSkillPaths = $skillInfos.filter(s => draftSnapshot.selectedSkillIds.includes(s.name)).map(s => s.path);
  const network = mapNetworkSelection(
    draftSnapshot.selectedNetwork,
    draftSnapshot.hostsByMode[draftSnapshot.selectedNetwork] ?? [],
  );
  const mounts = buildMountsFrom(draftSnapshot.selectedFileAccess, draftSnapshot.customMounts);

  const selected = $mcpRemoteServerInfos.filter(m => draftSnapshot.selectedMcpIds.includes(m.id));
  const remoteServers = selected
    .filter(m => m.setupType === 'remote' || (!m.setupType && m.url))
    .map(m => ({ name: m.name, url: m.url }));
  const commandServers = selected
    .filter(m => m.setupType === 'package' && m.commandSpec)
    .map(m => ({
      name: m.name,
      command: m.commandSpec!.command,
      args: m.commandSpec!.args,
      env: m.commandSpec!.env,
    }));
  const hasMcp = remoteServers.length > 0 || commandServers.length > 0;

  window
    .createAgentWorkspace({
      sourcePath: draftSnapshot.sourcePath.trim() || undefined,
      agent: draftSnapshot.selectedAgent,
      image: draftSnapshot.customImage.trim() || undefined,
      model: getModelId(draftSnapshot.selectedModel!),
      gateway: draftSnapshot.selectedGateway,
      name: getEffectiveWorkspaceNameFromSnapshot(draftSnapshot),
      description: draftSnapshot.description || undefined,
      skills: selectedSkillPaths.length > 0 ? selectedSkillPaths : undefined,
      network,
      secrets: draftSnapshot.selectedSecretIds.length > 0 ? [...draftSnapshot.selectedSecretIds] : undefined,
      mounts,
      mcp: hasMcp
        ? {
            ...(remoteServers.length > 0 ? { servers: remoteServers } : {}),
            ...(commandServers.length > 0 ? { commands: commandServers } : {}),
          }
        : undefined,
      workspaceConfiguration: getAgentWorkspaceConfiguration(draftSnapshot.selectedAgent),
      replaceConfig: draftSnapshot.configExists && draftSnapshot.configAction === 'replace' ? true : undefined,
      project: draftSnapshot.selectedProjectId,
    })
    .then(() => resetDraft())
    .catch((err: unknown) => {
      console.error('Failed to create agent workspace', err);
      window
        .showMessageBox({
          title: 'Agent Workspace',
          type: 'error',
          message: `Error while creating workspace: ${err instanceof Error ? err.message : String(err)}`,
          buttons: ['OK'],
        })
        .catch(console.error);
    });
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACES });
}
</script>

<FormPage title="Create Agent Workspace">
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
      <div class="bg-[var(--pd-content-card-bg)] py-6">
        <div class="flex flex-col px-6 max-w-4xl mx-auto space-y-5">

          <!-- Page header -->
          <div class="mb-2">
            <span class="text-xs font-semibold uppercase tracking-widest text-[var(--pd-label-primary-text)] bg-[var(--pd-label-primary-bg)] px-2 py-0.5 rounded mb-2 inline-block">
              Coding Agent
            </span>
            <h1 class="text-2xl font-bold text-[var(--pd-modal-text)] mb-1">Create Coding Agent Workspace</h1>
            <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 max-w-2xl leading-relaxed">
              Choose a code location or start empty, then configure agent, tools, and sandbox settings.
            </p>
          </div>

          <!-- Stepper -->
          <WizardStepper steps={wizardSteps} currentIndex={currentStepIndex} onStepClick={handleStepClick} />

          <!-- Step content -->
          <div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] p-6">
            {#if currentStepId === 'workspace'}
              <AgentWorkspaceCreateStepWorkspace
                bind:sourcePath={wizard.draft.sourcePath}
                bind:sessionName={wizard.draft.sessionName}
                gateways={[...reachableGateways]}
                bind:selectedGateway={wizard.draft.selectedGateway}
                bind:description={wizard.draft.description}
                bind:nameManuallyEdited={wizard.draft.nameManuallyEdited}
                bind:descriptionOpen={wizard.draft.descriptionOpen}
                bind:projectOpen={wizard.draft.projectOpen}
                onBrowseSource={handleBrowseSource}
                configExists={wizard.draft.configExists}
                bind:configAction={wizard.draft.configAction}
                onStartAsIs={startAsIs}
                startAsIsDisabled={!hasModel || wizard.draft.selectedGateway === ''}
                projects={[...$workspaceProjectInfos]}
                selectedProjectId={wizard.draft.selectedProjectId}
                onProjectSelect={handleProjectSelect}
                errors={validationErrors} />
            {:else if currentStepId === 'agent-model'}
              <AgentWorkspaceCreateStepAgentModel bind:selectedAgent={wizard.draft.selectedAgent} bind:selectedModel={wizard.draft.selectedModel} bind:customImage={wizard.draft.customImage} bind:customImageFieldOpen={wizard.draft.customImageFieldOpen} />
            {:else if currentStepId === 'tools-secrets'}
              <AgentWorkspaceCreateStepToolsSecrets
                {skillItems}
                gateway={wizard.draft.selectedGateway}
                bind:selectedSkillIds={wizard.draft.selectedSkillIds}
                {mcpItems}
                bind:selectedMcpIds={wizard.draft.selectedMcpIds}
                bind:selectedSecretIds={wizard.draft.selectedSecretIds}
                bind:secretsLoading
                {knowledgeItems}
                bind:selectedKnowledgeIds={wizard.draft.selectedKnowledgeIds} />
            {:else if currentStepId === 'filesystem'}
              <AgentWorkspaceCreateStepFileSystem
                bind:selectedFileAccess={wizard.draft.selectedFileAccess}
                customMounts={wizard.draft.customMounts}
                onBrowseCustomPath={handleBrowseCustomPath}
                onAddCustomMount={addCustomMount}
                onRemoveCustomMount={removeCustomMount}
                onUpdateCustomMount={updateCustomMount} />
            {:else if currentStepId === 'networking'}
              <AgentWorkspaceCreateStepNetworking
                bind:selectedNetwork={wizard.draft.selectedNetwork}
                customHosts={customHosts}
                onAddCustomHost={addCustomHost}
                onRemoveCustomHost={removeCustomHost}
                onUpdateCustomHost={updateCustomHost} />
            {/if}
          </div>

          {#if error}
            <div class="text-sm text-red-400 bg-red-900/20 rounded-lg p-3">{error}</div>
          {/if}

          <!-- Footer actions -->
          <div class="flex items-center justify-between pt-4 border-t border-[var(--pd-content-card-border)]">
            <div class="flex items-center gap-3 text-sm text-[var(--pd-content-card-text)] opacity-70">
              <Icon icon={faLock} size="sm" class="text-green-400" />
              <span>Step {currentStepIndex + 1} of {wizardSteps.length} · Workspace will run in a secured sandbox environment</span>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-3">
              {#if currentStepIndex > 0}
                <Button onclick={goBack}>Back</Button>
              {/if}
              <Button onclick={cancel}>Cancel</Button>
              {#if currentStepId === 'workspace'}
                <Button type="secondary" disabled={!isCurrentStepComplete || !hasModel} onclick={startWorkspace}>
                  Use all defaults and create workspace
                </Button>
              {/if}
              {#if isLastStep}
                <Button disabled={!hasModel} onclick={startWorkspace}>
                  Start Workspace
                </Button>
              {:else}
                <Button disabled={!isCurrentStepComplete} onclick={goNext}>Continue</Button>
              {/if}
            </div>
          </div>

        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
