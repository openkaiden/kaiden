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
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { DraftPolicyChunk } from '/@api/draft-policy-info';

import NetworkApprovalChunkDetails from './NetworkApprovalChunkDetails.svelte';

function makeChunk(overrides?: Partial<DraftPolicyChunk>): DraftPolicyChunk {
  return {
    chunkId: 'chunk-1',
    ruleName: 'allow_example_443',
    status: 'pending',
    host: 'example.com',
    port: 443,
    binaries: ['/**'],
    rationale: 'Host not in allow list',
    hasSecurityNotes: false,
    isL7: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('renders the request, binary and rationale for an L4 chunk', () => {
  render(NetworkApprovalChunkDetails, { chunk: makeChunk({ confidence: 0.9 }) });

  expect(screen.getByText('example.com:443 [L4]')).toBeInTheDocument();
  expect(screen.getByText('/**')).toBeInTheDocument();
  expect(screen.getByText('Host not in allow list')).toBeInTheDocument();
  expect(screen.getByText('90%')).toBeInTheDocument();
});

test('renders the L4 deny explanation when showPolicy is set', () => {
  render(NetworkApprovalChunkDetails, { chunk: makeChunk(), showPolicy: true });

  expect(screen.getByText('Deny')).toBeInTheDocument();
  expect(screen.getByText('— host not in allowed list')).toBeInTheDocument();
});

test('renders the L7 deny explanation when showPolicy is set', () => {
  render(NetworkApprovalChunkDetails, {
    chunk: makeChunk({ isL7: true, method: 'POST', path: '/api/data' }),
    showPolicy: true,
  });

  expect(screen.getByText('— method/path not in allow list')).toBeInTheDocument();
});

test('renders the GraphQL deny explanation when showPolicy is set', () => {
  render(NetworkApprovalChunkDetails, {
    chunk: makeChunk({ isL7: true, protocol: 'graphql', operationType: 'mutation', operationName: 'UpdateUser' }),
    showPolicy: true,
  });

  expect(screen.getByText('— operation not in allow list')).toBeInTheDocument();
});

test('hides the policy explanation when showPolicy is not set', () => {
  render(NetworkApprovalChunkDetails, { chunk: makeChunk() });

  expect(screen.queryByText('Deny')).not.toBeInTheDocument();
});

test('omits the binary line when no binaries are listed', () => {
  render(NetworkApprovalChunkDetails, { chunk: makeChunk({ binaries: [] }) });

  expect(screen.queryByText('Binary')).not.toBeInTheDocument();
});

test('renders the application error when the chunk carries one', () => {
  render(NetworkApprovalChunkDetails, { chunk: makeChunk({ applicationError: 'policy compile failed' }) });

  expect(screen.getByText('policy compile failed')).toBeInTheDocument();
});
