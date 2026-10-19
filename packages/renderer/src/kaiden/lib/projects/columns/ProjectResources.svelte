<script lang="ts">
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

interface Props {
  object: WorkspaceProjectInfo;
}

let { object }: Props = $props();

const parts = $derived.by(() => {
  const items: string[] = [];
  if (object.skills.length > 0) items.push(`${object.skills.length} skill${object.skills.length !== 1 ? 's' : ''}`);
  if (object.mcpServers.length > 0) items.push(`${object.mcpServers.length} MCP`);
  if (object.knowledges.length > 0) items.push(`${object.knowledges.length} KB`);
  if (object.secrets.length > 0) items.push(`${object.secrets.length} secret${object.secrets.length !== 1 ? 's' : ''}`);
  return items;
});
</script>

<div class="flex items-center gap-2 flex-wrap">
  {#each parts as part (part)}
    <span class="text-(--pd-table-body-text) text-xs px-1.5 py-0.5 rounded bg-(--pd-label-bg)">{part}</span>
  {/each}
  {#if parts.length === 0}
    <span class="text-(--pd-table-body-text-secondary) text-xs italic">None</span>
  {/if}
</div>
