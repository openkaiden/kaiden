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

import type { AcpFlowAgentMessageEvent } from '/@api/acp-session-info';

import AcpFlowAgentMessage from './AcpFlowAgentMessage.svelte';

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as Record<string, unknown>).clipboardWriteText = vi.fn().mockResolvedValue(undefined);
});

const AGENT_MESSAGE_EVENT: AcpFlowAgentMessageEvent = {
  kind: 'agent_message',
  text: 'Hello from the agent',
  timestamp: 1000,
};

test('should render agent message text', () => {
  render(AcpFlowAgentMessage, { event: AGENT_MESSAGE_EVENT });
  const elements = screen.getAllByText('Hello from the agent');
  expect(elements.length).toBeGreaterThan(0);
});

test('should render copy button', () => {
  render(AcpFlowAgentMessage, { event: AGENT_MESSAGE_EVENT });
  expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
});

test('should copy agent message text to clipboard on click', async () => {
  render(AcpFlowAgentMessage, { event: AGENT_MESSAGE_EVENT });
  const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' });
  await fireEvent.click(copyButton);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('Hello from the agent');
});
