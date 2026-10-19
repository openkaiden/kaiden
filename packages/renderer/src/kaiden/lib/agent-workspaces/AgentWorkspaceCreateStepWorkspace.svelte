<script lang="ts">
import { faChevronDown, faFolder, faFolderOpen, faInfoCircle, faRocket } from '@fortawesome/free-solid-svg-icons';
import { Button, Dropdown, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import WorkspaceDescriptionField from '/@/kaiden/lib/agent-workspaces/WorkspaceDescriptionField.svelte';
import { getSandboxNameValidationError } from '/@api/agent-workspace-info';
import type { GatewayInfo } from '/@api/openshell-gateway-info';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

interface Props {
  sourcePath: string;
  sessionName: string;
  gateways?: GatewayInfo[];
  selectedGateway?: string;
  description: string;
  nameManuallyEdited: boolean;
  descriptionOpen: boolean;
  projectOpen: boolean;
  onBrowseSource: () => Promise<void>;
  configExists?: boolean;
  configAction?: 'merge' | 'replace';
  onStartAsIs?: () => void;
  startAsIsDisabled?: boolean;
  projects?: WorkspaceProjectInfo[];
  selectedProjectId?: string;
  onProjectSelect?: (project: WorkspaceProjectInfo | undefined) => void;
  errors?: { name?: string };
}

let {
  sourcePath = $bindable(),
  sessionName = $bindable(),
  gateways = [],
  selectedGateway = $bindable(''),
  description = $bindable(),
  nameManuallyEdited = $bindable(),
  descriptionOpen = $bindable(),
  projectOpen = $bindable(),
  onBrowseSource,
  configExists = false,
  configAction = $bindable('merge'),
  onStartAsIs,
  startAsIsDisabled = false,
  projects = [],
  selectedProjectId,
  onProjectSelect,
  errors = {},
}: Props = $props();

function markNameEdited(): void {
  nameManuallyEdited = true;
}

function toggleDescription(): void {
  descriptionOpen = !descriptionOpen;
}

function toggleProject(): void {
  projectOpen = !projectOpen;
}

function getEffectiveWorkspaceName(name: string, path: string): string {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed;
  }
  const normalized = path.trim().replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
}

let effectiveName = $derived(getEffectiveWorkspaceName(sessionName, sourcePath));
let nameToValidate = $derived(nameManuallyEdited ? sessionName.trim() : effectiveName);
let sessionNameError = $derived(
  nameToValidate || nameManuallyEdited ? getSandboxNameValidationError(nameToValidate) : undefined,
);
let nameInputError = $derived(sessionNameError ?? errors?.name ?? '');
</script>

<h2 class="text-lg font-semibold text-[var(--pd-modal-text)] mb-1">Workspace</h2>
<p class="text-sm text-[var(--pd-content-card-text)] opacity-60 mb-5">
  Point to a local project folder, or leave it empty for a sandbox-only workspace.
</p>

