<script lang="ts">
import {
  faCode,
  faFolder,
  faGears,
  faHome,
  faLock,
  faO,
  faPlus,
  faRobot,
  faServer,
  faShieldHalved,
  faTriangleExclamation,
  faWrench,
} from '@fortawesome/free-solid-svg-icons';
import { Button, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { Textarea } from '/@/lib/chat/components/ui/textarea';
import CardSelector from '/@/lib/ui/CardSelector.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import type { ScrollableCardItem } from '/@/lib/ui/ScrollableCardSelector.svelte';
import ScrollableCardSelector from '/@/lib/ui/ScrollableCardSelector.svelte';
import { handleNavigation } from '/@/navigation';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { skillInfos } from '/@/stores/skills';
import { NavigationPage } from '/@api/navigation-page';

// Mock coding agents until real provider connections are available
const agentOptions = [
  {
    title: 'OpenCode',
    badge: 'Anomaly',
    value: 'opencode',
    icon: faO,
    description: 'Open-source terminal-based coding agent',
  },
  {
    title: 'Claude',
    badge: 'Anthropic',
    value: 'claude',
    icon: faRobot,
    description: `Anthropic's AI coding assistant`,
  },
  { title: 'Cursor', badge: 'Cursor', value: 'cursor', icon: faCode, description: 'AI-powered code editor agent' },
  {
    title: 'Goose',
    badge: 'Block',
    value: 'goose',
    icon: faWrench,
    description: 'Open-source autonomous coding agent',
  },
];

// --- File access options for CardSelector ---
const fileAccessOptions = [
  {
    title: 'Working Directory Only',
    badge: 'Recommended',
    value: 'workspace',
    icon: faFolder,
    description: 'Restrict access to the project working directory',
  },
  {
    title: 'Home Directory',
    badge: '~/  access',
    value: 'home',
    icon: faHome,
    description: 'Allow access to the user home directory',
  },
  {
    title: 'Custom Paths',
    badge: 'Configurable',
    value: 'custom',
    icon: faGears,
    description: 'Specify custom paths the agent can access',
  },
  {
    title: 'Full System Access',
    badge: 'Caution',
    value: 'full',
    icon: faTriangleExclamation,
    description: 'Unrestricted filesystem access — use with care',
  },
];

// Derive card items for ScrollableCardSelector
let skillItems: ScrollableCardItem[] = $derived(
  $skillInfos.map(s => ({ id: s.name, name: s.name, description: s.description })),
);

let mcpItems: ScrollableCardItem[] = $derived(
  $mcpRemoteServerInfos.map(m => ({ id: m.id, name: m.name, description: m.description })),
);

// --- Form state ---
let sessionName = $state('');
let workingDir = $state('');
let description = $state('');
let selectedAgent = $state('');
let selectedFileAccess = $state('workspace');
let selectedSkillIds = $state<string[]>([]);
let selectedMcpIds = $state<string[]>([]);
let customPaths = $state<string[]>(['']);

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

function cancel(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACES });
}

function startWorkspace(): void {
  if (!sessionName.trim()) return;

  const config = {
    name: sessionName,
    workingDir,
    description,
    agent: selectedAgent,
    fileAccess: selectedFileAccess,
    customPaths: selectedFileAccess === 'custom' ? customPaths.filter(p => p.trim()) : undefined,
    skills: selectedSkillIds,
    mcpServers: selectedMcpIds,
  };
  console.log('Starting workspace with config:', config);
}
</script>

