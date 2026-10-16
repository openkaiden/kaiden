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

import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import type { SkillInfo } from '/@api/skill/skill-info';

import { fetchSkills, filteredSkillInfos, skillInfos, skillSearchPattern } from './skills';

beforeEach(() => {
  vi.resetAllMocks();
  skillInfos.set([]);
  skillSearchPattern.set('');
});

test('fetchSkills should call window.listSkills and update the store', async () => {
  const skills: SkillInfo[] = [
    { name: 'skill-a', description: 'First skill', path: '/skills/skill-a', enabled: true, managed: true },
    { name: 'skill-b', description: 'Second skill', path: '/skills/skill-b', enabled: false, managed: true },
  ];
  vi.mocked(window.listSkills).mockResolvedValue(skills);

  await fetchSkills();

  expect(window.listSkills).toHaveBeenCalled();
  expect(get(skillInfos)).toEqual(skills);
});

test('filteredSkillInfos should return all skills when search pattern is empty', () => {
  const skills: SkillInfo[] = [
    { name: 'skill-a', description: 'First skill', path: '/skills/skill-a', enabled: true, managed: true },
    { name: 'skill-b', description: 'Second skill', path: '/skills/skill-b', enabled: false, managed: true },
  ];
  skillInfos.set(skills);

  expect(get(filteredSkillInfos)).toHaveLength(2);
});

test('filteredSkillInfos should filter by search pattern', () => {
  const skills: SkillInfo[] = [
    { name: 'skill-a', description: 'First skill', path: '/skills/skill-a', enabled: true, managed: true },
    { name: 'skill-b', description: 'Second skill', path: '/skills/skill-b', enabled: false, managed: true },
  ];
  skillInfos.set(skills);
  skillSearchPattern.set('skill-a');

  expect(get(filteredSkillInfos)).toHaveLength(1);
  expect(get(filteredSkillInfos)[0].name).toBe('skill-a');
});

test('filteredSkillInfos should return empty when no skills match search', () => {
  const skills: SkillInfo[] = [
    { name: 'skill-a', description: 'First skill', path: '/skills/skill-a', enabled: true, managed: true },
  ];
  skillInfos.set(skills);
  skillSearchPattern.set('nonexistent');

  expect(get(filteredSkillInfos)).toHaveLength(0);
});
