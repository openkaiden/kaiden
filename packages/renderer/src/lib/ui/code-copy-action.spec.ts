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

import { fireEvent } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { codeCopyButtons } from './code-copy-action';

beforeEach(() => {
  vi.resetAllMocks();
  (window as unknown as Record<string, unknown>).clipboardWriteText = vi.fn().mockResolvedValue(undefined);
});

function createContainer(html: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

describe('codeCopyButtons action', () => {
  test('should add copy button to pre elements', () => {
    const container = createContainer('<pre><code>console.log("hello");</code></pre>');
    const { destroy } = codeCopyButtons(container);

    const copyBtn = container.querySelector('.code-copy-btn');
    expect(copyBtn).toBeInTheDocument();
    expect(copyBtn).toHaveAttribute('aria-label', 'Copy code');

    destroy();
  });

  test('should copy code text to clipboard on click', async () => {
    const container = createContainer('<pre><code>some code</code></pre>');
    const { destroy } = codeCopyButtons(container);

    const copyBtn = container.querySelector('.code-copy-btn') as HTMLButtonElement;
    await fireEvent.click(copyBtn);

    expect(window.clipboardWriteText).toHaveBeenCalledWith('some code');

    destroy();
  });

  test('should show check icon and Copied! tooltip after copying', async () => {
    const container = createContainer('<pre><code>code</code></pre>');
    const { destroy } = codeCopyButtons(container);

    const copyBtn = container.querySelector('.code-copy-btn') as HTMLButtonElement;
    const originalHtml = copyBtn.innerHTML;
    await fireEvent.click(copyBtn);

    expect(copyBtn.innerHTML).not.toBe(originalHtml);
    const tooltip = document.querySelector('.code-copy-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Copied!');

    destroy();
  });

  test('should not add copy button to non-pre elements', () => {
    const container = createContainer('<code>inline code</code>');
    const { destroy } = codeCopyButtons(container);

    const copyBtn = container.querySelector('.code-copy-btn');
    expect(copyBtn).not.toBeInTheDocument();

    destroy();
  });

  test('should add copy buttons to multiple pre elements', () => {
    const container = createContainer('<pre><code>first</code></pre><pre><code>second</code></pre>');
    const { destroy } = codeCopyButtons(container);

    const copyBtns = container.querySelectorAll('.code-copy-btn');
    expect(copyBtns).toHaveLength(2);

    destroy();
  });

  test('should not duplicate buttons on repeated calls', () => {
    const container = createContainer('<pre><code>code</code></pre>');
    const { destroy } = codeCopyButtons(container);

    // Simulate a mutation by adding another pre
    const pre = document.createElement('pre');
    pre.innerHTML = '<code>new code</code>';
    container.appendChild(pre);

    // Wait for MutationObserver
    return new Promise<void>(resolve => {
      setTimeout(() => {
        const copyBtns = container.querySelectorAll('.code-copy-btn');
        expect(copyBtns).toHaveLength(2);
        destroy();
        resolve();
      }, 0);
    });
  });
});
