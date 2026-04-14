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

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

import type { Configuration } from '@openkaiden/api';
import { inject, injectable, preDestroy } from 'inversify';
import { dump, load } from 'js-yaml';

import { IPCHandle } from '/@/plugin/api.js';
import { Directories } from '/@/plugin/directories.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationNode } from '/@api/configuration/models.js';
import { IConfigurationRegistry } from '/@api/configuration/models.js';
import type { IDisposable } from '/@api/disposable.js';
import {
  SKILL_ENABLED,
  SKILL_FILE_NAME,
  SKILL_REGISTERED,
  SKILL_SECTION,
  type SkillFileContent,
  type SkillFolderInfo,
  type SkillInfo,
  type SkillMetadata,
} from '/@api/skill/skill-info.js';

const RESERVED_WORDS = ['anthropic', 'claude'];
const XML_TAG_PATTERN = /<[a-zA-Z/][a-zA-Z0-9 "'=/]*>/;

@injectable()
export class SkillManager {
  private skills: SkillInfo[] = [];
  private skillFolders: SkillFolderInfo[] = [];
  private configuration: Configuration | undefined;
  private disposables: IDisposable[] = [];

  constructor(
    @inject(ApiSenderType) private readonly apiSender: ApiSenderType,
    @inject(IConfigurationRegistry) private readonly configurationRegistry: IConfigurationRegistry,
    @inject(Directories) private readonly directories: Directories,
    @inject(IPCHandle) private readonly ipcHandle: IPCHandle,
  ) {}

  /**
   * Discovers skills from the skills directory, registers IPC handlers,
   * and enables newly found skills by default.
   */
  async init(): Promise<void> {
    const skillsConfiguration: IConfigurationNode = {
      id: 'preferences.skills',
      title: 'Skills',
      type: 'object',
      properties: {
        [`${SKILL_SECTION}.${SKILL_ENABLED}`]: {
          description: 'Enabled skills',
          type: 'array',
          hidden: true,
        },
        [`${SKILL_SECTION}.${SKILL_REGISTERED}`]: {
          description: 'Registered external skill paths',
          type: 'array',
          hidden: true,
        },
      },
    };
    this.disposables.push(this.configurationRegistry.registerConfigurations([skillsConfiguration]));
    this.configuration = this.configurationRegistry.getConfiguration(SKILL_SECTION);

    this.skillFolders = [
      {
        label: 'Kaiden Skills',
        badge: 'Kaiden',
        baseDirectory: this.directories.getSkillsDirectory(),
      },
    ];

    await this.discoverSkills();

    this.ipcHandle('skill-manager:listSkills', async (): Promise<SkillInfo[]> => {
      return this.listSkills();
    });

    this.ipcHandle('skill-manager:listSkillFolders', async (): Promise<SkillFolderInfo[]> => {
      return this.listSkillFolders();
    });

    this.ipcHandle('skill-manager:registerSkill', async (_listener, folderPath: string): Promise<SkillInfo> => {
      return this.registerSkill(folderPath);
    });

    this.ipcHandle('skill-manager:disableSkill', async (_listener, name: string): Promise<void> => {
      return this.disableSkill(name);
    });

    this.ipcHandle('skill-manager:enableSkill', async (_listener, name: string): Promise<void> => {
      return this.enableSkill(name);
    });

    this.ipcHandle('skill-manager:unregisterSkill', async (_listener, name: string): Promise<void> => {
      return this.unregisterSkill(name);
    });

    this.ipcHandle(
      'skill-manager:createSkill',
      async (_listener, options: SkillFileContent, targetDirectory: string): Promise<SkillInfo> => {
        return this.createSkill(options, targetDirectory);
      },
    );

    this.ipcHandle('skill-manager:getSkillContent', async (_listener, name: string): Promise<string> => {
      return this.getSkillContent(name);
    });

    this.ipcHandle('skill-manager:listSkillFolderContent', async (_listener, name: string): Promise<string[]> => {
      return this.listSkillFolderContent(name);
    });

    this.ipcHandle(
      'skill-manager:getSkillFileContent',
      async (_listener, filePath: string): Promise<SkillFileContent> => {
        return this.getSkillFileContent(filePath);
      },
    );
  }

  /**
   * Parses a SKILL.md file, extracting YAML frontmatter (name, description)
   * and validating metadata against naming constraints.
   */
  async parseSkillFile(filePath: string): Promise<SkillMetadata> {
    const rawContent = (await readFile(filePath, 'utf-8')).trimStart();
    const metadata = this.extractFrontmatter(rawContent, filePath);
    this.validateMetadata(metadata, filePath);
    return metadata;
  }

  private extractFrontmatter(rawContent: string, filePath: string): SkillMetadata {
    const DELIMITER = '---';
    if (!rawContent.startsWith(DELIMITER)) {
      throw new Error(`No metadata found in ${filePath}`);
    }

    const endIndex = rawContent.indexOf(`\n${DELIMITER}`, DELIMITER.length);
    if (endIndex === -1) {
      throw new Error(`Unclosed metadata block in ${filePath}`);
    }

    const yamlBlock = rawContent.slice(DELIMITER.length + 1, endIndex);
    const parsed = load(yamlBlock);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error(`Invalid metadata in ${filePath}`);
    }

    return parsed as SkillMetadata;
  }

  private stripFrontmatter(content: string): string {
    const trimmed = content.trimStart();
    const DELIMITER = '---';
    if (!trimmed.startsWith(DELIMITER)) return content;
    const endIndex = trimmed.indexOf(`\n${DELIMITER}`, DELIMITER.length);
    if (endIndex === -1) return content;
    return trimmed.slice(endIndex + DELIMITER.length + 2).trim();
  }

  private validateMetadata(metadata: SkillMetadata, filePath: string): void {
    if (typeof metadata.name !== 'string' || !metadata.name) {
      throw new Error(`Missing or invalid 'name' in ${filePath}`);
    }

    // Requirements specified in the Claude documentation:
    // https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview#skill-structure
    if (metadata.name.length > 64) {
      throw new Error(`'name' exceeds 64 characters in ${filePath}`);
    }
    if (!/^[a-z0-9-]+$/.test(metadata.name)) {
      throw new Error(`'name' must contain only lowercase letters, numbers, and hyphens in ${filePath}`);
    }
    if (RESERVED_WORDS.some(word => metadata.name.includes(word))) {
      throw new Error(`'name' contains a reserved word in ${filePath}`);
    }
    if (XML_TAG_PATTERN.test(metadata.name)) {
      throw new Error(`'name' must not contain XML tags in ${filePath}`);
    }

    if (typeof metadata.description !== 'string' || !metadata.description) {
      throw new Error(`Missing or invalid 'description' in ${filePath}`);
    }
    if (metadata.description.length > 1024) {
      throw new Error(`'description' exceeds 1024 characters in ${filePath}`);
    }
    if (XML_TAG_PATTERN.test(metadata.description)) {
      throw new Error(`'description' must not contain XML tags in ${filePath}`);
    }
  }

  /**
   * Registers a skill from an external folder by storing a reference to its
   * path. The original folder is not copied. The skill is enabled immediately
   * and the reference is persisted to config.
   */
  async registerSkill(folderPath: string): Promise<SkillInfo> {
    const resolvedPath = resolve(folderPath);
    const skillFilePath = join(resolvedPath, SKILL_FILE_NAME);

    if (!existsSync(skillFilePath)) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${resolvedPath}`);
    }

    const metadata = await this.parseSkillFile(skillFilePath);
    this.assertNoDuplicate(metadata.name);

    const skill: SkillInfo = {
      ...metadata,
      path: resolvedPath,
      enabled: true,
      managed: this.isInsideManagedDirectory(resolvedPath),
    };

    this.skills = [...this.skills, skill];
    this.saveAndNotifySkills();
    return skill;
  }

  /**
   * Creates a new skill by writing a SKILL.md file with the given name,
   * description, and content into the skills directory. The skill is
   * enabled immediately and persisted to config.
   */
  async createSkill(options: SkillFileContent, targetDirectory: string): Promise<SkillInfo> {
    if (!options.content) {
      throw new Error('Content must be provided');
    }

    this.validateSkillFolder(targetDirectory);

    const metadata: SkillMetadata = { name: options.name, description: options.description };
    this.validateMetadata(metadata, SKILL_FILE_NAME);
    this.assertNoDuplicate(metadata.name);

    const skillDir = join(targetDirectory, metadata.name);

    if (existsSync(skillDir)) {
      throw new Error(`Skill directory already exists: ${skillDir}`);
    }

    await mkdir(skillDir, { recursive: true });

    const body = this.stripFrontmatter(options.content);
    const frontmatter = dump({ name: metadata.name, description: metadata.description }).trimEnd();
    const fileContent = `---\n${frontmatter}\n---\n\n${body}`;
    await writeFile(join(skillDir, SKILL_FILE_NAME), fileContent, 'utf-8');

    if (options.sourcePath) {
      const sourceDir = dirname(options.sourcePath);
      const entries = await readdir(sourceDir);
      for (const entry of entries) {
        if (entry === SKILL_FILE_NAME) continue;
        await cp(join(sourceDir, entry), join(skillDir, entry), { recursive: true });
      }
    }

    const skill: SkillInfo = {
      ...metadata,
      path: skillDir,
      enabled: true,
      managed: this.isInsideManagedDirectory(skillDir),
    };
    this.skills = [...this.skills, skill];
    this.saveAndNotifySkills();
    return skill;
  }

  registerSkillFolder(folder: SkillFolderInfo): IDisposable {
    if (this.skillFolders.some(f => f.baseDirectory === folder.baseDirectory)) {
      throw new Error(`Skill folder '${folder.baseDirectory}' is already registered`);
    }
    this.skillFolders = [...this.skillFolders, folder];
    this.apiSender.send('skill-folders-update');

    this.discoverSkillsInDirectory(folder.baseDirectory).catch(console.error);

    return {
      dispose: (): void => {
        this.skillFolders = this.skillFolders.filter(f => f.baseDirectory !== folder.baseDirectory);
        const resolvedRoot = resolve(folder.baseDirectory);
        this.skills = this.skills.filter(s => {
          const resolvedPath = resolve(s.path);
          return resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${sep}`);
        });
        this.saveSkillsToConfig();
        this.apiSender.send('skill-folders-update');
        this.apiSender.send('skill-manager-update');
      },
    };
  }

  listSkillFolders(): SkillFolderInfo[] {
    return this.skillFolders;
  }

  private validateSkillFolder(directory: string): void {
    if (!this.listSkillFolders().some(f => f.baseDirectory === directory)) {
      throw new Error(`Unknown skill folder: '${directory}'`);
    }
  }

  disableSkill(name: string): void {
    this.setSkillEnabled(name, false);
  }

  enableSkill(name: string): void {
    this.setSkillEnabled(name, true);
  }

  /**
   * Removes a managed skill from the registry, deleting it from disk.
   * Extension-contributed skills cannot be deleted.
   */
  async unregisterSkill(name: string): Promise<void> {
    const skill = this.findSkillByName(name);
    if (!skill.managed) {
      throw new Error(`Cannot delete extension-contributed skill '${name}'`);
    }
    await rm(skill.path, { recursive: true, force: true });
    this.skills = this.skills.filter(s => s.name !== name);
    this.saveAndNotifySkills();
  }

  listSkills(): SkillInfo[] {
    return this.skills;
  }

  /** Returns the raw SKILL.md file content for the given skill. */
  async getSkillContent(name: string): Promise<string> {
    const skill = this.findSkillByName(name);
    const filePath = join(skill.path, SKILL_FILE_NAME);
    return readFile(filePath, 'utf-8');
  }

  /**
   * Helper to read a SKILL.md file by path and return parsed metadata
   * and body content. Used by the renderer to preview and prefill the
   * create-skill dialog before submission.
   */
  async getSkillFileContent(filePath: string): Promise<SkillFileContent> {
    const rawContent = (await readFile(filePath, 'utf-8')).trimStart();
    const metadata = this.extractFrontmatter(rawContent, filePath);
    const body = this.stripFrontmatter(rawContent);
    return { name: metadata.name, description: metadata.description, content: body };
  }

  /** Lists all file/directory names inside the skill's folder. */
  async listSkillFolderContent(name: string): Promise<string[]> {
    const skill = this.findSkillByName(name);
    return readdir(skill.path);
  }

  private findSkillByName(name: string): SkillInfo {
    const skill = this.skills.find(s => s.name === name);
    if (!skill) {
      throw new Error(`Skill not found with name: ${name}`);
    }
    return skill;
  }

  private assertNoDuplicate(name: string): void {
    const existing = this.skills.find(s => s.name === name);
    if (existing) {
      throw new Error(`Skill with name '${name}' already registered at path: ${existing.path}`);
    }
  }

  private setSkillEnabled(name: string, enabled: boolean): void {
    const skill = this.findSkillByName(name);
    skill.enabled = enabled;
    this.skills = [...this.skills];
    this.saveAndNotifySkills();
  }

  private saveAndNotifySkills(): void {
    this.saveSkillsToConfig();
    this.apiSender.send('skill-manager-update');
  }

  private isInsideManagedDirectory(skillPath: string): boolean {
    const resolvedSkillPath = resolve(skillPath);
    const resolvedRoot = resolve(this.directories.getSkillsDirectory());
    return resolvedSkillPath === resolvedRoot || resolvedSkillPath.startsWith(`${resolvedRoot}${sep}`);
  }

  /**
   * Discovers skills from all registered folders and externally
   * registered paths persisted in `skills.registered` config.
   */
  private async discoverSkills(): Promise<void> {
    for (const folder of this.skillFolders) {
      await this.discoverSkillsInDirectory(folder.baseDirectory);
    }
    const externalPaths: string[] = this.configuration?.get<string[]>(SKILL_REGISTERED) ?? [];
    await this.processDiscoveredPaths(externalPaths);
  }

  /**
   * Discovers skills from a single directory. Used by
   * {@link registerSkillFolder} so that each new folder triggers
   * discovery only for its own base directory.
   */
  private async discoverSkillsInDirectory(directory: string): Promise<void> {
    if (!existsSync(directory)) return;
    const folderPaths: string[] = [];
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          folderPaths.push(join(directory, entry.name));
        }
      }
    } catch {
      return;
    }
    await this.processDiscoveredPaths(folderPaths);
  }

  private async processDiscoveredPaths(folderPaths: string[]): Promise<void> {
    const enabledNames = new Set<string>(this.configuration?.get<string[]>(SKILL_ENABLED) ?? []);
    const discovered: SkillInfo[] = [];

    for (const folderPath of folderPaths) {
      const skillFilePath = join(folderPath, SKILL_FILE_NAME);
      if (!existsSync(skillFilePath)) {
        continue;
      }

      try {
        const metadata = await this.parseSkillFile(skillFilePath);
        if (this.skills.some(s => s.name === metadata.name) || discovered.some(s => s.name === metadata.name)) {
          continue;
        }
        discovered.push({
          ...metadata,
          path: folderPath,
          enabled: enabledNames.has(metadata.name) || !enabledNames.size,
          managed: this.isInsideManagedDirectory(folderPath),
        });
      } catch (error: unknown) {
        console.warn(`[SkillManager] Skipping invalid skill at ${folderPath}: ${error}`);
      }
    }

    // Re-check against this.skills at merge time to guard against
    // concurrent calls that may have appended the same skills.
    const existingNames = new Set(this.skills.map(s => s.name));
    const unique = discovered.filter(s => !existingNames.has(s.name));

    if (unique.length > 0) {
      this.skills = [...this.skills, ...unique];
      if (unique.some(s => !enabledNames.has(s.name))) {
        this.saveSkillsToConfig();
      }
      this.apiSender.send('skill-manager-update');
    }
  }

  /** Persists enabled skill names and external skill paths to config. */
  private saveSkillsToConfig(): void {
    const enabledNames = this.skills.filter(s => s.enabled).map(s => s.name);
    this.configuration?.update(SKILL_ENABLED, enabledNames).catch(console.error);

    const registeredPaths = this.skills.filter(s => !s.managed).map(s => s.path);
    this.configuration?.update(SKILL_REGISTERED, registeredPaths).catch(console.error);
  }

  @preDestroy()
  dispose(): void {
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
