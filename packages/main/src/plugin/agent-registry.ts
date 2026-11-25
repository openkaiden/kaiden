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

import type { Agent, AgentRegisteredEvent, AgentUnregisteredEvent, ModelType } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { AddonRegistry } from '/@/plugin/addon-registry.js';
import { ModelRegistry } from '/@/plugin/model-registry.js';
import { ProviderRegistry } from '/@/plugin/provider-registry.js';
import type { AgentInfo } from '/@api/agent-info.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { Event } from '/@api/event.js';

import { Emitter } from './events/emitter.js';
import { Disposable } from './types/disposable.js';

type AgentRegistration = {
  agent: Agent;
  agentInfo?: AgentInfo;
};

@injectable()
export class AgentRegistry {
  constructor(
    @inject(ApiSenderType) private apiSender: ApiSenderType,
    @inject(ModelRegistry) private modelRegistry: ModelRegistry,
    @inject(ProviderRegistry) private providerRegistry: ProviderRegistry,
    @inject(AddonRegistry) private addonRegistry: AddonRegistry,
  ) {
    modelRegistry.onChange(() => this.invalidate());
    addonRegistry.onDidChange(() => this.invalidate());
    providerRegistry.onDidSetConnectionFactory(e => {
      if (e.type === 'inference') {
        this.invalidate();
      }
    });
    providerRegistry.onDidUnsetConnectionFactory(e => {
      if (e.type === 'inference') {
        this.invalidate();
      }
    });
  }

  private agentRegistrations = new Map<string, AgentRegistration>();

  private readonly _onDidRegisterAgent = new Emitter<AgentRegisteredEvent>();
  readonly onDidRegisterAgent: Event<AgentRegisteredEvent> = this._onDidRegisterAgent.event;

  private readonly _onDidUnregisterAgent = new Emitter<AgentUnregisteredEvent>();
  readonly onDidUnregisterAgent: Event<AgentUnregisteredEvent> = this._onDidUnregisterAgent.event;

  async getModelTypes(isSupportedModelType: (type: ModelType) => boolean | Promise<boolean>): Promise<ModelType[]> {
    const modelTypes = this.modelRegistry.getCatalogModels().reduce((llmMetadatas: string[], model) => {
      if (model.llmMetadata?.name !== undefined && !llmMetadatas.includes(model.llmMetadata.name)) {
        llmMetadatas.push(model.llmMetadata.name);
      }
      return llmMetadatas;
    }, []);
    for (const provider of this.providerRegistry.getProviderInfos()) {
      const factoryName = provider.inferenceProviderConnectionCreationLLMMetadata?.name;
      if (factoryName !== undefined && !modelTypes.includes(factoryName)) {
        modelTypes.push(factoryName);
      }
    }
    const result = [];
    for (const modelType of modelTypes) {
      if (await isSupportedModelType({ name: modelType })) {
        result.push({ name: modelType });
      }
    }
    return result;
  }

  invalidate(): void {
    this.agentRegistrations.values().forEach(agentRegistration => {
      agentRegistration.agentInfo = undefined;
    });
    this.apiSender.send('agent-registry:updated');
  }

  async toAgentInfo(agent: Agent): Promise<AgentInfo> {
    const supportedModelTypes = agent.isSupportedModelType
      ? await this.getModelTypes(agent.isSupportedModelType)
      : undefined;
    return {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      icon: agent.icon,
      tags: agent.tags,
      command: agent.command,
      acp: agent.acp,
      baseImage: agent.baseImage,
      addonImages: this.getAddonImages(agent),
      destinationSkillsFolder: agent.destinationSkillsFolder,
      supportedModelTypes,
    };
  }

  registerAgent(agent: Agent): Disposable {
    if (this.agentRegistrations.has(agent.id)) {
      throw new Error(`Agent with id '${agent.id}' is already registered`);
    }

    this.agentRegistrations.set(agent.id, { agent });
    this.apiSender.send('agent-registry:create', agent.id);
    this._onDidRegisterAgent.fire({ agent });

    return Disposable.create(() => {
      this.agentRegistrations.delete(agent.id);
      this.apiSender.send('agent-registry:remove', agent.id);
      this._onDidUnregisterAgent.fire({ id: agent.id });
    });
  }

  async getAgentInfos(): Promise<ReadonlyArray<AgentInfo>> {
    const agentRegistrations = this.agentRegistrations.values();
    for (const agentRegistration of agentRegistrations) {
      agentRegistration.agentInfo ??= await this.toAgentInfo(agentRegistration.agent);
    }
    return Array.from(this.agentRegistrations.values(), agentRegistration => agentRegistration.agentInfo!);
  }

  async getAgent(id: string): Promise<Readonly<AgentInfo> | undefined> {
    const agentRegistration = this.agentRegistrations.get(id);
    if (agentRegistration === undefined) {
      return undefined;
    }
    agentRegistration.agentInfo ??= await this.toAgentInfo(agentRegistration.agent);
    return agentRegistration.agentInfo;
  }

  /** Images of the registered addons providing the agent, in the order of its addon ids. */
  private getAddonImages(agent: Agent): string[] | undefined {
    if (agent.addonIds === undefined) {
      return undefined;
    }
    const addonIds = typeof agent.addonIds === 'string' ? [agent.addonIds] : agent.addonIds;
    return addonIds.flatMap(id => this.addonRegistry.getAddon(id)?.ociImage ?? []);
  }

  getAgentRegistration(id: string): Agent | undefined {
    return this.agentRegistrations.get(id)?.agent;
  }
}
