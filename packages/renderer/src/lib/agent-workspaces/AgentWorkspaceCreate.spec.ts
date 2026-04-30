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

import { fireEvent, render, screen } from '@testing-library/svelte';
import { writable } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import * as mcpStore from '/@/stores/mcp-remote-servers';
import * as secretVaultStore from '/@/stores/secret-vault';
import * as skillsStore from '/@/stores/skills';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';
import type { SkillInfo } from '/@api/skill/skill-info';

import AgentWorkspaceCreate from './AgentWorkspaceCreate.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/stores/skills'));
vi.mock(import('/@/stores/mcp-remote-servers'));
vi.mock(import('/@/stores/secret-vault'));

beforeEach(() => {
  vi.resetAllMocks();
  HTMLElement.prototype.animate = vi.fn().mockReturnValue({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    onfinish: null,
  });
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([]);
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<MCPRemoteServerInfo[]>([]);
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>([]);
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

  expect(screen.getByPlaceholderText('e.g., Frontend Refactoring')).toBeInTheDocument();
});

test('Expect description section is collapsed by default', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByPlaceholderText('Short note for your team (optional)')).not.toBeInTheDocument();
});

test('Expect description section expands when toggle clicked', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.click(screen.getByRole('button', { name: /Description/ }));

  expect(screen.getByPlaceholderText('Short note for your team (optional)')).toBeInTheDocument();
});

test('Expect workspace name auto-suggested from source path', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-project' },
  });

  expect((screen.getByPlaceholderText('e.g., Frontend Refactoring') as HTMLInputElement).value).toBe('my-project');
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

test('Expect custom paths section shown when Custom Paths selected on filesystem step', async () => {
  render(AgentWorkspaceCreate);

  await fireEvent.input(screen.getByPlaceholderText('/path/to/project'), {
    target: { value: '/home/user/my-repo' },
  });
  // Workspace → Agent & Model → Tools & Secrets → File System
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

  await fireEvent.click(screen.getByRole('radio', { name: 'Use Custom Paths' }));

  expect(screen.getByPlaceholderText('/path/to/allowed/directory')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Another Path' })).toBeInTheDocument();
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
  await fireEvent.click(screen.getByRole('button', { name: /Customize skills, MCP servers, and vault/ }));
}

test('Expect summary card and customize toggle on tools & secrets step', async () => {
  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();

  expect(screen.getByText(/Everything available is included/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Customize skills, MCP servers, and vault/ })).toBeInTheDocument();
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

test('Expect secrets listed when vault has entries', async () => {
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

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();

  expect(screen.getByText('GitHub Token')).toBeInTheDocument();
  expect(screen.getByText('Anthropic Key')).toBeInTheDocument();
  expect(screen.getByText('Secret Vault')).toBeInTheDocument();
  expect(screen.queryByText('No secrets in your vault yet.')).not.toBeInTheDocument();
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

test('Expect Manage Skills button navigates to skills page', async () => {
  const { handleNavigation } = await import('/@/navigation');

  render(AgentWorkspaceCreate);

  await navigateToToolsSecretsStep();
  await expandCustomize();
  await fireEvent.click(screen.getByRole('button', { name: 'Manage Skills' }));

  expect(handleNavigation).toHaveBeenCalledWith({ page: 'skills' });
});

const wizardStepCount = 5;
