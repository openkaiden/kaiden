<script lang="ts">
import { Button } from '@podman-desktop/ui-svelte';
import { toast } from '@zerodevx/svelte-toast';

import { toastThemes } from '/@/lib/toast/toast-themes';
import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import WizardStepper from '/@/lib/ui/WizardStepper.svelte';
import { handleNavigation } from '/@/navigation';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { skillInfos } from '/@/stores/skills';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectAnalysis } from '/@api/workspace-project-info';

import { extractRepoName, extractRepoSlug, formatGitUrl } from './git-url-utils';
import ProjectCreateStepMcpServers, { type McpServerItem } from './ProjectCreateStepMcpServers.svelte';
import ProjectCreateStepReview from './ProjectCreateStepReview.svelte';
import ProjectCreateStepSecrets from './ProjectCreateStepSecrets.svelte';
import ProjectCreateStepSkills from './ProjectCreateStepSkills.svelte';
import ProjectCreateStepSource from './ProjectCreateStepSource.svelte';

const wizardSteps = [
  { id: 'source', title: 'Source' },
  { id: 'review', title: 'Review' },
  { id: 'mcp-servers', title: 'MCP Servers' },
  { id: 'secrets', title: 'Secrets' },
  { id: 'skills', title: 'Skills' },
];

let currentStepIndex = $state(0);
let currentStepId = $derived(wizardSteps[currentStepIndex]?.id ?? '');
let isLastStep = $derived(currentStepIndex === wizardSteps.length - 1);

let sourcePath = $state('');
let gitUrl = $state('');
let analyzing = $state(false);
let creating = $state(false);
let analysis = $state<WorkspaceProjectAnalysis | undefined>(undefined);

let projectName = $state('');
let projectDescription = $state('');
let cloneTo = $state('');
let error = $state('');

let selectedSkillIds = $state<string[]>([]);
let selectedSecretIds = $state<string[]>([]);

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

const RECOMMENDED_SERVER_KEYWORDS = ['github', 'fetch'];

function isRecommendedServer(name: string): boolean {
  const lower = name.toLowerCase();
  return RECOMMENDED_SERVER_KEYWORDS.some(kw => lower.includes(kw));
}

let mcpItems: McpServerItem[] = $derived(
  $mcpRemoteServerInfos.map(m => ({
    id: m.id,
    name: m.name,
    description: m.description,
    recommended: isRecommendedServer(m.name),
  })),
);
let selectedMcpIds: string[] = $state([]);
let hasInitializedMcpSelection = $state(false);

let isGitSource = $derived(gitUrl.trim() !== '' && sourcePath.trim() === '');
let gitRepoDisplay = $derived(formatGitUrl(gitUrl));

let isSourceStepComplete = $derived(sourcePath.trim() !== '' || gitUrl.trim() !== '');
let isReviewStepComplete = $derived.by(() => {
  if (isGitSource) {
    return projectName.trim() !== '' && cloneTo.trim() !== '';
  }
  return projectName.trim() !== '';
});

function goBack(): void {
  if (currentStepIndex > 0) currentStepIndex--;
}

function preselectRecommendedMcpServers(): void {
  if (hasInitializedMcpSelection || mcpItems.length === 0) return;
  selectedMcpIds = mcpItems.filter(m => m.recommended).map(m => m.id);
  hasInitializedMcpSelection = true;
}

function handleStepClick(index: number): void {
  if (index > currentStepIndex && !isGitSource && !analysis) {
    return;
  }
  currentStepIndex = index;
  if (wizardSteps[index]?.id === 'mcp-servers') preselectRecommendedMcpServers();
}

