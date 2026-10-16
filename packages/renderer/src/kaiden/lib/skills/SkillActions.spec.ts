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

import SkillActions from './SkillActions.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

const managedSkill: SkillInfo = {
  name: 'my-skill',
  description: 'A test skill',
  path: '/skills/my-skill',
  enabled: true,
  managed: true,
};

const contributedSkill: SkillInfo = {
  name: 'ext-skill',
  description: 'An extension skill',
  path: '/ext/skills/ext-skill',
  enabled: true,
  managed: false,
};

test('should render the delete button for managed skills', () => {
  render(SkillActions, { object: managedSkill });

  expect(screen.getByTitle('Delete')).toBeInTheDocument();
});

test('should not render the delete button for extension-contributed skills', () => {
  render(SkillActions, { object: contributedSkill });

  expect(screen.queryByTitle('Delete')).not.toBeInTheDocument();
});
