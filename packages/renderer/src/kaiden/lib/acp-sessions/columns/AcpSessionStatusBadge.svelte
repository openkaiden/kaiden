<script lang="ts">
import type { AcpSessionInfo } from '/@api/acp-session-info';

import { ACP_SESSION_STATUS_LABELS, getStatusDotClass, isWorkspaceUnavailable } from '../acp-session-status';

interface Props {
  object: AcpSessionInfo;
}

let { object }: Props = $props();

const unavailable = $derived(isWorkspaceUnavailable(object));
const dotClass = $derived(getStatusDotClass(object));
</script>

<div
  class="flex items-center gap-2 {unavailable ? 'opacity-50' : ''}"
  title={unavailable ? 'Workspace unavailable' : ACP_SESSION_STATUS_LABELS[object.status]}>
  <span class="w-2 h-2 rounded-full shrink-0 {dotClass}"></span>
  <span class="text-[var(--pd-table-body-text)] text-sm">{ACP_SESSION_STATUS_LABELS[object.status]}</span>
</div>
