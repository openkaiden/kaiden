<script lang="ts">
import { faKey } from '@fortawesome/free-solid-svg-icons';
import { Button, Expandable } from '@podman-desktop/ui-svelte';

import { secretVaultInfos } from '/@/kaiden/stores/secret-vault';
import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import ChecklistPanel from '/@/lib/ui/ChecklistPanel.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';

interface Props {
  selectedSecretIds: string[];
}

let { selectedSecretIds = $bindable() }: Props = $props();

let secretItems: ChecklistItem[] = $derived(
  $secretVaultInfos.map(s => ({
    id: s.id,
    name: s.name,
    description: [s.type, s.description].filter(Boolean).join(' · '),
  })),
);

let allIncluded: boolean = $derived(secretItems.length > 0 && selectedSecretIds.length === secretItems.length);

let summaryText: string = $derived(
  secretItems.length > 0 ? `${selectedSecretIds.length}/${secretItems.length} secrets` : '',
);

function navigateToSecretVault(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT });
}
</script>

<!-- Summary card -->
<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-5 py-4 mb-4">
  <p class="text-sm text-[var(--pd-content-card-text)] leading-relaxed">
    {#if secretItems.length === 0}
      No secrets in your vault yet. <button class="text-[var(--pd-link)] hover:underline cursor-pointer" onclick={navigateToSecretVault}>Create a secret</button> to get started.
    {:else if allIncluded}
      All available secrets are included{#if summaryText} ({summaryText}){/if}.
      Expand <strong class="text-[var(--pd-modal-text)]">Customize</strong> below only if you want to limit what is attached.
    {:else}
      {summaryText}.
      Expand <strong class="text-[var(--pd-modal-text)]">Customize</strong> below to adjust.
    {/if}
  </p>
</div>

<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-4 py-3">
  <Expandable expanded={false}>
    {#snippet title()}<span class="text-sm font-medium text-[var(--pd-modal-text)]">Customize secrets</span>{/snippet}
    <div class="pt-3">
      <ChecklistPanel
        title="Secret Vault"
        subtitle="Select secrets from your vault to make available in this project"
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
