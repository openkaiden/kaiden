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

import type { ScrollableCardItem } from './ScrollableCardSelector.svelte';
import ScrollableCardSelector from './ScrollableCardSelector.svelte';

function generateItems(count: number): ScrollableCardItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    name: `Item ${i}`,
    description: `Description for item ${i}`,
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.resetAllMocks();
});

test('Expect empty state when no items', () => {
  render(ScrollableCardSelector, { items: [] });

  expect(screen.getByText('No items available.')).toBeInTheDocument();
});

test('Expect items rendered', () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items });

  expect(screen.getByText('Item 0')).toBeInTheDocument();
  expect(screen.getByText('Item 1')).toBeInTheDocument();
  expect(screen.getByText('Item 2')).toBeInTheDocument();
});

test('Expect descriptions rendered', () => {
  const items = generateItems(2);
  render(ScrollableCardSelector, { items });

  expect(screen.getByText('Description for item 0')).toBeInTheDocument();
  expect(screen.getByText('Description for item 1')).toBeInTheDocument();
});

test('Expect search input rendered with custom placeholder', () => {
  render(ScrollableCardSelector, { items: generateItems(3), placeholder: 'Find skills...' });

  expect(screen.getByPlaceholderText('Find skills...')).toBeInTheDocument();
});

test('Expect search filters items', async () => {
  const items = [
    { id: '1', name: 'Docker', description: 'Container runtime' },
    { id: '2', name: 'Kubernetes', description: 'Orchestration' },
    { id: '3', name: 'Podman', description: 'Container engine' },
  ];
  render(ScrollableCardSelector, { items });

  const searchInput = screen.getByPlaceholderText('Search...');
  await fireEvent.input(searchInput, { target: { value: 'Docker' } });

  expect(screen.getByText('Docker')).toBeInTheDocument();
  expect(screen.queryByText('Kubernetes')).not.toBeInTheDocument();
  expect(screen.queryByText('Podman')).not.toBeInTheDocument();
});

test('Expect search by description', async () => {
  const items = [
    { id: '1', name: 'Docker', description: 'Container runtime' },
    { id: '2', name: 'Kubernetes', description: 'Orchestration' },
  ];
  render(ScrollableCardSelector, { items });

  const searchInput = screen.getByPlaceholderText('Search...');
  await fireEvent.input(searchInput, { target: { value: 'Orchestration' } });

  expect(screen.queryByText('Docker')).not.toBeInTheDocument();
  expect(screen.getByText('Kubernetes')).toBeInTheDocument();
});

test('Expect no results message when search has no matches', async () => {
  render(ScrollableCardSelector, { items: generateItems(3) });

  const searchInput = screen.getByPlaceholderText('Search...');
  await fireEvent.input(searchInput, { target: { value: 'nonexistent' } });

  expect(screen.getByText('No results found.')).toBeInTheDocument();
});

test('Expect clicking item toggles selection', async () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, selected: [] });

  const itemButton = screen.getByRole('button', { name: 'Item 0' });
  await fireEvent.click(itemButton);

  expect(screen.getByText('1 selected')).toBeInTheDocument();
});

test('Expect clicking selected item deselects it', async () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, selected: ['item-0'] });

  const itemButton = screen.getByRole('button', { name: 'Item 0' });
  await fireEvent.click(itemButton);

  expect(screen.getByText('0 selected')).toBeInTheDocument();
});

test('Expect selection count displayed', () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, selected: ['item-0', 'item-2'] });

  expect(screen.getByText('2 selected')).toBeInTheDocument();
});

test('Expect pagination with more items than page size', () => {
  const items = generateItems(12);
  render(ScrollableCardSelector, { items, columns: 3 });

  expect(screen.getByText('1 / 2')).toBeInTheDocument();
});

test('Expect next page button navigates to next page', async () => {
  const items = generateItems(12);
  render(ScrollableCardSelector, { items, columns: 3 });

  expect(screen.getByText('Item 0')).toBeInTheDocument();

  const nextButton = screen.getByRole('button', { name: 'Next page' });
  await fireEvent.click(nextButton);

  expect(screen.getByText('2 / 2')).toBeInTheDocument();
  expect(screen.getByText('Item 9')).toBeInTheDocument();
  expect(screen.queryByText('Item 0')).not.toBeInTheDocument();
});

test('Expect previous page button navigates back', async () => {
  const items = generateItems(12);
  render(ScrollableCardSelector, { items, columns: 3 });

  const nextButton = screen.getByRole('button', { name: 'Next page' });
  await fireEvent.click(nextButton);

  expect(screen.getByText('2 / 2')).toBeInTheDocument();

  const prevButton = screen.getByRole('button', { name: 'Previous page' });
  await fireEvent.click(prevButton);

  expect(screen.getByText('1 / 2')).toBeInTheDocument();
  expect(screen.getByText('Item 0')).toBeInTheDocument();
});

test('Expect previous page button disabled on first page', () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, columns: 3 });

  const prevButton = screen.getByRole('button', { name: 'Previous page' });
  expect(prevButton).toBeDisabled();
});

test('Expect next page button disabled on last page', () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, columns: 3 });

  const nextButton = screen.getByRole('button', { name: 'Next page' });
  expect(nextButton).toBeDisabled();
});

test('Expect no page indicator when single page', () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, columns: 3 });

  expect(screen.queryByText('1 / 1')).not.toBeInTheDocument();
});

test('Expect items without description render without description element', () => {
  const items = [{ id: '1', name: 'No Desc Item' }];
  render(ScrollableCardSelector, { items });

  expect(screen.getByText('No Desc Item')).toBeInTheDocument();
});

test('Expect clicking checkbox inside card toggles selection', async () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, selected: [] });

  const checkbox = screen.getByRole('checkbox', { name: 'Item 0' });
  await fireEvent.click(checkbox);

  expect(screen.getByText('1 selected')).toBeInTheDocument();
});

test('Expect clicking checkbox inside selected card deselects it', async () => {
  const items = generateItems(3);
  render(ScrollableCardSelector, { items, selected: ['item-0'] });

  const checkbox = screen.getByRole('checkbox', { name: 'Item 0' });
  await fireEvent.click(checkbox);

  expect(screen.getByText('0 selected')).toBeInTheDocument();
});
