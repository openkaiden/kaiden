/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import type { DynamicToolUIPart, UIMessage } from 'ai';

import type { FlowParameterAIGenerated } from '/@api/inference/detect-flow-fields-schema.ts';

export class ParameterExtractor {
  /**
   * Extract MCP tool input arguments as potential parameters
   */
  public extractFromMCPToolCalls(messages: UIMessage[]): FlowParameterAIGenerated[] {
    const assistantMessages = messages.filter(message => message.role === 'assistant');
    const parameters = assistantMessages.flatMap(message => this.extractParametersFromMessage(message));

    return parameters;
  }

  private extractParametersFromMessage(message: UIMessage): FlowParameterAIGenerated[] {
    const toolParts = message.parts.filter((part): part is DynamicToolUIPart => part.type === 'dynamic-tool');
    return toolParts.flatMap(tool => this.extractParametersFromTool(tool));
  }

  private extractParametersFromTool(tool: DynamicToolUIPart): FlowParameterAIGenerated[] {
    if (tool.input === undefined || typeof tool.input !== 'object') {
      return [];
    }

    return Object.entries(tool.input as Record<string, unknown>).map(([key, value]) =>
      this.createParameter(key, value, tool.toolName),
    );
  }

  private createParameter(name: string, value: unknown, toolName: string): FlowParameterAIGenerated {
    const valueAsString = typeof value === 'string' ? value : JSON.stringify(value);
    return {
      name,
      format: 'string',
      description: `Parameter from ${toolName} MCP tool`,
      default: valueAsString,
    };
  }
}
