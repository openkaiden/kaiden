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

export interface SkillMetadata {
  name: string;
  description: string;
}

export interface SkillInfo extends SkillMetadata {
  path: string;
  enabled: boolean;
  managed: boolean;
}

export interface SkillFolderInfo {
  label: string;
  badge: string;
  icon?: string;
  baseDirectory: string;
}

export interface SkillFileContent extends SkillMetadata {
  content?: string;
  sourcePath?: string;
}

export const SKILL_SECTION = 'skills';
export const SKILL_ENABLED = 'enabled';
export const SKILL_REGISTERED = 'registered';
export const SKILL_FILE_NAME = 'SKILL.md';
