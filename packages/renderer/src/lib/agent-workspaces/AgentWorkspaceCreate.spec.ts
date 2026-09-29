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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { writable } from 'svelte/store';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { resetDraft, wizard } from '/@/stores/agent-workspace-create-draft.svelte';
import * as agentsStore from '/@/stores/agents';
import * as mcpStore from '/@/stores/mcp-remote-servers';
import * as modelCatalogStore from '/@/stores/model-catalog';
import * as modelsStore from '/@/stores/models';
import * as openshellGatewaysStore from '/@/stores/openshell-gateways';
import * as openshellSandboxesStore from '/@/stores/openshell-sandboxes';
import * as providerStore from '/@/stores/providers';
import * as ragStore from '/@/stores/rag-environments';
import * as secretVaultStore from '/@/stores/secret-vault';
import * as skillsStore from '/@/stores/skills';
import * as workspaceProjectsStore from '/@/stores/workspace-projects';
import type { AgentInfo } from '/@api/agent-info';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { CatalogModelInfo } from '/@api/model-registry-info';
import type { SandboxInfo } from '/@api/openshell-gateway-info';
import type { ProviderInfo } from '/@api/provider-info';
import type { RagEnvironment } from '/@api/rag/rag-environment';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';
import type { SkillInfo } from '/@api/skill/skill-info';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import AgentWorkspaceCreate from './AgentWorkspaceCreate.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/stores/agents'));
vi.mock(import('/@/stores/skills'));
vi.mock(import('/@/stores/mcp-remote-servers'));
vi.mock(import('/@/stores/secret-vault'));
vi.mock(import('/@/stores/providers'));
vi.mock(import('/@/stores/rag-environments'));
vi.mock(import('/@/stores/model-catalog'));
vi.mock(import('/@/stores/models'));
vi.mock(import('/@/stores/openshell-gateways'));
vi.mock(import('/@/stores/openshell-sandboxes'));
vi.mock(import('/@/stores/workspace-projects'));

function buildCatalogModels(providers: ProviderInfo[]): CatalogModelInfo[] {
  const result: CatalogModelInfo[] = [];
  for (const provider of providers) {
    for (const connection of provider.inferenceConnections ?? []) {
      for (const model of connection.models) {
        result.push({
          providerId: provider.id,
          providerName: provider.name,
          connectionId: connection.id,
          connectionName: connection.name,
          type: connection.type,
          llmMetadata: connection.llmMetadata,
          endpoint: connection.endpoint,
          label: model.label,
          connectionStatus: connection.status,
        } as CatalogModelInfo);
      }
    }
  }
  return result;
}

function setProviders(providers: ProviderInfo[]): void {
  vi.mocked(providerStore).providerInfos = writable<ProviderInfo[]>(providers);
  vi.mocked(modelsStore).catalogModels = writable<CatalogModelInfo[]>(buildCatalogModels(providers));
}

const mockAnthropicProvider: ProviderInfo = {
  id: 'claude',
  name: 'Anthropic',
  internalId: 'claude-internal',
  status: 'started',
  inferenceConnections: [
    {
      id: 'conn-0',
      name: 'Anthropic Cloud',
      type: 'cloud',
      status: 'started',
      llmMetadata: { name: 'anthropic' },
      models: [{ label: 'claude-sonnet-4' }, { label: 'claude-opus-4' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

const mockOllamaProvider: ProviderInfo = {
  id: 'ollama',
  name: 'Ollama',
  internalId: 'ollama-internal',
  status: 'started',
  inferenceConnections: [
    {
      id: 'conn-1',
      name: 'Ollama Local',
      type: 'local',
      status: 'started',
      llmMetadata: { name: 'ollama' },
      models: [{ label: 'llama3.2:3b' }],
    },
  ],
  inferenceProviderConnectionCreation: false,
} as unknown as ProviderInfo;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.listSecrets).mockResolvedValue([]);
  vi.useFakeTimers({ shouldAdvanceTime: true });
  HTMLElement.prototype.animate = vi.fn().mockReturnValue({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    onfinish: null,
  });
  vi.mocked(agentsStore).agentInfos = writable<AgentInfo[]>([
    {
      id: 'opencode',
      name: 'OpenCode',
      description: 'Open-source agent.',
      command: 'opencode',
      tags: ['Recommended'],
      destinationSkillsFolder: '/home/test/.opencode/skills',
      supportedModelTypes: [{ name: 'anthropic' }, { name: 'openai' }, { name: 'ollama' }, { name: 'gemini' }],
    },
    {
      id: 'claude',
      name: 'Claude Code',
      description: 'Anthropic Claude.',
      command: 'claude',
      tags: ['Cloud'],
      destinationSkillsFolder: '/home/test/.claude/skills',
      supportedModelTypes: [{ name: 'anthropic' }],
    },
    {
      id: 'goose',
      name: 'Goose',
      description: 'Autonomous coding agent.',
      command: 'goose',
      destinationSkillsFolder: '/home/test/.agents/skills',
      supportedModelTypes: [{ name: 'anthropic' }, { name: 'openai' }, { name: 'ollama' }, { name: 'gemini' }],
    },
  ]);
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([]);
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<MCPRemoteServerInfo[]>([]);
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([]);
  setProviders([mockAnthropicProvider]);
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([]);
  vi.mocked(modelCatalogStore).disabledModels = writable<Set<string>>(new Set());
  vi.mocked(modelCatalogStore.isModelEnabled).mockImplementation(
    (disabled: Set<string>, providerId: string, label: string): boolean => !disabled.has(`${providerId}::${label}`),
  );
  vi.mocked(modelCatalogStore.modelKey).mockImplementation(
    (providerId: string, label: string): string => `${providerId}::${label}`,
  );
  vi.mocked(modelCatalogStore.modelSelectionKey).mockImplementation(
    (providerId: string, connectionId: string, label: string): string => `${providerId}::${connectionId}::${label}`,
  );
  vi.mocked(workspaceProjectsStore).workspaceProjectInfos = writable<readonly WorkspaceProjectInfo[]>([]);
  vi.mocked(openshellGatewaysStore).openshellGateways = writable([
    {
      canStop: false,
      name: 'kaiden',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  vi.mocked(openshellSandboxesStore).allOpenshellSandboxes = writable<(SandboxInfo & { gatewayName: string })[]>([]);
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(false);
  vi.mocked(window.checkAgentWorkspaceGlobalConfigExists).mockResolvedValue(false);
  vi.mocked(window.createAgentWorkspace).mockResolvedValue({ id: 'ws-1' });
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  resetDraft();
});

test('Expect page title displayed', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Create Coding Agent Workspace')).toBeInTheDocument();
});

test('Expect wizard stepper rendered with all five step labels', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('navigation', { name: 'Wizard progress' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Workspace step' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Agent & Model step' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Tools & Secrets step' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'File System step' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Networking step' })).toBeInTheDocument();
});

test('Expect workspace step content shown on initial render', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('heading', { name: 'Workspace' })).toBeInTheDocument();
  expect(screen.getByText(/Point to a local project folder/)).toBeInTheDocument();
});

