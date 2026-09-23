<script lang="ts">
import { faPaperclip, faPaperPlane, faSquare, faXmark } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { toast } from '@zerodevx/svelte-toast';
import { untrack } from 'svelte';
import { router } from 'tinro';

import { acpSessions, acpSessionsEventStoreInfo } from '/@/stores/acp-sessions.svelte';
import type {
  AcpAttachment,
  AcpFlowEvent,
  AcpSessionConfigOption,
  AcpSessionConfigSelectGroup,
  AcpSessionConfigSelectOption,
  AcpSessionInfo,
  AcpSessionStatus,
  AcpSlashCommand,
} from '/@api/acp-session-info';
import { AcpSettings } from '/@api/acp-settings';

import AcpAtMentionCompletion from './AcpAtMentionCompletion.svelte';
import AcpSlashCommandCompletion from './AcpSlashCommandCompletion.svelte';
import AcpFlowAgentMessage from './flow/AcpFlowAgentMessage.svelte';
import AcpFlowPlan from './flow/AcpFlowPlan.svelte';
import AcpFlowPrompt from './flow/AcpFlowPrompt.svelte';
import AcpFlowThinking from './flow/AcpFlowThinking.svelte';
import AcpFlowToolCall from './flow/AcpFlowToolCall.svelte';
import { InputHistory } from './input-history.js';

interface Props {
  sessionId: string;
  draftSandboxName?: string;
  draftAgentId?: string;
}

let { sessionId, draftSandboxName, draftAgentId }: Props = $props();

const isDraft = $derived(sessionId === 'new' && !!draftSandboxName);

let events: AcpFlowEvent[] = $state([]);
let followUpText = $state('');
interface PendingAttachment extends AcpAttachment {
  sourceKey?: string;
  fileSize?: number;
  isTemp?: boolean;
}

let pendingAttachments: PendingAttachment[] = $state([]);
let sendError: string | undefined = $state(undefined);
let fetchSeq = 0;
let flowContainer: HTMLElement | undefined = $state(undefined);
let userScrolledAway = $state(false);

const session: AcpSessionInfo | undefined = $derived($acpSessions.find(s => s.id === sessionId));
const sessionDisplayName: string = $derived.by(() => {
  if (!session) return 'Session';
  const name = session.name?.trim();
  if (name) return name;
  return session.prompt.trim() ? session.prompt.trim() : 'Session';
});
const isWaitingInput = $derived(!isDraft && session?.status === 'waiting_input');
const hasPendingPermission = $derived(
  events.some(e => e.kind === 'tool_call' && e.permissionRequest && !e.permissionRequest.resolved),
);
const canSendFollowUp = $derived(
  isDraft ||
    (session?.sandboxId &&
      (session?.status === 'running' ||
        session?.status === 'idle' ||
        session?.status === 'waiting_input' ||
        session?.status === 'completed')),
);

const slashQuery = $derived(
  followUpText.startsWith('/') && !followUpText.includes(' ') ? followUpText.slice(1) : undefined,
);
const showSlashCompletion = $derived(slashQuery !== undefined && (session?.availableCommands?.length ?? 0) > 0);
let completionRef: AcpSlashCommandCompletion | undefined = $state(undefined);

function handleSlashSelect(cmd: AcpSlashCommand): void {
  followUpText = `/${cmd.name} `;
}

function handleSlashCancel(): void {
  followUpText = '';
}

let inputHistory = new InputHistory();
let textareaEl: HTMLTextAreaElement | undefined = $state(undefined);
let atQuery: string | undefined = $state(undefined);
let atStartIndex = $state(-1);
let atCompletionRef: AcpAtMentionCompletion | undefined = $state(undefined);
const showAtCompletion = $derived(atQuery !== undefined);

function handleInput(): void {
  if (!textareaEl) return;
  const cursor = textareaEl.selectionStart;
  const text = followUpText;
  for (let i = cursor - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === ' ' || ch === '\n') break;
    if (ch === '@') {
      if (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\n') {
        const q = text.slice(i + 1, cursor);
        if (!q.includes(' ') && !q.includes('\n')) {
          atQuery = q;
          atStartIndex = i;
          return;
        }
      }
      break;
    }
  }
  atQuery = undefined;
  atStartIndex = -1;
}

