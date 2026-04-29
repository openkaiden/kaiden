<script lang="ts">
import { faKey, faServer, faWrench } from '@fortawesome/free-solid-svg-icons';
import { Button, Expandable } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import ChecklistPanel from '/@/lib/ui/ChecklistPanel.svelte';
import type { ScrollableCardItem } from '/@/lib/ui/ScrollableCardSelector.svelte';
import ScrollableCardSelector from '/@/lib/ui/ScrollableCardSelector.svelte';
import { handleNavigation } from '/@/navigation';
import { secretVaultInfos } from '/@/stores/secret-vault';
import { NavigationPage } from '/@api/navigation-page';

interface Props {
  skillItems: ScrollableCardItem[];
  selectedSkillIds: string[];
  mcpItems: ScrollableCardItem[];
  selectedMcpIds: string[];
  selectedSecretIds: string[];
}

let {
  skillItems,
  selectedSkillIds = $bindable(),
  mcpItems,
  selectedMcpIds = $bindable(),
  selectedSecretIds = $bindable(),
}: Props = $props();

let secretItems: ChecklistItem[] = $derived(
  $secretVaultInfos.map(s => ({
    id: s.id,
    name: s.name,
    description: [s.type, s.description].filter(Boolean).join(' · '),
    group: s.category === 'api' ? 'API tokens' : 'Infrastructure',
  })),
);

let allIncluded: boolean = $derived(
  selectedSkillIds.length === skillItems.length &&
    selectedMcpIds.length === mcpItems.length &&
    selectedSecretIds.length === secretItems.length,
);

let summaryParts: string[] = $derived(
  [
    skillItems.length > 0 ? `${selectedSkillIds.length}/${skillItems.length} skills` : '',
    mcpItems.length > 0 ? `${selectedMcpIds.length}/${mcpItems.length} MCP servers` : '',
    secretItems.length > 0 ? `${selectedSecretIds.length}/${secretItems.length} vault credentials` : '',
  ].filter(Boolean),
);

function navigateToSecretVault(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT });
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
    {#snippet title()}<span class="text-sm font-medium text-[var(--pd-modal-text)]">Customize skills, MCP servers, and vault</span>{/snippet}
    <div class="space-y-6 pt-3">
      {#if skillItems.length > 0}
        <div>
          <div class="flex items-center gap-3 mb-5">
            <div class="w-9 h-9 rounded-[9px] flex items-center justify-center bg-[var(--pd-label-tertiary-bg)] text-[var(--pd-label-tertiary-text)]">
              <Icon icon={faWrench} class="text-xl" />
            </div>
            <div>
              <span class="text-lg font-semibold text-[var(--pd-modal-text)]">Skills</span>
              <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 mt-0.5">Select the capabilities your agent should have</p>
            </div>
          </div>
          <ScrollableCardSelector items={skillItems} bind:selected={selectedSkillIds} placeholder="Search skills..." />
        </div>
      {/if}

      {#if mcpItems.length > 0}
        <div>
          <div class="flex items-center gap-3 mb-5">
            <div class="w-9 h-9 rounded-[9px] flex items-center justify-center bg-[var(--pd-label-secondary-bg)] text-[var(--pd-label-secondary-text)]">
              <Icon icon={faServer} class="text-xl" />
            </div>
            <div>
              <span class="text-lg font-semibold text-[var(--pd-modal-text)]">MCP Servers</span>
              <p class="text-sm text-[var(--pd-content-card-text)] opacity-70 mt-0.5">Connect to Model Context Protocol servers for extended capabilities</p>
            </div>
          </div>
          <ScrollableCardSelector items={mcpItems} bind:selected={selectedMcpIds} placeholder="Search MCP servers..." />
        </div>
      {/if}

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
    </div>
  </Expandable>
</div>
