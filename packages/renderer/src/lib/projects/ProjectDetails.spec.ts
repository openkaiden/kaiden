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
import { writable } from 'svelte/store';
import { router } from 'tinro';
import { beforeEach, expect, test, vi } from 'vitest';

import { handleNavigation } from '/@/navigation';
import { initializeDraftFromProject } from '/@/stores/agent-workspace-create-draft.svelte';
import { workspaceProjectInfos } from '/@/stores/workspace-projects';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import ProjectDetails from './ProjectDetails.svelte';

vi.mock(import('tinro'));
vi.mock(import('/@/navigation'));
vi.mock(import('/@/stores/agent-workspace-create-draft.svelte'));

const routerStore = writable({
  path: '/projects/my-project/overview',
  url: '/projects/my-project/overview',
  from: '/',
  query: {} as Record<string, string>,
  hash: '',
});

const sampleProject: WorkspaceProjectInfo = {
  id: 'my-project',
  name: 'My Project',
  folder: '/home/user/project',
  skills: ['skill-a'],
  mcpServers: ['mcp-1'],
  knowledges: ['kb-1'],
  secrets: ['secret-a'],
  filesystem: { mode: 'allow', mounts: [] },
  network: { mode: 'deny' },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(router).subscribe.mockImplementation(routerStore.subscribe);
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });
  vi.mocked(window.removeWorkspaceProject).mockResolvedValue(undefined);
  workspaceProjectInfos.set([sampleProject]);
});

test('Expect page title to use project name', () => {
  render(ProjectDetails, { projectId: 'my-project' });

  expect(screen.getByText('My Project')).toBeInTheDocument();
});

test('Expect remove button is rendered', () => {
  render(ProjectDetails, { projectId: 'my-project' });

  expect(screen.getByRole('button', { name: 'Remove Project' })).toBeInTheDocument();
});

test('create workspace initializes the displayed project before navigating', async () => {
  render(ProjectDetails, { projectId: sampleProject.id });

  await fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));

  expect(initializeDraftFromProject).toHaveBeenCalledExactlyOnceWith(sampleProject);
  expect(initializeDraftFromProject).toHaveBeenCalledBefore(vi.mocked(handleNavigation));
  expect(handleNavigation).toHaveBeenCalledExactlyOnceWith({
    page: NavigationPage.AGENT_WORKSPACE_CREATE,
  });
});

test('create workspace action is hidden when the project is missing', () => {
  workspaceProjectInfos.set([]);
  render(ProjectDetails, { projectId: 'missing-project' });

  expect(screen.queryByRole('button', { name: 'Create workspace' })).not.toBeInTheDocument();
});

test('Expect confirmation dialog shown when remove button clicked', async () => {
  render(ProjectDetails, { projectId: 'my-project' });

  const removeButton = screen.getByRole('button', { name: 'Remove Project' });
  await fireEvent.click(removeButton);

  expect(window.showMessageBox).toHaveBeenCalledOnce();
});

test('Expect project removed and navigated to list when user confirms', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });

  render(ProjectDetails, { projectId: 'my-project' });

  const removeButton = screen.getByRole('button', { name: 'Remove Project' });
  await fireEvent.click(removeButton);

  await waitFor(() => {
    expect(window.removeWorkspaceProject).toHaveBeenCalledWith('my-project');
  });

  expect(router.goto).toHaveBeenCalledWith('/projects');
});

test('Expect project not removed when user cancels', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });

  render(ProjectDetails, { projectId: 'my-project' });

  const removeButton = screen.getByRole('button', { name: 'Remove Project' });
  await fireEvent.click(removeButton);

  expect(window.removeWorkspaceProject).not.toHaveBeenCalled();
  expect(router.goto).not.toHaveBeenCalled();
});

test('Expect empty title when project not found', () => {
  workspaceProjectInfos.set([]);

  render(ProjectDetails, { projectId: 'missing-project' });

  expect(screen.queryByText('My Project')).not.toBeInTheDocument();
});

test('Expect empty state when project not found', () => {
  workspaceProjectInfos.set([]);

  render(ProjectDetails, { projectId: 'missing-project' });

  expect(screen.getByText('Project not found')).toBeInTheDocument();
});
