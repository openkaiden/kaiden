<script lang="ts">
import type { Chat } from '@ai-sdk/svelte';
import type { Attachment } from '@ai-sdk/ui-utils';
import { faToolbox } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { onMount, untrack } from 'svelte';
import type { SvelteMap } from 'svelte/reactivity';
import { innerWidth } from 'svelte/reactivity/window';
import { toast } from 'svelte-sonner';
import { router } from 'tinro';

import { EditState } from '/@/lib/chat/hooks/edit-state.svelte';
import { LocalStorage } from '/@/lib/chat/hooks/local-storage.svelte';
import { fileUIPart2Attachment } from '/@/lib/chat/utils/chat';
import { cn } from '/@/lib/chat/utils/shadcn';
import { mcpRemoteServerInfos, mcpRemoteServerInfosStatus } from '/@/stores/mcp-remote-servers';
import { ChatSettings } from '/@api/chat/chat-settings';

import ArrowUpIcon from './icons/arrow-up.svelte';
import PaperclipIcon from './icons/paperclip.svelte';
import StopIcon from './icons/stop.svelte';
import type { ModelInfo } from './model-info';
import ModelSelector from './model-selector.svelte';
import PreviewAttachment from './preview-attachment.svelte';
import SuggestedActions from './suggested-actions.svelte';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';

let {
  attachments = $bindable(),
  chatClient,
  class: c,
  models = [],
  selectedMCPTools,
  selectedModel = $bindable(),
  selectedMCPToolsCount = 0,
  mcpSelectorOpen = $bindable(false),
  hasActiveStream,
  activeStreamOnDataId,
}: {
  attachments: Attachment[];
  chatClient: Chat;
  class?: string;
  models?: Array<ModelInfo>;
  selectedMCPTools: SvelteMap<string, Set<string>>;
  selectedModel?: ModelInfo;
  selectedMCPToolsCount?: number;
  mcpSelectorOpen?: boolean;
  hasActiveStream?: boolean;
  activeStreamOnDataId?: number;
} = $props();

const editState = EditState.fromContext();

let input = $state('');
let savedInput = $state('');
let savedAttachments = $state<Attachment[]>([]);
let mounted = $state(false);
let textareaRef = $state<HTMLTextAreaElement | null>(null);
const storedInput = new LocalStorage('input', '');
const loading = $derived(
  chatClient.status === 'streaming' || chatClient.status === 'submitted' || hasActiveStream === true,
);
const noMcps = $derived($mcpRemoteServerInfosStatus === 'loaded' && $mcpRemoteServerInfos.length === 0);

$effect(() => {
  if (editState.editingMessage) {
    const parts = editState.editingMessage.parts;
    untrack(() => {
      const text = parts
        .filter(part => part.type === 'text')
        .map(part => (part as { type: 'text'; text: string }).text)
        .join('');
      const fileAttachments = parts.filter(part => part.type === 'file').map(part => fileUIPart2Attachment(part));
      savedInput = input;
      savedAttachments = [...attachments];
      input = text;
      attachments = fileAttachments;
      // Wait for DOM to update before adjusting height
      requestAnimationFrame(() => {
        adjustHeight();
        if (textareaRef) {
          textareaRef.focus();
          // Set cursor to the end of the text
          textareaRef.setSelectionRange(textareaRef.value.length, textareaRef.value.length);
        }
      });
    });
  }
});

async function cancelEditing(): Promise<void> {
  editState.cancelEditing();
  input = savedInput;
  savedInput = '';
  attachments = savedAttachments;
  savedAttachments = [];

  // Wait for DOM to update before resetting height
  await new Promise(resolve => requestAnimationFrame(resolve));
  adjustHeight();
}

const adjustHeight = (): void => {
  if (textareaRef) {
    textareaRef.style.height = 'auto';
    // Let the browser recalculate scrollHeight for the current content
    const scrollHeight = textareaRef.scrollHeight;
    const maxHeight = window.innerHeight * 0.25;
    const newHeight = Math.min(scrollHeight + 2, maxHeight);
    textareaRef.style.height = `${newHeight}px`;
  }
};

