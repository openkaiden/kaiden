/**********************************************************************
 * Copyright (C) 2025-2026 Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 ***********************************************************************/

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageModelV3 } from '@ai-sdk/provider';
import type { DynamicToolUIPart, ModelMessage, StopCondition, ToolSet, UIMessage } from 'ai';
import { convertToModelMessages, generateObject, generateText, isTextUIPart, stepCountIs, streamText } from 'ai';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import type { WebContents } from 'electron';
import { inject } from 'inversify';

import { IPCHandle, WebContentsType } from '/@/plugin/api.js';
import { Directories } from '/@/plugin/directories.js';
import type {
  DetectFlowFieldsParams,
  DetectFlowFieldsResult,
  FlowParameter,
  FlowParameterAIGenerated,
} from '/@api/chat/detect-flow-fields-schema.js';
import { DetectFlowFieldsResultSchema } from '/@api/chat/detect-flow-fields-schema.js';
import type { FlowGenerationParameters } from '/@api/chat/flow-generation-parameters-schema.js';
import { FlowGenerationParametersSchema } from '/@api/chat/flow-generation-parameters-schema.js';
import type { InferenceParameters } from '/@api/chat/InferenceParameters.js';
import type { MessageConfig } from '/@api/chat/message-config.js';
import type { Chat, Message } from '/@api/chat/schema.js';

import { MCPManager } from '../plugin/mcp/mcp-manager.js';
import { ProviderRegistry } from '../plugin/provider-registry.js';
import { runMigrate } from './db/migrate.js';
import { ChatQueries } from './db/queries.js';
import { FileContentDetector } from './file-content-detector.js';
import { buildChatSystemPrompt, buildPromptOnlySystemPrompt } from './flow-detect-prompts.js';
import { ParameterExtractor } from './parameter-extraction.js';

export class ChatManager {
  private chatQueries!: ChatQueries;
  private userId!: string;
  private activeStreams = new Map<number, { controller: AbortController; chatId: string }>();
  private readonly fileDetector = new FileContentDetector();

  constructor(
    @inject(ProviderRegistry)
    private readonly providerRegistry: ProviderRegistry,
    @inject(MCPManager)
    private readonly mcpManager: MCPManager,
    @inject(WebContentsType)
    private readonly webContents: WebContents,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(Directories)
    private readonly directories: Directories,
  ) {}

  public async init(): Promise<void> {
    const directory = this.directories.getChatPersistenceDirectory();
    if (!existsSync(directory)) {
      await mkdir(directory, { recursive: true });
    }
    const sqlite = new Database(join(directory, 'chats.db'));
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, {});

    runMigrate(db);

    const chatQueries = new ChatQueries(db);

    this.chatQueries = chatQueries;

    async function getOrCreateUserId(): Promise<string> {
      const defaultUserEmail = 'default@localhost';
      const userGetter = await chatQueries.getUser(defaultUserEmail);
      if (userGetter.isOk()) {
        return userGetter.value.id;
      } else {
        const newUserGetter = await chatQueries.createAuthUser(defaultUserEmail, '');
        if (newUserGetter.isOk()) {
          return newUserGetter.value.id;
        } else {
          throw new Error('Cannot create user');
        }
      }
    }

    this.userId = await getOrCreateUserId();

