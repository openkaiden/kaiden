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

export const builtInExtensions = [
  { name: 'Default MCP Registries', locator: 'kaiden.mcp-registries' },
  { name: 'Claude', locator: 'kaiden.claude' },
  { name: 'Codex', locator: 'kaiden.codex' },
  { name: 'Cursor', locator: 'kaiden.cursor' },
  { name: 'Docling Chunk Provider', locator: 'kaiden.docling' },
  { name: 'Gemini', locator: 'kaiden.gemini' },
  { name: 'GitHub Copilot', locator: 'kaiden.copilot' },
  { name: 'Goose', locator: 'kaiden.goose' },
  { name: 'llmman', locator: 'kaiden.llmman' },
  { name: 'Milvus Knowledges Provider', locator: 'kaiden.milvus' },
  { name: 'Mistral', locator: 'kaiden.mistral' },
  { name: 'Ollama', locator: 'kaiden.ollama' },
  { name: 'OpenAI Compatible', locator: 'kaiden.openai-compatible' },
  { name: 'OpenClaw', locator: 'kaiden.openclaw' },
  { name: 'OpenCode', locator: 'kaiden.opencode' },
  { name: 'OpenShift AI', locator: 'kaiden.openshift-ai' },
  { name: 'RamaLama', locator: 'kaiden.ramalama' },
  { name: 'Vertex AI', locator: 'kaiden.vertex-ai' },
] as const;

export type ExtensionLocator = (typeof builtInExtensions)[number]['locator'];

export function extensionRawName(extension: (typeof builtInExtensions)[number]): string {
  return extension.locator.replace(/^kaiden\./, '');
}

export enum Button {
  STOP = 'Stop',
  START = 'Start',
  DELETE = 'Delete',
}

export enum State {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}

export const BADGE_TEXT = 'built-in Extension' as const;

export enum BadgeType {
  BUILT_IN = 'badge-built-in Extension',
}

export enum ExtensionStatus {
  RUNNING = 'running',
  STOPPED = 'stopped',
  UNKNOWN = 'unknown',
}

export const proxyConfigurations = [
  { option: 'System', editable: false },
  { option: 'Manual', editable: true },
  { option: 'Disabled', editable: false },
] as const;

export type ProxyConfigurationOption = (typeof proxyConfigurations)[number]['option'];

export enum PreferenceOption {
  APPEARANCE = 'Appearance',
  CHAT = 'Chat',
  EDITOR = 'Editor',
  EXIT_ON_CLOSE = 'Exit On Close',
  EXTENSIONS = 'Extensions',
  KUBERNETES = 'Kubernetes',
  ONBOARDING = 'Onboarding',
  TASKS = 'Tasks',
  TELEMETRY = 'Telemetry',
  TERMINAL = 'Terminal',
  USER_CONFIRMATION = 'User Confirmation',
  WINDOW = 'Window',
}

export const preferenceOptions = (): PreferenceOption[] => Object.values(PreferenceOption);

export const resources = {
  openshiftai: { displayName: 'OpenShift AI', hasCreateButton: true },
  openai: { displayName: 'OpenAI', hasCreateButton: true },
  gemini: { displayName: 'Gemini', hasCreateButton: true },
  claude: { displayName: 'Claude', hasCreateButton: true },
  ollama: { displayName: 'Ollama', hasCreateButton: false },
  ramalama: { displayName: 'RamaLama', hasCreateButton: false },
  llmman: { displayName: 'llmman', hasCreateButton: false },
  mistral: { displayName: 'Mistral', hasCreateButton: true },
  cursor: { displayName: 'Cursor', hasCreateButton: true },
  milvus: { displayName: 'Milvus Vector Database', hasCreateButton: true },
  docling: { displayName: 'Docling Chunk Provider', hasCreateButton: true },
} as const;

export type SettingsResourceId = keyof typeof resources;

export const featuredResources = Object.keys(resources) as (keyof typeof resources)[];
export const resourcesWithCreateButton = Object.values(resources)
  .filter(r => r.hasCreateButton)
  .map(r => r.displayName);

export interface MCPServerConfig {
  readonly envVarName: string;
  readonly serverName: string;
}

export const MCP_SERVERS = {
  github: {
    envVarName: 'GITHUB_TOKEN',
    serverName: 'ai.openkaiden.registry/github',
  },
} as const satisfies Record<string, MCPServerConfig>;