const resetHeight = (): void => {
  adjustHeight();
};

function setInput(value: string): void {
  input = value;
  adjustHeight();
}

function removeAttachment(index: number): void {
  attachments = attachments.filter((_, i) => i !== index);
}

function canSubmit(): boolean {
  return input.trim().length > 0 || attachments.length > 0;
}

async function submitForm(): Promise<void> {
  if (!canSubmit()) {
    return;
  }
  const text = input;

  if (editState.editingMessage) {
    const editingMessage = editState.editingMessage;
    const editedAttachments = attachments;
    // Clear input directly instead of using setInput('') to avoid calling adjustHeight() before DOM updates
    input = '';
    savedInput = '';
    attachments = [];
    savedAttachments = [];
    editState.cancelEditing();

    // Wait for DOM to update before resetting height
    await new Promise(resolve => requestAnimationFrame(resolve));
    resetHeight();

    await window.inferenceDeleteTrailingMessages(editingMessage.id);

    const index = chatClient.messages.findIndex(m => m.id === editingMessage.id);
    if (index !== -1) {
      const fileParts = editedAttachments.map(attachment => ({
        type: 'file' as const,
        url: attachment.url,
        filename: attachment.name,
        mediaType: attachment.contentType ?? 'application/octet-stream',
      }));
      const updatedMessage = {
        ...editingMessage,
        parts: [...(text.trim().length > 0 ? [{ type: 'text' as const, text }] : []), ...fileParts],
      };
      chatClient.messages = [...chatClient.messages.slice(0, index), updatedMessage];
    }

    await chatClient.regenerate();
    return;
  }

  // Clear input directly instead of using setInput('') to avoid calling adjustHeight() before DOM updates
  input = '';

  // Wait for DOM to update before resetting height
  await new Promise(resolve => requestAnimationFrame(resolve));
  resetHeight();

  const files = attachments.map(attachment => ({
    type: 'file' as const,
    url: attachment.url,
    filename: attachment.name,
    mediaType: attachment.contentType ?? 'application/octet-stream',
  }));
  const previousAttachments = attachments;
  attachments = [];

  try {
    await chatClient.sendMessage({ text, files });
  } catch (error) {
    // Restore user state so they can retry
    attachments = previousAttachments;
    input = text;
    await new Promise(resolve => requestAnimationFrame(resolve));
    resetHeight();
    console.error('Failed to send message:', error);
    toast.error('Failed to send message. Please try again.');
    return;
  }

  if (innerWidth.current && innerWidth.current > 768) {
    textareaRef?.focus();
  }
}

