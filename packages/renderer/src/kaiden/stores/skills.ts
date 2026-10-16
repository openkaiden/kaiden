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

import type { Writable } from 'svelte/store';
import { derived, writable } from 'svelte/store';

import { findMatchInLeaves } from '/@/stores/search-util';
import type { SkillInfo } from '/@api/skill/skill-info';

export const skillInfos: Writable<readonly SkillInfo[]> = writable([]);

export const skillSearchPattern = writable('');

export const filteredSkillInfos = derived([skillInfos, skillSearchPattern], ([$skillInfos, $skillSearchPattern]) => {
  let filtered = $skillInfos;

  if ($skillSearchPattern.trim().length) {
    filtered = filtered.filter(skill => findMatchInLeaves(skill, $skillSearchPattern));
  }

  return filtered;
});

export async function fetchSkills(): Promise<void> {
  const data = await window.listSkills();
  skillInfos.set(data);
}

window.events?.receive('skill-manager-update', () => {
  fetchSkills().catch((error: unknown) => {
    console.error('Failed to fetch skills', error);
  });
});

window.addEventListener('system-ready', () => {
  fetchSkills().catch((error: unknown) => {
    console.error('Failed to fetch skills', error);
  });
});