test('Expect source input rendered with correct placeholder', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByPlaceholderText('/path/to/project')).toBeInTheDocument();
});

test('Expect workspace name input rendered', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByPlaceholderText('e.g., front-refactor')).toBeInTheDocument();
});

test('Expect description section is collapsed by default', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument();
});

test('Expect description section expands when toggle clicked', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.click(screen.getByRole('button', { name: /Description/ }));

  expect(screen.getByRole('textbox', { name: 'Description' })).toBeInTheDocument();
});

test('Expect workspace name auto-suggested from source path', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-project' },
  });

  expect((screen.getByPlaceholderText('e.g., front-refactor') as HTMLInputElement).value).toBe('my-project');
});

test('Expect gateway selector hidden when only one gateway is available', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('Expect gateway selector defaults to the active OpenShell gateway when multiple gateways are available', async () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  const gatewaySelector = screen.getByRole('combobox');
  expect(gatewaySelector).toHaveValue('remote');
  expect(screen.queryByRole('option', { name: 'Select a gateway' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();

  await fireEvent.change(gatewaySelector, { target: { value: 'local' } });

  expect(gatewaySelector).toHaveValue('local');
  expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
});

test('Expect selected gateway included when creating a workspace', async () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  render(AgentWorkspaceCreate);

  await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'remote' } });
  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(expect.objectContaining({ gateway: 'remote' }));
});

test('does not offer gateways while their reachability state is unavailable', () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    { canStop: false, name: 'local', endpoint: 'http://localhost:17670', active: true },
    { canStop: false, name: 'remote', endpoint: 'https://remote.example.com', active: false },
  ]);

  render(AgentWorkspaceCreate);

  expect(screen.queryByRole('option', { name: /local/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /remote/ })).not.toBeInTheDocument();
});

test('does not offer unreachable gateways for workspace creation', () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'stopped',
      endpoint: 'http://localhost:17671',
      active: false,
      gatewayState: { reachable: false, health: 'unknown', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);

  render(AgentWorkspaceCreate);

  expect(screen.getByRole('option', { name: /local/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /remote/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /stopped/ })).not.toBeInTheDocument();
});

test('does not offer version-incompatible gateways for workspace creation', () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      name: 'compatible',
      endpoint: 'http://localhost:17670',
      canStop: false,
      active: true,
      version: '0.0.116',
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      name: 'outdated',
      endpoint: 'http://localhost:17671',
      canStop: false,
      active: false,
      version: '0.0.100',
      gatewayState: { reachable: true, health: 'healthy', compatible: false },
    },
    {
      name: 'no-version',
      endpoint: 'https://remote.example.com',
      canStop: false,
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);

  render(AgentWorkspaceCreate);

  expect(screen.getByRole('option', { name: /compatible/ })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: /no-version/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /outdated/ })).not.toBeInTheDocument();
});

test('user-selected gateway is preserved across store updates', async () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  render(AgentWorkspaceCreate);

  const gatewaySelector = screen.getByRole('combobox');
  expect(gatewaySelector).toHaveValue('local');

  await fireEvent.change(gatewaySelector, { target: { value: 'remote' } });
  expect(gatewaySelector).toHaveValue('remote');

  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);

  await waitFor(() => {
    expect(gatewaySelector).toHaveValue('remote');
  });
});

test('falls back to active gateway when selected gateway becomes unreachable', async () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'extra',
      endpoint: 'https://extra.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  render(AgentWorkspaceCreate);

  await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'remote' } });
  expect(screen.getByRole('combobox')).toHaveValue('remote');

  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: false, health: 'unknown', compatible: true },
    },
    {
      canStop: false,
      name: 'extra',
      endpoint: 'https://extra.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);

  await waitFor(() => {
    expect(wizard.draft.selectedGateway).toBe('local');
  });
});

test('clears selected gateway when all gateways become unreachable', async () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  render(AgentWorkspaceCreate);

  expect(wizard.draft.selectedGateway).toBe('local');

  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: false, health: 'unknown', compatible: true },
    },
  ]);

  await waitFor(() => {
    expect(wizard.draft.selectedGateway).toBe('');
  });
});

test('Expect Continue button rendered on step 1', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument();
});

test('Expect Continue button disabled when source is empty', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
});

test('Expect Continue button enabled when name and source are filled', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
});

test('Expect Continue button enabled when sourcePath is empty but workspace name is filled', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('e.g., front-refactor'), {
    target: { value: 'my-sandbox' },
  });

  expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
});

test('Expect whitespace-only sourcePath sent as undefined to createAgentWorkspace', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '   ' },
  });
  await fireEvent.input(screen.getByPlaceholderText('e.g., front-refactor'), {
    target: { value: 'my-sandbox' },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      sourcePath: undefined,
      name: 'my-sandbox',
    }),
  );
});