function fileUrl(filePath: string): string {
  let pathName = filePath;
  pathName = pathName.replace(/\\/g, '/');

  // Windows drive letter must be prefixed with a slash.
  if (pathName[0] !== '/') {
    pathName = `/${pathName}`;
  }

  // Escape required characters for path components.
  // See: https://tools.ietf.org/html/rfc3986#section-3.3
  return encodeURI(`file://${pathName}`).replace(/[?#]/g, encodeURIComponent);
}

const MAX_FILE_SIZE_KEY = `${ChatSettings.SectionName}.${ChatSettings.MaxDndFileSizeMB}`;
const DEFAULT_MAX_FILE_SIZE_MB = 20;

async function getMaxFileSizeBytes(): Promise<number> {
  const maxSizeMB = (await window.getConfigurationValue<number>(MAX_FILE_SIZE_KEY)) ?? DEFAULT_MAX_FILE_SIZE_MB;
  return maxSizeMB * 1024 * 1024;
}

function rejectOversizedFile(fileName: string, maxSizeMB: number): void {
  toast.error(`${fileName} is too large to attach (max ${maxSizeMB} MB).`, {
    action: {
      label: 'Settings',
      onClick: (): void => router.goto('/preferences/default/preferences.chat'),
    },
  });
}

const mimeToExtension: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

function extensionForMimeType(mime: string): string {
  return mimeToExtension[mime] ?? 'bin';
}

async function processClipboardFiles(clipboardData: DataTransfer): Promise<void> {
  const files: File[] = [];

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }

  // Fallback for environments where items is empty but files is populated
  if (files.length === 0 && clipboardData.files.length > 0) {
    files.push(...Array.from(clipboardData.files));
  }

  const maxSizeBytes = await getMaxFileSizeBytes();

  for (const file of files) {
    if (file.size > maxSizeBytes) {
      rejectOversizedFile(file.name, maxSizeBytes / (1024 * 1024));
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    let contentType = file.type;
    if (!contentType && file.name) {
      contentType = await window.pathMimeType(file.name);
    }
    contentType ||= 'application/octet-stream';
    attachments.push({
      url: dataUrl,
      name: file.name || `pasted-file-${Date.now()}.${extensionForMimeType(contentType)}`,
      contentType,
    });
  }
}

function handlePaste(event: ClipboardEvent): void {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;

  // Check both files and items — in some Chromium builds files may be empty while items has file entries
  const hasFileItem = Array.from(clipboardData.items ?? []).some(item => item.kind === 'file');
  if (!hasFileItem && clipboardData.files.length === 0) return;

  // If the clipboard also has non-empty text data, let normal paste handle it
  const hasTextData =
    clipboardData.types.includes('text/plain') && clipboardData.getData('text/plain').trim().length > 0;
  if (hasTextData) return;

  event.preventDefault();
  processClipboardFiles(clipboardData).catch((error: unknown) => {
    console.error('Failed to process pasted files:', error);
    toast.error('Failed to process pasted files. Please try again.');
  });
}

async function handleFile(): Promise<void> {
  const filepaths = await window.openDialog({
    title: 'Select files',
    selectors: ['openFile', 'multiSelections'],
  });
  if (!filepaths?.length) return;

  const maxSizeBytes = await getMaxFileSizeBytes();

  for (const filepath of filepaths) {
    const fileSize = await window.pathFileSize(filepath);
    if (fileSize > maxSizeBytes) {
      const fileName = filepath.split(/[/\\]/).pop() ?? filepath;
      rejectOversizedFile(fileName, maxSizeBytes / (1024 * 1024));
      continue;
    }
    const mimeType = await window.pathMimeType(filepath);
    const url = fileUrl(filepath);
    attachments.push({
      url,
      name: url.substring(url.lastIndexOf('/') + 1),
      contentType: mimeType,
    });
  }
}

let isDragging = $state(false);
let dragDepth = 0;

function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types?.includes('Files') ?? false;
}

function handleDragEnter(event: DragEvent): void {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  isDragging = true;
}

function handleDragOver(event: DragEvent): void {
  if (!isFileDrag(event)) return;
  event.preventDefault();
}

function handleDragLeave(): void {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    isDragging = false;
  }
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => resolve(reader.result as string);
    reader.onerror = (): void => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function handleDrop(event: DragEvent): Promise<void> {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  isDragging = false;
  dragDepth = 0;

  const files = event.dataTransfer?.files;
  if (!files?.length) return;

  const maxSizeBytes = await getMaxFileSizeBytes();

  // Collect file references synchronously before any async work
  const fileList = Array.from(files);

  for (const file of fileList) {
    if (file.size > maxSizeBytes) {
      rejectOversizedFile(file.name, maxSizeBytes / (1024 * 1024));
      continue;
    }
    const url = await readFileAsDataUrl(file);
    attachments.push({
      url,
      name: file.name,
      contentType: file.type || (await window.pathMimeType(file.name)),
    });
  }
}

onMount(() => {
  input = storedInput.value;
  adjustHeight();
  mounted = true;
});

$effect.pre(() => {
  storedInput.value = input;
});

// Global ESC handler for edit mode
$effect((): (() => void) | void => {
  if (editState.isEditing) {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelEditing().catch(console.error);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return (): void => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }
});
</script>

<div class="relative flex w-full flex-col gap-4">
  {#if mounted && chatClient.messages.length === 0 && attachments.length === 0}
    <SuggestedActions {chatClient} {selectedMCPTools} />
  {/if}

  {#if editState.isEditing}
    <div class="text-muted-foreground px-3 pt-2 text-sm">Press ESC to cancel editing</div>
  {/if}

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- drop zone wraps the interactive textarea, adding a role would be semantically incorrect -->
  <div
    class={cn(
      'bg-muted flex flex-col rounded-2xl border border-[var(--pd-input-field-stroke)]',
      isDragging && 'border-primary border-dashed',
      c
    )}
    ondragenter={handleDragEnter}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={(e): void => { handleDrop(e).catch(console.error); }}
  >
    {#if attachments.length > 0}
      <div
        class="flex flex-row items-end gap-2 overflow-x-auto overflow-y-visible px-2 pt-1 pb-0"
        onwheel={(e): void => { if (e.deltaX !== 0) e.stopPropagation(); }}
        ontouchmove={(e): void => { e.stopPropagation(); }}
      >
        {#each attachments as attachment, index (`${attachment.url}:${index}`)}
          <PreviewAttachment {attachment} onremove={(): void => removeAttachment(index)} />
        {/each}
      </div>
    {/if}

    <Textarea
      bind:ref={textareaRef}
      placeholder="Send a message..."
      bind:value={():string => input, setInput}
      class="max-h-[calc(25dvh)] min-h-[24px] resize-none overflow-y-auto border-0 bg-transparent dark:bg-transparent text-base! shadow-none focus-visible:ring-0"
      rows={2}
      autofocus
      onpaste={handlePaste}
      onkeydown={async (event): Promise<void> => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.preventDefault();

          if (loading) {
            toast.error('Please wait for the model to finish its response!');
          } else {
            await submitForm();
          }
        }
      }}
    />

    <div class="flex w-full flex-row items-center justify-between px-1 py-1">
      <div class="flex flex-row justify-start">
        <Button
          class="h-fit rounded-md rounded-bl-lg p-[7px] hover:bg-[var(--pd-content-card-hover-bg)] dark:hover:bg-[var(--pd-content-card-hover-bg)]"
          onclick={(event): void => {
            event.preventDefault();
            handleFile().catch(console.error);
          }}
          disabled={loading}
          variant="ghost"
          aria-label="Attach file"
          title="Attach file"
        >
          <PaperclipIcon size={14} />
        </Button>
      </div>

      <div class="flex flex-row items-center justify-end gap-1">
        {#if noMcps}
          <Button
            variant="link"
            class="h-auto p-0 text-xs hover:underline text-muted-foreground"
            onclick={(): void => router.goto('/mcps')}
          >
            Configure MCP servers
          </Button>
        {:else}
          <Button
            aria-label="Tools Selection"
            variant="outline"
            onclick={(): void => { mcpSelectorOpen = true; }}
            class="w-fit h-8 px-2"
          >
            <Icon icon={faToolbox} />
            Tools ({selectedMCPToolsCount})
          </Button>
        {/if}
        <ModelSelector
          models={models}
          menuSide="top"
          bind:value={selectedModel}
        />
        {#if loading}
          <Button
            aria-label="Stop generation"
            title="Stop generation"
            class="h-8 w-8 rounded-full border border-[var(--pd-input-field-stroke)] p-1.5"
            onclick={async (event): Promise<void> => {
              event.preventDefault();
              try {
                await chatClient.stop();
              } finally {
                if (activeStreamOnDataId !== undefined) {
                  await window.inferenceStopStream(activeStreamOnDataId);
                }
              }
            }}
          >
            <StopIcon size={14} />
          </Button>
        {:else}
          <Button
              aria-label="Send message"
              title="Send message"
              class="h-8 w-8 rounded-full border border-[var(--pd-input-field-stroke)] p-1.5"
              onclick={async (event): Promise<void> => {
                event.preventDefault();
                await submitForm();
              }}
              disabled={!canSubmit()}
            >
            <ArrowUpIcon size={14} />
          </Button>
        {/if}
      </div>
    </div>
  </div>
</div>
