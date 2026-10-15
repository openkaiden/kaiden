
<script lang="ts">
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown';
import { faToolbox } from '@fortawesome/free-solid-svg-icons/faToolbox';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import type { DynamicToolUIPart } from 'ai';
import { tick } from 'svelte';
/* eslint-disable import/no-duplicates */
import { cubicInOut } from 'svelte/easing';
import { SvelteSet } from 'svelte/reactivity';
import { slide } from 'svelte/transition';

/* eslint-enable import/no-duplicates */
import { formatText } from '/@/lib/format/format';

import { getLock } from './lock.svelte';

interface Props {
  tools: Array<DynamicToolUIPart>;
}

let { tools }: Props = $props();

let expanded: Set<string> = new SvelteSet();

const scrollLock = getLock('messages-scroll');

function lockScrolling(): void {
  scrollLock.lockTransition();
}

function unlockScrolling(): void {
  tick()
    .then(() => {
      scrollLock.unlockTransition();
    })
    .catch(console.error);
}

function toggle(id: string): void {
  if (expanded.has(id)) {
    expanded.delete(id);
  } else {
    expanded.add(id);
  }
}

// Helpers to better reflect MCP CallToolResult shapes in output rendering
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMcpCallToolResult(
  value: unknown,
): value is { content?: Array<unknown>; isError?: boolean; toolResult?: unknown } {
  if (!isRecord(value)) return false;
  return 'content' in value || 'toolResult' in value;
}

function isMcpTextContent(item: unknown): item is { type: 'text'; text: string } {
  return isRecord(item) && item.type === 'text' && typeof item.text === 'string';
}

function isMcpImageContent(item: unknown): item is { type: 'image'; data: string; mimeType: string } {
  return isRecord(item) && item.type === 'image' && typeof item.data === 'string' && typeof item.mimeType === 'string';
}

function isMcpResourceContent(
  item: unknown,
): item is { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } } {
  if (!isRecord(item) || item.type !== 'resource' || !isRecord(item.resource)) return false;
  const resource = (item as { resource?: { uri?: unknown } }).resource;
  return !!resource && typeof resource.uri === 'string';
}
</script>

<div class="flex flex-col">
  {#each tools as tool (tool.toolCallId)}
    <div class="flex flex-row items-center gap-2">

      <Icon icon={faToolbox} />
      <div class="font-medium">{tool.toolName}</div>
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="cursor-pointer"
        onclick={toggle.bind(undefined, tool.toolCallId)}
      >
        <Icon icon={faChevronDown} />
      </div>
    </div>

    {#if expanded.has(tool.toolCallId)}
      <div
        transition:slide={{ duration: 200, easing: cubicInOut }}
        onintrostart={lockScrolling}
        onintroend={unlockScrolling}
        onoutrostart={lockScrolling}
        onoutroend={unlockScrolling}
        class="mt-4 mb-2 flex flex-col gap-4 border-l pl-4 text-zinc-600 dark:text-zinc-400"
      >
        <span class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Input</span>
        <code class="whitespace-pre-wrap overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
          {JSON.stringify(tool.input,  null, 2)}
        </code>

        <span class="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Output</span>
        {#if isMcpCallToolResult(tool.output)}
          {#if isRecord(tool.output) && 'isError' in tool.output && tool.output.isError}
            <div class="text-red-600 dark:text-red-400 text-sm">MCP reported an error</div>
          {/if}

          {#if isRecord(tool.output) && Array.isArray(tool.output.content)}
            <div class="flex flex-col gap-3">
              {#each tool.output.content as item, idx (idx)}
                {#if isMcpTextContent(item)}
                  <div class="rounded border p-2">
                    <div class="text-[10px] uppercase tracking-wide text-zinc-500">Text</div>
                    <div class="whitespace-pre-wrap text-sm">{formatText(item.text)}</div>
                  </div>
                {:else if isMcpImageContent(item)}
                  <div class="rounded border p-2">
                    <div class="text-[10px] uppercase tracking-wide text-zinc-500">Image ({item.mimeType})</div>
                    <img alt="MCP {item.mimeType} content" class="max-h-64 rounded border" src={`data:${item.mimeType};base64,${item.data}`} />
                  </div>
                {:else if isMcpResourceContent(item)}
                  <div class="rounded border p-2">
                    <div class="text-[10px] uppercase tracking-wide text-zinc-500">Resource</div>
                    <div class="text-sm"><span class="font-medium">URI:</span> {item.resource.uri}</div>
                    {#if item.resource.mimeType}
                      <div class="text-sm"><span class="font-medium">MIME:</span> {item.resource.mimeType}</div>
                    {/if}
                    {#if 'text' in item.resource && item.resource.text}
                      <div class="mt-1">
                        <div class="text-[10px] uppercase tracking-wide text-zinc-500">Text</div>
                        <code class="whitespace-pre-wrap overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{formatText(item.resource.text)}</code>
                      </div>
                    {:else if 'blob' in item.resource && item.resource.blob}
                      <div class="text-xs text-zinc-500">Binary blob provided.</div>
                    {/if}
                  </div>
                {:else}
                  <code class="whitespace-pre-wrap overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{JSON.stringify(item, null, 2)}</code>
                {/if}
              {/each}
            </div>
          {:else if isRecord(tool.output) && 'toolResult' in tool.output}
            <code class="whitespace-pre-wrap overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
              {JSON.stringify(tool.output.toolResult, null, 2)}
            </code>
          {:else}
            <code class="whitespace-pre-wrap overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
              {JSON.stringify(tool.output, null, 2)}
            </code>
          {/if}
        {:else}
          <code class="whitespace-pre-wrap overflow-auto rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">
            {JSON.stringify(tool.output, null, 2)}
          </code>
        {/if}
      </div>
    {/if}

  {/each}
</div>

