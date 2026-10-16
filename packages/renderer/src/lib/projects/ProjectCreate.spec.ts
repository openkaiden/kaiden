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
import { beforeEach, expect, test, vi } from 'vitest';

import * as secretVaultStore from '/@/kaiden/stores/secret-vault';
import * as skillsStore from '/@/kaiden/stores/skills';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';
import type { SkillInfo } from '/@api/skill/skill-info';
import type { WorkspaceProjectAnalysis, WorkspaceProjectInfo } from '/@api/workspace-project-info';

import ProjectCreate from './ProjectCreate.svelte';

vi.mock(import('/@/navigation'));
vi.mock(import('/@/kaiden/stores/skills'));
vi.mock(import('/@/kaiden/stores/secret-vault'));

const SAMPLE_SKILLS: SkillInfo[] = [
  { name: 'code-review', description: 'Reviews code', path: '/skills/code-review', enabled: true, managed: false },
  { name: 'testing', description: 'Writes tests', path: '/skills/testing', enabled: true, managed: true },
  { name: 'disabled-skill', description: 'Disabled', path: '/skills/disabled', enabled: false, managed: true },
];

const SAMPLE_SECRETS: SecretVaultInfo[] = [
  { id: 'github-token', name: 'GitHub Token', type: 'github', description: 'Personal access token' },
  { id: 'anthropic-key', name: 'Anthropic Key', type: 'anthropic', description: 'API key' },
];

beforeEach(() => {
  vi.resetAllMocks();
  HTMLElement.prototype.animate = vi.fn().mockReturnValue({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    onfinish: null,
  });
  vi.mocked(skillsStore).skillInfos = writable<readonly SkillInfo[]>(SAMPLE_SKILLS);
  vi.mocked(secretVaultStore).secretVaultInfos = writable<readonly SecretVaultInfo[]>(SAMPLE_SECRETS);
});

test('wizard displays 5 steps in stepper', () => {
  render(ProjectCreate);

  expect(screen.getAllByText('Source').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Review')).toBeInTheDocument();
  expect(screen.getByText('MCP Servers')).toBeInTheDocument();
  expect(screen.getByText('Secrets')).toBeInTheDocument();
  expect(screen.getByText('Skills')).toBeInTheDocument();
});

test('step counter shows Step 1 of 5', () => {
  render(ProjectCreate);

  expect(screen.getByText('Step 1 of 5')).toBeInTheDocument();
});

test('navigates to review step after analyze with local path', async () => {
  const analysisResult: WorkspaceProjectAnalysis = {
    name: 'my-project',
    description: 'A project',
    folder: '/home/user/my-project',
  };
  vi.mocked(window.analyzeWorkspaceProject).mockResolvedValue(analysisResult);

  render(ProjectCreate);

  const input = screen.getByPlaceholderText('/home/user/dev/my-project');
  await fireEvent.input(input, { target: { value: '/home/user/my-project' } });

  const analyzeButton = screen.getByText('Analyze');
  await fireEvent.click(analyzeButton);

  await waitFor(() => {
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });
});

test('secrets step shows all vault secrets selected by default', async () => {
  const analysisResult: WorkspaceProjectAnalysis = {
    name: 'my-project',
    folder: '/home/user/my-project',
  };
  vi.mocked(window.analyzeWorkspaceProject).mockResolvedValue(analysisResult);

  render(ProjectCreate);

  const input = screen.getByPlaceholderText('/home/user/dev/my-project');
  await fireEvent.input(input, { target: { value: '/home/user/my-project' } });
  await fireEvent.click(screen.getByText('Analyze'));

  await waitFor(() => {
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument();
    expect(screen.getByText(/2\/2 secrets/)).toBeInTheDocument();
  });
});

test('skills step shows all enabled skills selected by default', async () => {
  const analysisResult: WorkspaceProjectAnalysis = {
    name: 'my-project',
    folder: '/home/user/my-project',
  };
  vi.mocked(window.analyzeWorkspaceProject).mockResolvedValue(analysisResult);

  render(ProjectCreate);

  const input = screen.getByPlaceholderText('/home/user/dev/my-project');
  await fireEvent.input(input, { target: { value: '/home/user/my-project' } });
  await fireEvent.click(screen.getByText('Analyze'));

  await waitFor(() => {
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText(/2\/2 skills/)).toBeInTheDocument();
  });
});

test('passes selected skills and secrets to createWorkspaceProject', async () => {
  const analysisResult: WorkspaceProjectAnalysis = {
    name: 'my-project',
    folder: '/home/user/my-project',
  };
  vi.mocked(window.analyzeWorkspaceProject).mockResolvedValue(analysisResult);
  vi.mocked(window.createWorkspaceProject).mockResolvedValue({} as unknown as WorkspaceProjectInfo);

  render(ProjectCreate);

  const input = screen.getByPlaceholderText('/home/user/dev/my-project');
  await fireEvent.input(input, { target: { value: '/home/user/my-project' } });
  await fireEvent.click(screen.getByText('Analyze'));

  await waitFor(() => {
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Create Project'));

  await waitFor(() => {
    expect(window.createWorkspaceProject).toHaveBeenCalledWith(
      expect.objectContaining({
        skills: ['code-review', 'testing'],
        secrets: ['github-token', 'anthropic-key'],
      }),
    );
  });
});

test('passes deselected secrets to createWorkspaceProject', async () => {
  const analysisResult: WorkspaceProjectAnalysis = {
    name: 'my-project',
    folder: '/home/user/my-project',
  };
  vi.mocked(window.analyzeWorkspaceProject).mockResolvedValue(analysisResult);
  vi.mocked(window.createWorkspaceProject).mockResolvedValue({} as unknown as WorkspaceProjectInfo);

  render(ProjectCreate);

  const input = screen.getByPlaceholderText('/home/user/dev/my-project');
  await fireEvent.input(input, { target: { value: '/home/user/my-project' } });
  await fireEvent.click(screen.getByText('Analyze'));

  await waitFor(() => {
    expect(screen.getByText('Step 2 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 3 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 4 of 5')).toBeInTheDocument();
  });

  const expandButton = screen.getByText('Customize secrets').closest('button')!;
  await fireEvent.click(expandButton);
  await fireEvent.click(screen.getByRole('button', { name: 'Anthropic Key' }));

  await fireEvent.click(screen.getByText('Continue'));

  await waitFor(() => {
    expect(screen.getByText('Step 5 of 5')).toBeInTheDocument();
  });

  await fireEvent.click(screen.getByText('Create Project'));

  await waitFor(() => {
    expect(window.createWorkspaceProject).toHaveBeenCalledWith(
      expect.objectContaining({
        secrets: ['github-token'],
      }),
    );
  });
});