<FormPage title="Create Agent Workspace">
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
      <div class="bg-[var(--pd-content-card-bg)] py-6">
        <div class="flex flex-col px-6 max-w-4xl mx-auto space-y-5">

          <!-- Page header -->
          <div>
            <h1 class="text-2xl font-bold text-[var(--pd-modal-text)]">Create Coding Agent Workspace</h1>
            <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 mt-2">
              Configure your coding agent with the skills, tools, and access permissions it needs.
              The session will run in a secure sandbox environment.
            </p>
          </div>

          <!-- Session Details -->
          <section class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] p-6">
            <div class="flex items-center gap-4 mb-5">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--pd-label-primary-bg)] text-[var(--pd-label-primary-text)]">
                <Icon icon={faCode} size="lg" />
              </div>
              <div class="flex flex-col">
                <span class="text-lg font-semibold text-[var(--pd-modal-text)]">Session Details</span>
                <span class="text-xs text-[var(--pd-content-card-text)] opacity-70">Give your session a name and select the coding agent</span>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-4 mb-4">
              <div>
                <span class="block text-sm font-semibold text-[var(--pd-modal-text)] mb-2">Session Name</span>
                <Input bind:value={sessionName} placeholder="e.g., Frontend Refactoring" class="w-full" />
              </div>
              <div>
                <span class="block text-sm font-semibold text-[var(--pd-modal-text)] mb-2">Working Directory</span>
                <Input bind:value={workingDir} placeholder="/path/to/project" class="w-full" />
              </div>
            </div>

            <div class="mb-5">
              <span class="block text-sm font-semibold text-[var(--pd-modal-text)] mb-2">Description (optional)</span>
              <Textarea
                bind:value={description}
                placeholder="Describe what this session will accomplish..."
                rows={2}
                class="bg-muted min-h-[24px] resize-none rounded-lg !text-sm dark:border-zinc-700"
              />
            </div>

            <CardSelector
              label="Select Coding Agent"
              options={agentOptions}
              bind:selected={selectedAgent}
            />
          </section>

          <!-- Skills -->
          {#if skillItems.length > 0}
            <section class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] p-6">
              <div class="flex items-center gap-4 mb-5">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--pd-label-tertiary-bg)] text-[var(--pd-label-tertiary-text)]">
                  <Icon icon={faWrench} size="lg" />
                </div>
                <div class="flex flex-col">
                  <span class="text-lg font-semibold text-[var(--pd-modal-text)]">Skills</span>
                  <span class="text-xs text-[var(--pd-content-card-text)] opacity-70">Select the capabilities your agent should have</span>
                </div>
              </div>

              <ScrollableCardSelector
                items={skillItems}
                bind:selected={selectedSkillIds}
                placeholder="Search skills..."
              />
            </section>
          {/if}

          <!-- MCP Servers -->
          {#if mcpItems.length > 0}
            <section class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] p-6">
              <div class="flex items-center gap-4 mb-5">
                <div class="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--pd-label-secondary-bg)] text-[var(--pd-label-secondary-text)]">
                  <Icon icon={faServer} size="lg" />
                </div>
                <div class="flex flex-col">
                  <span class="text-lg font-semibold text-[var(--pd-modal-text)]">MCP Servers</span>
                  <span class="text-xs text-[var(--pd-content-card-text)] opacity-70">Connect to Model Context Protocol servers for extended capabilities</span>
                </div>
              </div>

              <ScrollableCardSelector
                items={mcpItems}
                bind:selected={selectedMcpIds}
                placeholder="Search MCP servers..."
              />
            </section>
          {/if}

          <!-- File System Access -->
          <section class="rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-inset-bg)] p-6">
            <div class="flex items-center gap-4 mb-5">
              <div class="w-10 h-10 rounded-lg flex items-center justify-center bg-[var(--pd-label-quaternary-bg)] text-[var(--pd-label-quaternary-text)]">
                <Icon icon={faShieldHalved} size="lg" />
              </div>
              <div class="flex flex-col">
                <span class="text-lg font-semibold text-[var(--pd-modal-text)]">File System Access</span>
                <span class="text-xs text-[var(--pd-content-card-text)] opacity-70">Define which directories the agent can access on your host system</span>
              </div>
            </div>

            <CardSelector
              label="Access Level"
              options={fileAccessOptions}
              bind:selected={selectedFileAccess}
            />

            {#if selectedFileAccess === 'custom'}
              <div class="mt-4 p-4 rounded-lg bg-[var(--pd-content-card-inset-bg)]">
                {#each customPaths as path, index (index)}
                  <div class="flex gap-3 mb-2">
                    <Input
                      value={path}
                      placeholder="/path/to/allowed/directory"
                      class="flex-1 font-mono text-sm"
                      oninput={(e: Event): void => updateCustomPath(index, (e.target as HTMLInputElement).value)}
                    />
                    {#if customPaths.length > 1}
                      <Button class="text-red-400" onclick={(): void => removeCustomPath(index)}>Remove</Button>
                    {/if}
                  </div>
                {/each}
                <Button class="mt-2" icon={faPlus} onclick={addCustomPath}>Add Another Path</Button>
              </div>
            {/if}
          </section>

          <!-- Footer actions -->
          <div class="flex items-center justify-between pt-4 border-t border-[var(--pd-content-card-border)]">
            <div class="flex items-center gap-3 text-sm text-[var(--pd-content-card-text)] opacity-70">
              <Icon icon={faLock} size="sm" />
              <span>Workspace will run in a secured sandbox environment</span>
            </div>
            <div class="flex gap-3">
              <Button onclick={cancel}>Cancel</Button>
              <Button disabled={!sessionName.trim()} onclick={startWorkspace}>Start Workspace</Button>
            </div>
          </div>

        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
