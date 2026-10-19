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
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { AcpFlowThinkingEvent } from '/@api/acp-session-info';

import AcpFlowThinking from './AcpFlowThinking.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

const THINKING_EVENT: AcpFlowThinkingEvent = {
  kind: 'thinking',
  text: 'Some internal reasoning',
  timestamp: 1000,
};

describe('AcpFlowThinking', () => {
  test('should show "Thinking…" when not complete', () => {
    render(AcpFlowThinking, {
      event: THINKING_EVENT,
      isComplete: false,
    });

    expect(screen.getByText('Thinking…')).toBeInTheDocument();
    expect(screen.queryByText(/^Thought for/)).not.toBeInTheDocument();
  });

  test('should show "Thought for <duration>" when complete with duration', () => {
    render(AcpFlowThinking, {
      event: THINKING_EVENT,
      isComplete: true,
      durationMs: 5000,
    });

    expect(screen.getByText('Thought for 5 seconds')).toBeInTheDocument();
    expect(screen.queryByText('Thinking…')).not.toBeInTheDocument();
  });

  test('should show "Thought for a few seconds" when complete without duration', () => {
    render(AcpFlowThinking, {
      event: THINKING_EVENT,
      isComplete: true,
    });

    expect(screen.getByText('Thought for a few seconds')).toBeInTheDocument();
  });

  test('should default to not complete when isComplete is omitted', () => {
    render(AcpFlowThinking, {
      event: THINKING_EVENT,
    });

    expect(screen.getByText('Thinking…')).toBeInTheDocument();
  });
});