export type MCPServerId = keyof typeof MCP_SERVERS;

export type ConnectionType = 'inference' | 'rag' | 'chunk';

export interface InlineConnectionFieldSpec {
  readonly label: string;
  readonly useEnvVar?: boolean;
  readonly useBaseURL?: boolean;
}

export interface ResourceConfig {
  readonly envVarName: string;
  readonly resourceId?: SettingsResourceId;
  readonly baseURL?: string;
  readonly autoDetected?: boolean;
  readonly connectionType?: ConnectionType;
  readonly providerPickerName?: string;
  readonly inlineConnectionFields?: readonly InlineConnectionFieldSpec[];
}

export const PROVIDERS = {
  gemini: {
    envVarName: 'GEMINI_API_KEY',
    resourceId: 'gemini',
    providerPickerName: 'Gemini',
    inlineConnectionFields: [{ label: 'Enter your Gemini API key (GEMINI_API_KEY)', useEnvVar: true }],
  },
  openai: {
    envVarName: 'OPENAI_API_KEY',
    resourceId: 'openai',
    baseURL: 'https://api.openai.com/v1',
    providerPickerName: 'OpenAI',
    inlineConnectionFields: [
      { label: 'baseURL', useBaseURL: true },
      { label: 'apiKey', useEnvVar: true },
    ],
  },
  ollama: {
    envVarName: 'OLLAMA_ENABLED',
    resourceId: 'ollama',
    autoDetected: true,
  },
  ramalama: {
    envVarName: 'RAMALAMA_ENABLED',
    resourceId: 'ramalama',
    autoDetected: true,
  },
  llmman: {
    envVarName: 'LLMMAN_ENABLED',
    resourceId: 'llmman',
    autoDetected: true,
  },
  claude: {
    envVarName: 'ANTHROPIC_API_KEY',
    resourceId: 'claude',
    providerPickerName: 'Claude',
    inlineConnectionFields: [{ label: 'Enter your Claude API key (ANTHROPIC_API_KEY)', useEnvVar: true }],
  },
  mistral: {
    envVarName: 'MISTRAL_API_KEY',
    resourceId: 'mistral',
  },
  cursor: {
    envVarName: 'CURSOR_API_KEY',
    resourceId: 'cursor',
    providerPickerName: 'Cursor',
    inlineConnectionFields: [{ label: 'Enter your Cursor API key (CURSOR_API_KEY)', useEnvVar: true }],
  },
  'openshift-ai': {
    envVarName: 'OPENSHIFT_AI_TOKEN',
    resourceId: 'openshiftai',
  },
  milvus: {
    envVarName: 'PODMAN_ENABLED',
    resourceId: 'milvus',
    connectionType: 'rag',
  },
  docling: {
    envVarName: 'PODMAN_ENABLED',
    resourceId: 'docling',
    connectionType: 'chunk',
  },
} as const satisfies Record<string, ResourceConfig>;

export type ResourceId = keyof typeof PROVIDERS;

export type WorkspaceInferenceProviderConfig = ResourceConfig & {
  readonly providerPickerName: string;
  readonly inlineConnectionFields: readonly InlineConnectionFieldSpec[];
};

export interface DialogOptions {
  dialogName?: string;
  buttonName?: string;
  timeout?: number;
  throwErrorOnFailOrMissing?: boolean;
  waitForDialogToDisappear?: boolean;
}

export const CODING_AGENT = {
  OPENCODE: 'OpenCode',
  OPENCLAW: 'OpenClaw',
  CLAUDE: 'Claude Code',
  GOOSE: 'Goose',
  CODEX: 'Codex',
  CURSOR: 'Cursor CLI',
  COPILOT: 'GitHub Copilot',
  GEMINI: 'Gemini CLI',
} as const;
export const CODING_AGENTS = Object.values(CODING_AGENT);
export type CodingAgent = (typeof CODING_AGENT)[keyof typeof CODING_AGENT];

export const TERMINAL_READY_PATTERNS = {
  OPENCODE: [/Ask anything/i, /opencode/i],
  CLAUDE: [/Claude Code/],
  COPILOT: [/Copilot/i],
  GOOSE: [/goose/i],
  OPENCLAW: [/openclaw/i],
} as const;

