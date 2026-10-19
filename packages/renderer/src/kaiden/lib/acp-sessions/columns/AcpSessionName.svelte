<script lang="ts">
import { router } from 'tinro';

import type { AcpSessionInfo } from '/@api/acp-session-info';

interface Props {
  object: AcpSessionInfo;
}

let { object }: Props = $props();

function openDetails(): void {
  router.goto(`/acp-sessions/${encodeURIComponent(object.id)}`);
}

const displayName = $derived(object.name ?? object.prompt);
const truncatedName = $derived(displayName.length > 80 ? `${displayName.slice(0, 80)}…` : displayName);
</script>

<div class="flex flex-col gap-1 overflow-hidden min-w-0">
  <button class="flex items-start text-left" onclick={openDetails}>
    <span
      class="text-(--pd-table-body-text-highlight) text-[14px] font-semibold leading-normal overflow-hidden text-ellipsis whitespace-nowrap"
      title={displayName}>
      {truncatedName}
    </span>
  </button>
</div>
