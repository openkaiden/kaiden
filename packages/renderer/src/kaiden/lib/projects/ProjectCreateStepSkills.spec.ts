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
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ChecklistItem } from '/@/lib/ui/ChecklistPanel.svelte';

import ProjectCreateStepSkills from './ProjectCreateStepSkills.svelte';

vi.mock(import('/@/navigation'));

const SAMPLE_SKILLS: ChecklistItem[] = [
  { id: 'code-review', name: 'code-review', description: 'Reviews code changes', group: 'Pre-built' },
  { id: 'testing', name: 'testing', description: 'Generates unit tests', group: 'Pre-built' },
  { id: 'my-skill', name: 'my-skill', description: 'Custom skill', group: 'Custom' },
];

beforeEach(() => {
  vi.resetAllMocks();
  HTMLElement.prototype.animate = vi.fn().mockReturnValue({
    finished: Promise.resolve(),
    cancel: vi.fn(),
    onfinish: null,
  });
});

describe('summary card', () => {
  test('shows all-included message when all skills selected', () => {
    render(ProjectCreateStepSkills, {
      skillItems: SAMPLE_SKILLS,
      selectedSkillIds: ['code-review', 'testing', 'my-skill'],
    });

    expect(screen.getByText(/All available skills are included/)).toBeInTheDocument();
    expect(screen.getByText(/3\/3 skills/)).toBeInTheDocument();
  });

  test('shows partial count when not all skills selected', () => {
    render(ProjectCreateStepSkills, {
      skillItems: SAMPLE_SKILLS,
      selectedSkillIds: ['code-review'],
    });

    expect(screen.getByText(/1\/3 skills/)).toBeInTheDocument();
    expect(screen.getByText(/Expand/)).toBeInTheDocument();
  });

  test('shows no summary text when no skills available', () => {
    render(ProjectCreateStepSkills, {
      skillItems: [],
      selectedSkillIds: [],
    });

    expect(screen.getByText(/All available skills are included/)).toBeInTheDocument();
  });
});

describe('checklist panel', () => {
  async function expandCustomize(): Promise<void> {
    const expandButton = screen.getByText('Customize skills').closest('button')!;
    await fireEvent.click(expandButton);
  }

  test('renders Skills panel with correct title after expanding', async () => {
    render(ProjectCreateStepSkills, {
      skillItems: SAMPLE_SKILLS,
      selectedSkillIds: SAMPLE_SKILLS.map(s => s.id),
    });

    await expandCustomize();

    expect(screen.getByText('Skills')).toBeInTheDocument();
  });

  test('renders empty message when no skills available', async () => {
    render(ProjectCreateStepSkills, {
      skillItems: [],
      selectedSkillIds: [],
    });

    await expandCustomize();

    expect(screen.getByText('No skills available yet.')).toBeInTheDocument();
  });

  test('renders skill items with names and descriptions', async () => {
    render(ProjectCreateStepSkills, {
      skillItems: SAMPLE_SKILLS,
      selectedSkillIds: SAMPLE_SKILLS.map(s => s.id),
    });

    await expandCustomize();

    expect(screen.getByText('code-review')).toBeInTheDocument();
    expect(screen.getByText('Reviews code changes')).toBeInTheDocument();
    expect(screen.getByText('my-skill')).toBeInTheDocument();
    expect(screen.getByText('Custom skill')).toBeInTheDocument();
  });

  test('displays Manage Skills button after expanding', async () => {
    render(ProjectCreateStepSkills, {
      skillItems: SAMPLE_SKILLS,
      selectedSkillIds: ['code-review'],
    });

    await expandCustomize();

    expect(screen.getByRole('button', { name: 'Manage Skills' })).toBeInTheDocument();
  });

  test('toggling a skill updates the footer count', async () => {
    render(ProjectCreateStepSkills, {
      skillItems: SAMPLE_SKILLS,
      selectedSkillIds: ['code-review', 'testing', 'my-skill'],
    });

    await expandCustomize();

    expect(screen.getByText('3 of 3 selected')).toBeInTheDocument();

    const skillButton = screen.getByRole('button', { name: 'testing' });
    await fireEvent.click(skillButton);

    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
  });
});
