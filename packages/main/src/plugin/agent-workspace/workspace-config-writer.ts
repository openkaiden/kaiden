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

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { components as workspaceComponents } from '@openkaiden/workspace-configuration';

import type { WorkspaceRequirements } from '/@/plugin/mcp/package/mcp-spawner.js';
import { mcpSpawnerFactoryRegistry } from '/@/plugin/mcp/package/mcp-spawner-factory-registry.js';
import type { AgentWorkspaceCreateOptions } from '/@api/agent-workspace-info.js';

export type WorkspaceConfiguration = workspaceComponents['schemas']['WorkspaceConfiguration'];

export async function writeWorkspaceConfig(
  options: AgentWorkspaceCreateOptions,
  overrideConfigDir?: string,
): Promise<WorkspaceConfiguration> {
  const mcpServers = options.mcp?.servers;
  const mcpCommands = options.mcp?.commands;
  const hasSkills = !!options.skills?.length;
  const hasMcp = !!mcpServers?.length || !!mcpCommands?.length;
  const hasWsConfig = !!options.workspaceConfiguration;
  const hasMounts = !!options.mounts?.length;

  if (!overrideConfigDir && !options.sourcePath) {
    throw new Error('writeWorkspaceConfig requires either options.sourcePath or overrideConfigDir');
  }
  const configDir = overrideConfigDir ?? join(options.sourcePath!, '.kaiden');
  const configPath = join(configDir, 'workspace.json');
  await mkdir(configDir, { recursive: true });

  let existing: WorkspaceConfiguration = {};
  try {
    const content = await readFile(configPath, 'utf-8');
    existing = JSON.parse(content) as WorkspaceConfiguration;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  if (hasWsConfig) {
    const wc = options.workspaceConfiguration!;
    if (wc.environment?.length) {
      const merged = [...(existing.environment ?? []), ...wc.environment];
      const seen = new Set<string>();
      existing.environment = merged.filter(e => {
        if (seen.has(e.name)) return false;
        seen.add(e.name);
        return true;
      });
    }
    if (wc.mounts?.length) {
      const merged = [...(existing.mounts ?? []), ...wc.mounts];
      const seen = new Set<string>();
      existing.mounts = merged.filter(m => {
        const key = `${m.host}::${m.target}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  }

  if (options.description !== undefined) {
    existing.description = options.description;
  }

  if (options.image !== undefined) {
    existing.image = options.image;
  }

  if (hasSkills) {
    existing.skills = options.skills;
  }
  if (options.network !== undefined) {
    existing.network = options.network;
  }

  const wsConfigSecrets = options.workspaceConfiguration?.secrets ?? [];
  const explicitSecrets = options.secrets ?? [];
  if (explicitSecrets.length > 0 || wsConfigSecrets.length > 0) {
    const mergedSecrets = [...new Set([...explicitSecrets, ...wsConfigSecrets])];
    existing.secrets = mergedSecrets;
  }

  if (hasMounts) {
    existing.mounts = options.mounts;
  }

  if (hasMcp) {
    const reqsByCommand = new Map<string, WorkspaceRequirements | undefined>();
    for (const c of mcpCommands ?? []) {
      if (!reqsByCommand.has(c.command)) {
        reqsByCommand.set(c.command, mcpSpawnerFactoryRegistry.getByCommand(c.command)?.getWorkspaceRequirements());
      }
    }

    const mcp: WorkspaceConfiguration['mcp'] = {};
    if (mcpServers?.length) {
      mcp.servers = mcpServers.map(s => ({
        name: s.name,
        url: s.url,
        ...(s.headers && Object.keys(s.headers).length > 0 ? { headers: s.headers } : {}),
      }));
    }
    if (mcpCommands?.length) {
      mcp.commands = mcpCommands.map(c => {
        const reqs = reqsByCommand.get(c.command);
        const env = { ...reqs?.env, ...c.env };
        return {
          name: c.name,
          command: c.command,
          ...(c.args?.length ? { args: c.args } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
        };
      });
    }
    existing.mcp = mcp;

    const requiredHosts: string[] = [];
    for (const [, reqs] of reqsByCommand) {
      if (!reqs) continue;
      for (const [key, value] of Object.entries(reqs.features)) {
        existing.features = {
          ...existing.features,
          [key]: existing.features?.[key] ?? value,
        };
      }
      if (reqs.ensureFeatures) {
        await reqs.ensureFeatures(configDir);
      }
      requiredHosts.push(...reqs.hosts);
    }

    const network = existing.network;
    if (requiredHosts.length > 0 && network?.mode === 'deny' && Array.isArray(network.hosts)) {
      const missingHosts = requiredHosts.filter(h => !network.hosts!.includes(h));
      if (missingHosts.length > 0) {
        existing.network = {
          ...network,
          mode: 'deny',
          hosts: [...network.hosts!, ...missingHosts],
        };
      }
    }
  }

  const output = JSON.stringify(existing, undefined, 2) + '\n';
  await writeFile(configPath, output, 'utf-8');
  console.log(`[KdnCli] wrote workspace.json to ${configPath}`);
  return existing;
}

export async function updateWorkspaceConfig(
  configurationPath: string,
  update: Partial<WorkspaceConfiguration>,
): Promise<void> {
  const configPath = join(configurationPath, 'workspace.json');

  let existing: WorkspaceConfiguration = {};
  try {
    const content = await readFile(configPath, 'utf-8');
    existing = JSON.parse(content) as WorkspaceConfiguration;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }

  const merged = { ...existing, ...update };
  const output = JSON.stringify(merged, undefined, 2) + '\n';
  await writeFile(configPath, output, 'utf-8');
}
