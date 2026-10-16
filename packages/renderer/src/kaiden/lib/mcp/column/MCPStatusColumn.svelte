<script lang="ts">
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

interface Props {
  object: MCPRemoteServerInfo;
}

let { object }: Props = $props();

const isRegistered = $derived(object.status === 'registered');

const label = $derived.by(() => {
  if (object.setupType === 'remote') return 'Connected';
  return isRegistered ? 'Registered' : 'Spawned';
});

const badgeStyle = $derived(
  isRegistered
    ? 'bg-[var(--pd-label-bg)] text-[var(--pd-label-text)] border border-[var(--pd-content-card-border)]'
    : 'text-[var(--pd-status-running)] bg-[color-mix(in_srgb,var(--pd-status-running)_12%,transparent)] border border-[color-mix(in_srgb,var(--pd-status-running)_25%,transparent)]',
);
</script>

<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {badgeStyle}">
  {label}
</span>
