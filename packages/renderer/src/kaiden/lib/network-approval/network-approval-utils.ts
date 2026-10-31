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

import type { DraftPolicyChunk } from '/@api/draft-policy-info';

export function formatPolicyConfidence(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatPolicyRequest(chunk: DraftPolicyChunk): string {
  if (chunk.protocol === 'graphql' && chunk.operationType) {
    const operation = [chunk.operationType, chunk.operationName].filter(Boolean).join(' ');
    const fields = chunk.graphqlFields?.length ? ` (${chunk.graphqlFields.join(', ')})` : '';
    return `GraphQL ${operation}${fields}`;
  }

  if (chunk.isL7) {
    return chunk.method && chunk.path ? `${chunk.method} ${chunk.host}:${chunk.port}${chunk.path}` : 'L7 request';
  }

  return `${chunk.host}:${chunk.port} [L4]`;
}
