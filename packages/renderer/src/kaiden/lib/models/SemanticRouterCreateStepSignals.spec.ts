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
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';

import SemanticRouterCreateStepSignals from './SemanticRouterCreateStepSignals.svelte';

const mockModels: CatalogModelInfo[] = [
  {
    providerId: 'gemini',
    connectionId: 'conn-1',
    connectionName: 'Gemini',
    type: 'cloud',
    label: 'gemini-2.5-pro',
    connectionStatus: 'started',
    providerName: 'Gemini',
  },
  {
    providerId: 'ollama',
    connectionId: 'conn-2',
    connectionName: 'Ollama',
    type: 'local',
    label: 'qwen3-coder',
    connectionStatus: 'started',
    providerName: 'Ollama',
  },
];

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

describe('signals section', () => {
  test('renders signals and decisions headers', () => {
    render(SemanticRouterCreateStepSignals, { keywords: [], decisions: [], availableModels: mockModels });

    screen.getByText('Signals');
    screen.getByText('Decisions');
  });

  test('shows empty state when no signals defined', () => {
    render(SemanticRouterCreateStepSignals, { keywords: [], decisions: [], availableModels: mockModels });

    screen.getByText('No signals defined yet. Add a keyword signal to get started.');
  });

  test('adds a keyword signal when button is clicked', async () => {
    render(SemanticRouterCreateStepSignals, { keywords: [], decisions: [], availableModels: mockModels });

    const addBtn = screen.getByRole('button', { name: /Add keyword signal/i });
    await fireEvent.click(addBtn);

    screen.getByLabelText('Signal name');
  });

  test('renders existing keyword signals', () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [{ name: 'coding_keywords', operator: 'OR', keywords: ['function', 'class'], caseSensitive: false }],
      decisions: [],
      availableModels: mockModels,
    });

    expect(screen.getByDisplayValue('coding_keywords')).toBeInTheDocument();
    screen.getByText('function');
    screen.getByText('class');
  });

  test('removes a keyword signal', async () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [{ name: 'my-signal', operator: 'OR', keywords: [], caseSensitive: false }],
      decisions: [],
      availableModels: mockModels,
    });

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    await fireEvent.click(closeBtn);

    screen.getByText('No signals defined yet. Add a keyword signal to get started.');
  });

  test('adds a keyword chip via Enter key', async () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [{ name: 'sig', operator: 'OR', keywords: [], caseSensitive: false }],
      decisions: [],
      availableModels: mockModels,
    });

    const chipInput = screen.getByLabelText('Add keyword');
    await fireEvent.input(chipInput, { target: { value: 'function' } });
    await fireEvent.keyPress(chipInput, { key: 'Enter' });

    screen.getByText('function');
  });

  test('removes a keyword chip', async () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [{ name: 'sig', operator: 'OR', keywords: ['testchip'], caseSensitive: false }],
      decisions: [],
      availableModels: mockModels,
    });

    screen.getByText('testchip');
    const chip = screen.getByText('testchip').closest('span')!;
    const removeBtn = chip.querySelector('button')!;
    await fireEvent.click(removeBtn);

    expect(screen.queryByText('testchip')).not.toBeInTheDocument();
  });

  test('toggles operator between OR and AND via slide toggle', async () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [{ name: 'sig', operator: 'OR', keywords: [], caseSensitive: false }],
      decisions: [],
      availableModels: mockModels,
    });

    const toggle = screen.getByRole('checkbox', { name: 'Toggle operator' });
    expect(toggle).not.toBeChecked();

    await fireEvent.input(toggle);
  });
});

describe('decisions section', () => {
  test('shows empty state when no decisions defined', () => {
    render(SemanticRouterCreateStepSignals, { keywords: [], decisions: [], availableModels: mockModels });

    screen.getByText('No decisions defined yet. Add a decision to create routing rules.');
  });

  test('adds a decision when button is clicked', async () => {
    render(SemanticRouterCreateStepSignals, { keywords: [], decisions: [], availableModels: mockModels });

    const addBtn = screen.getByRole('button', { name: /Add decision/i });
    await fireEvent.click(addBtn);

    screen.getByLabelText('Decision name');
  });

  test('renders existing decisions', () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [],
      decisions: [
        {
          name: 'code-route',
          priority: 100,
          rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
        },
      ],
      availableModels: mockModels,
    });

    expect(screen.getByDisplayValue('code-route')).toBeInTheDocument();
  });

  test('removes a decision', async () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [],
      decisions: [
        {
          name: 'to-remove',
          priority: 50,
          rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
        },
      ],
      availableModels: mockModels,
    });

    const closeBtn = screen.getByRole('button', { name: 'Close' });
    await fireEvent.click(closeBtn);

    screen.getByText('No decisions defined yet. Add a decision to create routing rules.');
  });

  test('shows signal names as toggleable conditions', () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [
        { name: 'coding_kw', operator: 'OR', keywords: ['code'], caseSensitive: false },
        { name: 'review_kw', operator: 'AND', keywords: ['review'], caseSensitive: false },
      ],
      decisions: [
        {
          name: 'route-1',
          priority: 100,
          rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
        },
      ],
      availableModels: mockModels,
    });

    screen.getByRole('checkbox', { name: 'Toggle signal coding_kw' });
    screen.getByRole('checkbox', { name: 'Toggle signal review_kw' });
  });

  test('shows hint when no signals defined for conditions', () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [],
      decisions: [
        {
          name: 'route-1',
          priority: 100,
          rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
        },
      ],
      availableModels: mockModels,
    });

    screen.getByText('Define keyword signals above first.');
  });

  test('renders model select with available models', () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [],
      decisions: [
        {
          name: 'route-1',
          priority: 100,
          rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
        },
      ],
      availableModels: mockModels,
    });

    screen.getByLabelText('Target model');
  });

  test('renders reasoning toggle', () => {
    render(SemanticRouterCreateStepSignals, {
      keywords: [],
      decisions: [
        {
          name: 'route-1',
          priority: 100,
          rules: [{ operator: 'AND', conditions: [], modelRefs: [] }],
        },
      ],
      availableModels: mockModels,
    });

    screen.getByText('Enable reasoning mode');
  });
});