    this.ipcHandle('inference:streamText', (_, params) => this.streamText(params));
    this.ipcHandle('inference:stopStream', (_, onDataId: number) => this.stopStream(onDataId));
    this.ipcHandle('inference:generate', (_, params) => this.generate(params));
    this.ipcHandle('inference:generateFlowParams', (_, params) => this.generateFlowParams(params));
    this.ipcHandle('inference:detectFlowFields', (_, params) => this.detectFlowFields(params));
    this.ipcHandle('mcp-manager:getExchanges', (_, mcpId: string) => this.getExchanges(mcpId));
    this.ipcHandle('inference:getChats', () => this.getChats());
    this.ipcHandle('inference:getChatMessagesById', (_, id: string) => this.getChatMessagesById(id));
    this.ipcHandle('inference:deleteChat', (_, id: string) => this.deleteChat(id));
    this.ipcHandle('inference:deleteAllChats', () => this.deleteAllChats());
    this.ipcHandle('inference:deleteTrailingMessages', (_, id: string) => this.deleteTrailingMessages(id));
    this.ipcHandle('inference:renameChat', (_, id: string, title: string) => this.renameChat(id, title));
  }

  private async getExchanges(mcpId: string): Promise<DynamicToolUIPart[]> {
    return this.mcpManager.getExchanges(mcpId);
  }

  private async getChats(): Promise<Chat[]> {
    return this.chatQueries.getChatsByUserId({ id: this.userId }).match(
      chats => chats,
      err => {
        throw err;
      },
    );
  }

  private async getChatMessagesById(id: string): Promise<{ chat: Chat | undefined; messages: Message[] }> {
    return (await this.chatQueries.getMessagesByChatId({ id })).match(
      async messages => {
        const chat = (await this.chatQueries.getChatById({ id })).match(
          chat => chat,
          () => {
            return undefined;
          },
        );
        return { chat, messages };
      },
      () => {
        return { chat: undefined, messages: [] };
      },
    );
  }

  private async deleteChat(id: string): Promise<undefined> {
    this.stopStreamsByChat(id);
    await this.chatQueries.deleteChatById({ id });
  }

  private async deleteAllChats(): Promise<undefined> {
    // Abort all active streams
    for (const [onDataId, stream] of this.activeStreams.entries()) {
      stream.controller.abort();
      this.activeStreams.delete(onDataId);
    }
    await this.chatQueries.deleteAllChatsForUser({ userId: this.userId });
  }

  private async deleteTrailingMessages(id: string): Promise<undefined> {
    const result = await this.chatQueries.deleteTrailingMessages({ id });
    if (result.isErr()) {
      throw result.error;
    }
  }

  private async renameChat(id: string, title: string): Promise<undefined> {
    const result = await this.chatQueries.updateChatTitleById({ chatId: id, title });
    if (result.isErr()) {
      throw result.error;
    }
    this.webContents.send('api-sender', 'chat-list-updated');
  }

  /**
   * Converts a file part to either a text part (for text-based files) or a
   * file part with raw base64 (for binary files sent to the model).
   */
  private convertFilePartForModel(
    part: { type: 'file'; url: string; mediaType: string; filename?: string },
    buffer: Buffer,
    base64: string,
  ): UIMessage['parts'][number] {
    if (this.fileDetector.isTextContent(part.mediaType, part.filename, buffer)) {
      const label = part.filename ? `[File: ${part.filename}]` : '[File]';
      return { type: 'text', text: `${label}\n${buffer.toString('utf-8')}` };
    }
    return { ...part, url: base64 };
  }

  /**
   * Converts file parts for model consumption.
   * - Text-based files are converted to text parts (avoids unsupported MIME type errors).
   * - file:// URLs: reads the file, mutates the original part to a data URL (for DB persistence),
   *   and returns a copy with raw base64 (for the model).
   * - data: URLs (from DB): returns a copy with raw base64 stripped of the data URL prefix.
   * Raw base64 strings are not valid URLs, so the AI SDK won't attempt to download them.
   */
  private async convertMessages(messages: UIMessage[]): Promise<UIMessage[]> {
    const result: UIMessage[] = [];
    for (const message of messages) {
      const convertedParts: UIMessage['parts'] = [];
      for (const part of message.parts) {
        if (part.type === 'file' && part.url.startsWith('file://')) {
          const filepath = fileURLToPath(part.url);
          let buffer: Buffer;
          try {
            buffer = await readFile(filepath);
          } catch (e) {
            console.error(`Failed to read file: ${filepath}`, e);
            convertedParts.push({
              type: 'text',
              text: `[File: ${part.filename ?? filepath} - Error reading file]`,
            });
            continue;
          }
          const base64 = buffer.toString('base64');
          // Mutate original for DB persistence (data URL)
          part.url = `data:${part.mediaType};base64,${base64}`;
          convertedParts.push(this.convertFilePartForModel(part, buffer, base64));
        } else if (part.type === 'file' && part.url.startsWith('data:')) {
          // Already a data URL (loaded from DB) — strip prefix for model
          const commaIndex = part.url.indexOf(',');
          if (commaIndex < 0) {
            console.warn(`Malformed data URL (no comma) for file: ${part.filename}`);
            convertedParts.push(part);
            continue;
          }
          const base64 = part.url.substring(commaIndex + 1);
          const buffer = Buffer.from(base64, 'base64');
          convertedParts.push(this.convertFilePartForModel(part, buffer, base64));
        } else {
          convertedParts.push(part);
        }
      }
      result.push({ ...message, parts: convertedParts });
    }
    return result;
  }

  private getMostRecentUserMessage(messages: UIMessage[]): UIMessage | undefined {
    const userMessages = messages.filter(message => message.role === 'user');
    return userMessages.at(-1);
  }

  private async getInferenceComponents(params: InferenceParameters): Promise<{
    model: ReturnType<typeof sdk.languageModel>;
    messages: ModelMessage[];
    tools: ToolSet;
    stopWhen: StopCondition<ToolSet>;
    system: string;
    userMessage: UIMessage;
  }> {
    const internalProviderId = this.providerRegistry.getMatchingProviderInternalId(params.providerId);
    const sdk = this.providerRegistry.getInferenceSDK(internalProviderId, params.connectionName);
    const model = sdk.languageModel(params.modelId);

    const userMessage = this.getMostRecentUserMessage(params.messages);

    if (!userMessage) {
      throw new Error('No user message found');
    }

    // ai sdk/fetch does not support file:URLs
    const convertedMessages = await this.convertMessages(params.messages);
    const messages = await convertToModelMessages(convertedMessages);

    const tools = await this.mcpManager.getToolSet(params.tools);

    return {
      model,
      userMessage,
      messages,
      tools,
      stopWhen: stepCountIs(5),
      system: 'You are a friendly assistant! Keep your responses concise and helpful.',
    };
  }

  /**
   * Extracts a placeholder title from the first text part of a user message, truncated to 80 characters.
   */
  private extractPlaceholderTitle(userMessage: UIMessage): string {
    const textPart = userMessage.parts.find(p => p.type === 'text');
    if (textPart && 'text' in textPart) {
      return textPart.text.slice(0, 80);
    }
    return 'New Chat';
  }

  /**
   * Asynchronously generates an AI-powered chat title and persists it, notifying the UI on success.
   * Only updates the title if it hasn't been manually changed from the placeholder.
   */
  private generateTitleInBackground(
    model: LanguageModelV3,
    userMessage: UIMessage,
    chatId: string,
    placeholderTitle: string,
  ): void {
    generateText({
      model,
      prompt: userMessage.parts
        .filter(isTextUIPart)
        .map(p => p.text)
        .join(' '),
      system: `\n
      - you will generate a short title based on the first message a user begins a conversation with
      - ensure it is not more than 80 characters long
      - the title should be a summary of the user's message
      - do not use quotes or colons`,
    })
      .then(async result => {
        // Atomically update title only if it still matches the placeholder
        const updateResult = await this.chatQueries.updateChatTitleIfMatches({
          chatId,
          expectedTitle: placeholderTitle,
          newTitle: result.text,
        });

        if (updateResult.isErr()) {
          console.error('Failed to update chat title in database', updateResult.error);
          return;
        }

        // Only emit event if a row was actually updated
        if (updateResult.value) {
          this.webContents.send('api-sender', 'chat-list-updated');
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to generate chat title', error);
      });
  }

  async streamText(params: InferenceParameters & { onDataId: number; chatId: string }): Promise<number> {
    const { chatId } = params;
    const abortController = new AbortController();
    this.activeStreams.set(params.onDataId, { controller: abortController, chatId });

    try {
      const chatGetter = await this.chatQueries.getChatById({ id: chatId });
      if (abortController.signal.aborted) return params.onDataId;

      if (!chatGetter.isOk()) {
        const userMessage = this.getMostRecentUserMessage(params.messages);
        if (!userMessage) {
          throw new Error('No user message found');
        }
        const placeholderTitle = this.extractPlaceholderTitle(userMessage);
        await this.chatQueries.saveChat({
          id: chatId,
          userId: this.userId,
          title: placeholderTitle,
        });
        if (abortController.signal.aborted) return params.onDataId;

        this.webContents.send('api-sender', 'chat-list-updated');

        const internalProviderId = this.providerRegistry.getMatchingProviderInternalId(params.providerId);
        const sdk = this.providerRegistry.getInferenceSDK(internalProviderId, params.connectionName);
        const model = sdk.languageModel(params.modelId);
        this.generateTitleInBackground(model, userMessage, chatId, placeholderTitle);
      }

      const inferenceComponents = await this.getInferenceComponents(params);
      if (abortController.signal.aborted) return params.onDataId;

      const config: MessageConfig = {
        tools: params.tools,
        modelId: params.modelId,
        connectionName: params.connectionName,
        providerId: params.providerId,
        type: this.providerRegistry.getInferenceConnectionType(params.providerId, params.connectionName),
      };
      await this.chatQueries.saveMessages({
        messages: [
          {
            chatId,
            id: inferenceComponents.userMessage.id,
            role: 'user',
            parts: inferenceComponents.userMessage.parts,
            createdAt: new Date(),
            attachments: [],
            config,
          },
        ],
      });
      if (abortController.signal.aborted) return params.onDataId;

      const streaming = streamText({
        ...inferenceComponents,
        abortSignal: abortController.signal,
      });

      let onFinishSavePromise: Promise<void> | undefined;

      const reader = streaming
        .toUIMessageStream({
          onFinish: ({ messages }): void => {
            onFinishSavePromise = this.chatQueries
              .saveMessages({
                messages: messages.map(message => ({
                  id: randomUUID().toString(),
                  role: message.role,
                  parts: message.parts,
                  createdAt: new Date(),
                  chatId,
                  attachments: [],
                  config,
                })),
              })
              .match(
                () => {},
                error => {
                  throw error;
                },
              );
          },
        })
        .getReader();

      // loop to wait for the stream to finish
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.webContents.send('inference:streamText-onChunk', params.onDataId, value);
      }

      // Wait for onFinish message save to complete before signaling stream end
      if (onFinishSavePromise) {
        await onFinishSavePromise;
      }
    } finally {
      this.activeStreams.delete(params.onDataId);
      this.webContents.send('inference:streamText-onEnd', params.onDataId);
    }

    return params.onDataId;
  }

  private stopStream(onDataId: number): void {
    const stream = this.activeStreams.get(onDataId);
    if (stream) {
      stream.controller.abort();
      this.activeStreams.delete(onDataId);
    }
  }

  private stopStreamsByChat(chatId: string): void {
    for (const [onDataId, stream] of this.activeStreams.entries()) {
      if (stream.chatId === chatId) {
        stream.controller.abort();
        this.activeStreams.delete(onDataId);
      }
    }
  }

  async generate(params: InferenceParameters): Promise<string> {
    const result = await generateText(await this.getInferenceComponents(params));
    return result.text;
  }

  async generateFlowParams(params: InferenceParameters): Promise<FlowGenerationParameters> {
    const result = await generateObject({
      ...(await this.getInferenceComponents(params)),
      schema: FlowGenerationParametersSchema,
    });
    return result.object;
  }

  /**
   * Extract parameter names from a prompt template that uses {{parameterName}} syntax
   */
  private extractParameterNamesFromPrompt(prompt: string): string[] {
    const regex = /\{\{(\w+)\}\}/g;
    const matches = [...prompt.matchAll(regex)];
    const paramNames = matches.map(match => match[1]).filter((name): name is string => name !== undefined);
    return [...new Set(paramNames)];
  }

  private mergeParameters(
    extracted: FlowParameterAIGenerated[],
    aiGenerated: FlowParameterAIGenerated[],
  ): FlowParameter[] {
    // Deduplicate and merge parameters
    const paramMap = new Map<string, FlowParameterAIGenerated>();

    // Add AI-generated parameters (without 'required' field)
    for (const param of aiGenerated) {
      paramMap.set(param.name, param);
    }

    // Add default values from extracted parameters
    for (const param of extracted) {
      const existing = paramMap.get(param.name);
      if (existing) {
        paramMap.set(param.name, {
          ...existing,
          default: param.default ?? existing.default,
        });
      }
    }

    // Set required based on whether a default value exists
    return Array.from(paramMap.values()).map(param => ({
      ...param,
      required: param.default === undefined,
    }));
  }

  /**
   * Convert database Message[] to UIMessage[] format for AI SDK
   */
  private convertDbMessagesToUIMessages(messages: Message[]): UIMessage[] {
    return messages.map(message => ({
      id: message.id,
      parts: message.parts as UIMessage['parts'],
      role: message.role as UIMessage['role'],
      content: '',
      createdAt: message.createdAt,
      experimental_attachments:
        (message.attachments as Array<{ name?: string; contentType?: string; url: string }>) ?? [],
    }));
  }

  /**
   * Detect flow fields from a prompt (and optionally chat conversation).
   * This analyzes the prompt (and chat messages if chatId provided) to extract parameters
   * and update the prompt with {{placeholder}} syntax.
   */
  async detectFlowFields(params: DetectFlowFieldsParams): Promise<DetectFlowFieldsResult> {
    // Get model SDK
    const internalProviderId = this.providerRegistry.getMatchingProviderInternalId(params.providerId);
    const sdk = this.providerRegistry.getInferenceSDK(internalProviderId, params.connectionName);
    const model = sdk.languageModel(params.modelId);

    let extractedParams: FlowParameterAIGenerated[] = [];
    let modelMessages: ModelMessage[] = [];
    let systemPrompt: string;

    // If chatId is provided, analyze chat messages for additional context
    if (params.chatId) {
      const { messages } = await this.getChatMessagesById(params.chatId);

      if (messages.length > 0) {
        // Convert DB messages to UIMessage format
        const uiMessages = this.convertDbMessagesToUIMessages(messages);

        // Extract parameters from MCP tool calls in the conversation
        extractedParams = new ParameterExtractor().extractFromMCPToolCalls(uiMessages);

        // Convert messages for the AI model
        const convertedMessages = await this.convertMessages(uiMessages);
        modelMessages = await convertToModelMessages(convertedMessages);
      }
    }

    // Build context for AI based on extracted params
    const extractedParamsContext =
      extractedParams.length > 0
        ? `\n\nThe following values were extracted from MCP tool calls in the conversation. Use these as default values for parameters:\n${JSON.stringify(extractedParams, null, 2)}`
        : '';

    // Build system prompt based on whether we have chat context
    if (modelMessages.length > 0) {
      systemPrompt = buildChatSystemPrompt(params.prompt, extractedParamsContext);
    } else {
      // Prompt-only mode (no chat context)
      systemPrompt = buildPromptOnlySystemPrompt(params.prompt);
    }

    // Use AI to analyze the prompt (and conversation if available) to detect parameters
    const result =
      modelMessages.length > 0
        ? await generateObject({
            model,
            messages: modelMessages,
            system: systemPrompt,
            schema: DetectFlowFieldsResultSchema,
          })
        : await generateObject({
            model,
            prompt: params.prompt,
            system: systemPrompt,
            schema: DetectFlowFieldsResultSchema,
          });

    const { prompt: updatedPrompt, parameters: aiParameters } = result.object;

    // Extract parameter names from the updated prompt
    const parameterNamesInPrompt = this.extractParameterNamesFromPrompt(updatedPrompt);

    // Filter parameters to only include those that appear in the prompt
    const filteredParameters = aiParameters.filter(param => parameterNamesInPrompt.includes(param.name));

    // Merge with extracted parameters to get default values (if any)
    const mergedParameters = this.mergeParameters(extractedParams, filteredParameters);

    return {
      prompt: updatedPrompt,
      parameters: mergedParameters,
    };
  }
}