test('Expect Continue button disabled when workspace name exceeds hostname limit', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.input(screen.getByPlaceholderText('e.g., front-refactor'), {
    target: { value: 'a'.repeat(20) },
  });

  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  expect(screen.getByText(/must not exceed 19 characters/)).toBeInTheDocument();
});

test('Expect basename-derived name sanitized to fit hostname limit', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: `/home/user/${'a'.repeat(20)}` },
  });

  expect((screen.getByPlaceholderText('e.g., front-refactor') as HTMLInputElement).value).toBe('a'.repeat(19));
  expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
});

test('Expect use-all-defaults button on step 1', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  expect(screen.getByRole('button', { name: 'Use all defaults and create workspace' })).not.toBeDisabled();
});

test('Expect use-all-defaults button disabled on step 1 when source is empty', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('button', { name: 'Use all defaults and create workspace' })).toBeDisabled();
});

test('Expect Cancel button always visible', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

test('Expect Back button not visible on first step', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
});

test('Expect sandbox security message displayed with step counter', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText(/Step 1 of 5 · Workspace will run in a secured sandbox environment/)).toBeInTheDocument();
});

test('Expect navigating to agent & model step shows coding agent options', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  expect(screen.getAllByText('Coding Agent').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Claude Code')).toBeInTheDocument();
  expect(screen.getByText('Goose')).toBeInTheDocument();
  expect(screen.getAllByText('OpenCode').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
});

test('Expect Start Workspace button visible on last step', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  for (let i = 0; i < wizardStepCount - 1; i++) {
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
});

test('Expect custom mounts section shown when Custom Paths selected on filesystem step', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  // Workspace → Agent & Model → Tools & Secrets → File System
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Custom Paths' }));

  expect(screen.getByPlaceholderText('/path/on/host')).toBeInTheDocument();
  expect(screen.getByPlaceholderText('Leave empty to use host path')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Another Mount' })).toBeInTheDocument();
});

async function navigateToToolsSecretsStep(): Promise<void> {
  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  // Workspace → Agent & Model → Tools & Secrets
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

async function expandCustomize(): Promise<void> {
  await fireEvent.click(screen.getByRole('button', { name: /Customize skills, MCP servers, vault, and knowledges/ }));
}

test('Expect summary card and customize toggle on tools & secrets step', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();

  expect(screen.getByText(/Everything available is included/)).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: /Customize skills, MCP servers, vault, and knowledges/ }),
  ).toBeInTheDocument();
});

test('Expect secrets section visible after expanding customize', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('Secret Vault')).toBeInTheDocument();
  expect(screen.getByText('Select secrets from your vault to make available in the workspace')).toBeInTheDocument();
});

test('Expect secrets empty state shown when vault is empty', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('No secrets in your vault yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Vault' })).toBeInTheDocument();
});

test('Expect secrets listed from the selected gateway', async () => {
  vi.mocked(openshellGatewaysStore).openshellGateways.set([
    {
      canStop: false,
      name: 'local',
      endpoint: 'http://localhost:17670',
      active: true,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
    {
      canStop: false,
      name: 'remote',
      endpoint: 'https://remote.example.com',
      active: false,
      gatewayState: { reachable: true, health: 'healthy', compatible: true },
    },
  ]);
  vi.mocked(window.listSecrets).mockImplementation(async gateway =>
    gateway === 'remote'
      ? [
          {
            name: 'github-token',
            type: 'github',
            description: 'Personal access token',
            gateway: 'remote',
          },
          {
            name: 'anthropic-key',
            type: 'anthropic',
            description: 'API key',
            gateway: 'remote',
          },
        ]
      : [
          {
            name: 'local-only-secret',
            type: 'generic',
            description: 'Only available on the local gateway',
            gateway: 'local',
          },
        ],
  );

  render(AgentWorkspaceCreate);

  await fireEvent.change(screen.getByRole('combobox'), { target: { value: 'remote' } });
  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('github-token')).toBeInTheDocument();
  expect(screen.getByText('anthropic-key')).toBeInTheDocument();
  expect(screen.queryByText('local-only-secret')).not.toBeInTheDocument();
  expect(window.listSecrets).toHaveBeenCalledWith('remote');
  expect(screen.getByText('Secret Vault')).toBeInTheDocument();
  expect(screen.queryByText('No secrets in your vault yet.')).not.toBeInTheDocument();
});

test('Expect stale secret selections cleared and Continue disabled while gateway secrets load', async () => {
  let resolveSecrets: (secrets: { name: string; type: string; description: string; gateway: string }[]) => void;
  vi.mocked(window.listSecrets).mockImplementation(
    () =>
      new Promise(resolve => {
        resolveSecrets = resolve;
      }),
  );
  wizard.draft.selectedSecretIds = ['local-only-secret'];

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();

  expect(wizard.draft.selectedSecretIds).toEqual([]);
  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();

  resolveSecrets!([
    { name: 'remote-secret', type: 'generic', description: 'Remote gateway secret', gateway: 'remote' },
  ]);

  await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled());
});

test('Expect Open Vault button navigates to secret vault', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();
  await fireEvent.click(screen.getByRole('button', { name: 'Open Vault' }));

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'secret-vault' });
});

test('Expect skills section visible after expanding customize', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('Skills')).toBeInTheDocument();
  expect(screen.getByText('Select the capabilities your agent should have')).toBeInTheDocument();
});

test('Expect skills empty state shown when no skills available', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('No skills available yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Manage Skills' })).toBeInTheDocument();
});

test('Expect skills listed when store has entries', async () => {
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
    {
      name: 'kubernetes',
      description: 'Deploy & manage clusters',
      path: '/skills/kubernetes',
      enabled: true,
      managed: false,
    },
    {
      name: 'code-review',
      description: 'Analyze code quality & security',
      path: '/skills/code-review',
      enabled: true,
      managed: true,
    },
  ]);

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('kubernetes')).toBeInTheDocument();
  expect(screen.getByText('code-review')).toBeInTheDocument();
  expect(screen.queryByText('No skills available yet.')).not.toBeInTheDocument();
});

