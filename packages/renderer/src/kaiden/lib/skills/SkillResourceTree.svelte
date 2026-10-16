<script lang="ts">
import { faFile, faFolder } from '@fortawesome/free-regular-svg-icons';
import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { SkillResourceEntry } from '/@api/skill/skill-info';

import SkillResourceTree from './SkillResourceTree.svelte';

interface Props {
  skillName: string;
  entries: SkillResourceEntry[];
  relativePath?: string;
  depth?: number;
}

let { skillName, entries, relativePath = '', depth = 0 }: Props = $props();

let expanded: Record<string, boolean> = $state({});
let childEntries: Record<string, SkillResourceEntry[]> = $state({});
let loading: Record<string, boolean> = $state({});

let depthOffset = $derived(depth * 20);

async function toggle(name: string): Promise<void> {
  expanded[name] = !expanded[name];
  if (expanded[name] && !childEntries[name]) {
    const childPath = relativePath ? `${relativePath}/${name}` : name;
    loading[name] = true;
    try {
      childEntries[name] = await window.listSkillFolderContent(skillName, childPath);
    } catch (err: unknown) {
      console.error('Error loading folder contents:', err);
    } finally {
      loading[name] = false;
    }
  }
}
</script>

{#each entries as entry (entry.name)}
  {#if entry.isDirectory}
    <button
      class="flex items-center gap-3 w-full py-3 pr-5 border-b border-[var(--pd-content-card-border)] last:border-b-0 hover:bg-[var(--pd-content-card-hover-bg)] text-left pl-[var(--depth-pad)]"
      style:--depth-pad="{20 + depthOffset}px"
      aria-expanded={!!expanded[entry.name]}
      aria-label="Toggle folder {entry.name}"
      onclick={(): void => {
        toggle(entry.name).catch((err: unknown) => console.error(err));
      }}>
      <Icon icon={expanded[entry.name] ? faChevronDown : faChevronRight} size="xs" class="text-[var(--pd-content-card-text)] w-3" />
      <div class="w-8 h-8 rounded-md flex items-center justify-center bg-[var(--pd-content-bg)]">
        <Icon icon={faFolder} class="text-[var(--pd-content-card-text)]" />
      </div>
      <span class="text-sm font-medium text-[var(--pd-content-text)] font-mono">{entry.name}/</span>
    </button>
    {#if expanded[entry.name]}
      {#if loading[entry.name]}
        <div
          class="flex items-center gap-3 py-3 pr-5 border-b border-[var(--pd-content-card-border)] pl-[var(--depth-pad)]"
          style:--depth-pad="{20 + (depth + 1) * 20}px">
          <span class="text-xs text-[var(--pd-content-card-text)]">Loading...</span>
        </div>
      {:else if childEntries[entry.name]?.length}
        <SkillResourceTree
          {skillName}
          entries={childEntries[entry.name]}
          relativePath={relativePath ? `${relativePath}/${entry.name}` : entry.name}
          depth={depth + 1} />
      {/if}
    {/if}
  {:else}
    <div
      class="flex items-center gap-3 py-3 pr-5 border-b border-[var(--pd-content-card-border)] last:border-b-0 hover:bg-[var(--pd-content-card-hover-bg)] pl-[var(--depth-pad)]"
      style:--depth-pad="{36 + depthOffset}px">
      <div class="w-8 h-8 rounded-md flex items-center justify-center bg-[var(--pd-content-bg)]">
        <Icon icon={faFile} class="text-[var(--pd-content-card-text)]" />
      </div>
      <span class="text-sm font-medium text-[var(--pd-content-text)] font-mono">{entry.name}</span>
    </div>
  {/if}
{/each}
