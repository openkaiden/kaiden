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

import type { AcpFlowPromptEvent } from '/@api/acp-session-info';

import AcpFlowPrompt from './AcpFlowPrompt.svelte';

beforeEach(() => {
  vi.resetAllMocks();
});

const PROMPT_EVENT: AcpFlowPromptEvent = {
  kind: 'prompt',
  text: 'Help me build a container',
  timestamp: 1000,
};

test('should render prompt text', () => {
  render(AcpFlowPrompt, { event: PROMPT_EVENT });
  expect(screen.getByText('Help me build a container')).toBeInTheDocument();
});

test('should render copy button', () => {
  render(AcpFlowPrompt, { event: PROMPT_EVENT });
  expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
});

test('should copy prompt text to clipboard on click', async () => {
  render(AcpFlowPrompt, { event: PROMPT_EVENT });
  const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' });
  await fireEvent.click(copyButton);
  expect(window.clipboardWriteText).toHaveBeenCalledWith('Help me build a container');
});

test('should render attachment chips when attachments are present', () => {
  const eventWithAttachments: AcpFlowPromptEvent = {
    ...PROMPT_EVENT,
    attachments: [{ fileName: 'test.txt', mimeType: 'text/plain' }],
  };
  render(AcpFlowPrompt, { event: eventWithAttachments });
  expect(screen.getByText('test.txt')).toBeInTheDocument();
});
