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

import type { Addon, Agent } from '@openkaiden/api';
import { afterEach, assert, beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import type { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { CatalogModelInfo } from '/@api/model-registry-info.js';
import type { ProviderInfo } from '/@api/provider-info.js';

import { AddonRegistry } from './addon-registry.js';
import { AgentRegistry } from './agent-registry.js';
import type { ModelRegistry } from './model-registry.js';
import type { ProviderRegistry } from './provider-registry.js';

const apiSender: ApiSenderType = {
  send: vi.fn(),
  receive: vi.fn(),
};

const modelRegistry: ModelRegistry = {
  getCatalogModels: vi.fn(),
  onChange: vi.fn(),
} as unknown as ModelRegistry;

const providerRegistry: ProviderRegistry = {
  getProviderInfos: vi.fn(),
  onDidSetConnectionFactory: vi.fn(),
  onDidUnsetConnectionFactory: vi.fn(),
} as unknown as ProviderRegistry;

vi.mock(import('./addon-registry.js'));

const ipcHandle: IPCHandle = vi.fn();
const addonRegistry = new AddonRegistry(apiSender, ipcHandle);

let addonsChanged: Emitter<void>;
let agentRegistry: AgentRegistry;

function mockRegisteredAddons(addons: Addon[]): void {
  vi.mocked(AddonRegistry.prototype.getAddon).mockImplementation(id => addons.find(addon => addon.id === id));
}

function createAgent(overrides?: Partial<Agent>): Agent {
  return {
    id: 'test-agent',
    name: 'Test Agent',
    description: 'A test agent',
    command: 'test-cmd',
    configurationFiles: [],
    destinationSkillsFolder: '/home/test/.test-agent/skills',
    async preWorkspaceStart(): Promise<void> {
      throw new Error('not implemented');
    },
    ...overrides,
  };
}

function createCatalogModel(llmMetadataName?: string): CatalogModelInfo {
  return {
    providerId: 'provider-1',
    providerName: 'Provider 1',
    connectionId: 'conn-0',
    connectionName: 'connection-1',
    type: 'cloud',
    label: 'model-label',
    connectionStatus: 'started',
    llmMetadata: llmMetadataName ? { name: llmMetadataName } : undefined,
  };
}

function createProviderInfo(llmMetadataName?: string): ProviderInfo {
  return {
    id: 'provider-1',
    name: 'Provider 1',
    internalId: 'internal-1',
    status: 'started',
    inferenceProviderConnectionCreationLLMMetadata: llmMetadataName ? { name: llmMetadataName } : undefined,
  } as unknown as ProviderInfo;
}

describe('AgentRegistry', () => {
  beforeEach(() => {
    // Automocked classes do not get instance fields, so expose the event the agent registry subscribes to.
    addonsChanged = new Emitter<void>();
    Object.defineProperty(addonRegistry, 'onDidChange', { value: addonsChanged.event, configurable: true });
    agentRegistry = new AgentRegistry(apiSender, modelRegistry, providerRegistry, addonRegistry);
    vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([]);
    vi.mocked(providerRegistry.getProviderInfos).mockReturnValue([]);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('registerAgent', () => {
    test('sends agent-registry:create event via apiSender', () => {
      const agent = createAgent();
      agentRegistry.registerAgent(agent);

      expect(apiSender.send).toHaveBeenCalledWith('agent-registry:create', agent.id);
    });

    test('fires onDidRegisterAgent event with the agent', () => {
      const listener = vi.fn();
      agentRegistry.onDidRegisterAgent(listener);

      const agent = createAgent();
      agentRegistry.registerAgent(agent);

      expect(listener).toHaveBeenCalledWith({ agent });
    });

    test('throws when registering duplicate agent id', () => {
      const agent = createAgent();
      agentRegistry.registerAgent(agent);

      expect(() => agentRegistry.registerAgent(agent)).toThrow(`Agent with id 'test-agent' is already registered`);
    });

    test('returns a Disposable that removes the agent', async () => {
      const agent = createAgent();
      const disposable = agentRegistry.registerAgent(agent);

      expect(await agentRegistry.getAgentInfos()).toHaveLength(1);

      disposable.dispose();

      expect(await agentRegistry.getAgentInfos()).toHaveLength(0);
    });

    test('dispose sends agent-registry:remove event', () => {
      const agent = createAgent();
      const disposable = agentRegistry.registerAgent(agent);

      disposable.dispose();

      expect(apiSender.send).toHaveBeenCalledWith('agent-registry:remove', agent.id);
    });

    test('dispose fires onDidUnregisterAgent event', () => {
      const listener = vi.fn();
      agentRegistry.onDidUnregisterAgent(listener);

      const agent = createAgent();
      const disposable = agentRegistry.registerAgent(agent);
      disposable.dispose();

      expect(listener).toHaveBeenCalledWith({ id: agent.id });
    });
  });

  describe('getAgentInfos', () => {
    test('returns empty array when no agents registered', async () => {
      expect(await agentRegistry.getAgentInfos()).toEqual([]);
    });

    test('returns agent info for registered agents', async () => {
      const agent = createAgent({ tags: ['cloud', 'recommended'] });
      agentRegistry.registerAgent(agent);

      const infos = await agentRegistry.getAgentInfos();
      expect(infos).toHaveLength(1);
      expect(infos[0]).toEqual(
        expect.objectContaining({
          id: 'test-agent',
          name: 'Test Agent',
          description: 'A test agent',
          tags: ['cloud', 'recommended'],
        }),
      );
    });

    test('returns multiple agents', async () => {
      agentRegistry.registerAgent(createAgent({ id: 'agent-1', name: 'Agent 1' }));
      agentRegistry.registerAgent(createAgent({ id: 'agent-2', name: 'Agent 2' }));

      const infos = await agentRegistry.getAgentInfos();
      expect(infos).toHaveLength(2);
    });

    test('caches agentInfo after first call', async () => {
      const isSupportedModelType = vi.fn().mockReturnValue(true);
      agentRegistry.registerAgent(createAgent({ isSupportedModelType }));
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([createCatalogModel('anthropic')]);

      await agentRegistry.getAgentInfos();
      await agentRegistry.getAgentInfos();

      expect(isSupportedModelType).toHaveBeenCalledTimes(1);
    });
  });

  describe('getAgent', () => {
    test('returns undefined for unknown id', async () => {
      expect(await agentRegistry.getAgent('unknown')).toBeUndefined();
    });

    test('returns agent info for known id', async () => {
      const agent = createAgent();
      agentRegistry.registerAgent(agent);

      const result = await agentRegistry.getAgent('test-agent');
      expect(result).toBeDefined();
      expect(result!.name).toBe('Test Agent');
    });
  });

  describe('addonImages', () => {
    const first: Addon = {
      id: 'kaiden.first',
      name: 'first',
      displayName: 'First',
      publisher: { name: 'kaiden', displayName: 'Kaiden' },
      ociImage: 'ghcr.io/my-org/first@sha256:1111',
    };
    const second: Addon = {
      id: 'kaiden.second',
      name: 'second',
      displayName: 'Second',
      publisher: { name: 'kaiden', displayName: 'Kaiden' },
      ociImage: 'ghcr.io/my-org/second@sha256:2222',
    };

    test('resolves the image of a single addon id', async () => {
      mockRegisteredAddons([first, second]);
      agentRegistry.registerAgent(createAgent({ addonIds: 'kaiden.second' }));
      const info = await agentRegistry.getAgent('test-agent');
      assert(info);
      expect(info.addonImages).toStrictEqual([second.ociImage]);
    });

    test('resolves the images of a list of addon ids in order, skipping unregistered ones', async () => {
      mockRegisteredAddons([first, second]);
      agentRegistry.registerAgent(createAgent({ addonIds: ['kaiden.second', 'kaiden.missing', 'kaiden.first'] }));
      const [info] = await agentRegistry.getAgentInfos();
      assert(info);
      expect(info.addonImages).toStrictEqual([second.ociImage, first.ociImage]);
    });

    test('is empty when no addon with the id is registered', async () => {
      mockRegisteredAddons([]);
      agentRegistry.registerAgent(createAgent({ addonIds: 'kaiden.missing' }));
      const info = await agentRegistry.getAgent('test-agent');
      assert(info);
      expect(info.addonImages).toStrictEqual([]);
    });

    test('is undefined when the agent has no addonIds', async () => {
      mockRegisteredAddons([first]);
      agentRegistry.registerAgent(createAgent());
      const info = await agentRegistry.getAgent('test-agent');
      assert(info);
      expect(info.addonImages).toBeUndefined();
    });

    test('invalidates cached agent infos and notifies the renderer when addons change', async () => {
      mockRegisteredAddons([]);
      agentRegistry.registerAgent(createAgent({ addonIds: 'kaiden.first' }));
      const before = await agentRegistry.getAgent('test-agent');
      assert(before);
      expect(before.addonImages).toStrictEqual([]);

      mockRegisteredAddons([first]);
      addonsChanged.fire();

      expect(apiSender.send).toHaveBeenCalledWith('agent-registry:updated');
      const after = await agentRegistry.getAgent('test-agent');
      assert(after);
      expect(after.addonImages).toStrictEqual([first.ociImage]);
    });
  });

  describe('getAgentRegistration', () => {
    test('returns undefined for unknown id', () => {
      expect(agentRegistry.getAgentRegistration('unknown')).toBeUndefined();
    });

    test('returns the raw Agent object for known id', () => {
      const agent = createAgent();
      agentRegistry.registerAgent(agent);

      const result = agentRegistry.getAgentRegistration('test-agent');
      expect(result).toBe(agent);
    });

    test('returns undefined after agent is disposed', () => {
      const agent = createAgent();
      const disposable = agentRegistry.registerAgent(agent);
      disposable.dispose();

      expect(agentRegistry.getAgentRegistration('test-agent')).toBeUndefined();
    });
  });

  describe('getModelTypes', () => {
    test('filters model types using isSupportedModelType callback', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([
        createCatalogModel('anthropic'),
        createCatalogModel('openai'),
        createCatalogModel('gemini'),
      ]);

      const result = await agentRegistry.getModelTypes(type => type.name === 'anthropic');
      expect(result).toEqual([{ name: 'anthropic' }]);
    });

    test('deduplicates model types', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([
        createCatalogModel('anthropic'),
        createCatalogModel('anthropic'),
      ]);

      const result = await agentRegistry.getModelTypes(() => true);
      expect(result).toEqual([{ name: 'anthropic' }]);
    });

    test('skips models without llmMetadata name', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([
        createCatalogModel(),
        createCatalogModel('anthropic'),
      ]);

      const result = await agentRegistry.getModelTypes(() => true);
      expect(result).toEqual([{ name: 'anthropic' }]);
    });

    test('supports async callback', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([createCatalogModel('anthropic')]);

      const result = await agentRegistry.getModelTypes(async type => type.name === 'anthropic');
      expect(result).toEqual([{ name: 'anthropic' }]);
    });

    test('includes model types from factory llmMetadata when no catalog models exist', async () => {
      vi.mocked(providerRegistry.getProviderInfos).mockReturnValue([createProviderInfo('anthropic')]);

      const result = await agentRegistry.getModelTypes(() => true);
      expect(result).toEqual([{ name: 'anthropic' }]);
    });

    test('deduplicates model types between catalog models and factory metadata', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([createCatalogModel('anthropic')]);
      vi.mocked(providerRegistry.getProviderInfos).mockReturnValue([createProviderInfo('anthropic')]);

      const result = await agentRegistry.getModelTypes(() => true);
      expect(result).toEqual([{ name: 'anthropic' }]);
    });

    test('combines model types from catalog models and factory metadata', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([createCatalogModel('openai')]);
      vi.mocked(providerRegistry.getProviderInfos).mockReturnValue([createProviderInfo('anthropic')]);

      const result = await agentRegistry.getModelTypes(() => true);
      expect(result).toEqual([{ name: 'openai' }, { name: 'anthropic' }]);
    });

    test('skips providers without factory llmMetadata', async () => {
      vi.mocked(providerRegistry.getProviderInfos).mockReturnValue([createProviderInfo()]);

      const result = await agentRegistry.getModelTypes(() => true);
      expect(result).toEqual([]);
    });

    test('filters factory model types through isSupportedModelType callback', async () => {
      vi.mocked(providerRegistry.getProviderInfos).mockReturnValue([createProviderInfo('anthropic')]);

      const result = await agentRegistry.getModelTypes(type => type.name !== 'anthropic');
      expect(result).toEqual([]);
    });
  });

  describe('toAgentInfo', () => {
    test('returns agent info without supported types when callbacks absent', async () => {
      const agent = createAgent();
      const info = await agentRegistry.toAgentInfo(agent);

      expect(info).toEqual({
        id: 'test-agent',
        name: 'Test Agent',
        description: 'A test agent',
        icon: undefined,
        tags: undefined,
        command: 'test-cmd',
        acp: undefined,
        baseImage: undefined,
        destinationSkillsFolder: '/home/test/.test-agent/skills',
        supportedModelTypes: undefined,
      });
    });

    test('includes baseImage when set on the agent', async () => {
      const agent = createAgent({ baseImage: 'ghcr.io/my-org/my-image:latest' });
      const info = await agentRegistry.toAgentInfo(agent);
      expect(info.baseImage).toBe('ghcr.io/my-org/my-image:latest');
    });

    test('passes through command and acp configuration', async () => {
      const agent = createAgent({
        command: 'goose',
        acp: { args: ['acp'] },
      });

      const info = await agentRegistry.toAgentInfo(agent);
      expect(info.command).toBe('goose');
      expect(info.acp).toEqual({ args: ['acp'] });
    });

    test('passes through command without acp', async () => {
      const agent = createAgent({
        command: 'claude',
      });

      const info = await agentRegistry.toAgentInfo(agent);
      expect(info.command).toBe('claude');
      expect(info.acp).toBeUndefined();
    });

    test('populates supportedModelTypes when isSupportedModelType is provided', async () => {
      vi.mocked(modelRegistry.getCatalogModels).mockReturnValue([
        createCatalogModel('anthropic'),
        createCatalogModel('openai'),
      ]);
      const agent = createAgent({
        isSupportedModelType: type => type.name === 'anthropic',
      });

      const info = await agentRegistry.toAgentInfo(agent);
      expect(info.supportedModelTypes).toEqual([{ name: 'anthropic' }]);
    });

    test('passes through skillsFolder', async () => {
      const agent = createAgent({
        destinationSkillsFolder: '/home/user/.claude/skills',
      });

      const info = await agentRegistry.toAgentInfo(agent);
      expect(info.destinationSkillsFolder).toBe('/home/user/.claude/skills');
    });

    test('includes icon and tags', async () => {
      const agent = createAgent({
        icon: { icon: 'my-icon', logo: 'my-logo' },
        tags: ['cloud', 'recommended'],
      });

      const info = await agentRegistry.toAgentInfo(agent);
      expect(info.icon).toEqual({ icon: 'my-icon', logo: 'my-logo' });
      expect(info.tags).toEqual(['cloud', 'recommended']);
    });
  });
});