async function handleAtSelect(): Promise<void> {
  const cursorBefore = textareaEl?.selectionStart ?? followUpText.length;
  await handleAttach();
  if (atStartIndex >= 0) {
    followUpText = followUpText.slice(0, atStartIndex) + followUpText.slice(cursorBefore);
  }
  atQuery = undefined;
  atStartIndex = -1;
}

function handleAtCancel(): void {
  atQuery = undefined;
  atStartIndex = -1;
}

const hasModes = $derived(session?.availableModes && session.availableModes.length > 0);
const modeOptions = $derived(session?.availableModes?.map(m => ({ label: m.name, value: m.modeId })) ?? []);
let selectedModeId = $state('');

$effect(() => {
  if (session?.currentModeId) {
    selectedModeId = session.currentModeId;
  }
});

function handleModeChange(e: Event): void {
  const modeId = (e.target as HTMLSelectElement).value;
  if (modeId && modeId !== session?.currentModeId) {
    window.setAcpSessionMode(sessionId, modeId).catch((err: unknown) => console.error('Failed to set mode', err));
  }
}

const hasModels = $derived(session?.availableModels && session.availableModels.length > 0);
const modelOptions = $derived(session?.availableModels?.map(m => ({ label: m.name, value: m.modelId })) ?? []);
let selectedModelId = $state('');

$effect(() => {
  if (session?.currentModelId) {
    selectedModelId = session.currentModelId;
  }
});

function handleModelChange(e: Event): void {
  const modelId = (e.target as HTMLSelectElement).value;
  if (modelId && modelId !== session?.currentModelId) {
    window.setAcpSessionModel(sessionId, modelId).catch((err: unknown) => console.error('Failed to set model', err));
  }
}

const selectConfigOptions = $derived(
  (session?.configOptions ?? []).filter(
    (o): o is AcpSessionConfigOption & { type: 'select' } => o.type === 'select' && o.category !== 'mode',
  ),
);

function isGrouped(
  options: AcpSessionConfigSelectOption[] | AcpSessionConfigSelectGroup[],
): options is AcpSessionConfigSelectGroup[] {
  return options.length > 0 && 'group' in options[0]!;
}

function handleConfigChange(configId: string, e: Event): void {
  const value = (e.target as HTMLSelectElement).value;
  window
    .setAcpSessionConfigOption(sessionId, configId, value)
    .catch((err: unknown) => console.error('Failed to set config option', err));
}

const isRunning = $derived(session?.status === 'running');
const hasContext = $derived(session?.contextSize !== undefined && session.contextSize > 0);
const contextPercent = $derived(
  hasContext ? Math.round(((session?.contextUsed ?? 0) / (session?.contextSize ?? 1)) * 100) : 0,
);

