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

import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import type { AcpFlowToolCallEvent } from '/@api/acp-session-info';

import AcpFlowToolCall from './AcpFlowToolCall.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

const BASE_TOOL_CALL: AcpFlowToolCallEvent = {
  kind: 'tool_call',
  toolCallId: 'tc-1',
  title: 'Run command',
  status: 'completed',
  timestamp: 1000,
};

test('should render tool call title', () => {
  render(AcpFlowToolCall, { event: BASE_TOOL_CALL, sessionId: 'session-1' });
  expect(screen.getByText('Run command')).toBeInTheDocument();
});

test('should render copy button for command block', () => {
  const event: AcpFlowToolCallEvent = {
    ...BASE_TOOL_CALL,
    command: 'echo hello',
  };
  render(AcpFlowToolCall, { event, sessionId: 'session-1' });
  const copyButtons = screen.getAllByRole('button', { name: 'Copy to clipboard' });
  expect(copyButtons.length).toBeGreaterThanOrEqual(1);
});

test('should copy command text to clipboard on click', async () => {
  const event: AcpFlowToolCallEvent = {
    ...BASE_TOOL_CALL,
    command: 'echo hello',
  };
  render(AcpFlowToolCall, { event, sessionId: 'session-1' });
  const copyButtons = screen.getAllByRole('button', { name: 'Copy to clipboard' });
  await fireEvent.click(copyButtons[0]!);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('echo hello');
});

test('should render copy button for short output', () => {
  const event: AcpFlowToolCallEvent = {
    ...BASE_TOOL_CALL,
    content: 'Output text',
  };
  render(AcpFlowToolCall, { event, sessionId: 'session-1' });
  const copyButtons = screen.getAllByRole('button', { name: 'Copy to clipboard' });
  expect(copyButtons.length).toBeGreaterThanOrEqual(1);
});

test('should render both command and output copy buttons', async () => {
  const event: AcpFlowToolCallEvent = {
    ...BASE_TOOL_CALL,
    command: 'echo hello',
    content: 'hello',
  };
  render(AcpFlowToolCall, { event, sessionId: 'session-1' });
  const copyButtons = screen.getAllByRole('button', { name: 'Copy to clipboard' });
  expect(copyButtons.length).toBe(2);

  await fireEvent.click(copyButtons[0]!);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('echo hello');

  await fireEvent.click(copyButtons[1]!);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('hello');
});

test('should not render copy buttons when no command and no output', () => {
  render(AcpFlowToolCall, { event: BASE_TOOL_CALL, sessionId: 'session-1' });
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).not.toBeInTheDocument();
});
