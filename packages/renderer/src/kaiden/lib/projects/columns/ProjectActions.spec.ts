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

import { handleNavigation } from '/@/navigation';
import { initializeDraftFromProject } from '/@/stores/agent-workspace-create-draft.svelte';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import ProjectActions from './ProjectActions.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/stores/agent-workspace-create-draft.svelte'));

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
});

test('create workspace initializes the row project before navigating', async () => {
  render(ProjectActions, { object: sampleProject });
  await fireEvent.click(screen.getByRole('button', { name: 'Create workspace' }));
  expect(initializeDraftFromProject).toHaveBeenCalledExactlyOnceWith(sampleProject);
  expect(initializeDraftFromProject).toHaveBeenCalledBefore(vi.mocked(handleNavigation));
  expect(handleNavigation).toHaveBeenCalledExactlyOnceWith({
    page: NavigationPage.AGENT_WORKSPACE_CREATE,
  });
});

test('remove action retains confirmation and deletes only its project', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 0 });
  vi.mocked(window.removeWorkspaceProject).mockResolvedValue(undefined);
  render(ProjectActions, { object: sampleProject });
  await fireEvent.click(screen.getByRole('button', { name: 'Remove project' }));
  expect(window.showMessageBox).toHaveBeenCalledExactlyOnceWith({
    title: 'Confirmation',
    message: 'Are you sure you want to remove project My Project?',
    buttons: ['Yes', 'Cancel'],
  });
  await vi.waitFor(() => expect(window.removeWorkspaceProject).toHaveBeenCalledWith(sampleProject.id));
  expect(handleNavigation).not.toHaveBeenCalled();
});

test('remove action does not delete the project when confirmation is cancelled', async () => {
  vi.mocked(window.showMessageBox).mockResolvedValue({ response: 1 });
  render(ProjectActions, { object: sampleProject });
  await fireEvent.click(screen.getByRole('button', { name: 'Remove project' }));
  expect(window.showMessageBox).toHaveBeenCalledOnce();
  expect(window.removeWorkspaceProject).not.toHaveBeenCalled();
});
