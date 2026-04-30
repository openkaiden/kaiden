/**********************************************************************
 * Copyright (C) 2024-2025 Red Hat, Inc.
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

export enum NavigationPage {
  DASHBOARD = 'dashboard',
  FLOWS = 'flows',
  FLOW_CREATE = 'flow-create',
  FLOW_DETAILS = 'flow-details',
  FLOW_RUN = 'flow-run',
  MCPS = 'mcps',
  MCP_INSTALL_FROM_REGISTRY = 'mcp-install-from-registry',
  CONTAINERS = 'containers',
  CONTAINER_EXPORT = 'container-export',
  CONTAINER = 'container',
  CONTAINER_SUMMARY = 'container-summary',
  EXISTING_IMAGE_CREATE_CONTAINER = 'existing-image-create-container',
  CONTAINER_LOGS = 'container-logs',
  CONTAINER_INSPECT = 'container-inspect',
  CONTAINER_TERMINAL = 'container-terminal',
  CONTAINER_TTY = 'container-tty',
  CONTAINER_KUBE = 'container-kube',
  IMAGES = 'images',
  IMAGE_BUILD = 'image-build',
  IMAGE = 'image',
  MANIFEST = 'manifest',
  ONBOARDING = 'preferences-onboarding',
  PODMAN_PODS = 'pods',
  PODMAN_POD = 'pod',
  PODMAN_POD_SUMMARY = 'pod-summary',
  VOLUMES = 'volumes',
  VOLUME = 'volume',
  CONTRIBUTION = 'contribution',
  TROUBLESHOOTING = 'troubleshooting',
  HELP = 'help',
  CLI_TOOLS = 'preferences-cli-tools',
  PROVIDER_TASK = 'preferences-provider-task',
  WEBVIEW = 'webview',
  AUTHENTICATION = 'authentication',
  RESOURCES = 'resources',
  EDIT_CONTAINER_CONNECTION = 'edit-container-connection',
  DEPLOY_TO_KUBE = 'deploy-to-kube',
  EXPERIMENTAL_FEATURES = 'experimental',
  CREATE_PROVIDER_CONNECTION = 'create-provider-connection',
  NETWORKS = 'networks',
  NETWORK = 'network',
  NETWORK_CREATE = 'network-create',
  EXTENSIONS_CATALOG = 'extensions-catalog',
  MCP_DETAILS = 'mcp-details',
  AGENT_WORKSPACES = 'agent-workspaces',
  AGENT_WORKSPACE_CREATE = 'agent-workspace-create',
  SKILLS = 'skills',
  SKILL_DETAILS = 'skill-details',
  RAG_ENVIRONMENTS = 'rag-environments',
  RAG_ENVIRONMENT_DETAILS = 'rag-environment-details',
  SECRET_VAULT = 'secret-vault',
  SECRET_VAULT_CREATE = 'secret-vault-create',
  MODELS = 'models',
}
