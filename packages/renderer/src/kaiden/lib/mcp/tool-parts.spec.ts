/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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
import userEvent from '@testing-library/user-event';
import type { DynamicToolUIPart } from 'ai';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import ToolParts from './tool-parts.svelte';

function matches(content: string, val: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(content)) === JSON.stringify(val);
  } catch (e: unknown) {
    return false;
  }
}

vi.mock('svelte/transition', () => ({
  slide: (): { delay: number; duration: number } => ({
    delay: 0,
    duration: 0,
  }),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe('tool-parts.svelte', () => {
  test.each(['{Enter}', ' '])('toggles tool details with the keyboard using %j', async key => {
    const user = userEvent.setup();
    render(ToolParts, {
      tools: [
        {
          type: 'dynamic-tool',
          state: 'output-available',
          toolCallId: 't1',
          toolName: 'Tool Text',
          input: {},
          output: { content: [{ type: 'text', text: 'Hello world' }] },
        },
      ],
    });

    const toggle = screen.getByRole('button', { name: 'Toggle details for Tool Text', expanded: false });
    expect(toggle).toHaveAttribute('type', 'button');
    expect(screen.queryByText('Hello world')).not.toBeInTheDocument();

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard(key);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hello world')).toBeVisible();

    await user.keyboard(key);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Hello world')).not.toBeInTheDocument();
  });

  test('renders tool sections collapsed by default and toggles to show input/output details', async () => {
    const tools: Array<DynamicToolUIPart> = [
      {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 't1',
        toolName: 'Tool Text',
        input: { a: 1 },
        output: { content: [{ type: 'text', text: 'Hello world' }] },
      },
      {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 't2',
        toolName: 'Tool Image',
        input: { b: 2 },
        output: { content: [{ type: 'image', data: 'AAA', mimeType: 'image/png' }] },
      },
      {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 't3',
        toolName: 'Tool Resource',
        input: { c: 3 },
        output: {
          content: [
            {
              type: 'resource',
              resource: { uri: 'file:///tmp/readme.txt', mimeType: 'text/plain', text: 'Some text here' },
            },
          ],
        },
      },
      {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 't4',
        toolName: 'Tool Result',
        input: { d: 4 },
        output: { toolResult: { ok: true } },
      },
      {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 't5',
        toolName: 'Tool Non-MCP',
        input: { e: 5 },
        output: 'plain',
      },
      {
        type: 'dynamic-tool',
        state: 'output-available',
        toolCallId: 't6',
        toolName: 'Tool Error',
        input: { f: 6 },
        output: { isError: true, content: [] },
      },
    ];

    const user = userEvent.setup();

    render(ToolParts, { tools: tools });

    // Verify headers are present
    for (const t of tools) {
      const element = screen.getByText(t.toolName);
      expect(element).toBeDefined();
      expect(element).toBeInTheDocument();
    }

    // By default no input JSONs should be visible
    for (const t of tools) {
      expect(screen.queryByText(content => matches(content, t.input))).not.toBeInTheDocument();
    }

    // Helper to click the toggle for a given tool name
    async function toggle(name: string): Promise<void> {
      const title = screen.getByText(name);
      const row = title.parentElement as HTMLElement | null;
      expect(row).toBeTruthy();
      const toggleEl = row!.querySelector('.cursor-pointer') as HTMLElement | null;
      expect(toggleEl).toBeTruthy();
      await user.click(toggleEl!);
    }

    // Expand Tool Text and assert text content rendering
    await toggle('Tool Text');
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText(content => matches(content, { a: 1 }))).toBeInTheDocument();
    // Output renders a Text block
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Hello world')).toBeInTheDocument();

    // Collapse Tool Text and ensure input JSON disappears
    await toggle('Tool Text');
    expect(screen.queryByText(content => matches(content, { a: 1 }))).not.toBeInTheDocument();

    // Expand Tool Image and assert image rendering
    await toggle('Tool Image');
    expect(screen.getByText(content => matches(content, { b: 2 }))).toBeInTheDocument();
    const img = screen.getByRole('img', { name: 'MCP image/png content' }) as HTMLImageElement;
    expect(img).toBeInTheDocument();
    expect(img.src).toContain('data:image/png;base64,AAA');

    // Expand Tool Resource and assert resource details
    await toggle('Tool Resource');
    expect(screen.getAllByText('Resource').length).toBeGreaterThan(0);
    expect(screen.getByText('file:///tmp/readme.txt')).toBeInTheDocument();
    // The resource also renders an inner Text section with the provided text
    expect(screen.getByText('Some text here')).toBeInTheDocument();

    // Expand Tool Result and assert toolResult branch
    await toggle('Tool Result');
    expect(screen.getByText(content => matches(content, { ok: true }))).toBeInTheDocument();

    // Expand Tool Non-MCP and assert raw JSON of output
    await toggle('Tool Non-MCP');
    // JSON.stringify('plain') => "plain"
    expect(screen.getByText('"plain"')).toBeInTheDocument();

    // Expand Tool Error and check error message appears
    await toggle('Tool Error');
    expect(screen.getByText('MCP reported an error')).toBeInTheDocument();
  });
});
