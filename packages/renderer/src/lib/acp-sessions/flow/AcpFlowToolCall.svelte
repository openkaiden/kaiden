<script lang="ts">
import { faBan, faCheck, faCircleNotch, faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import Markdown from '/@/lib/markdown/Markdown.svelte';
import type { AcpFlowToolCallEvent } from '/@api/acp-session-info';

import AcpCopyButton from './AcpCopyButton.svelte';

interface Props {
  event: AcpFlowToolCallEvent;
  sessionId: string;
}

let { event, sessionId }: Props = $props();
let outputExpanded = $state(false);
let responding = $state(false);

const statusIcon = $derived(
  event.status === 'completed' ? faCheck : event.status === 'error' ? faExclamationTriangle : faCircleNotch,
);

const statusColor = $derived(
  event.status === 'completed'
    ? 'text-[var(--pd-status-running)]'
    : event.status === 'error'
      ? 'text-[var(--pd-status-dead)]'
      : 'text-[var(--pd-content-text)] animate-spin',
);

const showOutput = $derived(event.status === 'completed' || event.status === 'error');
const pendingPermission = $derived(!!event.permissionRequest && !event.permissionRequest.resolved);
const SHORT_OUTPUT_MAX_LINES = 5;
const PREVIEW_LINES = 3;
const outputLines = $derived(event.content ? event.content.split('\n') : []);
const outputLineCount = $derived(outputLines.length);
const isShortOutput = $derived(outputLineCount <= SHORT_OUTPUT_MAX_LINES);
const outputPreview = $derived(outputLines.slice(0, PREVIEW_LINES).join('\n'));

const selectedOption = $derived(
  event.permissionRequest?.resolved
    ? event.permissionRequest.options.find(o => o.optionId === event.permissionRequest?.selectedOptionId)
    : undefined,
);

async function handleOption(optionId: string): Promise<void> {
  if (responding || !event.permissionRequest || event.permissionRequest.resolved) return;
  responding = true;
  try {
    await window.respondToAcpRequest({
      sessionId,
      requestId: event.permissionRequest.requestId,
      type: 'permission',
      data: { optionId },
    });
  } catch (err: unknown) {
    console.error('Failed to respond', err);
  } finally {
    responding = false;
  }
}
</script>

<div class="group/toolcall rounded-lg border bg-[var(--pd-content-card-bg)] overflow-hidden {pendingPermission ? 'tool-call-pending-permission border-[var(--pd-status-waiting)] animate-pulse' : 'border-[var(--pd-content-divider)]'}">
  <!-- Header: status icon + tool name badge + description -->
  <div class="flex items-center gap-2 px-4 py-2.5">
    <Icon icon={statusIcon} class="{statusColor} text-xs" />
    {#if event.toolName}
      <span class="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-[var(--pd-content-card-hover-bg)] text-[var(--pd-content-text)]">
        {event.toolName}
      </span>
    {/if}
    <span class="text-sm text-[var(--pd-content-text)] truncate">
      {event.description ?? event.title}
    </span>
  </div>

  <!-- Command block -->
  {#if event.command}
    <div class="group/command relative border-t border-[var(--pd-content-divider)] px-4 py-2 text-xs font-mono text-[var(--pd-content-text)] whitespace-pre-wrap bg-[var(--pd-invert-content-card-bg)] overflow-auto max-h-32">
      {event.command}
      <div class="absolute top-1 right-1 opacity-0 group-hover/command:opacity-100 transition-opacity">
        <AcpCopyButton text={event.command} />
      </div>
    </div>
  {/if}

  <!-- Permission section -->
  {#if event.permissionRequest}
    <div class="border-t border-[var(--pd-content-divider)] px-4 py-2.5">
      {#if event.permissionRequest.resolved && selectedOption}
        <div class="flex items-center gap-1.5 text-xs">
          {#if selectedOption.kind === 'deny'}
            <Icon icon={faBan} class="text-[var(--pd-status-dead)] text-xs" />
            <span class="text-[var(--pd-status-dead)]">Denied</span>
          {:else}
            <Icon icon={faCheck} class="text-[var(--pd-status-running)] text-xs" />
            <span class="text-[var(--pd-status-running)]">{selectedOption.name}</span>
          {/if}
        </div>
      {:else}
        <div class="flex items-center gap-2 flex-wrap">
          {#each event.permissionRequest.options as option (option.optionId)}
            <Button
              type={option.kind === 'deny' ? 'secondary' : 'primary'}
              onclick={(): void => { handleOption(option.optionId).catch((e: unknown) => console.error(e)); }}
              disabled={responding}
            >
              {option.name}
            </Button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Output section -->
  {#if showOutput && event.content}
    <div class="group/output relative border-t border-[var(--pd-content-divider)]">
      <div class="absolute top-1 right-1 opacity-0 group-hover/output:opacity-100 transition-opacity z-10">
        <AcpCopyButton text={event.content} />
      </div>
      {#if isShortOutput}
        <div class="px-4 py-2.5 text-sm text-[var(--pd-content-text)]">
          <Markdown markdown={event.content} />
        </div>
      {:else}
        <button
          class="flex items-center gap-1 w-full px-4 py-1.5 text-left text-xs text-[var(--pd-content-text)] hover:bg-[var(--pd-content-card-hover-bg)] transition-colors"
          onclick={(): void => { outputExpanded = !outputExpanded; }}
        >
          <span>{outputExpanded ? '▾' : '▸'}</span>
          <span class="font-medium">Output</span>
          <span class="opacity-50">({outputLineCount} lines)</span>
        </button>
        {#if outputExpanded}
          <div class="px-4 pb-3 text-sm text-[var(--pd-content-text)]">
            <Markdown markdown={event.content} />
          </div>
        {:else}
          <button
            class="w-full text-left px-4 pb-2 cursor-pointer"
            onclick={(): void => { outputExpanded = true; }}
          >
            <div class="text-xs font-mono text-[var(--pd-content-text)] opacity-40 whitespace-pre-wrap overflow-hidden max-h-14 relative">
              {outputPreview}
              <div class="absolute bottom-0 left-0 right-0 h-6 bg-gradient-to-t from-[var(--pd-content-card-bg)] to-transparent"></div>
            </div>
          </button>
        {/if}
      {/if}
    </div>
  {/if}
</div>
