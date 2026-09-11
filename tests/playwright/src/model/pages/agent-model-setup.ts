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

import {
  AGENT_MODEL_SETUPS,
  type CodingAgent,
  PROVIDERS,
  type WorkspaceInferenceProviderConfig,
  type WorkspaceInferenceProviderId,
} from '/@/model/core/types';

export interface InlineConnectionField {
  label: string;
  value: string;
}

export interface ResolvedAgentModelSetup {
  agent: CodingAgent;
  providerName: string;
  fields: InlineConnectionField[];
}

function getWorkspaceInferenceProvider(providerId: WorkspaceInferenceProviderId): WorkspaceInferenceProviderConfig {
  return PROVIDERS[providerId] as WorkspaceInferenceProviderConfig;
}

export function buildInlineConnectionFields(providerId: WorkspaceInferenceProviderId): InlineConnectionField[] {
  const provider = getWorkspaceInferenceProvider(providerId);

  return provider.inlineConnectionFields.map(field => {
    const value = field.useBaseURL ? provider.baseURL : field.useEnvVar ? process.env[provider.envVarName] : undefined;
    if (!value) {
      throw new Error(`Missing value for inline connection field "${field.label}" on provider "${providerId}"`);
    }
    return { label: field.label, value };
  });
}

export function resolveAgentModelConnectionFor(
  agent: CodingAgent,
  preferredProviderId?: WorkspaceInferenceProviderId,
): ResolvedAgentModelSetup | undefined {
  const setup = AGENT_MODEL_SETUPS.find(entry => entry.agent === agent);
  if (!setup) {
    return undefined;
  }
  const candidateProviderIds = preferredProviderId ? [preferredProviderId] : setup.providerIds;
  for (const providerId of candidateProviderIds) {
    if (!(setup.providerIds as readonly WorkspaceInferenceProviderId[]).includes(providerId)) {
      continue;
    }
    const provider = getWorkspaceInferenceProvider(providerId);
    if (process.env[provider.envVarName]) {
      return {
        agent: setup.agent,
        providerName: provider.providerPickerName,
        fields: buildInlineConnectionFields(providerId),
      };
    }
  }
  return undefined;
}

export function resolveAgentModelConnection(): ResolvedAgentModelSetup | undefined {
  if (isLocalRuntimeAvailable()) {
    const localSetup = AGENT_MODEL_SETUPS.find(s => s.localRuntimeFallback && s.providerIds.length === 0);
    if (localSetup) {
      return { agent: localSetup.agent, providerName: '', fields: [] };
    }
  }

  for (const setup of AGENT_MODEL_SETUPS) {
    const connection = resolveAgentModelConnectionFor(setup.agent);
    if (connection) {
      return connection;
    }
  }
  return undefined;
}

export function agentModelSetupSkipMessage(): string {
  const envVars = Array.from(
    new Set([
      PROVIDERS.ollama.envVarName,
      PROVIDERS.ramalama.envVarName,
      ...AGENT_MODEL_SETUPS.flatMap(setup =>
        setup.providerIds.map(providerId => getWorkspaceInferenceProvider(providerId).envVarName),
      ),
    ]),
  ).join(', ');
  return `One of ${envVars} is required for workspace wizard model step`;
}

/** Ollama/RamaLama are auto-detected local runtimes - no API key or inline connection form needed. */
export function isLocalRuntimeAvailable(): boolean {
  return !!process.env[PROVIDERS.ollama.envVarName] || !!process.env[PROVIDERS.ramalama.envVarName];
}

export function isAgentModelSetupAvailable(agent: CodingAgent): boolean {
  const setup = AGENT_MODEL_SETUPS.find(entry => entry.agent === agent);
  if (!setup) {
    return false;
  }
  if (setup.localRuntimeFallback && isLocalRuntimeAvailable()) {
    return true;
  }
  return resolveAgentModelConnectionFor(agent) !== undefined;
}

export function agentModelSetupSkipMessageFor(agent: CodingAgent): string {
  const setup = AGENT_MODEL_SETUPS.find(entry => entry.agent === agent);
  if (!setup) {
    return `${agent} is not supported`;
  }
  const envVars = Array.from(
    new Set([
      ...(setup.localRuntimeFallback ? [PROVIDERS.ollama.envVarName, PROVIDERS.ramalama.envVarName] : []),
      ...setup.providerIds.map(providerId => PROVIDERS[providerId].envVarName),
    ]),
  );
  return `${envVars.join(' or ')} is required for ${agent} model setup`;
}