test.each([
  { managed: false, expectedGroup: 'Pre-built', unexpectedGroup: 'Custom' },
  { managed: true, expectedGroup: 'Custom', unexpectedGroup: 'Pre-built' },
])('Expect managed=$managed maps to the correct group', async ({ managed, expectedGroup, unexpectedGroup }) => {
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
    {
      name: 'sample-skill',
      description: 'Sample description',
      path: '/skills/sample-skill',
      enabled: true,
      managed,
    },
  ]);

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText(expectedGroup)).toBeInTheDocument();
  expect(screen.queryByText(unexpectedGroup)).not.toBeInTheDocument();
});

test('Expect disabled skills excluded from wizard checklist', async () => {
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
    {
      name: 'kubernetes',
      description: 'Deploy & manage clusters',
      path: '/skills/kubernetes',
      enabled: true,
      managed: false,
    },
    {
      name: 'code-review',
      description: 'Analyze code quality & security',
      path: '/skills/code-review',
      enabled: false,
      managed: true,
    },
  ]);

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('kubernetes')).toBeInTheDocument();
  expect(screen.queryByText('code-review')).not.toBeInTheDocument();
});

test('Expect createAgentWorkspace excludes disabled skill paths', async () => {
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
    {
      name: 'kubernetes',
      description: 'Deploy & manage clusters',
      path: '/home/user/.kaiden/skills/kubernetes',
      enabled: true,
      managed: false,
    },
    {
      name: 'code-review',
      description: 'Analyze code quality',
      path: '/home/user/.kaiden/skills/code-review',
      enabled: false,
      managed: true,
    },
  ]);
  wizard.draft.selectedSkillIds = ['kubernetes'];

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      skills: ['/home/user/.kaiden/skills/kubernetes'],
    }),
  );
});

test('Expect Manage Skills button navigates to skills page', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();
  await fireEvent.click(screen.getByRole('button', { name: 'Manage Skills' }));

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'skills' });
});

test('Expect createAgentWorkspace called with skill paths', async () => {
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
    {
      name: 'kubernetes',
      description: 'Deploy & manage clusters',
      path: '/home/user/.kaiden/skills/kubernetes',
      enabled: true,
      managed: false,
    },
    {
      name: 'code-review',
      description: 'Analyze code quality',
      path: '/home/user/.kaiden/skills/code-review',
      enabled: true,
      managed: true,
    },
  ]);
  wizard.draft.selectedSkillIds = ['kubernetes', 'code-review'];

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      skills: ['/home/user/.kaiden/skills/kubernetes', '/home/user/.kaiden/skills/code-review'],
    }),
  );
});

test('Expect createAgentWorkspace called without skills when none available', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      skills: undefined,
    }),
  );
});

test('Expect createAgentWorkspace called with secret ids when vault has entries', async () => {
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([
    {
      id: 'github-token',
      name: 'GitHub Token',
      type: 'github',
      description: 'Personal access token',
    },
    {
      id: 'anthropic-key',
      name: 'Anthropic Key',
      type: 'anthropic',
      description: 'API key',
    },
  ]);
  wizard.draft.selectedSecretIds = ['github-token', 'anthropic-key'];

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      secrets: ['github-token', 'anthropic-key'],
    }),
  );
});

test('Expect createAgentWorkspace called without secrets when vault is empty', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      secrets: undefined,
    }),
  );
});

test('Expect Knowledges section visible after expanding customize', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('Knowledges')).toBeInTheDocument();
  expect(screen.getByText('Optional retrieval context for the agent')).toBeInTheDocument();
});

test('Expect Knowledges empty state shown when no knowledge bases available', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('No knowledge bases available yet.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Manage Knowledges' })).toBeInTheDocument();
});

test('Expect knowledge bases listed with provider display name and source count', async () => {
  setProviders([{ id: 'milvus', name: 'Milvus' } as ProviderInfo]);
  vi.mocked(ragStore).ragEnvironments = writable<RagEnvironment[]>([
    {
      name: 'kubernetes-knowledges',
      ragConnection: { name: 'my-connection', providerId: 'milvus' },
      chunkerConnection: { id: 'docling', providerId: 'milvus' },
      mcpServer: { id: 'kb-mcp', name: 'kb-mcp' } as MCPRemoteServerInfo,
      files: [
        { path: '/docs/k8s.md', status: 'indexed' },
        { path: '/docs/pods.md', status: 'indexed' },
      ],
    },
  ]);

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('kubernetes-knowledges')).toBeInTheDocument();
  expect(screen.getByText('Milvus · 2 sources')).toBeInTheDocument();
  expect(screen.queryByText('No knowledge bases available yet.')).not.toBeInTheDocument();
});

test('Expect Manage Knowledges button navigates to rag environments page', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();
  await fireEvent.click(screen.getByRole('button', { name: 'Manage Knowledges' }));

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'rag-environments' });
});

async function navigateToNetworkingStep(): Promise<void> {
  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  // Workspace → Agent & Model → Tools & Secrets → File System → Networking
  for (let i = 0; i < 4; i++) {
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }
}

test('Expect networking step shows Network Policy heading', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect(screen.getByText('Network Policy')).toBeInTheDocument();
  expect(screen.getByText('Outbound network for this workspace sandbox')).toBeInTheDocument();
});

test('Expect three network options rendered with Agent mode disabled and Unrestricted absent', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect(screen.getByRole('radio', { name: 'Use Deny All' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Use Developer Preset' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Use Agent mode' })).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Use Agent mode' })).toBeDisabled();
  expect(screen.queryByRole('radio', { name: 'Use Unrestricted' })).not.toBeInTheDocument();
  expect(screen.queryByRole('radio', { name: 'Use Allow all outbound' })).not.toBeInTheDocument();
});

