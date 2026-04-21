<script lang="ts" module>
import type { ModelInfo } from '/@/lib/chat/components/model-info';

export function findModel(models: ModelInfo[], model: ModelInfo | undefined): ModelInfo | undefined {
  if (!model) return undefined;
  return models.find(
    m =>
      m.label === model.label &&
      m.providerId === model.providerId &&
      m.connectionName === model.connectionName &&
      m.type === model.type &&
      m.endpoint === model.endpoint,
  );
}
</script>

<script lang="ts">
import { Chat } from '@ai-sdk/svelte';
import type { Attachment } from '@ai-sdk/ui-utils';
import type { ReasoningUIPart, TextUIPart, UIMessage, UIMessageChunk } from 'ai';
import { untrack } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { toast } from 'svelte-sonner';

import { LAST_USED_MODEL_KEY } from '/@/lib/chat/ai/models';
import { ChatHistory } from '/@/lib/chat/hooks/chat-history.svelte';
import { EditState } from '/@/lib/chat/hooks/edit-state.svelte';
import { LocalStorage } from '/@/lib/chat/hooks/local-storage.svelte';
import { convertToUIMessages } from '/@/lib/chat/utils/chat';
import { getModels } from '/@/lib/models/models-utils';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { providerInfos } from '/@/stores/providers';
import { MessageConfigSchema } from '/@api/chat/message-config';
import type { Chat as DbChat, Message as DbMessage } from '/@api/chat/schema.js';

import ChatHeader from './chat-header.svelte';
import { IPCChatTransport } from './ipc-chat-transport';
import McpToolsSidepanel from './mcp-tools-sidepanel.svelte';
import Messages from './messages.svelte';
import MultimodalInput from './multimodal-input.svelte';
import NoModelsAvailable from './NoModelsAvailable.svelte';

let {
  chat,
  readonly,
  messages,
}: {
  chat: DbChat | undefined;
  messages: DbMessage[];
  readonly: boolean;
} = $props();

let models: Array<ModelInfo> = $derived(getModels($providerInfos));

const config = MessageConfigSchema.safeParse(messages[messages.length - 1]?.config).data;

const lastUsedModel = new LocalStorage<ModelInfo | undefined>(LAST_USED_MODEL_KEY, undefined);

let selectedModel = $derived<ModelInfo | undefined>(
  config
    ? {
        connectionName: config.connectionName,
        label: config.modelId,
        providerId: config.providerId,
        type: config.type ?? 'cloud',
        endpoint: config.endpoint,
      }
    : findModel(models, lastUsedModel.value) ?? models[0],
);

$effect(() => {
  if (selectedModel) {
    lastUsedModel.value = selectedModel;
  }
});

/**
 * Here we store the list of tools selected
 * key => the MCP Server ID
 * values => the selected tools
 */
const selectedMCPTools = new SvelteMap<string, SvelteSet<string>>(
  Object.entries(config?.tools ?? {}).reduce((acc, [mcpId, tools]) => {
    const server = $mcpRemoteServerInfos.find(r => r.id === mcpId);
    if (server) {
      const selectedTools: Array<string> = tools ?? Object.keys(server.tools) ?? [];
      acc.set(mcpId, new SvelteSet(selectedTools));
    }
    return acc;
  }, new Map<string, SvelteSet<string>>()),
);

const selectedMCPToolsCount = $derived(
  selectedMCPTools.entries().reduce((acc, [, tools]) => {
    return acc + tools.size;
  }, 0),
);

const chatHistory = ChatHistory.fromContext();

