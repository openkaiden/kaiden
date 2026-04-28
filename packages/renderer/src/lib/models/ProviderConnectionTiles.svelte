<script lang="ts">
import { router } from 'tinro';

import type { InferenceConnectionSummary } from '/@/lib/models/models-utils';

interface Props {
  connections: InferenceConnectionSummary[];
}

let { connections }: Props = $props();

function configure(connection: InferenceConnectionSummary): void {
  router.goto(`/preferences/provider/${connection.providerInternalId}`);
}

interface BadgeInfo {
  label: string;
  style: string;
}

function effectiveStatus(connection: InferenceConnectionSummary): string {
  if (connection.status === 'unknown' && connection.modelCount > 0) return 'started';
  return connection.status;
}

function getStatusBadge(status: string): BadgeInfo {
  switch (status) {
    case 'started':
      return {
        label: 'Connected',
        style: 'text-[var(--pd-status-running)] bg-[color-mix(in_srgb,var(--pd-status-running)_12%,transparent)]',
      };
    case 'stopped':
      return {
        label: 'Disconnected',
        style: 'text-[var(--pd-status-stopped)] bg-[color-mix(in_srgb,var(--pd-status-stopped)_12%,transparent)]',
      };
    case 'not-configured':
      return { label: 'Not configured', style: 'bg-[var(--pd-label-bg)] text-[var(--pd-label-text)]' };
    case 'failed':
      return {
        label: 'Error',
        style: 'text-[var(--pd-status-terminated)] bg-[color-mix(in_srgb,var(--pd-status-terminated)_12%,transparent)]',
      };
    default:
      return {
        label: status.charAt(0).toUpperCase() + status.slice(1),
        style: 'bg-[var(--pd-label-bg)] text-[var(--pd-label-text)]',
      };
  }
}

function getSecondBadge(status: string): BadgeInfo | undefined {
  switch (status) {
    case 'started':
      return { label: 'Verified', style: 'bg-[var(--pd-label-bg)] text-[var(--pd-label-text)]' };
    case 'failed':
      return { label: 'Check failed', style: 'bg-[var(--pd-label-bg)] text-[var(--pd-label-text)]' };
    default:
      return undefined;
  }
}
</script>

<div class="flex flex-wrap gap-3">
  {#each connections as connection (connection.providerId + ':' + connection.connectionName)}
    {@const status = effectiveStatus(connection)}
    {@const primaryBadge = getStatusBadge(status)}
    {@const secondaryBadge = getSecondBadge(status)}
    <div
      class="flex flex-col gap-2 p-4 rounded-lg border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] flex-1 min-w-40 max-w-48">
      <span class="text-base font-semibold text-[var(--pd-content-card-header-text)]">
        {connection.providerName}
      </span>
      <div class="flex flex-wrap items-center gap-2 mt-1 -ml-1">
        <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {primaryBadge.style}">
          {primaryBadge.label}
        </span>
        {#if secondaryBadge}
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium {secondaryBadge.style}">
            {secondaryBadge.label}
          </span>
        {/if}
      </div>
      <button
        class="text-xs font-semibold text-[var(--pd-link)] hover:text-[var(--pd-link-hover)] mt-auto pt-2 self-start"
        aria-label={`Configure ${connection.providerName}`}
        onclick={(): void => configure(connection)}>
        Configure
      </button>
    </div>
  {/each}
</div>
