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

import { expect, test } from 'vitest';

import type { DraftPolicyChunk } from '/@api/draft-policy-info';

import { formatPolicyConfidence, formatPolicyRequest } from './network-approval-utils';

function makeChunk(overrides?: Partial<DraftPolicyChunk>): DraftPolicyChunk {
  return {
    chunkId: 'chunk-1',
    ruleName: 'allow_example_443',
    status: 'pending',
    host: 'example.com',
    port: 443,
    binaries: [],
    rationale: 'blocked',
    hasSecurityNotes: false,
    isL7: false,
    ...overrides,
  };
}

test('formats confidence as a percentage', () => {
  expect(formatPolicyConfidence(0.876)).toBe('88%');
});

test.each([
  ['L4 request', makeChunk(), 'example.com:443 [L4]'],
  ['REST request', makeChunk({ isL7: true, method: 'POST', path: '/api/data' }), 'POST example.com:443/api/data'],
  ['L7 request without method and path', makeChunk({ isL7: true }), 'L7 request'],
  [
    'GraphQL request',
    makeChunk({
      isL7: true,
      protocol: 'graphql',
      operationType: 'mutation',
      operationName: 'CreateIssue',
      graphqlFields: ['createIssue'],
    }),
    'GraphQL mutation CreateIssue (createIssue)',
  ],
])('formats %s', (_name, chunk, expected) => {
  expect(formatPolicyRequest(chunk)).toBe(expected);
});