const chatClient = $derived(
  new Chat({
    id: chat?.id,
    transport: new IPCChatTransport({
      getModel: (): ModelInfo => {
        const value = $state.snapshot(selectedModel);
        if (!value) throw new Error('no model selected');
        return value;
      },
      getMCPTools: (): Record<string, Array<string>> => {
        return selectedMCPTools.entries().reduce(
          (accumulator, [mcpId, tools]) => {
            accumulator[mcpId] = Array.from(tools.values());
            return accumulator;
          },
          {} as Record<string, Array<string>>,
        );
      },
    }),
    // This way, the client is only recreated when the ID changes, allowing us to fully manage messages
    // clientside while still SSRing them on initial load or when we navigate to a different chat.
    messages: untrack(() => convertToUIMessages(messages)),
    generateId: crypto.randomUUID.bind(crypto),
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    onFinish: async (): Promise<void> => {
      await chatHistory.refetch();
    },
    onError: (error): void => {
      try {
        // If there's an API error, its message will be JSON-formatted
        const jsonError = JSON.parse(error.message);
        console.log(jsonError);
        if (
          typeof jsonError === 'object' &&
          jsonError !== null &&
          'message' in jsonError &&
          typeof jsonError.message === 'string'
        ) {
          toast.error(jsonError.message);
        } else {
          toast.error(error.message);
        }
      } catch {
        toast.error(error.message);
      }
    },
  }),
);

EditState.toContext();

let attachments = $state<Attachment[]>([]);
let mcpSelectorOpen = $state(false);
let activeStreamOnDataId = $state<number | undefined>(undefined);
let reconnectedStreamingMessage = $state<UIMessage | undefined>(undefined);

const hasModels = $derived(models && models.length > 0);
const hasActiveStream = $derived(activeStreamOnDataId !== undefined);

function onCheckMCPTool(mcpId: string, toolId: string, checked: boolean): void {
  const tools = selectedMCPTools.get(mcpId) ?? new SvelteSet();
  if (checked) {
    tools.add(toolId);
  } else {
    tools.delete(toolId);
  }
  selectedMCPTools.set(mcpId, tools);
}

// Reconnect to active stream when returning to a chat
let reconnectedMessageId = '';
let reconnectedText = '';
let reconnectedReasoning = '';

