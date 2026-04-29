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

import { render } from '@testing-library/svelte';
import { describe, expect, test } from 'vitest';

import LoaderAnimation from './LoaderAnimation.svelte';

describe('LoaderAnimation', () => {
  test('should render an SVG element', () => {
    const { container } = render(LoaderAnimation);
    const svg = container.querySelector('svg');
    expect(svg).toBeDefined();
  });

  test('should have the correct viewBox', () => {
    const { container } = render(LoaderAnimation);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 1093 1235');
  });

  test('should have role status for accessibility', () => {
    const { container } = render(LoaderAnimation);
    const statusElement = container.querySelector('[role="status"]');
    expect(statusElement).toBeDefined();
  });

  test('should have sr-only loading text', () => {
    const { getByText } = render(LoaderAnimation);
    const loadingText = getByText('Loading');
    expect(loadingText).toBeDefined();
    expect(loadingText.className).toContain('sr-only');
  });

  test('should mark SVG as aria-hidden', () => {
    const { container } = render(LoaderAnimation);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });
});
