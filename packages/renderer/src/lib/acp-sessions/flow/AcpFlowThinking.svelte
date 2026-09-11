<script lang="ts">
import '/@/lib/chat/components/messages/code-copy.css';

import { faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import humanizeDuration from 'humanize-duration';

import { codeCopyButtons } from '/@/lib/chat/components/messages/code-copy-action';
import Markdown from '/@/lib/markdown/Markdown.svelte';
import type { AcpFlowThinkingEvent } from '/@api/acp-session-info';

interface Props {
  event: AcpFlowThinkingEvent;
  isComplete?: boolean;
  durationMs?: number;
}

let { event, isComplete = false, durationMs }: Props = $props();
let expanded = $state(false);

const label = $derived(
  isComplete
    ? durationMs !== undefined
      ? `Thought for ${humanizeDuration(durationMs, { round: true, largest: 2 })}`
      : 'Thought for a few seconds'
    : 'Thinking…',
);
</script>

<div class="rounded-lg border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] overflow-hidden">
  <button
    class="flex items-center gap-2 w-full px-4 py-2 text-left text-xs text-[var(--pd-content-text)] opacity-60 hover:opacity-80"
    onclick={(): void => { expanded = !expanded; }}
  >
    <Icon icon={expanded ? faChevronDown : faChevronRight} class="text-[10px]" />
    <span class="italic">{label}</span>
  </button>
  {#if expanded}
    <div class="border-t border-[var(--pd-content-divider)] px-4 py-3 text-sm text-[var(--pd-content-text)] opacity-70" use:codeCopyButtons>
      <Markdown markdown={event.text} />
    </div>
  {/if}
</div>