export const ENABLED_CODING_AGENTS = [
  CODING_AGENT.OPENCODE,
  CODING_AGENT.CLAUDE,
  CODING_AGENT.COPILOT,
] as const satisfies readonly CodingAgent[];

export const AGENT_MODEL_SETUPS = [
  { agent: CODING_AGENT.OPENCODE, providerIds: [], localRuntimeFallback: true },
  { agent: CODING_AGENT.CLAUDE, providerIds: ['claude'], localRuntimeFallback: false },
  { agent: CODING_AGENT.CODEX, providerIds: ['openai'], localRuntimeFallback: false },
  { agent: CODING_AGENT.GEMINI, providerIds: ['gemini'], localRuntimeFallback: false },
  { agent: CODING_AGENT.CURSOR, providerIds: ['cursor'], localRuntimeFallback: false },
  { agent: CODING_AGENT.COPILOT, providerIds: ['openai', 'claude'], localRuntimeFallback: true },
] as const;

export type WorkspaceInferenceProviderId = (typeof AGENT_MODEL_SETUPS)[number]['providerIds'][number];

export interface AgentModelSetupConfig {
  readonly agent: CodingAgent;
  readonly providerIds: readonly WorkspaceInferenceProviderId[];
  readonly localRuntimeFallback: boolean;
}

export const WIZARD_STEP = {
  WORKSPACE: 'Workspace',
  AGENT_MODEL: 'Agent & Model',
  TOOLS_SECRETS: 'Tools & Secrets',
  FILE_SYSTEM: 'File System',
  NETWORKING: 'Networking',
} as const;
export const WIZARD_STEPS = Object.values(WIZARD_STEP);
export type WizardStep = (typeof WIZARD_STEP)[keyof typeof WIZARD_STEP];

export const FILE_ACCESS_LEVEL = {
  NO_HOST_ACCESS: 'No host filesystem access',
  CUSTOM_PATHS: 'Custom Paths',
} as const;
export const FILE_ACCESS_LEVELS = Object.values(FILE_ACCESS_LEVEL);
export type FileAccessLevel = (typeof FILE_ACCESS_LEVEL)[keyof typeof FILE_ACCESS_LEVEL];

export const FILESYSTEM_BADGE = {
  STRICT: 'Strict',
  CUSTOM: 'Custom',
} as const;
export type FilesystemBadge = (typeof FILESYSTEM_BADGE)[keyof typeof FILESYSTEM_BADGE];

export const NETWORK_ACCESS_LEVEL = {
  DENY_ALL: 'Deny All',
  DEVELOPER_PRESET: 'Developer Preset',
} as const;
export const NETWORK_ACCESS_LEVELS = Object.values(NETWORK_ACCESS_LEVEL);
export type NetworkAccessLevel = (typeof NETWORK_ACCESS_LEVEL)[keyof typeof NETWORK_ACCESS_LEVEL];

export interface WorkspaceCustomMount {
  host: string;
  target?: string;
  readOnly?: boolean;
}

export const SELECTORS = {
  MAIN_ANY: 'main',
  MAIN_INITIALIZING: 'main.flex.flex-row.w-screen.h-screen.justify-center',
  MAIN_APP_CONTAINER: 'main.flex.flex-col.w-screen.h-screen.overflow-hidden',
  TITLE_BAR: 'header#navbar',
  WELCOME_PAGE: 'div.fixed.top-0.left-0.right-0.bottom-0.z-50:has-text("Get started with Kaiden")',
  NAVIGATION: { role: 'navigation' as const, name: 'AppNavigation' },
} as const;

export const WORKSPACE_STATUS = {
  RUNNING: 'running',
  STOPPED: 'stopped',
  STARTING: 'starting',
  STOPPING: 'stopping',
} as const;

export const TIMEOUTS = {
  PAGE_LOAD: 90_000,
  NON_DEVTOOLS_WINDOW: 60_000,
  RETRY_DELAY: 1_000,
  MAX_RETRIES: 3,
  DEFAULT: 120_000,
  INITIALIZING_SCREEN: 180_000,
  STANDARD: 30_000,
  SHORT: 10_000,
  MODEL_RESPONSE: 90_000,
  WORKSPACE_READY: 180_000,
  IMAGE_PULL: 600_000,
} as const;