async function handleBrowseSource(): Promise<void> {
  try {
    const result = await window.openDialog({ title: 'Select a working directory', selectors: ['openDirectory'] });
    const selected = result?.[0];
    if (selected) {
      sourcePath = selected;
      analysis = undefined;
      projectName = '';
      projectDescription = '';
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast.push(`Failed to browse for directory: ${message}`, { theme: toastThemes.error });
  }
}

async function handleBrowseCloneTo(): Promise<void> {
  try {
    const result = await window.openDialog({ title: 'Select parent directory', selectors: ['openDirectory'] });
    const selected = result?.[0];
    if (selected) {
      const repoSlug = extractRepoSlug(gitUrl);
      cloneTo = `${selected}/${repoSlug}`;
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast.push(`Failed to browse for directory: ${message}`, { theme: toastThemes.error });
  }
}

function initializeSkillSelection(): void {
  selectedSkillIds = $skillInfos.filter(s => s.enabled).map(s => s.name);
}

function initializeSecretSelection(): void {
  selectedSecretIds = $secretVaultInfos.map(s => s.id);
}

async function handleAnalyze(): Promise<void> {
  if (isGitSource) {
    projectName = extractRepoName(gitUrl);
    projectDescription = 'Cloned from remote repository.';
    cloneTo = '';
    analysis = undefined;
    initializeSkillSelection();
    initializeSecretSelection();
    currentStepIndex = 1;
    return;
  }

  const path = sourcePath.trim();
  if (!path) return;

  analyzing = true;
  try {
    const result = await window.analyzeWorkspaceProject(path);
    analysis = result;
    projectName = result.name;
    projectDescription = result.description ?? '';
    initializeSkillSelection();
    initializeSecretSelection();
    currentStepIndex = 1;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    toast.push(`Failed to analyze project: ${message}`, { theme: toastThemes.error });
  } finally {
    analyzing = false;
  }
}

function cancel(): void {
  handleNavigation({ page: NavigationPage.PROJECTS });
}

async function createProject(): Promise<void> {
  if (!projectName.trim()) return;

  error = '';
  creating = true;
  try {
    let folder: string;

    if (isGitSource) {
      const result = await window.cloneAndAnalyzeWorkspaceProject(gitUrl.trim(), cloneTo.trim());
      folder = result.folder;
    } else {
      if (!analysis) {
        throw new Error('Please analyze the selected working directory before creating the project.');
      }
      folder = analysis.folder;
    }

    await window.createWorkspaceProject({
      name: projectName.trim(),
      description: projectDescription.trim() || undefined,
      folder,
      skills: [...selectedSkillIds],
      mcpServers: [...selectedMcpIds],
      knowledges: [],
      secrets: [...selectedSecretIds],
      filesystem: { mode: 'project', mounts: [] },
      network: { mode: 'allow' },
    });
    toast.push(`Project "${projectName}" created successfully`, { theme: toastThemes.success });
    handleNavigation({ page: NavigationPage.PROJECTS });
  } catch (err: unknown) {
    console.error('Failed to create project', err);
    error = err instanceof Error ? err.message : String(err);
  } finally {
    creating = false;
  }
}
</script>

<FormPage title="New Project">
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
      <div class="bg-(--pd-content-card-bg) py-6">
        <div class="flex flex-col px-6 max-w-4xl mx-auto space-y-5">

          <!-- Page header -->
          <div class="mb-2">
            <h1 class="text-2xl font-bold text-(--pd-modal-text) mb-1">New Project</h1>
            <p class="text-sm text-(--pd-content-card-text) opacity-70 max-w-2xl leading-relaxed">
              Point Kaiden to a local working directory or a git repository, and we'll analyze your project automatically.
            </p>
          </div>

          <!-- Stepper -->
          <WizardStepper steps={wizardSteps} currentIndex={currentStepIndex} onStepClick={handleStepClick} />

          <!-- Step content -->
          <div class="rounded-xl border border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg) p-6">
            {#if currentStepId === 'source'}
              <ProjectCreateStepSource
                bind:sourcePath={sourcePath}
                bind:gitUrl={gitUrl}
                onBrowseSource={handleBrowseSource}
              />
            {:else if currentStepId === 'skills'}
              <ProjectCreateStepSkills
                {skillItems}
                bind:selectedSkillIds={selectedSkillIds}
              />
            {:else if currentStepId === 'review'}
              <ProjectCreateStepReview
                {analysis}
                bind:projectName={projectName}
                bind:projectDescription={projectDescription}
                {isGitSource}
                {gitRepoDisplay}
                bind:cloneTo={cloneTo}
                onBrowseCloneTo={handleBrowseCloneTo}
                {error}
              />
            {:else if currentStepId === 'mcp-servers'}
              <ProjectCreateStepMcpServers
                {mcpItems}
                bind:selectedMcpIds={selectedMcpIds}
              />
            {:else if currentStepId === 'secrets'}
              <ProjectCreateStepSecrets
                bind:selectedSecretIds={selectedSecretIds}
              />
            {/if}
          </div>

          <!-- Footer actions -->
          <div class="flex items-center justify-between pt-4 border-t border-(--pd-content-card-border)">
            <div class="flex items-center gap-3 text-sm text-(--pd-content-card-text) opacity-70">
              <span>Step {currentStepIndex + 1} of {wizardSteps.length}</span>
            </div>
            <div class="flex flex-wrap items-center justify-end gap-3">
              {#if currentStepIndex > 0}
                <Button onclick={goBack}>Back</Button>
              {/if}
              <Button onclick={cancel}>Cancel</Button>
              {#if currentStepId === 'source'}
                <Button disabled={!isSourceStepComplete || analyzing} onclick={handleAnalyze}>
                  {analyzing ? 'Analyzing...' : 'Analyze'}
                </Button>
              {:else if isLastStep}
                <Button disabled={!isReviewStepComplete || creating} onclick={createProject}>
                  {#if creating}
                    {isGitSource ? 'Cloning & Creating...' : 'Creating...'}
                  {:else}
                    Create Project
                  {/if}
                </Button>
              {:else}
                <Button onclick={(): void => { currentStepIndex++; if (wizardSteps[currentStepIndex]?.id === 'mcp-servers') preselectRecommendedMcpServers(); }}>Continue</Button>
              {/if}
            </div>
          </div>

        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
