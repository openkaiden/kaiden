<script lang="ts">
import { Tooltip } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import type { SandboxInfo } from '/@api/openshell-gateway-info';

interface Props {
  object: SandboxInfo;
}

let { object }: Props = $props();

const isDeleting = $derived(object.phase === 'Deleting');

function openDetails(): void {
  if (!isDeleting) {
    router.goto(`/agent-workspaces/${encodeURIComponent(object.id)}/overview`);
  }
}
</script>

<div class="flex flex-col">
  <Tooltip top tip={object.sourcePath ?? object.name}>
    <button class="flex items-start" onclick={openDetails} disabled={isDeleting} class:opacity-50={isDeleting} class:cursor-default={isDeleting}>
    <div class="text-sm text-[var(--pd-table-body-text)]">{object.name}</div>
    </button>
  </Tooltip>
  <div class="text-xs text-[var(--pd-table-body-text-sub)]">ID: {object.id}</div>
</div>