<div class="space-y-4">
  {#if gateways.length > 1}
    <div>
      <label for="workspace-gateway" class="block text-sm font-semibold text-[var(--pd-modal-text)] mb-2">
        Gateway
      </label>
      <Dropdown id="workspace-gateway" name="workspace-gateway" class="w-full" bind:value={selectedGateway}>
        {#each gateways as gateway (gateway.name)}
          <option value={gateway.name}>{gateway.name} — {gateway.endpoint}</option>
        {/each}
      </Dropdown>
      <p class="text-xs text-[var(--pd-content-card-text)] opacity-50 mt-1.5">
        The workspace will be created on this OpenShell gateway.
      </p>
    </div>
  {/if}

  <div>
    <label for="workspace-source" class="block text-sm font-semibold text-[var(--pd-modal-text)] mb-2">
      Project folder <span class="text-xs font-normal opacity-50">(optional)</span>
    </label>
    <div class="flex gap-2 items-stretch">
      <Input
        id="workspace-source"
        bind:value={sourcePath}
        placeholder="/path/to/project"
        class="grow font-mono text-sm"
      />
      <Button onclick={onBrowseSource} aria-label="Browse for folder" icon={faFolderOpen} />
    </div>
    <p class="text-xs text-[var(--pd-content-card-text)] opacity-50 mt-1.5">
      Select a local directory, or leave empty for a sandbox-only workspace.
    </p>
  </div>

  {#if configExists}
    <div class="rounded-lg border border-blue-500/30 bg-blue-500/10 p-4 space-y-3" role="status">
      <div class="flex items-start gap-2">
        <Icon icon={faInfoCircle} size="sm" class="text-blue-400 mt-0.5 shrink-0" />
        <p class="text-sm text-[var(--pd-modal-text)]">
          An existing workspace configuration was found in this folder.
        </p>
      </div>

      <div class="flex flex-col gap-3 pl-6">
        <Button type="secondary" disabled={startAsIsDisabled} onclick={onStartAsIs} aria-label="Start workspace as-is">
          Start workspace as-is
        </Button>

        <p class="text-xs text-[var(--pd-content-card-text)] opacity-60">
          Or continue below to configure a new workspace:
        </p>

        <div class="flex items-center gap-4">
          <label class="flex items-center gap-1.5 text-sm text-[var(--pd-modal-text)] cursor-pointer">
            <input
              type="radio"
              name="config-action"
              value="merge"
              checked={configAction === 'merge'}
              onchange={(): void => { configAction = 'merge'; }}
              class="accent-blue-500" />
            Merge with existing
          </label>
          <label class="flex items-center gap-1.5 text-sm text-[var(--pd-modal-text)] cursor-pointer">
            <input
              type="radio"
              name="config-action"
              value="replace"
              checked={configAction === 'replace'}
              onchange={(): void => { configAction = 'replace'; }}
              class="accent-blue-500" />
            Replace existing
          </label>
        </div>
      </div>
    </div>
  {/if}

  <div>
    <label for="workspace-name" class="block text-sm font-semibold text-[var(--pd-modal-text)] mb-2">
      Workspace name
    </label>
    <Input
      id="workspace-name"
      bind:value={sessionName}
      placeholder="e.g., front-refactor"
      class="w-full"
      oninput={markNameEdited}
      error={nameInputError}
      aria-invalid={nameInputError !== ''}
    />
  </div>

  <div class="rounded-xl border border-[var(--pd-content-card-border)]/85 bg-[var(--pd-content-card-bg)]/35 overflow-hidden">
    <button
      class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--pd-modal-text)] hover:bg-[var(--pd-content-card-inset-bg)]/50 transition-colors cursor-pointer"
      onclick={toggleDescription}>
      <span>
        Description <span class="text-xs font-normal opacity-50">(optional)</span>
      </span>
      <span
        class="transition-transform duration-150 {descriptionOpen ? 'rotate-180' : ''}"
        aria-hidden="true">
        <Icon icon={faChevronDown} size="xs" />
      </span>
    </button>
    {#if descriptionOpen}
      <div class="px-4 pb-4">
        <label for="workspace-description" class="block text-xs text-[var(--pd-content-card-text)] opacity-60 mb-1.5">
          What should this workspace focus on?
        </label>
        <WorkspaceDescriptionField
          bind:value={description}
          placeholder="e.g. Debug the login timeout — reproduce issue #42 and propose a fix (optional, max 500 chars)"
        />
      </div>
    {/if}
  </div>

  {#if projects.length > 0}
    <div class="rounded-xl border border-[var(--pd-content-card-border)]/85 bg-[var(--pd-content-card-bg)]/35 overflow-hidden">
      <button
        class="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-[var(--pd-modal-text)] hover:bg-[var(--pd-content-card-inset-bg)]/50 transition-colors cursor-pointer"
        onclick={toggleProject}>
        <span>
          Saved project <span class="text-xs font-normal opacity-50">(optional)</span>
        </span>
        <span
          class="transition-transform duration-150 {projectOpen ? 'rotate-180' : ''}"
          aria-hidden="true">
          <Icon icon={faChevronDown} size="xs" />
        </span>
      </button>
      {#if projectOpen}
        <div class="px-4 pb-4 space-y-3">
          <p class="text-xs text-[var(--pd-content-card-text)] opacity-60">
            Load defaults from a project — path, skills, MCP, secrets, and access presets.
          </p>
          <div role="listbox" aria-label="Project selection" class="space-y-2">
            <button
              type="button"
              role="option"
              aria-selected={selectedProjectId === undefined}
              class="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer text-left text-sm transition-colors
                {selectedProjectId === undefined
                  ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)] text-[var(--pd-modal-text)]'
                  : 'border-[var(--pd-content-card-border)] bg-transparent text-[var(--pd-content-card-text)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
              onclick={(): void => onProjectSelect?.(undefined)}>
              <span class="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0
                {selectedProjectId === undefined ? 'border-[var(--pd-link)]' : 'border-[var(--pd-content-card-border)]'}">
                {#if selectedProjectId === undefined}
                  <span class="w-2 h-2 rounded-full bg-[var(--pd-link)]"></span>
                {/if}
              </span>
              <span>None — keep what I entered above</span>
            </button>

            <div class="grid grid-cols-2 gap-2">
              {#each projects as project (project.id)}
                {@const isSelected = selectedProjectId === project.id}
                {@const resourceCount = project.skills.length + project.mcpServers.length + project.secrets.length + project.knowledges.length}
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  class="flex flex-col gap-2 p-3 rounded-lg border cursor-pointer text-left transition-colors
                    {isSelected
                      ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
                      : 'border-[var(--pd-content-card-border)] bg-transparent hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
                  onclick={(): void => onProjectSelect?.(project)}>
                  <div class="flex items-center gap-2">
                    <div class="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--pd-link)]/15 text-[var(--pd-link)] shrink-0">
                      <Icon icon={faRocket} size="sm" />
                    </div>
                    <span class="font-semibold text-sm text-[var(--pd-modal-text)] truncate">{project.name}</span>
                  </div>
                  <div class="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--pd-content-card-text)] opacity-60">
                    <span class="flex items-center gap-1">
                      <Icon icon={faFolder} size="xs" />
                      <span class="font-mono truncate max-w-[160px]">{project.folder}</span>
                    </span>
                    {#if resourceCount > 0}
                      <span>{resourceCount} resource{resourceCount !== 1 ? 's' : ''}</span>
                    {/if}
                  </div>
                </button>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
