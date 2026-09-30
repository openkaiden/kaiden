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

import { strict as assert } from 'node:assert';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AgentWorkspaceCreateOptions } from '/@api/agent-workspace-info.js';

import { updateWorkspaceConfig, writeWorkspaceConfig } from './workspace-config-writer.js';

vi.mock(import('node:fs/promises'));

function mockEnoent(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error('ENOENT');
  err.code = 'ENOENT';
  return err;
}

const defaultOptions: AgentWorkspaceCreateOptions = {
  sourcePath: '/tmp/my-project',
  agent: 'claude',
  model: 'anthropic::claude-sonnet-4::',
  gateway: 'kaiden',
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('writeWorkspaceConfig', () => {
  test('writes workspace.json with skills', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes', '/home/user/.kaiden/skills/code-review'],
    });

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes', '/home/user/.kaiden/skills/code-review']);
  });

  test('merges skills into existing workspace.json', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcp: { servers: [] } }));

    await writeWorkspaceConfig({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes'],
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcp).toEqual({ servers: [] });
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes']);
  });

  test('writes workspace.json with network', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      network: { mode: 'deny', hosts: ['registry.npmjs.org', 'pypi.org'] },
    });

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.network).toEqual({ mode: 'deny', hosts: ['registry.npmjs.org', 'pypi.org'] });
  });

  test('write empty workspace.json when no skills, network, secrets, mcp, mounts or workspaceConfiguration provided', async () => {
    vi.mocked(readFile).mockRejectedValue(mockEnoent());
    await writeWorkspaceConfig(defaultOptions);

    expect(writeFile).toHaveBeenCalled();
  });

  test('writes workspace.json with mounts', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      mounts: [
        { host: '/home/user/data', target: '/workspace/data', ro: false },
        { host: '$HOME/.gitconfig', target: '$HOME/.gitconfig', ro: true },
      ],
    });

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mounts).toEqual([
      { host: '/home/user/data', target: '/workspace/data', ro: false },
      { host: '$HOME/.gitconfig', target: '$HOME/.gitconfig', ro: true },
    ]);
  });

  test('merges mounts into existing workspace.json preserving other fields', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcp: { servers: [] }, network: { mode: 'allow' } }));

    await writeWorkspaceConfig({
      ...defaultOptions,
      mounts: [{ host: '$HOME', target: '$HOME', ro: false }],
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcp).toEqual({ servers: [] });
    expect(parsed.network).toEqual({ mode: 'allow' });
    expect(parsed.mounts).toEqual([{ host: '$HOME', target: '$HOME', ro: false }]);
  });

  test('merges network into existing workspace.json', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcp: { servers: [] } }));

    await writeWorkspaceConfig({
      ...defaultOptions,
      network: { mode: 'allow' },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcp).toEqual({ servers: [] });
    expect(parsed.network).toEqual({ mode: 'allow' });
  });

  test('writes workspace.json with both skills and network', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes'],
      network: { mode: 'deny', hosts: ['registry.npmjs.org'] },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes']);
    expect(parsed.network).toEqual({ mode: 'deny', hosts: ['registry.npmjs.org'] });
  });

  test('writes workspace.json with secrets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      secrets: ['github-token', 'anthropic-key'],
    });

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.secrets).toEqual(['github-token', 'anthropic-key']);
  });

  test('merges secrets into existing workspace.json preserving other fields', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ mcp: { servers: [] } }));

    await writeWorkspaceConfig({
      ...defaultOptions,
      secrets: ['github-token'],
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcp).toEqual({ servers: [] });
    expect(parsed.secrets).toEqual(['github-token']);
  });

  test('writes workspace.json with both skills and secrets', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes'],
      secrets: ['github-token', 'anthropic-key'],
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes']);
    expect(parsed.secrets).toEqual(['github-token', 'anthropic-key']);
  });

  test('writes workspace.json with command-based MCP servers and adds Python feature for uvx', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      mcp: {
        commands: [{ name: 'pypi-server', command: 'uvx', args: ['mcp-server==1.0.0'], env: { API_KEY: 'test' } }],
      },
    });

    const calls = vi.mocked(writeFile).mock.calls;
    const configCall = calls.find(c => String(c[0]).endsWith('workspace.json'));
    const parsed = JSON.parse(configCall![1] as string);
    expect(parsed.mcp.commands).toEqual([
      {
        name: 'pypi-server',
        command: 'uvx',
        args: ['mcp-server==1.0.0'],
        env: { API_KEY: 'test', UV_SYSTEM_CERTS: '1' },
      },
    ]);
    expect(parsed.features).toEqual({ './uv-feature': {} });
    expect(parsed.network).toBeUndefined();
  });

  test('writes workspace.json with both remote and command-based MCP servers', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      mcp: {
        servers: [{ name: 'github', url: 'https://mcp.github.com/sse' }],
        commands: [{ name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp'] }],
      },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mcp.servers).toEqual([{ name: 'github', url: 'https://mcp.github.com/sse' }]);
    expect(parsed.mcp.commands).toEqual([{ name: 'playwright', command: 'npx', args: ['-y', '@playwright/mcp'] }]);
    expect(parsed.features).toEqual({ 'ghcr.io/devcontainers/features/node:1': { version: '22' } });
  });

  test('preserves existing feature config rather than overwriting', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        features: { './uv-feature': { version: '3.12' } },
      }),
    );

    await writeWorkspaceConfig({
      ...defaultOptions,
      mcp: {
        commands: [{ name: 'pypi-server', command: 'uvx', args: ['mcp-server==1.0.0'] }],
      },
    });

    const calls = vi.mocked(writeFile).mock.calls;
    const configCall = calls.find(c => String(c[0]).endsWith('workspace.json'));
    const parsed = JSON.parse(configCall![1] as string);
    expect(parsed.features).toEqual({ './uv-feature': { version: '3.12' } });
  });

  test('writes workspace.json with environment and mounts from workspaceConfiguration', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      workspaceConfiguration: {
        environment: [
          { name: 'CLAUDE_CODE_USE_VERTEX', value: '1' },
          { name: 'CLOUD_ML_REGION', value: 'us-east5' },
        ],
        mounts: [
          {
            host: '$HOME/.config/gcloud/application_default_credentials.json',
            target: '$HOME/.config/gcloud/application_default_credentials.json',
            ro: true,
          },
        ],
      },
    });

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.environment).toEqual([
      { name: 'CLAUDE_CODE_USE_VERTEX', value: '1' },
      { name: 'CLOUD_ML_REGION', value: 'us-east5' },
    ]);
    expect(parsed.mounts).toEqual([
      {
        host: '$HOME/.config/gcloud/application_default_credentials.json',
        target: '$HOME/.config/gcloud/application_default_credentials.json',
        ro: true,
      },
    ]);
  });

  test('merges workspaceConfiguration environment into existing workspace.json', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ environment: [{ name: 'EXISTING_VAR', value: 'keep' }] }));

    await writeWorkspaceConfig({
      ...defaultOptions,
      workspaceConfiguration: {
        environment: [{ name: 'NEW_VAR', value: 'added' }],
      },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.environment).toEqual([
      { name: 'EXISTING_VAR', value: 'keep' },
      { name: 'NEW_VAR', value: 'added' },
    ]);
  });

  test('deduplicates environment entries by name keeping first occurrence', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ environment: [{ name: 'CLOUD_ML_REGION', value: 'existing-region' }] }),
    );

    await writeWorkspaceConfig({
      ...defaultOptions,
      workspaceConfiguration: {
        environment: [
          { name: 'CLOUD_ML_REGION', value: 'new-region' },
          { name: 'NEW_VAR', value: 'added' },
        ],
      },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.environment).toEqual([
      { name: 'CLOUD_ML_REGION', value: 'existing-region' },
      { name: 'NEW_VAR', value: 'added' },
    ]);
  });

  test('deduplicates mounts by host and target keeping first occurrence', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({
        mounts: [{ host: '$HOME/.config/gcloud/adc.json', target: '$HOME/.config/gcloud/adc.json', ro: true }],
      }),
    );

    await writeWorkspaceConfig({
      ...defaultOptions,
      workspaceConfiguration: {
        mounts: [
          { host: '$HOME/.config/gcloud/adc.json', target: '$HOME/.config/gcloud/adc.json', ro: false },
          { host: '$HOME/.ssh/config', target: '$HOME/.ssh/config', ro: true },
        ],
      },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.mounts).toEqual([
      { host: '$HOME/.config/gcloud/adc.json', target: '$HOME/.config/gcloud/adc.json', ro: true },
      { host: '$HOME/.ssh/config', target: '$HOME/.ssh/config', ro: true },
    ]);
  });

  test('merges workspaceConfiguration secrets with explicit secrets deduplicating', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      secrets: ['github-token', 'shared-secret'],
      workspaceConfiguration: {
        secrets: ['vertex-creds', 'shared-secret'],
      },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.secrets).toEqual(['github-token', 'shared-secret', 'vertex-creds']);
  });

  test('writes workspace.json with workspaceConfiguration alone when no other options set', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      workspaceConfiguration: {
        environment: [{ name: 'FOO', value: 'bar' }],
      },
    });

    expect(writeFile).toHaveBeenCalled();
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.environment).toEqual([{ name: 'FOO', value: 'bar' }]);
  });

  test('writes workspace.json combining workspaceConfiguration with explicit skills and network', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes'],
      network: { mode: 'deny', hosts: ['registry.npmjs.org'] },
      workspaceConfiguration: {
        environment: [{ name: 'CLAUDE_CODE_USE_VERTEX', value: '1' }],
        mounts: [{ host: '$HOME/.config/gcloud/adc.json', target: '$HOME/.config/gcloud/adc.json', ro: true }],
      },
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/home/user/.kaiden/skills/kubernetes']);
    expect(parsed.network).toEqual({ mode: 'deny', hosts: ['registry.npmjs.org'] });
    expect(parsed.environment).toEqual([{ name: 'CLAUDE_CODE_USE_VERTEX', value: '1' }]);
    expect(parsed.mounts).toEqual([
      { host: '$HOME/.config/gcloud/adc.json', target: '$HOME/.config/gcloud/adc.json', ro: true },
    ]);
  });

  test('writes workspace.json to overrideConfigDir when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig(
      { ...defaultOptions, sourcePath: undefined, skills: ['/path/to/skill'] },
      '/global/agent-workspaces/gw/my-sandbox',
    );

    expect(mkdir).toHaveBeenCalledWith('/global/agent-workspaces/gw/my-sandbox', { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join('/global/agent-workspaces/gw/my-sandbox', 'workspace.json'),
      expect.any(String),
      'utf-8',
    );
    const parsed = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(parsed.skills).toEqual(['/path/to/skill']);
  });

  test('falls back to sourcePath/.kaiden when overrideConfigDir is not provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig(defaultOptions);

    expect(mkdir).toHaveBeenCalledWith(join('/tmp/my-project', '.kaiden'), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(
      join('/tmp/my-project', '.kaiden', 'workspace.json'),
      expect.any(String),
      'utf-8',
    );
  });

  test('merges into existing config at overrideConfigDir', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ skills: ['/existing/skill'] }));

    await writeWorkspaceConfig(
      { ...defaultOptions, sourcePath: undefined, network: { mode: 'allow' } },
      '/global/agent-workspaces/gw/my-sandbox',
    );

    const parsed = JSON.parse(vi.mocked(writeFile).mock.calls[0]![1] as string);
    expect(parsed.skills).toEqual(['/existing/skill']);
    expect(parsed.network).toEqual({ mode: 'allow' });
  });

  test('preserves existing workspace.json secrets when no secrets provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockResolvedValue(
      JSON.stringify({ secrets: ['existing-secret'], skills: ['/home/user/.kaiden/skills/k8s'] }),
    );

    await writeWorkspaceConfig({
      ...defaultOptions,
      skills: ['/home/user/.kaiden/skills/kubernetes'],
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.secrets).toEqual(['existing-secret']);
  });

  test('writes description to workspace.json when provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      description: 'My workspace description',
    });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.description).toBe('My workspace description');
  });

  test('omits description from workspace.json when not provided', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig(defaultOptions);

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.description).toBeUndefined();
  });

  test('writes image to workspace.json when provided', async () => {
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig({
      ...defaultOptions,
      image: 'ghcr.io/my-org/my-custom-agent:1.0.0',
    });

    const call = vi.mocked(writeFile).mock.calls[0];
    assert(call, 'writeFile was not called');
    assert(typeof call[1] === 'string');
    const parsed = JSON.parse(call[1]);
    expect(parsed.image).toBe('ghcr.io/my-org/my-custom-agent:1.0.0');
  });

  test('omits image from workspace.json when not provided', async () => {
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await writeWorkspaceConfig(defaultOptions);

    const call = vi.mocked(writeFile).mock.calls[0];
    assert(call, 'writeFile was not called');
    assert(typeof call[1] === 'string');
    const parsed = JSON.parse(call[1]);
    expect(parsed.image).toBeUndefined();
  });

  test('clears existing image when not provided in options', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ image: 'existing-image:latest' }));

    await writeWorkspaceConfig(defaultOptions);

    const call = vi.mocked(writeFile).mock.calls[0];
    assert(call, 'writeFile was not called');
    assert(typeof call[1] === 'string');
    const parsed = JSON.parse(call[1]);
    expect(parsed.image).toBeUndefined();
  });
});

