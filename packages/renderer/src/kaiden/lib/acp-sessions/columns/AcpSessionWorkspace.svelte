<script lang="ts">
import type { AcpSessionInfo } from '/@api/acp-session-info';

import { isWorkspaceUnavailable } from '../acp-session-status';

interface Props {
  object: AcpSessionInfo;
}

let { object }: Props = $props();

const unavailable = $derived(isWorkspaceUnavailable(object));
</script>

<span
  class="text-[var(--pd-table-body-text)] text-sm {unavailable ? 'opacity-50' : ''}"
  title={unavailable ? 'Workspace unavailable' : object.sandboxName}
  >{object.sandboxName}{#if unavailable} (unavailable){/if}</span
>