test('Expect clicking disabled Agent mode does not change selection', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  await userEvent.click(screen.getByRole('radio', { name: 'Use Agent mode' }));

  expect(screen.getByRole('radio', { name: 'Use Developer Preset' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Use Agent mode' })).not.toBeChecked();
});

test('Expect Developer Preset selected by default on networking step', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect(screen.getByRole('radio', { name: 'Use Developer Preset' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Use Deny All' })).not.toBeChecked();
});

test('Expect selecting Deny All updates the radio', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));

  expect(screen.getByRole('radio', { name: 'Use Deny All' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Use Developer Preset' })).not.toBeChecked();
});

test('Expect default agent from onboarding.defaultWorkspaceSettings when valid', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({ defaultAgent: 'claude' });

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.getConfigurationValue).toHaveBeenCalledWith('onboarding.defaultWorkspaceSettings');
  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'claude',
    }),
  );
});

test('Expect default agent falls back to opencode when setting is empty', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({ defaultAgent: '' });

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'opencode',
      network: {
        mode: 'deny',
        hosts: ['registry.npmjs.org', 'pypi.python.org'],
      },
    }),
  );
});

test('Expect default agent falls back to opencode when setting is unknown value', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({ defaultAgent: 'unknown-agent' });

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'opencode',
    }),
  );
});

test('Expect createAgentWorkspace called with deny network when blocked selected', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      network: { mode: 'deny' },
    }),
  );
});

test('Expect createAgentWorkspace called without network when agent_mode selected', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Agent mode' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      network: undefined,
    }),
  );
});

test('Expect default model from onboarding.defaultWorkspaceSettings when valid', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({
    defaultAgent: 'opencode',
    defaultAgentSettings: {
      opencode: {
        defaultModel: { providerId: 'claude', connectionId: 'conn-0', label: 'claude-sonnet-4' },
      },
    },
  });
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.getConfigurationValue).toHaveBeenCalledWith('onboarding.defaultWorkspaceSettings');
  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'anthropic::claude-sonnet-4::',
    }),
  );
});

test('Expect first compatible model used when defaultWorkspaceSettings has no model and providers exist', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({ defaultAgent: 'opencode' });
  setProviders([mockAnthropicProvider, mockOllamaProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'anthropic::claude-sonnet-4::',
    }),
  );
});

test('Expect use-all-defaults button disabled when no model available', async () => {
  setProviders([]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  expect(screen.getByRole('button', { name: 'Use all defaults and create workspace' })).toBeDisabled();
});

test('Expect Continue button disabled on agent & model step when no model available', async () => {
  setProviders([]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
});

test('Expect Start Workspace button disabled when no model available', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  for (let i = 0; i < wizardStepCount - 1; i++) {
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  setProviders([]);
  wizard.draft.selectedModel = undefined;

  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start Workspace' })).toBeDisabled();
  });
});

test('Expect first compatible model used when defaultWorkspaceSettings is undefined and providers exist', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue(undefined);
  setProviders([mockOllamaProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'ollama::llama3.2:3b::',
    }),
  );
});

test('Expect custom hosts input shown when Deny All is selected on networking step', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));

  expect(screen.getByLabelText('Custom host 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Another Host' })).toBeInTheDocument();
});

test('Expect custom hosts pre-populated with registry hosts when Developer Preset is selected', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect(screen.getByLabelText('Custom host 1')).toBeInTheDocument();
  expect((screen.getByLabelText('Custom host 1') as HTMLInputElement).value).toBe('registry.npmjs.org');
  expect((screen.getByLabelText('Custom host 2') as HTMLInputElement).value).toBe('pypi.python.org');
  expect(screen.getByRole('button', { name: 'Add Another Host' })).toBeInTheDocument();
});

test('Expect createAgentWorkspace called with registry hosts plus custom host for Developer Preset', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  await fireEvent.click(screen.getByRole('button', { name: 'Add Another Host' }));
  await fireEvent.input(screen.getByLabelText('Custom host 3'), {
    target: { value: 'api.example.com' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      network: { mode: 'deny', hosts: ['registry.npmjs.org', 'pypi.python.org', 'api.example.com'] },
    }),
  );
});

test('Expect createAgentWorkspace splits MCP servers into remote and command entries', async () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<MCPRemoteServerInfo[]>([
    {
      id: 'mcp-remote',
      name: 'GitHub MCP',
      description: 'Repos & PRs',
      url: 'https://mcp.github.com/sse',
      setupType: 'remote',
      infos: { internalProviderId: 'p1', serverId: 's1', remoteId: 1 },
      tools: { 'list-repos': {} },
    },
    {
      id: 'mcp-pkg',
      name: 'NPM MCP',
      description: 'Node MCP server',
      url: '',
      setupType: 'package',
      commandSpec: { command: 'npx', args: ['@example/mcp@1.0.0'] },
      infos: { internalProviderId: 'p2', serverId: 's2', remoteId: 0 },
      tools: {},
    },
  ]);
  wizard.draft.selectedMcpIds = ['mcp-remote', 'mcp-pkg'];

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      mcp: {
        servers: [{ name: 'GitHub MCP', url: 'https://mcp.github.com/sse' }],
        commands: [{ name: 'NPM MCP', command: 'npx', args: ['@example/mcp@1.0.0'], env: undefined }],
      },
    }),
  );
});

test('Expect createAgentWorkspace called with custom hosts only for Deny All with custom host', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));

  await fireEvent.input(screen.getByLabelText('Custom host 1'), {
    target: { value: 'internal.corp.io' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      network: { mode: 'deny', hosts: ['internal.corp.io'] },
    }),
  );
});

test('Expect Add Another Host button adds a new input field', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect(screen.queryByLabelText('Custom host 3')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Add Another Host' }));

  expect(screen.getByLabelText('Custom host 3')).toBeInTheDocument();
});

test('Expect Remove button removes a registry host', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect(screen.getByLabelText('Custom host 2')).toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Remove host 2' }));

  expect(screen.queryByLabelText('Custom host 2')).not.toBeInTheDocument();
});

test('Expect createAgentWorkspace called without removed registry host for Developer Preset', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  await fireEvent.click(screen.getByRole('button', { name: 'Remove host 1' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      network: { mode: 'deny', hosts: ['pypi.python.org'] },
    }),
  );
});

