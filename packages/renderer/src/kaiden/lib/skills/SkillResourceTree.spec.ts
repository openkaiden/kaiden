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

import type { SkillResourceEntry } from '/@api/skill/skill-info';

import SkillResourceTree from './SkillResourceTree.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

test('should render file entries', () => {
  const entries: SkillResourceEntry[] = [
    { name: 'SKILL.md', isDirectory: false },
    { name: 'utils.ts', isDirectory: false },
  ];

  render(SkillResourceTree, { skillName: 'test-skill', entries });

  expect(screen.getByText('SKILL.md')).toBeInTheDocument();
  expect(screen.getByText('utils.ts')).toBeInTheDocument();
});

test('should render directory entries with trailing slash', () => {
  const entries: SkillResourceEntry[] = [{ name: 'templates', isDirectory: true }];

  render(SkillResourceTree, { skillName: 'test-skill', entries });

  expect(screen.getByText('templates/')).toBeInTheDocument();
});

test('should lazily load children when directory is expanded', async () => {
  const entries: SkillResourceEntry[] = [{ name: 'templates', isDirectory: true }];
  vi.mocked(window.listSkillFolderContent).mockResolvedValue([{ name: 'deploy.yaml', isDirectory: false }]);

  render(SkillResourceTree, { skillName: 'test-skill', entries });

  await fireEvent.click(screen.getByText('templates/'));

  expect(window.listSkillFolderContent).toHaveBeenCalledWith('test-skill', 'templates');
  expect(await screen.findByText('deploy.yaml')).toBeInTheDocument();
});

test('should not reload children when directory is collapsed and re-expanded', async () => {
  const entries: SkillResourceEntry[] = [{ name: 'data', isDirectory: true }];
  vi.mocked(window.listSkillFolderContent).mockResolvedValue([{ name: 'file.txt', isDirectory: false }]);

  render(SkillResourceTree, { skillName: 'test-skill', entries });

  const button = screen.getByText('data/');
  await fireEvent.click(button);
  await screen.findByText('file.txt');

  await fireEvent.click(button);
  await fireEvent.click(button);

  expect(window.listSkillFolderContent).toHaveBeenCalledTimes(1);
});
