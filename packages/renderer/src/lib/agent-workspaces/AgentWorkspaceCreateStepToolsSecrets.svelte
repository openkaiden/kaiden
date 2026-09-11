<script lang="ts">
import { faBook, faKey, faServer, faWrench } from '@fortawesome/free-solid-svg-icons';
import { Button, Expandable } from '@podman-desktop/ui-svelte';
import { untrack } from 'svelte';
import { router } from 'tinro';

import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import ChecklistPanel from '/@/lib/ui/ChecklistPanel.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SecretInfo } from '/@api/secret-info';

interface Props {
  skillItems: ChecklistItem[];
  selectedSkillIds: string[];
  mcpItems: ChecklistItem[];
  selectedMcpIds: string[];
  selectedSecretIds: string[];
  secretsLoading: boolean;
  gateway: string;
  knowledgeItems: ChecklistItem[];
  selectedKnowledgeIds: string[];
}

let {
  skillItems,
  selectedSkillIds = $bindable(),
  mcpItems,
  selectedMcpIds = $bindable(),
  selectedSecretIds = $bindable(),
  secretsLoading = $bindable(),
  gateway,
  knowledgeItems,
  selectedKnowledgeIds = $bindable(),
}: Props = $props();

let secrets = $state.raw<SecretInfo[]>([]);
let secretItems: ChecklistItem[] = $derived(
  secrets.map(s => ({
    id: s.name,
    name: s.name,
    description: [s.type, s.description].filter(Boolean).join(' · '),
  })),
);

$effect(() => {
  let cancelled = false;
  const requestedSecretIds = untrack(() => selectedSecretIds);
  secrets = [];
  selectedSecretIds = [];
  secretsLoading = true;
  window.listSecrets(gateway).then(
    items => {
      if (!cancelled) {
        secrets = items;
        const available = new Set(items.map(item => item.name));
        selectedSecretIds = requestedSecretIds.filter(id => available.has(id));
        secretsLoading = false;
      }
    },
    (error: unknown) => {
      if (!cancelled) {
        secretsLoading = false;
        console.error('Failed to list secrets for gateway', error);
      }
    },
  );
  return (): void => {
    cancelled = true;
  };
});

let allIncluded: boolean = $derived(
  selectedSkillIds.length === skillItems.length &&
    selectedMcpIds.length === mcpItems.length &&
    selectedSecretIds.length === secretItems.length &&
    selectedKnowledgeIds.length === knowledgeItems.length,
);

let summaryParts: string[] = $derived(
  [
    skillItems.length > 0 ? `${selectedSkillIds.length}/${skillItems.length} skills` : '',
    mcpItems.length > 0 ? `${selectedMcpIds.length}/${mcpItems.length} MCP servers` : '',
    secretItems.length > 0 ? `${selectedSecretIds.length}/${secretItems.length} vault credentials` : '',
    knowledgeItems.length > 0 ? `${selectedKnowledgeIds.length}/${knowledgeItems.length} knowledges` : '',
  ].filter(Boolean),
);

function navigateToSkills(): void {
  handleNavigation({ page: NavigationPage.SKILLS });
}

function navigateToMcp(): void {
  router.goto('/preferences/mcps');
}

function navigateToSecretVault(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT });
}

function navigateToKnowledges(): void {
  handleNavigation({ page: NavigationPage.RAG_ENVIRONMENTS });
}
</script>

<!-- Summary card -->
<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-5 py-4 mb-4">
  <p class="text-sm text-[var(--pd-content-card-text)] leading-relaxed">
    {#if allIncluded}
      Everything available is included{#if summaryParts.length > 0} ({summaryParts.join(' · ')}){/if}.
      Expand <strong class="text-[var(--pd-modal-text)]">Customize</strong> below only if you want to limit what is attached.
    {:else}
      {summaryParts.join(' · ')}.
      Expand <strong class="text-[var(--pd-modal-text)]">Customize</strong> below to adjust.
    {/if}
  </p>
</div>

<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-4 py-3">
  <Expandable expanded={false}>
    {#snippet title()}<span class="text-sm font-medium text-[var(--pd-modal-text)]">Customize skills, MCP servers, vault, and knowledges</span>{/snippet}
    <div class="space-y-6 pt-3">
      <ChecklistPanel
        title="Skills"
        subtitle="Select the capabilities your agent should have"
        icon={faWrench}
        items={skillItems}
        bind:selected={selectedSkillIds}
        emptyMessage="No skills available yet.">
        {#snippet headerAction()}
          <Button type="secondary" onclick={navigateToSkills}>Manage Skills</Button>
        {/snippet}
      </ChecklistPanel>

      <ChecklistPanel
        title="MCP Servers"
        subtitle="Connect to Model Context Protocol servers for extended capabilities"
        icon={faServer}
        items={mcpItems}
        bind:selected={selectedMcpIds}
        emptyMessage="No MCP servers available yet.">
        {#snippet headerAction()}
          <Button type="secondary" onclick={navigateToMcp}>Manage Servers</Button>
        {/snippet}
      </ChecklistPanel>

      <ChecklistPanel
        title="Secret Vault"
        subtitle="Select secrets from your vault to make available in the workspace"
        icon={faKey}
        items={secretItems}
        bind:selected={selectedSecretIds}
        emptyMessage="No secrets in your vault yet.">
        {#snippet headerAction()}
          <Button type="secondary" onclick={navigateToSecretVault}>Open Vault</Button>
        {/snippet}
      </ChecklistPanel>

      <ChecklistPanel
        title="Knowledges"
        subtitle="Optional retrieval context for the agent"
        icon={faBook}
        items={knowledgeItems}
        bind:selected={selectedKnowledgeIds}
        emptyMessage="No knowledge bases available yet.">
        {#snippet headerAction()}
          <Button type="secondary" onclick={navigateToKnowledges}>Manage Knowledges</Button>
        {/snippet}
      </ChecklistPanel>
    </div>
  </Expandable>
</div>