test('Expect Deny All resets to empty host list when switching from Developer Preset', async () => {
  render(AgentWorkspaceCreate);

  await navigateToNetworkingStep();

  expect((screen.getByLabelText('Custom host 1') as HTMLInputElement).value).toBe('registry.npmjs.org');

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Deny All' }));

  expect((screen.getByLabelText('Custom host 1') as HTMLInputElement).value).toBe('');
});

test('Expect createAgentWorkspace called with workspaceConfiguration from settings for selected agent', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({
    defaultAgent: 'claude',
    defaultAgentSettings: {
      claude: {
        defaultModel: { providerId: 'claude', connectionId: 'conn-0', label: 'claude-sonnet-4' },
        workspaceConfiguration: {
          environment: [
            { name: 'CLAUDE_CODE_USE_VERTEX', value: '1' },
            { name: 'CLOUD_ML_REGION', value: 'us-east5' },
          ],
          mounts: [
            {
              host: '$HOME/.config/gcloud/application_default_credentials.json',
              target: '$HOME/.config/gcloud/application_default_credentials.json',
              ro: true,
            },
          ],
        },
      },
    },
  });
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'claude',
      workspaceConfiguration: {
        environment: [
          { name: 'CLAUDE_CODE_USE_VERTEX', value: '1' },
          { name: 'CLOUD_ML_REGION', value: 'us-east5' },
        ],
        mounts: [
          {
            host: '$HOME/.config/gcloud/application_default_credentials.json',
            target: '$HOME/.config/gcloud/application_default_credentials.json',
            ro: true,
          },
        ],
      },
    }),
  );
});

test('Expect workspaceConfiguration undefined when no settings for selected agent', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({
    defaultAgent: 'opencode',
    defaultAgentSettings: {
      opencode: {
        defaultModel: { providerId: 'claude', connectionId: 'conn-0', label: 'claude-sonnet-4' },
      },
    },
  });
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'opencode',
      workspaceConfiguration: undefined,
    }),
  );
});

test('Expect workspaceConfiguration looked up by agent id directly', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({
    defaultAgent: 'claude',
    defaultAgentSettings: {
      claude: {
        workspaceConfiguration: {
          environment: [{ name: 'CLAUDE_CODE_USE_VERTEX', value: '1' }],
        },
      },
    },
  });
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      agent: 'claude',
      workspaceConfiguration: {
        environment: [{ name: 'CLAUDE_CODE_USE_VERTEX', value: '1' }],
      },
    }),
  );
});

test('Expect tilde mount paths normalized to $HOME in workspaceConfiguration', async () => {
  vi.mocked(window.getConfigurationValue).mockResolvedValue({
    defaultAgent: 'claude',
    defaultAgentSettings: {
      claude: {
        workspaceConfiguration: {
          mounts: [
            {
              host: '~/.config/gcloud/application_default_credentials.json',
              target: '~/.config/gcloud/application_default_credentials.json',
              ro: true,
            },
          ],
        },
      },
    },
  });
  setProviders([mockAnthropicProvider]);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceConfiguration: {
        mounts: [
          {
            host: '$HOME/.config/gcloud/application_default_credentials.json',
            target: '$HOME/.config/gcloud/application_default_credentials.json',
            ro: true,
          },
        ],
      },
    }),
  );
});

async function navigateToFileSystemStep(): Promise<void> {
  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  // Workspace → Agent & Model → Tools & Secrets → File System
  for (let i = 0; i < 3; i++) {
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }
}

test('Expect createAgentWorkspace called without mounts when workspace (default) file access selected', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      mounts: undefined,
    }),
  );
});

test('Expect createAgentWorkspace called with custom mounts when Custom Paths selected', async () => {
  render(AgentWorkspaceCreate);

  await navigateToFileSystemStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Custom Paths' }));

  await fireEvent.input(screen.getByLabelText('Host path 1'), {
    target: { value: '/home/user/data' },
  });
  await fireEvent.input(screen.getByLabelText('Target path 1'), {
    target: { value: '/workspace/data' },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      mounts: [{ host: '/home/user/data', target: '/workspace/data', ro: false }],
    }),
  );
});

test('Expect createAgentWorkspace called with ro:true when read-only toggled for custom mount', async () => {
  render(AgentWorkspaceCreate);

  await navigateToFileSystemStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Custom Paths' }));

  await fireEvent.input(screen.getByLabelText('Host path 1'), {
    target: { value: '/home/user/data' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Toggle read-only for mount 1' }));

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      mounts: [{ host: '/home/user/data', target: 'data', ro: true }],
    }),
  );
});

test('Expect custom mount defaults target to host path when target is empty', async () => {
  render(AgentWorkspaceCreate);

  await navigateToFileSystemStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Custom Paths' }));

  await fireEvent.input(screen.getByLabelText('Host path 1'), {
    target: { value: '/home/user/configs' },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      mounts: [{ host: '/home/user/configs', target: 'configs', ro: false }],
    }),
  );
});

test('Expect custom mount strips trailing separators when deriving target from host', async () => {
  render(AgentWorkspaceCreate);

  await navigateToFileSystemStep();
  await fireEvent.click(screen.getByRole('radio', { name: 'Use Custom Paths' }));

  await fireEvent.input(screen.getByLabelText('Host path 1'), {
    target: { value: '/home/user/data/' },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      mounts: [{ host: '/home/user/data/', target: 'data', ro: false }],
    }),
  );
});

test('Expect checkAgentWorkspaceConfigExists called when source path is entered', async () => {
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(false);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  await vi.waitFor(() => {
    expect(window.checkAgentWorkspaceConfigExists).toHaveBeenCalledWith('/home/user/my-repo');
  });
});

test('Expect config-exists notification shown when existing config detected', async () => {
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByText(/existing workspace configuration was found/)).toBeInTheDocument();
  });
  expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeInTheDocument();
});

