<script lang="ts">
import { faFile, faFolder } from '@fortawesome/free-regular-svg-icons';
import { Checkbox, EmptyScreen, Tab } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { toast } from 'svelte-sonner';
import { router } from 'tinro';

import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import { skillInfos } from '/@/stores/skills';
import type { SkillInfo } from '/@api/skill/skill-info';

import SkillActions from './SkillActions.svelte';
import SkillDetailRow from './SkillDetailRow.svelte';

interface Props {
  name: string;
}

let { name }: Props = $props();

let skillInfo: SkillInfo | undefined = $derived($skillInfos.find(s => s.name === name));
let skillContent: string | undefined = $state(undefined);
let folderContents: string[] = $state([]);

$effect(() => {
  if (!skillInfo) {
    skillContent = undefined;
    folderContents = [];
    return;
  }
  const currentName = name;
  Promise.allSettled([window.getSkillContent(currentName), window.listSkillFolderContent(currentName)])
    .then(([contentResult, folderResult]) => {
      if (contentResult.status === 'fulfilled') {
        skillContent = contentResult.value;
      } else {
        console.error('Error loading skill instructions:', contentResult.reason);
        toast.error('Failed to load skill instructions');
      }
      if (folderResult.status === 'fulfilled') {
        folderContents = folderResult.value;
      } else {
        console.error('Error loading skill resources:', folderResult.reason);
        toast.error('Failed to load skill resources');
      }
    })
    .catch((err: unknown) => console.error('Unexpected error loading skill details:', err));
});

function formatTokenCount(text: string | undefined): string {
  if (!text) return 'N/A';
  const tokens = Math.ceil(text.length / 3.5);
  if (tokens >= 1000) {
    return `~${(tokens / 1000).toFixed(1)}k tokens`;
  }
  return `~${tokens} tokens`;
}

let toggling = $state(false);

function onToggle(): void {
  if (!skillInfo || toggling) return;
  toggling = true;
  const promise = skillInfo.enabled ? window.disableSkill(skillInfo.name) : window.enableSkill(skillInfo.name);
  promise
    .catch((err: unknown) => {
      console.error('Error toggling skill:', err);
      toast.error('Failed to toggle skill');
    })
    .finally(() => {
      toggling = false;
    });
}
</script>

