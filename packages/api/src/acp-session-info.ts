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

export type AcpSessionStatus = 'idle' | 'running' | 'waiting_input' | 'completed' | 'error' | 'cancelled';

export interface AcpModeInfo {
  modeId: string;
  name: string;
  description?: string;
}

export interface AcpModelInfo {
  modelId: string;
  name: string;
  description?: string;
}

export interface AcpSessionConfigSelectOption {
  value: string;
  name: string;
  description?: string;
}

export interface AcpSessionConfigSelectGroup {
  group: string;
  name: string;
  options: AcpSessionConfigSelectOption[];
}

export interface AcpSessionConfigOption {
  id: string;
  name: string;
  category?: string;
  description?: string;
  type: 'select' | 'boolean';
  currentValue?: string | boolean;
  options?: AcpSessionConfigSelectOption[] | AcpSessionConfigSelectGroup[];
}

export interface AcpSlashCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export interface AcpSessionInfo {
  id: string;
  name?: string;
  sandboxName: string;
  sandboxId?: string;
  prompt: string;
  status: AcpSessionStatus;
  createdAt: number;
  updatedAt: number;
  agentId?: string;
  agentName?: string;
  cost?: AcpCost;
  currentMode?: string;
  availableModes?: AcpModeInfo[];
  currentModeId?: string;
  availableModels?: AcpModelInfo[];
  currentModelId?: string;
  availableCommands?: AcpSlashCommand[];
  configOptions?: AcpSessionConfigOption[];
  contextUsed?: number;
  contextSize?: number;
  error?: string;
}

export interface AcpCost {
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  currency: string;
}

export interface AcpPlanStep {
  title: string;
  state: 'done' | 'running' | 'blocked' | 'queued';
}

export interface AcpPermissionOption {
  name: string;
  kind: string;
  optionId: string;
}

export type AcpFlowEvent =
  | AcpFlowPromptEvent
  | AcpFlowAgentMessageEvent
  | AcpFlowThinkingEvent
  | AcpFlowToolCallEvent
  | AcpFlowPlanEvent
  | AcpFlowPermissionRequestEvent
  | AcpFlowElicitationEvent
  | AcpFlowStatusChangeEvent
  | AcpFlowCostUpdateEvent;

export interface AcpAttachment {
  filePath: string;
  fileName: string;
  mimeType: string;
}

export interface AcpFlowPromptEvent {
  kind: 'prompt';
  text: string;
  attachments?: { fileName: string; mimeType: string }[];
  timestamp: number;
}

export interface AcpFlowAgentMessageEvent {
  kind: 'agent_message';
  text: string;
  messageId?: string;
  turn?: number;
  timestamp: number;
}

export interface AcpFlowThinkingEvent {
  kind: 'thinking';
  text: string;
  messageId?: string;
  timestamp: number;
}

export interface AcpFlowToolCallEvent {
  kind: 'tool_call';
  toolCallId: string;
  title: string;
  toolName?: string;
  command?: string;
  description?: string;
  status: 'running' | 'completed' | 'error';
  content?: string;
  timestamp: number;
  permissionRequest?: {
    requestId: string;
    options: AcpPermissionOption[];
    resolved: boolean;
    selectedOptionId?: string;
    expired?: boolean;
  };
}

export interface AcpFlowPlanEvent {
  kind: 'plan';
  steps: AcpPlanStep[];
  progress: number;
  timestamp: number;
}

/** @deprecated Permission data is now embedded in AcpFlowToolCallEvent.permissionRequest */
export interface AcpFlowPermissionRequestEvent {
  kind: 'permission_request';
  requestId: string;
  toolCallTitle: string;
  options: AcpPermissionOption[];
  resolved?: boolean;
  selectedOptionId?: string;
  timestamp: number;
}

export interface AcpFlowElicitationEvent {
  kind: 'elicitation';
  requestId: string;
  message: string;
  schema?: AcpElicitationSchema;
  resolved?: boolean;
  timestamp: number;
}

export interface AcpElicitationSchema {
  title?: string;
  description?: string;
  properties?: Record<string, AcpElicitationProperty>;
  required?: string[];
}

export interface AcpElicitationProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  default?: unknown;
  enum?: string[];
}

export interface AcpFlowStatusChangeEvent {
  kind: 'status_change';
  from: AcpSessionStatus;
  to: AcpSessionStatus;
  timestamp: number;
}

export interface AcpFlowCostUpdateEvent {
  kind: 'cost_update';
  cost: AcpCost;
  timestamp: number;
}

export interface AcpSessionCreateOptions {
  sandboxName: string;
  prompt: string;
  agentId?: string;
}

export interface AcpUserResponse {
  sessionId: string;
  requestId: string;
  type: 'permission' | 'elicitation';
  data: AcpPermissionResponseData | AcpElicitationResponseData;
}

export interface AcpPermissionResponseData {
  optionId: string;
}

export interface AcpElicitationResponseData {
  outcome: 'accept' | 'decline' | 'cancel';
  values?: Record<string, unknown>;
}
