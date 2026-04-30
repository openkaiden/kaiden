<script lang="ts">
import { faBook, faKey, faServer, faWrench } from '@fortawesome/free-solid-svg-icons';
import { Button, Expandable } from '@podman-desktop/ui-svelte';

import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import ChecklistPanel from '/@/lib/ui/ChecklistPanel.svelte';
import { handleNavigation } from '/@/navigation';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { NavigationPage } from '/@api/navigation-page';

interface Props {
  skillItems: ChecklistItem[];
  selectedSkillIds: string[];
  mcpItems: ChecklistItem[];
  selectedMcpIds: string[];
  selectedSecretIds: string[];
  knowledgeItems: ChecklistItem[];
  selectedKnowledgeIds: string[];
}

let {
  skillItems,
  selectedSkillIds = $bindable(),
  mcpItems,
  selectedMcpIds = $bindable(),
  selectedSecretIds = $bindable(),
  knowledgeItems,
  selectedKnowledgeIds = $bindable(),
}: Props = $props();

let secretItems: ChecklistItem[] = $derived(
  $secretVaultInfos.map(s => ({
    id: s.id,
    name: s.name,
    description: [s.type, s.description].filter(Boolean).join(' · '),
  })),
);

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

function navigateToMcps(): void {
  handleNavigation({ page: NavigationPage.MCPS });
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
        emptyMessage="No MCP servers connected yet.">
        {#snippet headerAction()}
          <Button type="secondary" onclick={navigateToMcps}>Add Server</Button>
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
