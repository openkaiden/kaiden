<script lang="ts">
import '/@/lib/ui/code-copy.css';

import type { UIMessage } from '@ai-sdk/svelte';
import type { DynamicToolUIPart } from 'ai';
import { fly } from 'svelte/transition';

import { EditState } from '/@/lib/chat/hooks/edit-state.svelte';
import { fileUIPart2Attachment } from '/@/lib/chat/utils/chat';
import { cn } from '/@/lib/chat/utils/shadcn';
import Markdown from '/@/lib/markdown/Markdown.svelte';
import { codeCopyButtons } from '/@/lib/ui/code-copy-action';

import LoaderIcon from '../icons/loader.svelte';
import SparklesIcon from '../icons/sparkles.svelte';
import MessageReasoning from '../message-reasoning.svelte';
import PreviewAttachment from '../preview-attachment.svelte';
import MessageActions from './message-actions.svelte';
import ToolParts from './tool-parts.svelte';

let {
  message,
  messages,
  readonly,
  loading,
}: {
  message: UIMessage;
  messages: UIMessage[];
  readonly: boolean;
  loading: boolean;
} = $props();

const editState = EditState.fromContext();

const isGrayed = $derived(editState.isAfterEditingMessage(messages, message));

const tools: Array<DynamicToolUIPart> = $derived(message.parts.filter(part => part?.type === 'dynamic-tool'));

// Separate reasoning and text parts for proper ordering
const reasoningParts = $derived(message.parts.filter(part => part.type === 'reasoning'));
const textParts = $derived(message.parts.filter(part => part.type === 'text'));
const hasText = $derived(textParts.some(part => part.text.trim().length > 0));
const hasFiles = $derived(message.parts.some(part => part.type === 'file'));

// Show spinner only for the last assistant message while loading (during reasoning or text generation)
const isLastMessage = $derived(messages.length > 0 && messages[messages.length - 1].id === message.id);
const isLastAssistantMessage = $derived(message.role === 'assistant' && isLastMessage);
const isGeneratingResponse = $derived(loading && isLastAssistantMessage);
</script>

<div
  class={cn('group/message mx-auto w-full max-w-3xl px-4', {
    'opacity-40 pointer-events-none': isGrayed,
  })}
  data-role={message.role}
  in:fly|global={{ opacity: 0, y: 5 }}
>

  <div
    class="flex w-full gap-4 group-data-[role=user]/message:ml-auto group-data-[role=user]/message:max-w-2xl"
  >
    {#if message.role === 'assistant'}
      <div
        class="bg-background ring-border flex size-8 shrink-0 items-center justify-center rounded-full ring-1"
      >
        <div class="translate-y-px">
          <SparklesIcon size={14} />
        </div>
      </div>
    {/if}

    <div class="flex w-full min-w-0 flex-col gap-4" use:codeCopyButtons>
      {#if message.role === 'assistant'}
        <!-- do we have tooling in parts ?-->
        {#if tools.length > 0}
          <ToolParts tools={tools} />
        {/if}
      {/if}

      {#if message.parts.filter(part => part.type === 'file').length > 0}
        <div class="w-full overflow-x-auto overflow-y-visible">
          <div class="ml-auto flex w-max flex-row gap-2">
            {#each message.parts.filter(part => part.type === 'file') as attachment, i (`${attachment.url}:${i}`)}
              <PreviewAttachment attachment={fileUIPart2Attachment(attachment)} />
            {/each}
          </div>
        </div>
      {/if}

      <!-- Show reasoning first -->
      {#each reasoningParts as part, i (`${message.id}-reasoning-${i}`)}
        <MessageReasoning {loading} reasoningContent={part.text} {hasText} />
      {/each}

      <!-- Show text parts after reasoning -->
      {#each textParts as part, i (`${message.id}-text-${i}`)}
        <div
          class={cn('flex flex-col gap-4 overflow-hidden [&_p:last-child]:mb-0 [&_p:last-child]:pb-0', {
            'bg-primary text-primary-foreground ml-auto w-fit rounded-xl px-3 pt-4': message.role === 'user',
            'animate-fade-in': message.role === 'assistant',
          })}
        >
          <Markdown markdown={part.text} allowDangerousHtml={message.role !== 'user'} />
        </div>
      {/each}

      <!-- Show spinner at the end while response is streaming (after reasoning completes) -->
      {#if isGeneratingResponse}
        <div class="flex">
          <div class="animate-spin">
            <LoaderIcon size={16} />
          </div>
        </div>
      {/if}

      {#if (hasText || hasFiles) && (message.role === 'user' || !isGeneratingResponse)}
        <MessageActions {message} {readonly} alwaysVisible={isLastAssistantMessage && !isGeneratingResponse} hasCopyableText={hasText} />
      {/if}
    </div>
  </div>
</div>
