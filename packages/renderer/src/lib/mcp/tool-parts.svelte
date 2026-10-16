<script lang="ts">
import { faChevronDown } from '@fortawesome/free-solid-svg-icons/faChevronDown';
import { faToolbox } from '@fortawesome/free-solid-svg-icons/faToolbox';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import type { DynamicToolUIPart } from 'ai';
/* eslint-disable import/no-duplicates */
import { cubicInOut } from 'svelte/easing';
import { SvelteSet } from 'svelte/reactivity';
import { slide } from 'svelte/transition';

/* eslint-enable import/no-duplicates */
import { formatText } from '/@/kaiden/lib/format/format';

interface Props {
  tools: Array<DynamicToolUIPart>;
}

let { tools }: Props = $props();

let expanded: Set<string> = new SvelteSet();

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
      <button
        type="button"
        class="cursor-pointer"
        aria-label="Toggle details for {tool.toolName}"
        aria-expanded={expanded.has(tool.toolCallId)}
        onclick={toggle.bind(undefined, tool.toolCallId)}
      >
        <Icon icon={faChevronDown} />
      </button>
    </div>

    {#if expanded.has(tool.toolCallId)}
      <div
        transition:slide={{ duration: 200, easing: cubicInOut }}
        class="mt-4 mb-2 flex flex-col gap-4 border-l border-(--pd-content-card-border) pl-4 text-(--pd-content-card-text)"
      >
        <span class="text-xs uppercase tracking-wide text-(--pd-content-card-text) opacity-70">Input</span>
        <code class="whitespace-pre-wrap overflow-auto rounded bg-(--pd-content-card-inset-bg) p-2 text-xs">
          {JSON.stringify(tool.input,  null, 2)}
        </code>

        <span class="text-xs uppercase tracking-wide text-(--pd-content-card-text) opacity-70">Output</span>
        {#if isMcpCallToolResult(tool.output)}
          {#if isRecord(tool.output) && 'isError' in tool.output && tool.output.isError}
            <div class="text-(--pd-state-error) text-sm">MCP reported an error</div>
          {/if}

          {#if isRecord(tool.output) && Array.isArray(tool.output.content)}
            <div class="flex flex-col gap-3">
              {#each tool.output.content as item, idx (idx)}
                {#if isMcpTextContent(item)}
                  <div class="rounded border border-(--pd-content-card-border) p-2">
                    <div class="text-[10px] uppercase tracking-wide text-(--pd-content-card-text) opacity-70">Text</div>
                    <div class="whitespace-pre-wrap text-sm">{formatText(item.text)}</div>
                  </div>
                {:else if isMcpImageContent(item)}
                  <div class="rounded border border-(--pd-content-card-border) p-2">
                    <div class="text-[10px] uppercase tracking-wide text-(--pd-content-card-text) opacity-70">Image ({item.mimeType})</div>
                    <img alt="MCP {item.mimeType} content" class="max-h-64 rounded border border-(--pd-content-card-border)" src={`data:${item.mimeType};base64,${item.data}`} />
                  </div>
                {:else if isMcpResourceContent(item)}
                  <div class="rounded border border-(--pd-content-card-border) p-2">
                    <div class="text-[10px] uppercase tracking-wide text-(--pd-content-card-text) opacity-70">Resource</div>
                    <div class="text-sm"><span class="font-medium">URI:</span> {item.resource.uri}</div>
                    {#if item.resource.mimeType}
                      <div class="text-sm"><span class="font-medium">MIME:</span> {item.resource.mimeType}</div>
                    {/if}
                    {#if 'text' in item.resource && item.resource.text}
                      <div class="mt-1">
                        <div class="text-[10px] uppercase tracking-wide text-(--pd-content-card-text) opacity-70">Text</div>
                        <code class="whitespace-pre-wrap overflow-auto rounded bg-(--pd-content-card-inset-bg) p-2 text-xs">{formatText(item.resource.text)}</code>
                      </div>
                    {:else if 'blob' in item.resource && item.resource.blob}
                      <div class="text-xs text-(--pd-content-card-text) opacity-70">Binary blob provided.</div>
                    {/if}
                  </div>
                {:else}
                  <code class="whitespace-pre-wrap overflow-auto rounded bg-(--pd-content-card-inset-bg) p-2 text-xs">{JSON.stringify(item, null, 2)}</code>
                {/if}
              {/each}
            </div>
          {:else if isRecord(tool.output) && 'toolResult' in tool.output}
            <code class="whitespace-pre-wrap overflow-auto rounded bg-(--pd-content-card-inset-bg) p-2 text-xs">
              {JSON.stringify(tool.output.toolResult, null, 2)}
            </code>
          {:else}
            <code class="whitespace-pre-wrap overflow-auto rounded bg-(--pd-content-card-inset-bg) p-2 text-xs">
              {JSON.stringify(tool.output, null, 2)}
            </code>
          {/if}
        {:else}
          <code class="whitespace-pre-wrap overflow-auto rounded bg-(--pd-content-card-inset-bg) p-2 text-xs">
            {JSON.stringify(tool.output, null, 2)}
          </code>
        {/if}
      </div>
    {/if}

  {/each}
</div>

