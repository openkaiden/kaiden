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

import { faKey } from '@fortawesome/free-solid-svg-icons';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { ChecklistItem } from './ChecklistPanel.svelte';
import ChecklistPanel from './ChecklistPanel.svelte';

const SAMPLE_ITEMS: ChecklistItem[] = [
  { id: 'gh', name: 'GitHub', description: 'Personal access token', group: 'API tokens' },
  { id: 'jira', name: 'Jira', description: 'OAuth token', group: 'API tokens' },
  { id: 'ocp', name: 'OpenShift Cluster', description: 'Platform token', group: 'Infrastructure' },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe('empty state', () => {
  test('shows default empty message when no items', () => {
    render(ChecklistPanel, { title: 'Vault', items: [] });

    expect(screen.getByText('No items available.')).toBeInTheDocument();
  });

  test('shows custom empty message', () => {
    render(ChecklistPanel, { title: 'Vault', items: [], emptyMessage: 'Nothing here yet.' });

    expect(screen.getByText('Nothing here yet.')).toBeInTheDocument();
  });

  test('does not show item count when empty', () => {
    render(ChecklistPanel, { title: 'Vault', items: [] });

    expect(screen.queryByText(/\d+ items/)).not.toBeInTheDocument();
  });

  test('does not show footer when empty', () => {
    render(ChecklistPanel, { title: 'Vault', items: [] });

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});

describe('header', () => {
  test('renders title', () => {
    render(ChecklistPanel, { title: 'Secret Vault', items: SAMPLE_ITEMS });

    expect(screen.getByText('Secret Vault')).toBeInTheDocument();
  });

  test('renders subtitle when provided', () => {
    render(ChecklistPanel, { title: 'Vault', subtitle: 'Pick your secrets', items: SAMPLE_ITEMS });

    expect(screen.getByText('Pick your secrets')).toBeInTheDocument();
  });

  test('renders item count', () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS });

    expect(screen.getByText('3 items')).toBeInTheDocument();
  });

  test('renders icon when provided', () => {
    const { container } = render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS, icon: faKey });

    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('items rendering', () => {
  test('renders all item names', () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS });

    expect(screen.getByText('GitHub')).toBeInTheDocument();
    expect(screen.getByText('Jira')).toBeInTheDocument();
    expect(screen.getByText('OpenShift Cluster')).toBeInTheDocument();
  });

  test('renders item descriptions', () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS });

    expect(screen.getByText('Personal access token')).toBeInTheDocument();
    expect(screen.getByText('OAuth token')).toBeInTheDocument();
    expect(screen.getByText('Platform token')).toBeInTheDocument();
  });

  test('renders items without description', () => {
    const items: ChecklistItem[] = [{ id: '1', name: 'No Desc' }];
    render(ChecklistPanel, { title: 'Vault', items });

    expect(screen.getByText('No Desc')).toBeInTheDocument();
  });

  test('renders group labels', () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS });

    expect(screen.getByText('API tokens')).toBeInTheDocument();
    expect(screen.getByText('Infrastructure')).toBeInTheDocument();
  });

  test('renders items without groups', () => {
    const items: ChecklistItem[] = [
      { id: '1', name: 'Alpha' },
      { id: '2', name: 'Beta' },
    ];
    render(ChecklistPanel, { title: 'Vault', items });

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});

describe('selection', () => {
  test('clicking item toggles selection', async () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS, selected: [] });

    await fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
  });

  test('clicking selected item deselects it', async () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS, selected: ['gh'] });

    await fireEvent.click(screen.getByRole('button', { name: 'GitHub' }));

    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
  });

  test('clicking checkbox toggles selection', async () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS, selected: [] });

    const checkbox = screen.getByRole('checkbox', { name: 'GitHub' });
    await fireEvent.click(checkbox);

    expect(screen.getByText('1 of 3 selected')).toBeInTheDocument();
  });

  test('renders selection count in footer', () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS, selected: ['gh', 'ocp'] });

    expect(screen.getByText('2 of 3 selected')).toBeInTheDocument();
  });

  test('renders zero selection count', () => {
    render(ChecklistPanel, { title: 'Vault', items: SAMPLE_ITEMS, selected: [] });

    expect(screen.getByText('0 of 3 selected')).toBeInTheDocument();
  });
});
