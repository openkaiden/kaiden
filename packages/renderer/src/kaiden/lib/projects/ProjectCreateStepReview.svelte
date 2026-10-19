<script lang="ts">
import { faCheckCircle, faCodeBranch, faFolderOpen } from '@fortawesome/free-solid-svg-icons';
import { Button, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { WorkspaceProjectAnalysis } from '/@api/workspace-project-info';

import { formatGitUrl } from './git-url-utils';

interface Props {
  analysis: WorkspaceProjectAnalysis | undefined;
  projectName: string;
  projectDescription: string;
  isGitSource?: boolean;
  gitRepoDisplay?: string;
  cloneTo?: string;
  onBrowseCloneTo?: () => Promise<void>;
  error?: string;
}

let {
  analysis,
  projectName = $bindable(),
  projectDescription = $bindable(),
  isGitSource = false,
  gitRepoDisplay = '',
  cloneTo = $bindable(''),
  onBrowseCloneTo,
  error = '',
}: Props = $props();

let displayFolder = $derived(analysis?.folder ?? '');
</script>

<h2 class="text-lg font-semibold text-(--pd-modal-text) mb-1">Review Project</h2>
<p class="text-sm text-(--pd-content-card-text) opacity-60 mb-5">
  Review and edit the detected project information.
</p>

{#if analysis}
  <!-- Success banner (local path analyzed) -->
  <div class="flex items-center gap-2 rounded-lg bg-(--pd-content-card-bg) border border-(--pd-state-success) px-4 py-3 mb-5">
    <Icon icon={faCheckCircle} class="text-(--pd-state-success)" />
    <span class="text-sm font-medium text-(--pd-state-success)">Project analyzed</span>
    <span class="ml-auto text-xs text-(--pd-content-card-text) opacity-70 font-mono">{displayFolder}</span>
  </div>
{/if}

<div class="space-y-4">
  <div>
    <label for="project-name" class="block text-xs font-semibold uppercase tracking-wider text-(--pd-content-card-text) opacity-70 mb-2">
      Project Name
    </label>
    <Input
      id="project-name"
      bind:value={projectName}
      placeholder="My Project"
      class="w-full"
    />
  </div>

  <div>
    <label for="project-description" class="block text-xs font-semibold uppercase tracking-wider text-(--pd-content-card-text) opacity-70 mb-2">
      Description
    </label>
    <textarea
      id="project-description"
      rows={3}
      bind:value={projectDescription}
      placeholder="Describe your project..."
      class="w-full field-sizing-content min-h-[3.5lh] rounded-sm text-sm bg-(--pd-input-field-bg) text-(--pd-input-field-focused-text) border border-(--pd-input-field-stroke) p-2 resize-none placeholder:text-(--pd-input-field-placeholder-text) focus:bg-(--pd-input-field-focused-bg) focus:border-(--pd-input-field-hover-stroke) focus:outline-none"
    ></textarea>
  </div>

  {#if !isGitSource}
    <div>
      <span class="block text-xs font-semibold uppercase tracking-wider text-(--pd-content-card-text) opacity-70 mb-2">
        Working Directory
      </span>
      <div class="rounded-lg bg-(--pd-content-card-bg) px-3 py-2.5 text-sm font-mono text-(--pd-content-card-text)">
        {displayFolder || '—'}
      </div>
    </div>

    {#if analysis?.gitRepository}
      <div>
        <span class="block text-xs font-semibold uppercase tracking-wider text-(--pd-content-card-text) opacity-70 mb-2">
          Git Repository
        </span>
        <div class="flex items-center gap-2 rounded-lg bg-(--pd-content-card-bg) px-3 py-2.5">
          <Icon icon={faCodeBranch} class="text-(--pd-content-card-text) opacity-50" size="sm" />
          <span class="text-sm font-mono text-(--pd-content-card-text)">{formatGitUrl(analysis.gitRepository)}</span>
          {#if analysis.gitBranch}
            <span class="ml-auto text-xs font-medium bg-(--pd-label-quaternary-bg) text-(--pd-label-quaternary-text) px-2 py-0.5 rounded">
              {analysis.gitBranch}
            </span>
          {/if}
        </div>
      </div>
    {/if}
  {:else}
    <!-- Git URL: show git repo + clone to -->
    <div>
      <span class="block text-xs font-semibold uppercase tracking-wider text-(--pd-content-card-text) opacity-70 mb-2">
        Git Repository
      </span>
      <div class="flex items-center gap-2 rounded-lg bg-(--pd-content-card-bg) px-3 py-2.5">
        <Icon icon={faCodeBranch} class="text-(--pd-content-card-text) opacity-50" size="sm" />
        <span class="text-sm font-mono text-(--pd-content-card-text)">{gitRepoDisplay}</span>
      </div>
    </div>

    <div>
      <label for="project-clone-to" class="block text-xs font-semibold uppercase tracking-wider text-(--pd-content-card-text) opacity-70 mb-2">
        Clone To
      </label>
      <div class="flex gap-2 items-stretch">
        <Input
          id="project-clone-to"
          bind:value={cloneTo}
          placeholder="~/Dev/my-project"
          class="grow font-mono text-sm"
        />
        <Button onclick={onBrowseCloneTo} aria-label="Browse for clone directory" icon={faFolderOpen}>
          Browse
        </Button>
      </div>
      <p class="text-xs text-(--pd-content-card-text) opacity-50 mt-1.5">
        The repository will be cloned into this path. The parent directory must exist.
      </p>
    </div>
  {/if}
</div>

{#if error}
  <p class="text-sm text-(--pd-state-error) mt-4">{error}</p>
{/if}