<DetailsPage title={name}>
  {#snippet subtitleSnippet()}
    <div class="flex items-center gap-3">
      <span
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
        bg-[var(--pd-label-bg)] text-[var(--pd-label-text)]">
        {skillInfo?.managed ? 'Custom' : 'Pre-built'}
      </span>
      <span
        class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
        class:text-[var(--pd-status-running)]={skillInfo?.enabled}
        class:text-[var(--pd-status-stopped)]={!skillInfo?.enabled}>
        <span
          class="w-1.5 h-1.5 rounded-full"
          class:bg-[var(--pd-status-running)]={skillInfo?.enabled}
          class:bg-[var(--pd-status-stopped)]={!skillInfo?.enabled}>
        </span>
        {skillInfo?.enabled ? 'Enabled' : 'Disabled'}
      </span>
    </div>
  {/snippet}

  {#snippet actionsSnippet()}
    <div class="flex items-center gap-2">
      {#if skillInfo}
        <Checkbox
          checked={skillInfo.enabled}
          onclick={onToggle}
          title={skillInfo.enabled ? 'Disable skill' : 'Enable skill'} />
        <SkillActions object={skillInfo} detailed={true} />
      {/if}
    </div>
  {/snippet}

  {#snippet tabsSnippet()}
    <Tab title="Summary" selected={isTabSelected($router.path, 'summary')} url={getTabUrl($router.path, 'summary')} />
    <Tab title="Instructions" selected={isTabSelected($router.path, 'instructions')} url={getTabUrl($router.path, 'instructions')} />
    <Tab title="Resources" selected={isTabSelected($router.path, 'resources')} url={getTabUrl($router.path, 'resources')} />
  {/snippet}

  {#snippet contentSnippet()}
    <Route path="/summary" breadcrumb="Summary" navigationHint="tab">
      {#if skillInfo}
        <!-- About Section -->
        <div class="px-5 py-4 h-full overflow-auto">
          <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-5 mb-6">
            <h3 class="text-sm font-semibold text-[var(--pd-content-card-header-text)] uppercase tracking-wider mb-4">About This Skill</h3>
            <p class="text-sm text-[var(--pd-content-text)] leading-relaxed">
              {skillInfo.description || 'No description available.'}
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <!-- General Information -->
            <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-5">
              <h3 class="text-sm font-semibold text-[var(--pd-content-card-header-text)] uppercase tracking-wider mb-4">General Information</h3>
              <div class="divide-y divide-[var(--pd-content-card-border)]">
                <SkillDetailRow label="Name" value={skillInfo.name} />
                <SkillDetailRow label="Type" value={skillInfo.managed ? 'Custom' : 'Pre-built'} />
                <SkillDetailRow label="Status" value={skillInfo.enabled ? 'Enabled' : 'Disabled'} />
                <SkillDetailRow label="Path" value={skillInfo.path || 'N/A'} />
              </div>
            </div>

            <!-- Metadata -->
            <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-5">
              <h3 class="text-sm font-semibold text-[var(--pd-content-card-header-text)] uppercase tracking-wider mb-4">Metadata</h3>
              <div class="divide-y divide-[var(--pd-content-card-border)]">
                <SkillDetailRow label="Instructions Size" value={formatTokenCount(skillContent)} />
                <SkillDetailRow label="Bundled Resources" value="{folderContents.length} items" />
              </div>
            </div>
          </div>
        </div>
      {:else}
        <EmptyScreen title="Skill not found" message="Skill '{name}' could not be found" icon={NoLogIcon} />
      {/if}
    </Route>

    <Route path="/instructions" breadcrumb="Instructions" navigationHint="tab">
      <div class="px-5 py-4 h-full overflow-auto">
        <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg overflow-hidden">
          <div class="flex justify-between items-center px-4 py-3 bg-[var(--pd-content-bg)] border-b border-[var(--pd-content-card-border)]">
            <span class="text-sm font-medium text-[var(--pd-content-text)] font-mono">SKILL.md</span>
          </div>
          <div class="p-5">
            <pre class="text-sm text-[var(--pd-content-text)] leading-relaxed whitespace-pre-wrap font-mono">{skillContent ?? 'No content available.'}</pre>
          </div>
        </div>
      </div>
    </Route>

    <Route path="/resources" breadcrumb="Resources" navigationHint="tab">
      <div class="px-5 py-4 h-full overflow-auto">
        <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg overflow-hidden">
          <div class="px-5 py-4 border-b border-[var(--pd-content-card-border)] bg-[var(--pd-content-bg)]">
            <span class="text-base font-semibold text-[var(--pd-content-text)]">Bundled Resources ({folderContents.length})</span>
          </div>
          {#if folderContents.length === 0}
            <div class="px-6 py-12 text-center">
              <p class="text-sm text-[var(--pd-content-card-text)]">No bundled resources.</p>
            </div>
          {:else}
            {#each folderContents as item (item)}
              <div class="flex items-center gap-3 px-5 py-3 border-b border-[var(--pd-content-card-border)] last:border-b-0 hover:bg-[var(--pd-content-card-hover-bg)]">
                <div class="w-8 h-8 rounded-md flex items-center justify-center bg-[var(--pd-content-bg)]">
                  <Icon icon={item.endsWith('/') ? faFolder : faFile} class="text-[var(--pd-content-card-text)]" />
                </div>
                <span class="text-sm font-medium text-[var(--pd-content-text)] font-mono">{item}</span>
              </div>
            {/each}
          {/if}
        </div>
      </div>
    </Route>
  {/snippet}
</DetailsPage>
