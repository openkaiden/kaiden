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
import { faCircleCheck } from '@fortawesome/free-regular-svg-icons';
import { faCopy } from '@fortawesome/free-solid-svg-icons';

function faIconToSvg(icon: { icon: [number, number, unknown, unknown, string | string[]] }): string {
  const [width, height, , , pathData] = icon.icon;
  const path = Array.isArray(pathData) ? pathData.join(' ') : pathData;
  return `<svg viewBox="0 0 ${width} ${height}" height="1.25em" style="color: currentColor;"><path d="${path}" fill="currentColor"/></svg>`;
}

const copyIconHtml = faIconToSvg(faCopy);
const checkIconHtml = faIconToSvg(faCircleCheck);

// Tooltip is appended to document.body instead of using a CSS pseudo-element
// because the button sits inside multiple nested containers with overflow:hidden
// (chat scroll area, message wrapper, etc.) which clip any absolutely positioned
// content that extends beyond their bounds. A fixed-position element on body
// escapes all overflow contexts.
let activeTooltip: HTMLElement | undefined;

function showTooltip(btn: HTMLElement, text: string): void {
  hideTooltip();
  const tip = document.createElement('div');
  tip.className = 'code-copy-tooltip';
  tip.textContent = text;
  document.body.appendChild(tip);
  activeTooltip = tip;

  const rect = btn.getBoundingClientRect();
  tip.style.left = `${rect.left + rect.width / 2 - tip.offsetWidth / 2}px`;
  tip.style.top = `${rect.top - tip.offsetHeight - 4}px`;
}

function hideTooltip(): void {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = undefined;
  }
}

function injectCopyButtons(container: HTMLElement): void {
  container.querySelectorAll('pre').forEach(pre => {
    if (pre.querySelector('.code-copy-btn')) {
      return;
    }
    pre.style.position = 'relative';
    const btn = document.createElement('button');
    btn.className = 'code-copy-btn';
    btn.setAttribute('aria-label', 'Copy code');
    btn.innerHTML = copyIconHtml;

    let tooltipText = 'Copy';
    btn.addEventListener('mouseenter', () => showTooltip(btn, tooltipText));
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('click', () => {
      const code = pre.querySelector('code');
      const text = code?.textContent ?? pre.textContent ?? '';
      window
        .clipboardWriteText(text)
        .then(() => {
          btn.innerHTML = checkIconHtml;
          tooltipText = 'Copied!';
          showTooltip(btn, tooltipText);
          setTimeout(() => {
            btn.innerHTML = copyIconHtml;
            tooltipText = 'Copy';
            hideTooltip();
          }, 2000);
        })
        .catch(console.error);
    });
    pre.appendChild(btn);
  });
}

/**
 * Svelte action that injects copy-to-clipboard buttons into `<pre>` code blocks.
 * Observes DOM mutations to handle dynamically rendered content.
 */
export function codeCopyButtons(node: HTMLElement): { destroy: () => void } {
  injectCopyButtons(node);

  const observer = new MutationObserver(() => {
    injectCopyButtons(node);
  });
  observer.observe(node, { childList: true, subtree: true });

  return {
    destroy(): void {
      observer.disconnect();
      hideTooltip();
    },
  };
}