test('Expect config-exists notification not shown when no existing config', async () => {
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(false);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/new-project' },
  });

  await vi.waitFor(() => {
    expect(window.checkAgentWorkspaceConfigExists).toHaveBeenCalled();
  });
  expect(screen.queryByText(/existing workspace configuration was found/)).not.toBeInTheDocument();
});

test('Expect Start workspace as-is calls createAgentWorkspace with model', async () => {
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Start workspace as-is' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      sourcePath: '/home/user/existing-project',
      agent: 'opencode',
      model: 'anthropic::claude-sonnet-4::',
      name: 'existing-project',
    }),
  );
  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.not.objectContaining({
      replaceConfig: expect.anything(),
    }),
  );
});

test('Expect Start workspace as-is button disabled when no model available', async () => {
  setProviders([]);
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeInTheDocument();
  });

  expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeDisabled();
});

test('Expect startWorkspace passes replaceConfig when configAction is replace and config exists', async () => {
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByLabelText('Replace existing')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByLabelText('Replace existing'));
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      replaceConfig: true,
    }),
  );
});

test('Expect startWorkspace does not pass replaceConfig when configAction is merge', async () => {
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByLabelText('Merge with existing')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  expect(window.createAgentWorkspace).toHaveBeenCalledWith(
    expect.objectContaining({
      replaceConfig: undefined,
    }),
  );
});

test('Expect draft preserved when startAsIs fails', async () => {
  vi.mocked(window.createAgentWorkspace).mockRejectedValue(new Error('creation failed'));
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeInTheDocument();
  });

  wizard.draft.currentStepIndex = 0;
  await fireEvent.click(screen.getByRole('button', { name: 'Start workspace as-is' }));

  expect(wizard.draft.sourcePath).toBe('/home/user/existing-project');
});

test('Expect draft preserved when startWorkspace fails', async () => {
  vi.mocked(window.createAgentWorkspace).mockRejectedValue(new Error('creation failed'));
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Agent Workspace',
        type: 'error',
        message: expect.stringContaining('creation failed'),
      }),
    );
  });

  expect(wizard.draft.sourcePath).toBe('/home/user/my-repo');
  expect(wizard.draft.sessionName).toBe('my-repo');
});

test('Expect error dialog shown when createAgentWorkspace fails from Start Workspace button', async () => {
  vi.mocked(window.createAgentWorkspace).mockRejectedValue(new Error('sandbox init failed'));
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  for (let i = 0; i < wizardStepCount - 1; i++) {
    await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  }

  await fireEvent.click(screen.getByRole('button', { name: 'Start Workspace' }));

  await vi.waitFor(() => {
    expect(window.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Agent Workspace',
        type: 'error',
        message: expect.stringContaining('sandbox init failed'),
      }),
    );
  });
});

test('Expect navigation still called when startAsIs fails', async () => {
  const { handleNavigation } = await import('/@/navigation');
  vi.mocked(window.createAgentWorkspace).mockRejectedValue(new Error('creation failed'));
  vi.mocked(window.checkAgentWorkspaceConfigExists).mockResolvedValue(true);

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/existing-project' },
  });

  await vi.waitFor(() => {
    expect(screen.getByRole('button', { name: 'Start workspace as-is' })).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Start workspace as-is' }));

  await vi.waitFor(() => {
    expect(handleNavigation).toHaveBeenCalledWith({ page: 'agent-workspaces' });
  });
});

test('Expect navigation still called when startWorkspace fails', async () => {
  const { handleNavigation } = await import('/@/navigation');
  vi.mocked(window.createAgentWorkspace).mockRejectedValue(new Error('creation failed'));
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });

  await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

  await vi.waitFor(() => {
    expect(handleNavigation).toHaveBeenCalledWith({ page: 'agent-workspaces' });
  });
});

const wizardStepCount = 5;

const sampleProject: WorkspaceProjectInfo = {
  id: 'my-app',
  name: 'My App',
  description: 'A sample project',
  folder: '/home/user/my-app',
  skills: ['kubernetes'],
  mcpServers: ['mcp-github'],
  knowledges: [],
  secrets: ['github-token'],
  filesystem: { mode: 'project', mounts: [] },
  network: { mode: 'deny', hosts: ['registry.npmjs.org'] },
};

function setProjects(projects: WorkspaceProjectInfo[]): void {
  vi.mocked(workspaceProjectsStore).workspaceProjectInfos = writable<readonly WorkspaceProjectInfo[]>(projects);
}

