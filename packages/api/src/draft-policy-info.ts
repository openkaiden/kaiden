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

export interface DraftPolicyChunk {
  chunkId: string;
  ruleName: string;
  status: 'pending' | 'approved' | 'rejected';
  host: string;
  port: number;
  binaries: string[];
  rationale: string;
  hasSecurityNotes: boolean;
  isL7: boolean;
  protocol?: 'rest' | 'graphql';
  method?: string;
  path?: string;
  operationType?: string;
  operationName?: string;
  graphqlFields?: string[];
  /** Confidence score from the draft policy server (0–1). */
  confidence?: number;
  /** Human-readable review or security notes from the draft policy server. */
  securityNotes?: string;
  /** Validation or review error from the draft policy server. */
  applicationError?: string;
}

export interface DraftPolicyFlowEvent {
  kind: 'draft_policy_update';
  chunks: DraftPolicyChunk[];
  timestamp: number;
}

/** Narrows an ACP flow event to a draft policy snapshot. */
export function isDraftPolicyEvent(event: { kind: string }): event is DraftPolicyFlowEvent {
  return event.kind === 'draft_policy_update';
}
