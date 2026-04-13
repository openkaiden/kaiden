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
import { beforeEach, expect, test, vi } from 'vitest';

import SkillCreate from './SkillCreate.svelte';

const closeMock = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.listSkillFolders).mockResolvedValue([
    { label: 'Kaiden Skills', badge: 'Kaiden', baseDirectory: '/test/skills' },
    { label: 'Claude Skills', badge: 'Claude', baseDirectory: '/home/.claude/skills' },
  ]);
  vi.mocked(window.createSkill).mockResolvedValue({
    name: 'test-skill',
    description: 'A test skill',
    path: '/skills/test-skill',
    enabled: true,
    type: 'custom',
  });
});

test('should render the Create Skill dialog title', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByText('Create Skill')).toBeInTheDocument();
  });
});

test('should render target cards after loading', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByText('Kaiden Skills')).toBeInTheDocument();
    expect(screen.getByText('Claude Skills')).toBeInTheDocument();
  });
});

test('should render name, description, and content fields', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByLabelText('Skill name')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill description')).toBeInTheDocument();
    expect(screen.getByLabelText('Skill content')).toBeInTheDocument();
  });
});

test('should render the drag/drop zone', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByLabelText('Drop or click to select a SKILL.md file')).toBeInTheDocument();
    expect(screen.getByText(/Choose file/)).toBeInTheDocument();
    expect(screen.getByText('Supported formats: .md')).toBeInTheDocument();
  });
});

test('should have Create button disabled when fields are empty', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});

test('should call onclose when Cancel is clicked', async () => {
  render(SkillCreate, { onclose: closeMock });

  const cancelButton = await screen.findByRole('button', { name: 'Cancel' });
  await fireEvent.click(cancelButton);

  expect(closeMock).toHaveBeenCalled();
});

test('should enable Create button when all fields are filled and target is auto-selected', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByText('Kaiden Skills')).toBeInTheDocument();
  });

  const nameInput = screen.getByLabelText('Skill name');
  const descInput = screen.getByLabelText('Skill description');
  const contentArea = screen.getByLabelText('Skill content');

  await userEvent.type(nameInput, 'test-skill');
  await userEvent.type(descInput, 'A test skill');
  await userEvent.type(contentArea, 'Some content');

  const createButton = screen.getByRole('button', { name: 'Create' });
  expect(createButton).toBeEnabled();
});

test('should call createSkill with correct parameters and close on success', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByText('Kaiden Skills')).toBeInTheDocument();
  });

  const nameInput = screen.getByLabelText('Skill name');
  const descInput = screen.getByLabelText('Skill description');
  const contentArea = screen.getByLabelText('Skill content');

  await userEvent.type(nameInput, 'test-skill');
  await userEvent.type(descInput, 'A test skill');
  await userEvent.type(contentArea, 'Some content');

  const createButton = screen.getByRole('button', { name: 'Create' });
  await fireEvent.click(createButton);

  expect(window.createSkill).toHaveBeenCalledWith(
    { name: 'test-skill', description: 'A test skill', content: 'Some content' },
    '/test/skills',
  );
  expect(closeMock).toHaveBeenCalled();
});

test('should call createSkill with claude target when Claude card is selected', async () => {
  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByText('Claude Skills')).toBeInTheDocument();
  });

  const claudeCard = screen.getByRole('button', { name: 'Claude Skills' });
  await fireEvent.click(claudeCard);

  const nameInput = screen.getByLabelText('Skill name');
  const descInput = screen.getByLabelText('Skill description');
  const contentArea = screen.getByLabelText('Skill content');

  await userEvent.type(nameInput, 'test-skill');
  await userEvent.type(descInput, 'A test skill');
  await userEvent.type(contentArea, 'Some content');

  const createButton = screen.getByRole('button', { name: 'Create' });
  await fireEvent.click(createButton);

  expect(window.createSkill).toHaveBeenCalledWith(expect.any(Object), '/home/.claude/skills');
});

test('should display error when createSkill fails', async () => {
  vi.mocked(window.createSkill).mockRejectedValue(new Error('Skill already exists'));

  render(SkillCreate, { onclose: closeMock });

  await waitFor(() => {
    expect(screen.getByText('Kaiden Skills')).toBeInTheDocument();
  });

  const nameInput = screen.getByLabelText('Skill name');
  const descInput = screen.getByLabelText('Skill description');
  const contentArea = screen.getByLabelText('Skill content');

  await userEvent.type(nameInput, 'test-skill');
  await userEvent.type(descInput, 'A test skill');
  await userEvent.type(contentArea, 'Some content');

  const createButton = screen.getByRole('button', { name: 'Create' });
  await fireEvent.click(createButton);

  expect(await screen.findByText(/Skill already exists/)).toBeInTheDocument();
  expect(closeMock).not.toHaveBeenCalled();
});

test('should render drop zone with correct label', async () => {
  render(SkillCreate, { onclose: closeMock });

  const dropZone = await screen.findByRole('button', { name: 'Drop or click to select a SKILL.md file' });
  expect(dropZone).toBeInTheDocument();
});

test('should open file dialog when drop zone is clicked', async () => {
  vi.mocked(window.openDialog).mockResolvedValue(['/home/user/skills/SKILL.md']);
  vi.mocked(window.getSkillFileContent).mockResolvedValue({
    name: 'parsed-skill',
    description: 'Parsed description',
    content: '# Body',
  });

  render(SkillCreate, { onclose: closeMock });

  const dropZone = await screen.findByLabelText('Drop or click to select a SKILL.md file');
  await fireEvent.click(dropZone);

  expect(window.openDialog).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Select a SKILL.md file',
      selectors: ['openFile'],
    }),
  );
});

test('should prefill fields from parsed file when browsing', async () => {
  vi.mocked(window.openDialog).mockResolvedValue(['/home/user/skills/SKILL.md']);
  vi.mocked(window.getSkillFileContent).mockResolvedValue({
    name: 'parsed-skill',
    description: 'Parsed description',
    content: '# Body content',
  });

  render(SkillCreate, { onclose: closeMock });

  const dropZone = await screen.findByLabelText('Drop or click to select a SKILL.md file');
  await fireEvent.click(dropZone);

  await waitFor(() => {
    expect(screen.getByLabelText('Skill name')).toHaveValue('parsed-skill');
    expect(screen.getByLabelText('Skill description')).toHaveValue('Parsed description');
    expect(screen.getByLabelText('Skill content')).toHaveValue('# Body content');
  });

  await waitFor(() => {
    expect(screen.getByText('Kaiden Skills')).toBeInTheDocument();
  });

  const createButton = screen.getByRole('button', { name: 'Create' });
  await fireEvent.click(createButton);

  expect(window.createSkill).toHaveBeenCalledWith(
    { name: 'parsed-skill', description: 'Parsed description', content: '# Body content' },
    '/test/skills',
  );
});
