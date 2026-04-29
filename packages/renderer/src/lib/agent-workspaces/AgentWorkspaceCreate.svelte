<script lang="ts">
import { faLock } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { toast } from 'svelte-sonner';

import AgentWorkspaceCreateStepAgentModel from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepAgentModel.svelte';
import type { FileAccessOption } from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepFileSystem.svelte';
import AgentWorkspaceCreateStepFileSystem from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepFileSystem.svelte';
import AgentWorkspaceCreateStepNetworking from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepNetworking.svelte';
import AgentWorkspaceCreateStepToolsSecrets from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepToolsSecrets.svelte';
import AgentWorkspaceCreateStepWorkspace from '/@/lib/agent-workspaces/AgentWorkspaceCreateStepWorkspace.svelte';
import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import type { ScrollableCardItem } from '/@/lib/ui/ScrollableCardSelector.svelte';
import WizardStepper from '/@/lib/ui/WizardStepper.svelte';
import { handleNavigation } from '/@/navigation';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { skillInfos } from '/@/stores/skills';
import { NavigationPage } from '/@api/navigation-page';

const fileAccessOptions: FileAccessOption[] = [
  {
    value: 'workspace',
    name: 'No host filesystem access',
    description: 'The agent cannot read or write files on your host. Use for API-only or fully remote workflows.',
    access: 'None',
    notes: 'Strict isolation',
    badge: 'Recommended',
  },
  {
    value: 'home',
    name: 'Home Directory',
    description: 'Agent can access your entire home directory (~/) and all subdirectories.',
    access: 'Home (~)',
    notes: 'Local development',
  },
  {
    value: 'custom',
    name: 'Custom Paths',
    description: 'Specify exact directories the agent can access.',
    access: 'Listed paths',
    notes: 'Set path below',
  },
  {
    value: 'full',
    name: 'Full System Access',
    description: 'Agent can access the entire filesystem. Use with caution.',
    access: 'Full host',
    notes: 'High privilege',
  },
];

const wizardSteps = [
  { id: 'workspace', title: 'Workspace' },
  { id: 'agent-model', title: 'Agent & Model' },
  { id: 'tools-secrets', title: 'Tools & Secrets' },
  { id: 'filesystem', title: 'File System' },
  { id: 'networking', title: 'Networking' },
];

let skillItems: ChecklistItem[] = $derived(
  $skillInfos.map(s => ({
    id: s.name,
    name: s.name,
    description: s.description,
    group: s.managed ? 'Custom' : 'Pre-built',
  })),
);
let mcpItems: ScrollableCardItem[] = $derived(
  $mcpRemoteServerInfos.map(m => ({ id: m.id, name: m.name, description: m.description })),
);

// --- Form state ---
let sourcePath = $state('');
let sessionName = $state('');
let description = $state('');
let selectedAgent = $state('opencode');
let selectedModel = $state('');
let selectedFileAccess = $state('workspace');
let selectedSkillIds = $derived(skillItems.map(s => s.id));
let selectedMcpIds = $derived(mcpItems.map(m => m.id));
let selectedSecretIds = $derived($secretVaultInfos.map(s => s.id));
let customPaths = $state<string[]>(['']);

// --- Step 1 UI state ---
let nameManuallyEdited = $state(false);
let descriptionOpen = $state(false);

function getDefaultSessionName(path: string): string {
  const normalized = path.trim().replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

$effect(() => {
  if (nameManuallyEdited) return;
  const last = getDefaultSessionName(sourcePath);
  if (last) sessionName = last;
});

// --- Wizard navigation ---
let currentStepIndex = $state(0);
let error = $state('');

let currentStepId = $derived(wizardSteps[currentStepIndex]?.id ?? '');
let isLastStep = $derived(currentStepIndex === wizardSteps.length - 1);
let isCurrentStepComplete = $derived(
  currentStepId === 'workspace' ? sessionName.trim() !== '' && sourcePath.trim() !== '' : true,
);

function goNext(): void {
  if (currentStepIndex < wizardSteps.length - 1) currentStepIndex++;
}

function goBack(): void {
  if (currentStepIndex > 0) currentStepIndex--;
}

function handleStepClick(index: number): void {
  currentStepIndex = index;
}

function addCustomPath(): void {
  customPaths = [...customPaths, ''];
}

function removeCustomPath(index: number): void {
  if (customPaths.length <= 1) return;
  customPaths = customPaths.filter((_, i) => i !== index);
}

function updateCustomPath(index: number, value: string): void {
  customPaths = customPaths.map((p, i) => (i === index ? value : p));
}

async function handleBrowseCustomPath(index: number): Promise<void> {
  try {
    const result = await window.openDialog({ title: 'Select a directory', selectors: ['openDirectory'] });
    const selected = result?.[0];
    if (selected) updateCustomPath(index, selected);
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
      sourcePath = selected;
      if (!nameManuallyEdited) {
        const lastSegment = getDefaultSessionName(selected);
        if (lastSegment) sessionName = lastSegment;
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    error = message;
    toast.error(`Failed to browse for directory: ${message}`);
  }
}

function cancel(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACES });
}

async function startWorkspace(): Promise<void> {
  if (!sessionName.trim() || !sourcePath.trim()) return;

  handleNavigation({ page: NavigationPage.AGENT_WORKSPACES });

  try {
    await window.createAgentWorkspace({
      sourcePath,
      agent: selectedAgent,
      model: selectedModel || undefined,
      name: sessionName,
    });
  } catch (err: unknown) {
    console.error('Failed to create agent workspace', err);
  }
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
              Add your code location first, then agent, tools, and sandbox filesystem & networking.
            </p>
          </div>

          <!-- Stepper -->
          <WizardStepper steps={wizardSteps} currentIndex={currentStepIndex} onStepClick={handleStepClick} />

          <!-- Step content -->
          <div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] p-6">
            {#if currentStepId === 'workspace'}
              <AgentWorkspaceCreateStepWorkspace
                bind:sourcePath
                bind:sessionName
                bind:description
                bind:nameManuallyEdited
                bind:descriptionOpen
                onBrowseSource={handleBrowseSource} />
            {:else if currentStepId === 'agent-model'}
              <AgentWorkspaceCreateStepAgentModel bind:selectedAgent bind:selectedModel />
            {:else if currentStepId === 'tools-secrets'}
              <AgentWorkspaceCreateStepToolsSecrets
                {skillItems}
                bind:selectedSkillIds
                {mcpItems}
                bind:selectedMcpIds
                bind:selectedSecretIds />
            {:else if currentStepId === 'filesystem'}
              <AgentWorkspaceCreateStepFileSystem
                {fileAccessOptions}
                bind:selectedFileAccess
                {customPaths}
                onBrowseCustomPath={handleBrowseCustomPath}
                onAddCustomPath={addCustomPath}
                onRemoveCustomPath={removeCustomPath}
                onUpdateCustomPath={updateCustomPath} />
            {:else if currentStepId === 'networking'}
              <AgentWorkspaceCreateStepNetworking />
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
                <Button type="secondary" disabled={!isCurrentStepComplete} onclick={startWorkspace}>
                  Use all defaults and create workspace
                </Button>
              {/if}
              {#if isLastStep}
                <Button onclick={startWorkspace}>
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