describe('updateWorkspaceConfig', () => {
  const CONFIG_DIR = '/tmp/ws1/.kaiden';

  test('merges update into existing workspace.json', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ skills: ['/path/to/skill1'] }));

    await updateWorkspaceConfig(CONFIG_DIR, { network: { mode: 'deny', hosts: ['api.example.com'] } });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/path/to/skill1']);
    expect(parsed.network).toEqual({ mode: 'deny', hosts: ['api.example.com'] });
  });

  test('creates new workspace.json when file does not exist', async () => {
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await updateWorkspaceConfig(CONFIG_DIR, { skills: ['/path/to/skill1'] });

    expect(writeFile).toHaveBeenCalledWith(join(CONFIG_DIR, 'workspace.json'), expect.any(String), 'utf-8');
    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/path/to/skill1']);
  });

  test('overwrites existing fields when update contains the same key', async () => {
    vi.mocked(readFile).mockResolvedValue(JSON.stringify({ skills: ['/old/skill'], network: { mode: 'allow' } }));

    await updateWorkspaceConfig(CONFIG_DIR, { skills: ['/new/skill'] });

    const writtenContent = vi.mocked(writeFile).mock.calls[0]![1] as string;
    const parsed = JSON.parse(writtenContent);
    expect(parsed.skills).toEqual(['/new/skill']);
    expect(parsed.network).toEqual({ mode: 'allow' });
  });

  test('propagates non-ENOENT read errors', async () => {
    const permError: NodeJS.ErrnoException = new Error('EACCES');
    permError.code = 'EACCES';
    vi.mocked(readFile).mockRejectedValue(permError);

    await expect(updateWorkspaceConfig(CONFIG_DIR, { skills: [] })).rejects.toThrow('EACCES');
  });

  test('writes to correct path under configurationPath', async () => {
    vi.mocked(readFile).mockRejectedValue(mockEnoent());

    await updateWorkspaceConfig('/custom/config/path', { ports: [8080] });

    expect(writeFile).toHaveBeenCalledWith(join('/custom/config/path', 'workspace.json'), expect.any(String), 'utf-8');
  });
});
