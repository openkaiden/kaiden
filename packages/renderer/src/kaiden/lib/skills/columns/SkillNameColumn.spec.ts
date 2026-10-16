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

import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { SkillInfo } from '/@api/skill/skill-info';

import SkillNameColumn from './SkillNameColumn.svelte';

const skill: SkillInfo = {
  name: 'my-test-skill',
  description: 'A test skill',
  path: '/skills/my-test-skill',
  enabled: true,
  managed: true,
};

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('should display the skill name', () => {
  render(SkillNameColumn, { object: skill });

  const text = screen.getByText('my-test-skill');
  expect(text).toBeInTheDocument();
});

test('should have correct styling', () => {
  render(SkillNameColumn, { object: skill });

  const button = screen.getByRole('button', { name: 'my-test-skill' });
  expect(button).toBeInTheDocument();
  const label = screen.getByText('my-test-skill');
  expect(label).toHaveClass('overflow-hidden');
  expect(label).toHaveClass('text-ellipsis');
});

test('should have the skill name as title attribute', () => {
  render(SkillNameColumn, { object: skill });

  const button = screen.getByTitle('my-test-skill');
  expect(button).toBeInTheDocument();
});