function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`;
}

const WORKING_VERBS = [
  'Thinking',
  'Pondering',
  'Contemplating',
  'Deliberating',
  'Cogitating',
  'Musing',
  'Ruminating',
  'Mulling',
  'Considering',
  'Philosophising',
  'Synthesizing',
  'Orchestrating',
  'Choreographing',
  'Composing',
  'Crafting',
  'Architecting',
  'Forging',
  'Hatching',
  'Concocting',
  'Brewing',
  'Computing',
  'Processing',
  'Calculating',
  'Crunching',
  'Inferring',
  'Imagining',
  'Envisioning',
  'Ideating',
  'Noodling',
  'Sketching',
  'Crystallizing',
  'Coalescing',
  'Harmonizing',
  'Cultivating',
  'Germinating',
  'Percolating',
  'Simmering',
  'Fermenting',
  'Incubating',
  'Sprouting',
  'Channeling',
  'Manifesting',
  'Conjuring',
  'Transmuting',
  'Transfiguring',
  'Deciphering',
  'Unravelling',
  'Puzzling',
  'Elucidating',
  'Reticulating',
  'Tinkering',
  'Puttering',
  'Fiddling',
  'Improvising',
  'Doodling',
  'Cascading',
  'Swirling',
  'Whirring',
  'Undulating',
  'Flowing',
  'Churning',
  'Spinning',
  'Warping',
  'Orbiting',
  'Nebulizing',
  'Grooving',
  'Vibing',
  'Moonwalking',
  'Boogieing',
  'Gallivanting',
  'Meandering',
  'Moseying',
  'Perambulating',
  'Wandering',
  'Kneading',
  'Seasoning',
  'Garnishing',
  'Marinating',
  'Whisking',
  'Flambéing',
  'Sautéing',
  'Caramelizing',
  'Tempering',
  'Zesting',
  'Combobulating',
  'Recombobulating',
  'Discombobulating',
  'Flummoxing',
  'Befuddling',
  'Shenaniganing',
  'Razzle-dazzling',
  'Lollygagging',
  'Dilly-dallying',
  'Tomfoolering',
];
// eslint-disable-next-line sonarjs/pseudo-random
let workingVerbIndex = $state(Math.floor(Math.random() * WORKING_VERBS.length));
let workingInterval: ReturnType<typeof setInterval> | undefined;

$effect(() => {
  if (isRunning) {
    workingVerbIndex = Math.floor(Math.random() * WORKING_VERBS.length); // eslint-disable-line sonarjs/pseudo-random
    workingInterval = setInterval(() => {
      workingVerbIndex = (workingVerbIndex + 1) % WORKING_VERBS.length;
    }, 4000);
  } else {
    if (workingInterval) clearInterval(workingInterval);
    workingInterval = undefined;
  }
  return (): void => {
    if (workingInterval) clearInterval(workingInterval);
  };
});

const STATUS_COLORS: Record<AcpSessionStatus, string> = {
  idle: 'bg-[var(--pd-status-not-running)]',
  running: 'bg-[var(--pd-status-running)]',
  waiting_input: 'bg-[var(--pd-status-waiting)]',
  completed: 'bg-[var(--pd-status-terminated)]',
  error: 'bg-[var(--pd-status-dead)]',
  cancelled: 'bg-[var(--pd-status-not-running)]',
};

const SCROLL_BOTTOM_THRESHOLD = 10;

function scrollToBottom(): void {
  if (flowContainer) {
    flowContainer.scrollTop = flowContainer.scrollHeight;
  }
}

function updateScrollLock(): void {
  if (!flowContainer) return;
  const { scrollTop, scrollHeight, clientHeight } = flowContainer;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
  userScrolledAway = distanceFromBottom > SCROLL_BOTTOM_THRESHOLD;
}

function refreshEvents(): void {
  if (isDraft) return;
  const seq = ++fetchSeq;
  window
    .getAcpSessionEvents(sessionId)
    .then((loadedEvents: AcpFlowEvent[]) => {
      if (seq === fetchSeq) {
        events = loadedEvents;
      }
    })
    .catch((err: unknown) => console.error('Failed to load events', err));
}

$effect(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, sonarjs/no-unused-vars
  const _sessions = $acpSessions;
  refreshEvents();
});

$effect(() => {
  const el = flowContainer;
  if (!el) return;
  el.addEventListener('scroll', updateScrollLock, { passive: true });
  return (): void => {
    el.removeEventListener('scroll', updateScrollLock);
  };
});

$effect(() => {
  const el = flowContainer;
  if (!el) return;
  const observer = new MutationObserver(() => {
    if (!userScrolledAway) scrollToBottom();
  });
  observer.observe(el, { childList: true, subtree: true, characterData: true });
  return (): void => observer.disconnect();
});

$effect(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, sonarjs/no-unused-vars
  const _id = sessionId;
  inputHistory = new InputHistory();
  followUpText = '';
  cleanupTempAttachments(untrack(() => pendingAttachments));
  pendingAttachments = [];
  sendError = undefined;
  userScrolledAway = false;
  acpSessionsEventStoreInfo?.fetch()?.catch(() => {});
  return (): void => {
    cleanupTempAttachments(untrack(() => pendingAttachments));
  };
});

// Pre-populate input history from existing prompt events (sessions loaded from disk)
$effect(() => {
  if (events.length > 0) {
    inputHistory.populateFromEvents(events.filter(e => e.kind === 'prompt').map(e => e.text));
  }
});

$effect(() => {
  if (isWaitingInput && hasPendingPermission && flowContainer) {
    requestAnimationFrame(() => {
      const pending = flowContainer?.querySelectorAll('.tool-call-pending-permission');
      if (pending?.length) {
        const lastPending = pending[pending.length - 1];
        lastPending?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const firstButton = lastPending?.querySelector<HTMLButtonElement>('.permission-actions button');
        firstButton?.focus();
      }
    });
  }
});

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.py': 'text/x-python',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.sh': 'text/x-shellscript',
};

function getMimeType(filePath: string): string {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return 'application/octet-stream';
  const ext = filePath.slice(dotIndex).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

async function handleAttach(): Promise<void> {
  const result = await window.openDialog({ title: 'Attach files', selectors: ['openFile', 'multiSelections'] });
  if (!result?.length) return;
  const newAttachments: PendingAttachment[] = [];
  for (const filePath of result) {
    if (pendingAttachments.some(a => a.filePath === filePath) || newAttachments.some(a => a.filePath === filePath))
      continue;
    const fileSize = await window.pathFileSize(filePath);
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    if (fileSize > maxFileSizeBytes) {
      rejectOversizedFile(fileName);
      continue;
    }
    newAttachments.push({ filePath, fileName, mimeType: getMimeType(filePath), fileSize });
  }
  if (newAttachments.length > 0) {
    pendingAttachments = [...pendingAttachments, ...newAttachments];
  }
}

function cleanupTempAttachments(attachments: PendingAttachment[]): void {
  for (const a of attachments) {
    if (a.isTemp) window.removeTempFile(a.filePath).catch(console.error);
  }
}

function removeAttachment(index: number): void {
  const removed = pendingAttachments[index];
  pendingAttachments = pendingAttachments.filter((_, i) => i !== index);
  if (removed) cleanupTempAttachments([removed]);
}

const DEFAULT_MAX_FILE_SIZE_MB = 20;
let maxFileSizeMB = $state(DEFAULT_MAX_FILE_SIZE_MB);
const maxFileSizeBytes = $derived(maxFileSizeMB * 1024 * 1024);

window
  .getConfigurationValue<number>(`${AcpSettings.SectionName}.${AcpSettings.MaxAttachmentFileSizeMB}`)
  .then(v => {
    if (v && v > 0) maxFileSizeMB = v;
  })
  .catch(() => {});

// TODO Refactor as part of https://github.com/openkaiden/kaiden/issues/2972
const ERROR_TOAST_THEME = {
  '--toastBackground': 'var(--pd-status-dead)',
  '--toastColor': 'var(--pd-content-header-text)',
  '--toastBarBackground': 'var(--pd-status-dead)',
  '--toastPadding': '0.5rem 0.75rem',
  '--toastMsgPadding': '0',
};

function rejectOversizedFile(fileName: string): void {
  toast.push(`${fileName} is too large to attach (max ${maxFileSizeMB} MB).`, { theme: ERROR_TOAST_THEME });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (): void => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] ?? '');
    };
    reader.onerror = (): void => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addFileAttachment(file: File): Promise<void> {
  if (file.size > maxFileSizeBytes) {
    rejectOversizedFile(file.name);
    return;
  }
  const sourceKey = `${file.name}|${file.size}|${file.lastModified}`;
  if (pendingAttachments.some(a => a.sourceKey === sourceKey)) return;
  // DnD: dedup by native path (two files can share name+size from different dirs)
  // Paste: no native path available, fall back to name+size
  const nativePath = window.getPathForFile(file);
  if (nativePath) {
    if (pendingAttachments.some(a => a.filePath === nativePath)) return;
  } else {
    if (pendingAttachments.some(a => a.fileName === file.name && a.fileSize === file.size)) return;
  }
  let mimeType = file.type;
  if (!mimeType && file.name) {
    mimeType = getMimeType(file.name);
  }
  mimeType ||= 'application/octet-stream';
  const fileName = file.name || `pasted-file-${Date.now()}.${mimeType.split('/')[1] ?? 'bin'}`;
  const originSessionId = sessionId;
  let filePath: string;
  let isTemp = false;
  if (nativePath) {
    filePath = nativePath;
  } else {
    const base64 = await readFileAsBase64(file);
    filePath = await window.saveTempAttachment(fileName, base64);
    isTemp = true;
  }
  // Discard if the session changed during async work
  if (sessionId !== originSessionId) {
    if (isTemp) window.removeTempFile(filePath).catch(() => {});
    return;
  }
  pendingAttachments = [
    ...pendingAttachments,
    { filePath, fileName, mimeType, sourceKey, fileSize: file.size, isTemp },
  ];
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

async function handleDrop(event: DragEvent): Promise<void> {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  isDragging = false;
  dragDepth = 0;
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  // Sequential: addFileAttachment mutates pendingAttachments, parallel would break dedup checks
  for (const file of Array.from(files)) {
    try {
      await addFileAttachment(file);
    } catch (error: unknown) {
      console.error('Failed to attach dropped file:', error);
      toast.push(`Failed to attach ${file.name}.`, { theme: ERROR_TOAST_THEME });
    }
  }
}

function handlePaste(event: ClipboardEvent): void {
  const clipboardData = event.clipboardData;
  if (!clipboardData) return;
  const hasFileItem = Array.from(clipboardData.items ?? []).some(item => item.kind === 'file');
  if (!hasFileItem && clipboardData.files.length === 0) return;
  const hasTextData =
    clipboardData.types.includes('text/plain') && clipboardData.getData('text/plain').trim().length > 0;
  // If clipboard has text, let the default paste behavior handle it (text wins over file items)
  if (hasTextData) return;
  event.preventDefault();
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind === 'file') {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  if (files.length === 0 && clipboardData.files.length > 0) {
    files.push(...Array.from(clipboardData.files));
  }
  // Sequential: addFileAttachment mutates pendingAttachments, parallel would break dedup checks
  (async (): Promise<void> => {
    for (const f of files) {
      await addFileAttachment(f);
    }
  })().catch((error: unknown) => {
    console.error('Failed to process pasted files:', error);
    toast.push('Failed to process pasted files.', { theme: ERROR_TOAST_THEME });
  });
}

async function handleSendFollowUp(): Promise<void> {
  const text = followUpText.trim();
  if (!text && pendingAttachments.length === 0) return;
  const textToSend = text || ' ';
  const attachmentsToSend =
    pendingAttachments.length > 0
      ? pendingAttachments.map(a => ({ filePath: a.filePath, fileName: a.fileName, mimeType: a.mimeType }))
      : undefined;

  if (isDraft && draftSandboxName) {
    try {
      sendError = undefined;
      const newSession = await window.createAcpSession({
        sandboxName: draftSandboxName,
        prompt: textToSend,
        agentId: draftAgentId ?? undefined,
      });
      followUpText = '';
      cleanupTempAttachments(pendingAttachments);
      pendingAttachments = [];
      router.goto(`/acp-sessions/${encodeURIComponent(newSession.id)}`);
    } catch (err: unknown) {
      console.error('Failed to create session', err);
      sendError = err instanceof Error ? err.message : String(err);
    }
    return;
  }

  const savedText = followUpText;
  const savedAttachments = pendingAttachments;
  const savedScrollLock = userScrolledAway;
  const historyAtSend = inputHistory;
  try {
    sendError = undefined;
    followUpText = '';
    pendingAttachments = [];
    userScrolledAway = false;
    await window.sendAcpFollowUp(sessionId, textToSend, attachmentsToSend);
    cleanupTempAttachments(savedAttachments);
    if (inputHistory === historyAtSend) {
      inputHistory.push(savedText);
    }
    refreshEvents();
  } catch (err: unknown) {
    console.error('Failed to send follow-up', err);
    sendError = err instanceof Error ? err.message : String(err);
    followUpText = savedText;
    pendingAttachments = savedAttachments;
    userScrolledAway = savedScrollLock;
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.isComposing) return;
  if (showSlashCompletion && completionRef?.handleKey(e)) {
    return;
  }
  if (showAtCompletion && atCompletionRef?.handleKey(e)) {
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSendFollowUp().catch((e: unknown) => console.error(e));
    return;
  }
  if (e.key === 'ArrowUp' && textareaEl && textareaEl.selectionStart === textareaEl.selectionEnd) {
    if (!followUpText.substring(0, textareaEl.selectionStart).includes('\n')) {
      const entry = inputHistory.navigateBack(followUpText);
      if (entry !== undefined) {
        e.preventDefault();
        followUpText = entry;
      }
    }
    return;
  }
  if (e.key === 'ArrowDown' && textareaEl && textareaEl.selectionStart === textareaEl.selectionEnd) {
    if (!followUpText.substring(textareaEl.selectionStart).includes('\n')) {
      const entry = inputHistory.navigateForward();
      if (entry !== undefined) {
        e.preventDefault();
        followUpText = entry;
      }
    }
  }
}
</script>

<!-- Header bar -->
<div class="flex items-center justify-between px-4 py-2 border-b border-[var(--pd-content-divider)]">
  <div class="flex items-center gap-2 min-w-0">
    <span class="w-2 h-2 rounded-full shrink-0 {STATUS_COLORS[session?.status ?? 'idle']}"></span>
    <span class="text-sm font-medium text-[var(--pd-content-header-text)] truncate">
      {#if isDraft}
        New Session
      {:else}
        {sessionDisplayName.length > 80 ? `${sessionDisplayName.slice(0, 80)}…` : sessionDisplayName}
      {/if}
    </span>
    {#if isDraft && draftSandboxName}
      <span class="text-xs text-[var(--pd-content-text)] opacity-50 shrink-0">({draftSandboxName})</span>
    {:else if session?.sandboxName}
      <span class="text-xs text-[var(--pd-content-text)] opacity-50 shrink-0">({session.sandboxName})</span>
    {/if}
  </div>
  <div class="flex items-center gap-2 shrink-0">
    {#if session?.cost}
      <span class="text-xs text-[var(--pd-content-text)] opacity-50">
        ${session.cost.totalCost.toFixed(4)} {session.cost.currency}
      </span>
    {/if}
  </div>
</div>

<!-- Events flow -->
<div class="flex-1 min-h-0 overflow-auto p-4" bind:this={flowContainer}>
  <div class="flex flex-col gap-3 max-w-4xl mx-auto">
    {#each events as event, i (i)}
      {#if event.kind === 'prompt'}
        <AcpFlowPrompt {event} />
      {:else if event.kind === 'agent_message'}
        <AcpFlowAgentMessage {event} />
      {:else if event.kind === 'thinking'}
        {@const nextEvent = events[i + 1]}
        {@const isThinkingComplete = !!nextEvent || session?.status !== 'running'}
        {@const thinkingDurationMs = nextEvent ? nextEvent.timestamp - event.timestamp : undefined}
        <AcpFlowThinking {event} isComplete={isThinkingComplete} durationMs={thinkingDurationMs} />
      {:else if event.kind === 'tool_call'}
        <AcpFlowToolCall {event} {sessionId} />
      {:else if event.kind === 'plan'}
        <AcpFlowPlan {event} />
      {/if}
    {/each}

    {#if session?.status === 'running'}
      <div class="flex items-center gap-2 text-sm text-[var(--pd-content-text)] opacity-60 py-2">
        <div class="w-2 h-2 rounded-full bg-[var(--pd-status-running)] animate-pulse"></div>
        {WORKING_VERBS[workingVerbIndex]}…
      </div>
    {/if}

    {#if session?.status === 'error' && session?.error}
      <div class="rounded-lg border border-[var(--pd-status-dead)] bg-[var(--pd-status-dead)]/10 px-4 py-3 text-sm text-[var(--pd-status-dead)]">
        {session.error}
      </div>
    {/if}

    {#if session && !session.sandboxId}
      <div class="rounded-lg border border-[var(--pd-state-warning)] bg-[var(--pd-state-warning)]/10 px-4 py-3 text-sm text-[var(--pd-state-warning)]">
        Sandbox "{session.sandboxName}" no longer exists. This session is read-only.
      </div>
    {/if}
  </div>
</div>

{#if sendError}
  <div class="px-4">
    <div class="max-w-4xl mx-auto rounded-lg border border-[var(--pd-status-dead)] bg-[var(--pd-status-dead)]/10 px-4 py-3 text-sm text-[var(--pd-status-dead)]">
      {sendError}
    </div>
  </div>
{/if}

<!-- Input area -->
{#if canSendFollowUp}
  <div class="px-4 pb-3 pt-2">
    <div class="max-w-4xl mx-auto">
      <!-- Context usage bar -->
      {#if hasContext}
        <div class="flex items-center gap-3 pb-2">
          <div class="flex-1 h-1.5 rounded-full bg-[var(--pd-content-card-hover-bg)] overflow-hidden">
            <div
              class="h-full rounded-full bg-[var(--pd-status-running)] transition-all"
              style="width: {contextPercent}%"
            ></div>
          </div>
          <span class="text-xs text-[var(--pd-content-text)] opacity-50 shrink-0">
            {contextPercent}% context used {formatTokens(session?.contextUsed ?? 0)} / {formatTokens(session?.contextSize ?? 0)}
          </span>
        </div>
      {/if}

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="rounded-lg border bg-[var(--pd-input-field-bg)] focus-within:ring-1 focus-within:ring-[var(--pd-input-field-stroke-highlight)] {isDragging ? 'border-[var(--pd-button-primary-bg)] border-dashed' : 'border-[var(--pd-input-field-stroke)]'}"
        ondragenter={handleDragEnter}
        ondragover={handleDragOver}
        ondragleave={handleDragLeave}
        ondrop={(e): void => { handleDrop(e).catch(console.error); }}
      >
        <!-- Attachment chips -->
        {#if pendingAttachments.length > 0}
          <div class="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto px-3 pt-2">
            {#each pendingAttachments as attachment, i (attachment.filePath)}
              <span class="inline-flex items-center gap-1 rounded-full bg-[var(--pd-content-card-hover-bg)] text-xs text-[var(--pd-content-text)] px-2.5 py-1">
                {attachment.fileName}
                <button
                  class="flex items-center justify-center w-4 h-4 rounded-full hover:bg-[var(--pd-content-card-bg)] transition-colors"
                  onclick={(): void => removeAttachment(i)}
                  title="Remove"
                >
                  <Icon icon={faXmark} class="text-[10px]" />
                </button>
              </span>
            {/each}
          </div>
        {/if}

        <!-- Textarea -->
        <div class="relative">
          {#if showSlashCompletion && session?.availableCommands}
            <AcpSlashCommandCompletion
              bind:this={completionRef}
              commands={session.availableCommands}
              query={slashQuery ?? ''}
              onselect={handleSlashSelect}
              oncancel={handleSlashCancel}
            />
          {/if}
          {#if showAtCompletion}
            <AcpAtMentionCompletion
              bind:this={atCompletionRef}
              query={atQuery ?? ''}
              onselect={(): void => { handleAtSelect().catch((e: unknown) => console.error(e)); }}
              oncancel={handleAtCancel}
            />
          {/if}
          <textarea
            bind:this={textareaEl}
            bind:value={followUpText}
            rows={3}
            placeholder={isWaitingInput ? 'Respond to the pending request above to continue…' : isDraft ? 'Describe your goal to start a new session…' : 'Describe your goal...'}
            disabled={isWaitingInput}
            onkeydown={handleKeyDown}
            oninput={handleInput}
            onpaste={handlePaste}
            class="w-full bg-transparent px-3 py-2 text-sm text-[var(--pd-input-field-focused-text)] placeholder-[var(--pd-input-field-placeholder-text)] focus:outline-none resize-none disabled:opacity-40 disabled:cursor-not-allowed"
          ></textarea>
        </div>

        <!-- Toolbar inside the box -->
        <div class="flex items-center justify-between px-2 pb-2">
          <div class="flex items-center gap-1">
            <button
              class="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-[var(--pd-content-text)] opacity-60 hover:opacity-100 hover:bg-[var(--pd-content-card-hover-bg)] transition-colors"
              title="Attach file"
              disabled={isWaitingInput}
              onclick={(): void => { handleAttach().catch((e: unknown) => console.error(e)); }}
            >
              <Icon icon={faPaperclip} class="text-xs" />
              Attach
            </button>
            {#if hasModels}
              <div class="inline-flex items-center gap-1.5 rounded-full border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] px-2.5 py-0.5">
                <span class="w-2 h-2 rounded-full bg-[var(--pd-status-connected)] shrink-0"></span>
                <select
                  bind:value={selectedModelId}
                  onchange={handleModelChange}
                  disabled={isRunning}
                  class="bg-transparent text-xs text-[var(--pd-content-text)] border-none outline-none cursor-pointer appearance-none pr-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {#each modelOptions as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              </div>
            {/if}
            {#if hasModes}
              <div class="inline-flex items-center gap-1.5 rounded-full border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] px-2.5 py-0.5">
                <span class="w-2 h-2 rounded-full bg-[var(--pd-status-running)] shrink-0"></span>
                <select
                  bind:value={selectedModeId}
                  onchange={handleModeChange}
                  disabled={isRunning}
                  class="bg-transparent text-xs text-[var(--pd-content-text)] border-none outline-none cursor-pointer appearance-none pr-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {#each modeOptions as opt (opt.value)}
                    <option value={opt.value}>{opt.label}</option>
                  {/each}
                </select>
              </div>
            {/if}
            {#each selectConfigOptions as configOpt (configOpt.id)}
              <div class="inline-flex items-center gap-1.5 rounded-full border border-[var(--pd-content-divider)] bg-[var(--pd-content-card-bg)] px-2.5 py-0.5" title={configOpt.description ?? configOpt.name}>
                <span class="w-2 h-2 rounded-full bg-[var(--pd-status-connected)] shrink-0"></span>
                <select
                  value={configOpt.currentValue}
                  onchange={(e: Event): void => handleConfigChange(configOpt.id, e)}
                  disabled={isRunning}
                  class="bg-transparent text-xs text-[var(--pd-content-text)] border-none outline-none cursor-pointer appearance-none pr-3 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {#if configOpt.options && isGrouped(configOpt.options)}
                    {#each configOpt.options as group (group.group)}
                      <optgroup label={group.name}>
                        {#each group.options as opt (opt.value)}
                          <option value={opt.value}>{opt.name}</option>
                        {/each}
                      </optgroup>
                    {/each}
                  {:else if configOpt.options}
                    {#each configOpt.options as opt (opt.value)}
                      <option value={opt.value}>{opt.name}</option>
                    {/each}
                  {/if}
                </select>
              </div>
            {/each}
          </div>
          <div class="flex items-center gap-1">
            {#if isRunning}
              <button
                onclick={(): void => { window.stopAcpPrompt(sessionId).catch((e: unknown) => console.error(e)); }}
                title="Stop"
                class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-[var(--pd-status-dead)] text-white hover:opacity-80 transition-colors"
              >
                <Icon icon={faSquare} class="text-[10px]" />
                Stop
              </button>
            {:else}
              <button
                onclick={(): void => { handleSendFollowUp().catch((e: unknown) => console.error(e)); }}
                disabled={(!followUpText.trim() && pendingAttachments.length === 0) || isWaitingInput}
                title="Send"
                class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-[var(--pd-button-primary-bg)] text-[var(--pd-button-primary-text)] hover:bg-[var(--pd-button-primary-bg-hover)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <Icon icon={faPaperPlane} class="text-[10px]" />
                Send
              </button>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
