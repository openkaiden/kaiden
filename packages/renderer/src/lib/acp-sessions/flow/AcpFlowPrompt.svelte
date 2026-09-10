<script lang="ts">
import { faPaperclip } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { AcpFlowPromptEvent } from '/@api/acp-session-info';

import AcpCopyButton from './AcpCopyButton.svelte';

interface Props {
  event: AcpFlowPromptEvent;
}

let { event }: Props = $props();
</script>

<div class="group/message ml-auto max-w-[80%]">
  <div class="rounded-lg bg-[var(--pd-button-primary-bg)] px-4 py-3 text-sm text-[var(--pd-button-primary-text)]">
    {#if event.attachments?.length}
      <div class="flex flex-wrap gap-1.5 mb-2">
        {#each event.attachments as attachment (attachment.fileName)}
          <span class="inline-flex items-center gap-1 rounded-full bg-white/20 text-xs px-2 py-0.5">
            <Icon icon={faPaperclip} class="text-[10px]" />
            {attachment.fileName}
          </span>
        {/each}
      </div>
    {/if}
    <span class="whitespace-pre-wrap">{event.text}</span>
  </div>
  <div class="flex justify-end -mt-1 opacity-0 group-hover/message:opacity-100 transition-opacity">
    <AcpCopyButton text={event.text} />
  </div>
</div>
