/**********************************************************************
 * Copyright (C) 2022 Red Hat, Inc.
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

import type {
  InferenceProviderConnectionType,
  Link,
  ProviderCleanupAction,
  ProviderConnectionStatus,
  ProviderDetectionCheck,
  ProviderImages,
  ProviderInformation,
  ProviderLinks,
  ProviderStatus,
} from '@openkaiden/api';

export type LifecycleMethod = 'start' | 'stop' | 'delete' | 'edit';
export interface ProviderContainerConnectionInfo {
  connectionType: 'container';
  name: string;
  displayName: string;
  status: ProviderConnectionStatus;
  endpoint: {
    socketPath: string;
  };
  lifecycleMethods?: LifecycleMethod[];
  /**
   * Specify if the corresponding {@link import('@openkaiden/api').ProviderContainerConnection} instance
   * has a shellAccess available
   */
  shellAccess?: boolean;
  type: 'docker' | 'podman';
  vmType?: { id: string; name: string };
}

export interface ProviderKubernetesConnectionInfo {
  connectionType: 'kubernetes';
  name: string;
  status: ProviderConnectionStatus;
  endpoint: {
    apiURL: string;
  };
  lifecycleMethods?: LifecycleMethod[];
}

export interface ProviderVmConnectionInfo {
  connectionType: 'vm';
  name: string;
  status: ProviderConnectionStatus;
  lifecycleMethods?: LifecycleMethod[];
}
export interface ProviderFlowConnectionInfo {
  name: string;
  status: ProviderConnectionStatus;
  lifecycleMethods?: LifecycleMethod[];
  connectionType: 'flow';
}

export interface ProviderInferenceConnectionInfo {
  connectionType: 'inference';
  name: string;
  type: InferenceProviderConnectionType;
  providerName?: string;
  endpoint?: string;
  status: ProviderConnectionStatus;
  lifecycleMethods?: LifecycleMethod[];
  models: Array<{
    label: string;
  }>;
}

export interface ProviderRagConnectionInfo {
  name: string;
  status: ProviderConnectionStatus;
  lifecycleMethods?: LifecycleMethod[];
  connectionType: 'rag';
}

export type ProviderConnectionInfo =
  | ProviderContainerConnectionInfo
  | ProviderKubernetesConnectionInfo
  | ProviderVmConnectionInfo
  | ProviderInferenceConnectionInfo
  | ProviderRagConnectionInfo
  | ProviderFlowConnectionInfo;

export interface ProviderInfo {
  internalId: string;
  id: string;
  readonly extensionId: string;
  name: string;

  // connections
  containerConnections: ProviderContainerConnectionInfo[];
  kubernetesConnections: ProviderKubernetesConnectionInfo[];
  vmConnections: ProviderVmConnectionInfo[];
  inferenceConnections: ProviderInferenceConnectionInfo[];
  ragConnections: ProviderRagConnectionInfo[];
  flowConnections: ProviderFlowConnectionInfo[];

  status: ProviderStatus;
  lifecycleMethods?: LifecycleMethod[];
  // can create provider connection from ContainerProviderConnectionFactory params
  containerProviderConnectionCreation: boolean;
  // can initialize provider connection from ContainerProviderConnectionFactory params
  containerProviderConnectionInitialization: boolean;
  // optional creation name (if defined)
  containerProviderConnectionCreationDisplayName?: string;

  // optional creation button title (if defined)
  containerProviderConnectionCreationButtonTitle?: string;

  // can create provider connection from KubernetesProviderConnectionFactory params
  kubernetesProviderConnectionCreation: boolean;
  // can initialize provider connection from KubernetesProviderConnectionFactory params
  kubernetesProviderConnectionInitialization: boolean;

  // optional creation name (if defined)
  kubernetesProviderConnectionCreationDisplayName?: string;

  // optional creation button title (if defined)
  kubernetesProviderConnectionCreationButtonTitle?: string;

  // can create provider connection from VmProviderConnectionFactory params
  vmProviderConnectionCreation: boolean;
  // can initialize provider connection from VmProviderConnectionFactory params
  vmProviderConnectionInitialization: boolean;

  // optional creation name (if defined)
  vmProviderConnectionCreationDisplayName?: string;

  // optional creation button title (if defined)
  vmProviderConnectionCreationButtonTitle?: string;

  /**
   * Inference Provider connection
   */
  // can create provider connection from InferenceProviderConnectionFactory params
  inferenceProviderConnectionCreation: boolean;
  // can initialize provider connection from InferenceProviderConnectionFactory params
  inferenceProviderConnectionInitialization: boolean;
  // optional creation name (if defined)
  inferenceProviderConnectionCreationDisplayName?: string;
  // optional creation button title (if defined)
  inferenceProviderConnectionCreationButtonTitle?: string;

  /**
   * RAG Provider connection
   */
  // can create provider connection from RagProviderConnectionFactory params
  ragProviderConnectionCreation: boolean;
  // can initialize provider connection from RagProviderConnectionFactory params
  ragProviderConnectionInitialization: boolean;
  // optional creation name (if defined)
  ragProviderConnectionCreationDisplayName?: string;
  // optional creation button title (if defined)
  ragProviderConnectionCreationButtonTitle?: string;

  // other
  emptyConnectionMarkdownDescription?: string;

  version?: string;

  links: ProviderLinks[];
  detectionChecks: ProviderDetectionCheck[];

  // warning messages regarding the provider
  warnings: ProviderInformation[];

  images: ProviderImages;

  // can install a provider
  installationSupport: boolean;

  // can perform cleanup operation
  cleanupSupport: boolean;

  // can update a provider
  updateInfo?: {
    version: string;
  };
}

export interface PreflightChecksCallback {
  startCheck: (status: CheckStatus) => void;
  endCheck: (status: CheckStatus) => void;
}

export interface CheckStatus {
  name: string;
  successful?: boolean;
  description?: string;
  docLinksDescription?: string;
  docLinks?: Link[];
}

export interface PreflightCheckEvent {
  type: 'start' | 'stop';
  status: CheckStatus;
}

export interface ProviderCleanupActionInfo {
  providerId: string;
  providerName: string;
  actions: Promise<ProviderCleanupAction[]>;
  instance: unknown;
}
