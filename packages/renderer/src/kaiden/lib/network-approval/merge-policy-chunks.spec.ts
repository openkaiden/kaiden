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

import { assert, expect, test } from 'vitest';

import type { AcpFlowEvent } from '/@api/acp-session-info';
import type { DraftPolicyChunk, DraftPolicyFlowEvent } from '/@api/draft-policy-info';

import { mergePolicyChunks } from './merge-policy-chunks';

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

function makeEvent(chunks: DraftPolicyChunk[]): DraftPolicyFlowEvent {
  return { kind: 'draft_policy_update', chunks, timestamp: Date.now() };
}

test('last-write-wins when the same chunkId appears in multiple events', () => {
  const events = [
    makeEvent([makeChunk({ chunkId: 'c1', rationale: 'first' })]),
    makeEvent([makeChunk({ chunkId: 'c1', rationale: 'second', status: 'approved' })]),
  ];

  const merged = mergePolicyChunks(events);
  expect(merged).toHaveLength(1);

  const chunk = merged[0];
  assert(chunk);
  expect(chunk.rationale).toBe('second');
  expect(chunk.status).toBe('approved');
});

test('merges distinct chunks from separate events', () => {
  const events = [
    makeEvent([makeChunk({ chunkId: 'c1' })]),
    makeEvent([makeChunk({ chunkId: 'c2', host: 'other.com' })]),
  ];

  const merged = mergePolicyChunks(events);
  expect(merged).toHaveLength(2);
});

test('ignores non-draft-policy events', () => {
  const events: AcpFlowEvent[] = [
    { kind: 'agent_message', text: 'hi', timestamp: Date.now() },
    makeEvent([makeChunk()]),
  ];

  const merged = mergePolicyChunks(events);
  expect(merged).toHaveLength(1);
});

test('returns empty array when no draft policy events exist', () => {
  expect(mergePolicyChunks([])).toEqual([]);
});

test('keeps a chunk whose id collides with an Object prototype key', () => {
  const merged = mergePolicyChunks([makeEvent([makeChunk({ chunkId: '__proto__' })])]);

  expect(merged).toHaveLength(1);
  expect(merged[0]?.chunkId).toBe('__proto__');
});
