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
import * as skillsStore from '/@/stores/skills';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { SkillInfo } from '/@api/skill/skill-info';

import AgentWorkspaceCreate from './AgentWorkspaceCreate.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/stores/skills'));
vi.mock(import('/@/stores/mcp-remote-servers'));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([]);
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<MCPRemoteServerInfo[]>([]);
});

test('Expect page title displayed', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Create Coding Agent Workspace')).toBeInTheDocument();
});

test('Expect session details section rendered', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Session Details')).toBeInTheDocument();
});

test('Expect session name input rendered', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByPlaceholderText('e.g., Frontend Refactoring')).toBeInTheDocument();
});

test('Expect working directory input rendered', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByPlaceholderText('/path/to/project')).toBeInTheDocument();
});

test('Expect coding agent options displayed', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Claude')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cursor' })).toBeInTheDocument();
  expect(screen.getByText('Goose')).toBeInTheDocument();
  expect(screen.getByText('OpenCode')).toBeInTheDocument();
});

test('Expect agent badges displayed', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Anthropic')).toBeInTheDocument();
  expect(screen.getByText('Block')).toBeInTheDocument();
});

test('Expect file system access section rendered', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('File System Access')).toBeInTheDocument();
});

test('Expect file access options displayed', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Working Directory Only')).toBeInTheDocument();
  expect(screen.getByText('Home Directory')).toBeInTheDocument();
  expect(screen.getByText('Custom Paths')).toBeInTheDocument();
  expect(screen.getByText('Full System Access')).toBeInTheDocument();
});

test('Expect Start Workspace button disabled when session name is empty', () => {
  render(AgentWorkspaceCreate);

  const startButton = screen.getByRole('button', { name: 'Start Workspace' });
  expect(startButton).toBeDisabled();
});

test('Expect Cancel button rendered', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

test('Expect skills section hidden when no skills available', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByText('Skills')).not.toBeInTheDocument();
});

test('Expect MCP servers section hidden when no servers available', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByText('MCP Servers')).not.toBeInTheDocument();
});

test('Expect skills section displayed when skills available', () => {
  vi.mocked(skillsStore).skillInfos = writable<SkillInfo[]>([
    { name: 'Docker Skill', description: 'Build containers' } as SkillInfo,
  ]);

  render(AgentWorkspaceCreate);

  expect(screen.getByText('Skills')).toBeInTheDocument();
  expect(screen.getByText('Docker Skill')).toBeInTheDocument();
});

test('Expect MCP section displayed when servers available', () => {
  vi.mocked(mcpStore).mcpRemoteServerInfos = writable<MCPRemoteServerInfo[]>([
    { id: 'mcp-1', name: 'My MCP Server', description: 'A test server' } as MCPRemoteServerInfo,
  ]);

  render(AgentWorkspaceCreate);

  expect(screen.getByText('MCP Servers')).toBeInTheDocument();
  expect(screen.getByText('My MCP Server')).toBeInTheDocument();
});

test('Expect sandbox security message displayed', () => {
  render(AgentWorkspaceCreate);

  expect(screen.getByText('Workspace will run in a secured sandbox environment')).toBeInTheDocument();
});

test('Expect custom paths section shown when Custom Paths selected', async () => {
  render(AgentWorkspaceCreate);

  const customPathsButton = screen.getByRole('button', { name: 'Custom Paths' });
  await fireEvent.click(customPathsButton);

  expect(screen.getByPlaceholderText('/path/to/allowed/directory')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Add Another Path' })).toBeInTheDocument();
});

test('Expect custom paths section hidden for non-custom file access', () => {
  render(AgentWorkspaceCreate);

  expect(screen.queryByPlaceholderText('/path/to/allowed/directory')).not.toBeInTheDocument();
});
