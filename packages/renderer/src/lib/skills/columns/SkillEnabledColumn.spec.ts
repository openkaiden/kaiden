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

import type { SkillInfo } from '/@api/skill/skill-info';

import SkillEnabledColumn from './SkillEnabledColumn.svelte';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(window.disableSkill).mockResolvedValue(undefined);
  vi.mocked(window.enableSkill).mockResolvedValue(undefined);
});

const enabledSkill: SkillInfo = {
  name: 'my-skill',
  description: 'A test skill',
  path: '/skills/my-skill',
  enabled: true,
  type: 'custom',
};

const disabledSkill: SkillInfo = {
  name: 'my-skill',
  description: 'A test skill',
  path: '/skills/my-skill',
  enabled: false,
  type: 'custom',
};

test('should show "Disable skill" title when skill is enabled', () => {
  render(SkillEnabledColumn, { object: enabledSkill });

  expect(screen.getByTitle('Disable skill')).toBeInTheDocument();
});

test('should show "Enable skill" title when skill is disabled', () => {
  render(SkillEnabledColumn, { object: disabledSkill });

  expect(screen.getByTitle('Enable skill')).toBeInTheDocument();
});

test('should call disableSkill when toggling an enabled skill', async () => {
  render(SkillEnabledColumn, { object: enabledSkill });

  await fireEvent.click(screen.getByTitle('Disable skill'));

  expect(window.disableSkill).toHaveBeenCalledWith('my-skill');
});

test('should call enableSkill when toggling a disabled skill', async () => {
  render(SkillEnabledColumn, { object: disabledSkill });

  await fireEvent.click(screen.getByTitle('Enable skill'));

  expect(window.enableSkill).toHaveBeenCalledWith('my-skill');
});
