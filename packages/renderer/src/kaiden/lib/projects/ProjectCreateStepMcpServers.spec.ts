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
import { beforeEach, expect, test, vi } from 'vitest';

import type { McpServerItem } from './ProjectCreateStepMcpServers.svelte';
import ProjectCreateStepMcpServers from './ProjectCreateStepMcpServers.svelte';

const recommendedItems: McpServerItem[] = [
  { id: 'mcp-github', name: 'GitHub', description: 'Repository access, PRs, issues', recommended: true },
  { id: 'mcp-filesystem', name: 'Filesystem', description: 'Read, write, and manage project files', recommended: true },
];

const availableItems: McpServerItem[] = [
  { id: 'mcp-terminal', name: 'Terminal', description: 'Execute shell commands and manage processes' },
  { id: 'mcp-playwright', name: 'Playwright', description: 'Browser automation for testing' },
];

const allItems: McpServerItem[] = [...recommendedItems, ...availableItems];

beforeEach(() => {
  vi.resetAllMocks();
});

test('Expect description text is shown', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: [] });

  expect(screen.getByText(/we recommend the following MCP servers/)).toBeInTheDocument();
});

test('Expect recommended section header and badges are shown', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: [] });

  const matches = screen.getAllByText('Recommended');
  expect(matches.length).toBeGreaterThanOrEqual(1);
});

test('Expect available section header is shown', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: [] });

  expect(screen.getByText('Available')).toBeInTheDocument();
});

test('Expect all server names are rendered', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: [] });

  expect(screen.getByText('GitHub')).toBeInTheDocument();
  expect(screen.getByText('Filesystem')).toBeInTheDocument();
  expect(screen.getByText('Terminal')).toBeInTheDocument();
  expect(screen.getByText('Playwright')).toBeInTheDocument();
});

test('Expect server descriptions are rendered', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: [] });

  expect(screen.getByText('Repository access, PRs, issues')).toBeInTheDocument();
  expect(screen.getByText('Execute shell commands and manage processes')).toBeInTheDocument();
});

test('Expect recommended badges are shown for recommended items', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: recommendedItems, selectedMcpIds: [] });

  const badges = screen.getAllByText('Recommended');
  expect(badges.length).toBe(3);
});

test('Expect optional badges are shown for available items', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: availableItems, selectedMcpIds: [] });

  const badges = screen.getAllByText('Optional');
  expect(badges.length).toBe(2);
});

test('Expect clicking a server toggles selection', async () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: [] });

  const checkbox = screen.getByRole('checkbox', { name: 'GitHub' });
  await fireEvent.click(checkbox);

  expect(checkbox).toBeChecked();
});

test('Expect clicking a selected server deselects it', async () => {
  render(ProjectCreateStepMcpServers, { mcpItems: allItems, selectedMcpIds: ['mcp-github'] });

  const checkbox = screen.getByRole('checkbox', { name: 'GitHub' });
  await fireEvent.click(checkbox);

  expect(checkbox).not.toBeChecked();
});

test('Expect empty state when no MCP servers available', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: [], selectedMcpIds: [] });

  expect(screen.getByText('No MCP servers available. Set up servers in the MCP section first.')).toBeInTheDocument();
});

test('Expect no recommended section when no recommended items', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: availableItems, selectedMcpIds: [] });

  expect(screen.queryByText('Recommended')).not.toBeInTheDocument();
});

test('Expect no available section when no available items', () => {
  render(ProjectCreateStepMcpServers, { mcpItems: recommendedItems, selectedMcpIds: [] });

  expect(screen.queryByText('Available')).not.toBeInTheDocument();
});
