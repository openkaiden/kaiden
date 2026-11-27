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

import type { ContainerInfo } from 'dockerode';

export enum SemanticRouterLabel {
  NAME = 'ai.openkaiden.vllm-semantic-router.name',
  ROLE = 'ai.openkaiden.vllm-semantic-router.role',
}

// images of the router and envoy containers
export enum SemanticRouterImage {
  ROUTER = 'ghcr.io/vllm-project/semantic-router/vllm-sr:v0.3.0',
  ENVOY = 'docker.io/envoyproxy/envoy:v1.40.2',
}

// ports inside the router container network namespace, shared by the router and envoy
export enum SemanticRouterPort {
  ENVOY_LISTEN = 8801,
  ENVOY_ADMIN = 9901,
  ROUTER_GRPC = 50051,
  ROUTER_API = 8080,
}

export enum SemanticRouterRole {
  ROUTER = 'router',
  ENVOY = 'envoy',
}

// only the name label is guaranteed: it is the label checked by ContainerFinder
export type SemanticRouterContainerInfo = ContainerInfo & {
  Labels: {
    [SemanticRouterLabel.NAME]: string;
  } & Record<string, string>;
};