describe('when projects exist', () => {
  beforeEach(() => {
    setProjects([sampleProject]);
  });

  test('Expect wizard still has five steps when projects exist', () => {
    render(AgentWorkspaceCreate);

    expect(screen.getByText(/Step 1 of 5/)).toBeInTheDocument();
  });

  test('Expect Saved project accordion visible on workspace step', () => {
    render(AgentWorkspaceCreate);

    expect(screen.getByRole('button', { name: /Saved project/ })).toBeInTheDocument();
  });

  test('Expect project selection cards rendered after expanding accordion', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));

    expect(screen.getByRole('option', { name: /None/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /My App/ })).toBeInTheDocument();
  });

  test('Expect selecting a project pre-fills source path', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect((screen.getByPlaceholderText('/path/to/project') as HTMLInputElement).value).toBe('/home/user/my-app');
  });

  test('Expect selecting a project pre-fills session name', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect((screen.getByPlaceholderText('e.g., front-refactor') as HTMLInputElement).value).toBe('my-app');
  });

  test('Expect createAgentWorkspace called with project id', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

    expect(window.createAgentWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'my-app',
        sourcePath: '/home/user/my-app',
      }),
    );
  });

  test('Expect createAgentWorkspace called without project when None selected', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));
    await fireEvent.click(screen.getByRole('option', { name: /None/ }));

    await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
      target: { value: '/home/user/other-repo' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Use all defaults and create workspace' }));

    expect(window.createAgentWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        project: undefined,
      }),
    );
  });

  test('Expect selecting a project populates draft skill ids', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedSkillIds).toEqual(['kubernetes']);
  });

  test('Expect selecting a project populates draft MCP ids', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedMcpIds).toEqual(['mcp-github']);
  });

  test('Expect selecting a project populates draft secret ids', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedSecretIds).toEqual(['github-token']);
  });

  test('Expect selecting a project maps deny network with custom hosts to blocked mode', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedNetwork).toBe('blocked');
    expect(wizard.draft.hostsByMode['blocked']).toEqual(['registry.npmjs.org']);
  });

  test('Expect clearing project resets draft fields', async () => {
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));
    expect(wizard.draft.selectedProjectId).toBe('my-app');

    await fireEvent.click(screen.getByRole('option', { name: /None/ }));

    expect(wizard.draft.selectedProjectId).toBeUndefined();
    expect(wizard.draft.sourcePath).toBe('');
    expect(wizard.draft.sessionName).toBe('');
  });

  test('Expect clearing project restores all-selected defaults for resources', async () => {
    vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
      { name: 'kubernetes', description: 'K8s', path: '/skills/k8s', enabled: true, managed: false },
      { name: 'docker', description: 'Docker', path: '/skills/docker', enabled: true, managed: false },
    ]);
    vi.mocked(mcpStore).mcpRemoteServerInfos = writable<MCPRemoteServerInfo[]>([
      { id: 'mcp-1', name: 'MCP One', description: '', url: '', infos: {}, tools: {} } as MCPRemoteServerInfo,
    ]);

    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));
    expect(wizard.draft.selectedSkillIds).toEqual(['kubernetes']);
    expect(wizard.draft.selectedMcpIds).toEqual(['mcp-github']);

    await fireEvent.click(screen.getByRole('option', { name: /None/ }));

    expect(wizard.draft.selectedSkillIds).toEqual(['kubernetes', 'docker']);
    expect(wizard.draft.selectedMcpIds).toEqual(['mcp-1']);
  });
});

describe('project filesystem mapping', () => {
  test('Expect allow network maps to registries', async () => {
    const openNetProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'open-net',
      network: { mode: 'allow' },
    };
    wizard.draft.hostsByMode = {
      ...wizard.draft.hostsByMode,
      registries: ['stale.example.com'],
    };
    setProjects([openNetProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedNetwork).toBe('registries');
    expect(wizard.draft.hostsByMode['registries']).toEqual(['registry.npmjs.org', 'pypi.python.org']);
  });

  test('Expect deny network without hosts mapped to blocked mode', async () => {
    const blockedProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'blocked',
      network: { mode: 'deny' },
    };
    setProjects([blockedProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedNetwork).toBe('blocked');
  });

  test('Expect deny network with registry preset hosts mapped to registries mode', async () => {
    const registryProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'registry-preset',
      network: { mode: 'deny', hosts: ['registry.npmjs.org', 'pypi.python.org'] },
    };
    setProjects([registryProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedNetwork).toBe('registries');
    expect(wizard.draft.hostsByMode['registries']).toEqual(['registry.npmjs.org', 'pypi.python.org']);
  });

  test('Expect deny network with custom hosts mapped to blocked mode', async () => {
    const customHostsProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'custom-hosts',
      network: { mode: 'deny', hosts: ['internal.corp.local'] },
    };
    setProjects([customHostsProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedNetwork).toBe('blocked');
    expect(wizard.draft.hostsByMode['blocked']).toEqual(['internal.corp.local']);
  });

  test('Expect Deny All radio checked on networking step after selecting project with custom hosts', async () => {
    const customHostsProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'custom-hosts',
      network: { mode: 'deny', hosts: ['internal.corp.local'] },
    };
    setProjects([customHostsProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    for (let i = 0; i < 4; i++) {
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    expect(screen.getByRole('radio', { name: 'Use Deny All' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Use Developer Preset' })).not.toBeChecked();
  });

  test('Expect Developer Preset radio checked on networking step after selecting project with registry preset', async () => {
    const registryProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'registry-preset',
      network: { mode: 'deny', hosts: ['registry.npmjs.org', 'pypi.python.org'] },
    };
    setProjects([registryProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    for (let i = 0; i < 4; i++) {
      await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    }

    expect(screen.getByRole('radio', { name: 'Use Developer Preset' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Use Deny All' })).not.toBeChecked();
  });

  test('Expect home mount mapped to custom file access', async () => {
    const homeProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'home-mount',
      filesystem: { mode: 'custom', mounts: [{ host: '$HOME', target: '$HOME', ro: false }] },
    };
    setProjects([homeProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedFileAccess).toBe('custom');
    expect(wizard.draft.customMounts).toEqual([{ host: '$HOME', target: '$HOME', ro: false }]);
  });

  test('Expect root mount mapped to custom file access', async () => {
    const rootProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'root-mount',
      filesystem: { mode: 'custom', mounts: [{ host: '/', target: '/', ro: false }] },
    };
    setProjects([rootProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedFileAccess).toBe('custom');
    expect(wizard.draft.customMounts).toEqual([{ host: '/', target: '/', ro: false }]);
  });

  test('Expect custom mounts mapped to custom file access', async () => {
    const customProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'custom-mounts',
      filesystem: {
        mode: 'custom',
        mounts: [{ host: '/data', target: '/workspace/data', ro: true }],
      },
    };
    setProjects([customProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedFileAccess).toBe('custom');
    expect(wizard.draft.customMounts).toEqual([{ host: '/data', target: '/workspace/data', ro: true }]);
  });

  test('Expect empty mounts mapped to workspace file access', async () => {
    const noMountProject: WorkspaceProjectInfo = {
      ...sampleProject,
      id: 'no-mounts',
      filesystem: { mode: 'project', mounts: [] },
    };
    setProjects([noMountProject]);
    render(AgentWorkspaceCreate);

    await fireEvent.click(screen.getByRole('button', { name: /Saved project/ }));
    await fireEvent.click(screen.getByRole('option', { name: /My App/ }));

    expect(wizard.draft.selectedFileAccess).toBe('workspace');
  });
});