$effect(() => {
  const currentChatId = chat?.id;
  if (!currentChatId) {
    activeStreamOnDataId = undefined;
    reconnectedStreamingMessage = undefined;
    return;
  }

  untrack(() => {
    const activeStream = window.inferenceGetActiveStream(currentChatId);
    if (!activeStream || activeStream.isComplete) {
      return;
    }

    // Reset state for fresh reconnection
    reconnectedMessageId = '';
    reconnectedText = '';
    reconnectedReasoning = '';
    reconnectedStreamingMessage = undefined;

    function buildParts(
      state: 'streaming' | 'done',
    ): Array<TextUIPart | ReasoningUIPart> {
      const parts: Array<TextUIPart | ReasoningUIPart> = [];
      if (reconnectedReasoning) {
        parts.push({ type: 'reasoning' as const, text: reconnectedReasoning, state });
      }
      if (reconnectedText || state === 'streaming') {
        parts.push({ type: 'text' as const, text: reconnectedText, state });
      }
      return parts;
    }

    function appendChunkToLastMessage(chunk: UIMessageChunk): void {
      if (chunk.type === 'text-start') {
        reconnectedMessageId = chunk.id;
        reconnectedText = '';
        reconnectedReasoning = '';
        reconnectedStreamingMessage = {
          id: chunk.id,
          role: 'assistant',
          parts: [],
        };
      } else if (chunk.type === 'text-delta' && chunk.id === reconnectedMessageId) {
        reconnectedText += chunk.delta;
        reconnectedStreamingMessage = {
          id: reconnectedMessageId,
          role: 'assistant',
          parts: buildParts('streaming'),
        };
      } else if (chunk.type === 'reasoning-delta' && chunk.id === reconnectedMessageId) {
        reconnectedReasoning += chunk.delta;
        reconnectedStreamingMessage = {
          id: reconnectedMessageId,
          role: 'assistant',
          parts: buildParts('streaming'),
        };
      } else if (chunk.type === 'text-end' && chunk.id === reconnectedMessageId) {
        reconnectedStreamingMessage = {
          id: reconnectedMessageId,
          role: 'assistant',
          parts: buildParts('done'),
        };
      }
    }

    const result = window.inferenceReconnectToStream(
      currentChatId,
      (chunk: UIMessageChunk): void => {
        appendChunkToLastMessage(chunk);
      },
      (error: unknown): void => {
        console.error('Error during reconnected stream:', error);
        activeStreamOnDataId = undefined;
        reconnectedStreamingMessage = undefined;
      },
      (): void => {
        console.log('Reconnected stream completed');
        activeStreamOnDataId = undefined;
        if (!reconnectedStreamingMessage) {
          // No text chunks were received (the stream may have been aborted before
          // producing text, e.g. due to model queuing). Load the persisted assistant
          // message from the database since onFinish saved it before onEnd was sent.
          window.inferenceGetChatMessagesById(currentChatId).then(({ messages: dbMessages }) => {
            if (chat?.id !== currentChatId) {
              return;
            }
            const assistantMsg = dbMessages.filter(m => m.role === 'assistant').pop();
            if (assistantMsg) {
              reconnectedStreamingMessage = {
                id: assistantMsg.id,
                role: 'assistant',
                parts: assistantMsg.parts as UIMessage['parts'],
              };
            }
          }).catch(console.error);
        }
      },
    );

    if (result) {
      activeStreamOnDataId = result.onDataId;

      // Process buffered chunks
      for (const chunk of result.bufferedChunks) {
        appendChunkToLastMessage(chunk);
      }
    }
  });

  return (): void => {
    untrack(() => {
      if (activeStreamOnDataId !== undefined) {
        window.inferenceDisconnectFromStream(activeStreamOnDataId);
      }
      activeStreamOnDataId = undefined;
      // Only clear the reconnected message when navigating to a different chat.
      // If the effect re-runs for the same chat (e.g. after chatHistory.refetch()),
      // keep the message visible since the completed stream can't be reconnected.
      if (currentChatId !== chat?.id) {
        reconnectedStreamingMessage = undefined;
      }
      reconnectedMessageId = '';
      reconnectedText = '';
      reconnectedReasoning = '';
    });
  };
});
</script>

<div class="bg-background flex h-full min-w-0 flex-col">
  <ChatHeader />
  <div class="flex min-h-0 flex-1">
        {#if hasModels}
            <div class="flex flex-col flex-3/4">
                <Messages
                    {readonly}
                    loading={chatClient.status === 'streaming' || chatClient.status === 'submitted' || hasActiveStream}
                    messages={reconnectedStreamingMessage ? [...chatClient.messages, reconnectedStreamingMessage] : chatClient.messages}
                />
                <form class="bg-background mx-auto flex w-full gap-2 px-4 pb-4 md:max-w-3xl md:pb-6">
                    {#if !readonly}
                        <MultimodalInput
                          {attachments}
                          {chatClient}
                          bind:selectedModel={selectedModel}
                          {selectedMCPTools}
                          {hasActiveStream}
                          {activeStreamOnDataId}
                          {models}
                          bind:mcpSelectorOpen={mcpSelectorOpen}
                          selectedMCPToolsCount={selectedMCPToolsCount}
                          class="flex-1"
                        />
                    {/if}
                </form>
            </div>
            <McpToolsSidepanel
              bind:mcpSelectorOpen={mcpSelectorOpen}
              selectedMCPTools={selectedMCPTools}
              onCheckMCPTool={onCheckMCPTool}
            />
        {:else}
            <NoModelsAvailable />
        {/if}
    </div>
</div>

<!-- TODO -->
<!-- <Artifact
	chatId={id}
	{input}
	{setInput}
	{handleSubmit}
	{isLoading}
	{stop}
	{attachments}
	{setAttachments}
	{append}
	{messages}
	{setMessages}
	{reload}
	{votes}
	{readonly}
/> -->
