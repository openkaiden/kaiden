<script lang="ts">
import { faWrench } from '@fortawesome/free-solid-svg-icons';
import { Button, Expandable } from '@podman-desktop/ui-svelte';

import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';
import ChecklistPanel from '/@/lib/ui/ChecklistPanel.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';

interface Props {
  skillItems: ChecklistItem[];
  selectedSkillIds: string[];
}

let { skillItems, selectedSkillIds = $bindable() }: Props = $props();

let allIncluded: boolean = $derived(selectedSkillIds.length === skillItems.length);

let summaryText: string = $derived(
  skillItems.length > 0 ? `${selectedSkillIds.length}/${skillItems.length} skills` : '',
);

function navigateToSkills(): void {
  handleNavigation({ page: NavigationPage.SKILLS });
}
</script>

<!-- Summary card -->
<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-5 py-4 mb-4">
  <p class="text-sm text-[var(--pd-content-card-text)] leading-relaxed">
    {#if allIncluded}
      All available skills are included{#if summaryText} ({summaryText}){/if}.
      Expand <strong class="text-[var(--pd-modal-text)]">Customize</strong> below only if you want to limit what is attached.
    {:else}
      {summaryText}.
      Expand <strong class="text-[var(--pd-modal-text)]">Customize</strong> below to adjust.
    {/if}
  </p>
</div>

<div class="rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] px-4 py-3">
  <Expandable expanded={false}>
    {#snippet title()}<span class="text-sm font-medium text-[var(--pd-modal-text)]">Customize skills</span>{/snippet}
    <div class="pt-3">
      <ChecklistPanel
        title="Skills"
        subtitle="Select the skills to attach to this project"
        icon={faWrench}
        items={skillItems}
        bind:selected={selectedSkillIds}
        emptyMessage="No skills available yet.">
        {#snippet headerAction()}
          <Button type="secondary" onclick={navigateToSkills}>Manage Skills</Button>
        {/snippet}
      </ChecklistPanel>
    </div>
  </Expandable>
</div>
