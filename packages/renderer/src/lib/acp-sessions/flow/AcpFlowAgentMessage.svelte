<script lang="ts">
import '/@/lib/chat/components/messages/code-copy.css';

import { codeCopyButtons } from '/@/lib/chat/components/messages/code-copy-action';
import Markdown from '/@/lib/markdown/Markdown.svelte';
import type { AcpFlowAgentMessageEvent } from '/@api/acp-session-info';

import AcpCopyButton from './AcpCopyButton.svelte';

interface Props {
  event: AcpFlowAgentMessageEvent;
}

let { event }: Props = $props();
</script>

<div class="group/message">
  <div class="rounded-lg bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-divider)] px-4 py-3 text-sm text-[var(--pd-content-text)]" use:codeCopyButtons>
    <Markdown markdown={event.text} />
  </div>
  <div class="flex justify-start mt-1 opacity-0 group-hover/message:opacity-100 group-focus-within/message:opacity-100 transition-opacity">
    <AcpCopyButton text={event.text} />
  </div>
</div>
