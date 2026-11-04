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

import type { AcpFlowEvent } from '/@api/acp-session-info';
import type { DraftPolicyChunk } from '/@api/draft-policy-info';
import { isDraftPolicyEvent } from '/@api/draft-policy-info';

export function mergePolicyChunks(events: AcpFlowEvent[]): DraftPolicyChunk[] {
  const byId = new Map<string, DraftPolicyChunk>();
  for (const chunk of events.filter(isDraftPolicyEvent).flatMap(event => event.chunks)) {
    byId.set(chunk.chunkId, chunk);
  }
  return Array.from(byId.values());
}
