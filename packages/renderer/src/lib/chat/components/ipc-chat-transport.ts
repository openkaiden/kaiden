import type { ChatRequestOptions, ChatTransport, UIMessage, UIMessageChunk } from 'ai';

import type { ModelInfo } from '/@api/model-registry-info';

interface Dependencies {
  getModel: () => ModelInfo;
  getMCPTools: () => Record<string, Array<string>>;
}

export class IPCChatTransport<T extends UIMessage> implements ChatTransport<T> {
  constructor(private readonly dependencies: Dependencies) {}

  async sendMessages(
    options: {
      trigger: 'submit-message' | 'regenerate-message';
      chatId: string;
      messageId: string | undefined;
      messages: T[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk>> {
    const uiMessages = JSON.parse(JSON.stringify(options.messages));
    const model = this.dependencies.getModel();

    const tools = this.dependencies.getMCPTools();

    const abortSignal = options.abortSignal;

    let streamOnDataId: number | undefined;

    return new ReadableStream<UIMessageChunk>({
      start(controller): void {
        const { providerId, connectionId, label } = model;
        const onDataId = window.inferenceStreamText(
          {
            chatId: options.chatId,
            providerId,
            connectionId,
            modelId: label,
            tools,
            messages: uiMessages,
          },
          (chunk: UIMessageChunk) => {
            controller.enqueue(chunk);
          },
          (error: unknown) => {
            console.error('Error during inferenceStreamText:', error);
            controller.error(error);
          },
          () => {
            controller.close();
          },
        );

        streamOnDataId = onDataId;

        if (abortSignal) {
          if (abortSignal.aborted) {
            window.inferenceStopStream(onDataId).catch(console.error);
          } else {
            abortSignal.addEventListener(
              'abort',
              () => {
                window.inferenceStopStream(onDataId).catch(console.error);
              },
              { once: true },
            );
          }
        }
      },
      cancel(): void {
        if (streamOnDataId !== undefined) {
          window.inferenceStopStream(streamOnDataId).catch(console.error);
        }
      },
    });
  }

  async reconnectToStream(
    options: { chatId: string } & ChatRequestOptions,
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    // Check if there's an active stream for this chat
    const activeStream = window.inferenceGetActiveStream(options.chatId);
    if (!activeStream) {
      return null;
    }

    let reconnectedOnDataId: number | undefined;

    return new ReadableStream<UIMessageChunk>({
      start(controller): void {
        const result = window.inferenceReconnectToStream(
          options.chatId,
          (chunk: UIMessageChunk) => {
            controller.enqueue(chunk);
          },
          (error: unknown) => {
            console.error('Error during reconnected stream:', error);
            controller.error(error);
          },
          () => {
            controller.close();
          },
        );

        if (!result) {
          controller.close();
          return;
        }

        reconnectedOnDataId = result.onDataId;

        for (const chunk of result.bufferedChunks) {
          controller.enqueue(chunk);
        }
      },
      cancel(): void {
        if (reconnectedOnDataId !== undefined) {
          window.inferenceStopStream(reconnectedOnDataId).catch(console.error);
        }
      },
    });
  }
}
