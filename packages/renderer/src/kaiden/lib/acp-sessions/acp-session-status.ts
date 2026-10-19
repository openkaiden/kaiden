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

import type { AcpSessionInfo, AcpSessionStatus } from '/@api/acp-session-info';

const PULSE = 'animate-pulse motion-reduce:animate-none';

export const ACP_SESSION_STATUS_LABELS: Record<AcpSessionStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting_input: 'Needs Input',
  completed: 'Completed',
  error: 'Error',
  cancelled: 'Cancelled',
};

export const ACP_SESSION_STATUS_COLORS: Record<AcpSessionStatus, string> = {
  idle: 'bg-[var(--pd-status-not-running)]',
  running: `bg-[var(--pd-status-running)] shadow-[0_0_5px_var(--pd-status-running)] ${PULSE}`,
  waiting_input: `bg-[var(--pd-status-waiting)] shadow-[0_0_5px_var(--pd-status-waiting)] ${PULSE}`,
  completed: 'bg-(--pd-status-connected)',
  error: 'bg-[var(--pd-status-dead)]',
  cancelled: 'bg-[var(--pd-status-not-running)]',
};

const TERMINAL_STATUSES: ReadonlySet<AcpSessionStatus> = new Set(['completed', 'cancelled', 'error']);

export function isTerminalStatus(status: AcpSessionStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isWorkspaceUnavailable(session: Pick<AcpSessionInfo, 'sandboxId'>): boolean {
  return session.sandboxId === undefined;
}

export function getStatusDotClass(session: Pick<AcpSessionInfo, 'sandboxId' | 'status'>): string {
  if (isWorkspaceUnavailable(session) && !isTerminalStatus(session.status)) {
    return ACP_SESSION_STATUS_COLORS.idle;
  }
  return ACP_SESSION_STATUS_COLORS[session.status];
}
