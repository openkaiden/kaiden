/**********************************************************************
 * Copyright (C) 2023-2025 Red Hat, Inc.
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

// eslint-disable-next-line unicorn/prefer-node-protocol
import { Buffer } from 'buffer';
import { router } from 'tinro';

import { NavigationPage } from '/@api/navigation-page';
import type { NavigationRequest } from '/@api/navigation-request';

// help method to ensure the handleNavigation is able to infer type properly through the switch
// ref https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
type InferredNavigationRequest<T extends NavigationPage> = T extends NavigationPage ? NavigationRequest<T> : never;

/**
 * Navigation hints for setting current page and history (breadcrumbs):
 *  root    - root pages that reset the history
 *  details - additional pages that should be tracked in the history
 *  tab     - tabs or other sub-pages that affect the URL, but do not
 *            change what the 'current' page is.
 */
export type NavigationHint = 'root' | 'details' | 'tab';

export const handleNavigation = (request: InferredNavigationRequest<NavigationPage>): void => {
  // eslint-disable-next-line sonarjs/max-switch-cases
  switch (request.page) {
    case NavigationPage.DASHBOARD:
      router.goto('/');
      break;
    case NavigationPage.FLOWS:
      router.goto('/flows');
      break;
    case NavigationPage.FLOW_CREATE:
      router.goto(`/flows/create`);
      break;
    case NavigationPage.FLOW_DETAILS:
      router.goto(
        `/flows/${encodeURIComponent(request.parameters.providerId)}/${encodeURIComponent(request.parameters.connectionName)}/${encodeURIComponent(request.parameters.flowId)}/summary`,
      );
      break;
    case NavigationPage.FLOW_RUN:
      router.goto(
        `/flows/${encodeURIComponent(request.parameters.providerId)}/${encodeURIComponent(request.parameters.connectionName)}/${encodeURIComponent(request.parameters.flowId)}/run`,
      );
      break;
    case NavigationPage.MCP_INSTALL_FROM_REGISTRY:
      router.goto(`/mcp-install-from-registry/${encodeURIComponent(request.parameters.serverId)}`);
      break;
    case NavigationPage.CONTAINERS:
      router.goto('/containers');
      break;
    case NavigationPage.CONTAINER_EXPORT:
      router.goto(`/containers/${request.parameters.id}/export`);
      break;
    case NavigationPage.CONTAINER:
      router.goto(`/containers/${request.parameters.id}/`);
      break;
    case NavigationPage.EXISTING_IMAGE_CREATE_CONTAINER:
      router.goto(`/images/existing-image-create-container`);
      break;
    case NavigationPage.CONTAINER_SUMMARY:
      router.goto(`/containers/${request.parameters.id}/summary`);
      break;
    case NavigationPage.CONTAINER_LOGS:
      router.goto(`/containers/${request.parameters.id}/logs`);
      break;
    case NavigationPage.CONTAINER_INSPECT:
      router.goto(`/containers/${request.parameters.id}/inspect`);
      break;
    case NavigationPage.CONTAINER_TERMINAL:
      router.goto(`/containers/${request.parameters.id}/terminal`);
      break;
    case NavigationPage.CONTAINER_TTY:
      router.goto(`/containers/${request.parameters.id}/tty`);
      break;
    case NavigationPage.CONTAINER_KUBE:
      router.goto(`/containers/${request.parameters.id}/kube`);
      break;
    case NavigationPage.DEPLOY_TO_KUBE:
      router.goto(`/deploy-to-kube/${request.parameters.id}/${request.parameters.engineId}`);
      break;
    case NavigationPage.IMAGES:
      router.goto(`/images`);
      break;
    case NavigationPage.IMAGE_BUILD:
      router.goto(`/images/build?taskId=${request.parameters.taskId}`);
      break;
    case NavigationPage.IMAGE:
      router.goto(
        `/images/${request.parameters.id}/${request.parameters.engineId}/${Buffer.from(request.parameters.tag).toString('base64')}/summary`,
      );
      break;
    case NavigationPage.MANIFEST:
      router.goto(
        `/manifests/${request.parameters.id}/${request.parameters.engineId}/${Buffer.from(request.parameters.tag).toString('base64')}/summary`,
      );
      break;
    case NavigationPage.ONBOARDING:
      router.goto(`/preferences/onboarding/${request.parameters.extensionId}`);
      break;
    case NavigationPage.PODMAN_PODS:
      router.goto(`/pods`);
      break;
    case NavigationPage.PODMAN_POD_SUMMARY:
      router.goto(`/pods/podman/${request.parameters.name}/${request.parameters.engineId}/summary`);
      break;
    case NavigationPage.PODMAN_POD:
      router.goto(`/pods/podman/${request.parameters.name}/${request.parameters.engineId}/`);
      break;
    case NavigationPage.VOLUMES:
      router.goto('/volumes');
      break;
    case NavigationPage.VOLUME:
      router.goto(`/volumes/${request.parameters.name}/${request.parameters.engineId}/summary`);
      break;
    case NavigationPage.CONTRIBUTION:
      router.goto(`/contribs/${request.parameters.name}/`);
      break;
    case NavigationPage.TROUBLESHOOTING:
      router.goto('/troubleshooting/repair-connections');
      break;
    case NavigationPage.HELP:
      router.goto('/help');
      break;
    case NavigationPage.CLI_TOOLS:
      router.goto(`/preferences/cli-tools`);
      break;
    case NavigationPage.PROVIDER_TASK:
      router.goto(`/preferences/provider-task/${request.parameters.internalId}/${request.parameters.taskId}`);
      break;
    case NavigationPage.WEBVIEW:
      router.goto(`/webviews/${request.parameters.id}`);
      break;
    case NavigationPage.AUTHENTICATION:
      router.goto('/preferences/authentication-providers');
      break;
    case NavigationPage.RESOURCES:
      router.goto('/preferences/resources');
      break;
    case NavigationPage.EDIT_CONTAINER_CONNECTION:
      router.goto(`/preferences/container-connection/edit/${request.parameters.provider}/${request.parameters.name}`);
      break;
    case NavigationPage.EXPERIMENTAL_FEATURES:
      router.goto('/preferences/experimental');
      break;
    case NavigationPage.CREATE_PROVIDER_CONNECTION:
      router.goto(`/preferences/provider/${request.parameters.provider}`);
      break;
    case NavigationPage.NETWORKS:
      router.goto('/networks');
      break;
    case NavigationPage.NETWORK:
      router.goto(`/networks/${request.parameters.name}/${request.parameters.engineId}/summary`);
      break;
    case NavigationPage.NETWORK_CREATE:
      router.goto('/networks/create');
      break;
    case NavigationPage.EXTENSIONS_CATALOG:
      router.goto(`/extensions?screen=catalog&searchTerm=${encodeURIComponent(request.parameters.searchTerm ?? '')}`);
      break;
    case NavigationPage.MCP_DETAILS:
      router.goto(`/mcps/${encodeURIComponent(request.parameters.id)}/summary`);
      break;
    case NavigationPage.AGENT_WORKSPACES:
      router.goto('/agent-workspaces');
      break;
    case NavigationPage.AGENT_WORKSPACE_CREATE:
      router.goto('/agent-workspaces/create');
      break;
    case NavigationPage.SKILL_DETAILS:
      router.goto(`/skills/${encodeURIComponent(request.parameters.name)}/summary`);
      break;
    case NavigationPage.RAG_ENVIRONMENT_DETAILS:
      router.goto(`/rag-environments/${encodeURIComponent(request.parameters.name)}/summary`);
      break;
    case NavigationPage.SKILLS:
      router.goto('/skills');
      break;
    case NavigationPage.SECRET_VAULT:
      router.goto('/secret-vault');
      break;
    case NavigationPage.SECRET_VAULT_CREATE:
      router.goto('/secret-vault/create');
      break;
    case NavigationPage.SECRET_VAULT_DETAILS:
      router.goto(`/secret-vault/${encodeURIComponent(request.parameters.id)}/summary`);
      break;
  }
};
