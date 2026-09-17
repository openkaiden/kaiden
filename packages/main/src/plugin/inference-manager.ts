/**********************************************************************
 * Copyright (C) 2026 Red Hat, Inc.
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

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { LanguageModel, ModelMessage, StopCondition, ToolSet, UIMessage } from 'ai';
import { convertToModelMessages, generateText, isStepCount } from 'ai';
import { inject, injectable } from 'inversify';

import type { InferenceParameters } from '/@api/inference/InferenceParameters.js';

import { IPCHandle } from './api.js';
import { FileContentDetector } from './inference/file-content-detector.js';
import { MCPManager } from './mcp/mcp-manager.js';
import { ProviderRegistry } from './provider-registry.js';

@injectable()
export class InferenceManager {
  private readonly fileDetector = new FileContentDetector();

  constructor(
    @inject(ProviderRegistry)
    private readonly providerRegistry: ProviderRegistry,
    @inject(MCPManager)
    private readonly mcpManager: MCPManager,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
  ) {}

  init(): void {
    this.ipcHandle('inference:generate', (_, params) => this.generate(params));
  }

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
          part.url = `data:${part.mediaType};base64,${base64}`;
          convertedParts.push(this.convertFilePartForModel(part, buffer, base64));
        } else if (part.type === 'file' && part.url.startsWith('data:')) {
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
    model: LanguageModel;
    messages: ModelMessage[];
    tools: ToolSet;
    stopWhen: StopCondition<ToolSet>;
    instructions: string;
    userMessage: UIMessage;
  }> {
    const internalProviderId = this.providerRegistry.getMatchingProviderInternalId(params.providerId);
    const sdk = this.providerRegistry.getInferenceSDK(internalProviderId, params.connectionId);
    const model = sdk.languageModel(params.modelId);

    const userMessage = this.getMostRecentUserMessage(params.messages);

    if (!userMessage) {
      throw new Error('No user message found');
    }

    const convertedMessages = await this.convertMessages(params.messages);
    const messages = await convertToModelMessages(convertedMessages);

    const tools = await this.mcpManager.getToolSet(params.tools);

    return {
      model,
      userMessage,
      messages,
      tools,
      stopWhen: isStepCount(5),
      instructions: 'You are a friendly assistant! Keep your responses concise and helpful.',
    };
  }

  async generate(params: InferenceParameters): Promise<string> {
    const result = await generateText(await this.getInferenceComponents(params));
    return result.text;
  }
}
