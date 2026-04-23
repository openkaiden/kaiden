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

import { faFolder, faGears, faHome } from '@fortawesome/free-solid-svg-icons';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { beforeEach, expect, test, vi } from 'vitest';

import CardSelector from './CardSelector.svelte';

const options = [
  { title: 'Option A', badge: 'Badge A', value: 'a', icon: faFolder },
  { title: 'Option B', badge: 'Badge B', value: 'b', icon: faHome },
  { title: 'Option C', badge: 'Badge C', value: 'c', icon: faGears, description: 'A description for C' },
];

beforeEach(() => {
  vi.resetAllMocks();
});

test('Expect all option titles rendered', () => {
  render(CardSelector, { options });

  expect(screen.getByText('Option A')).toBeInTheDocument();
  expect(screen.getByText('Option B')).toBeInTheDocument();
  expect(screen.getByText('Option C')).toBeInTheDocument();
});

test('Expect all badges rendered', () => {
  render(CardSelector, { options });

  expect(screen.getByText('Badge A')).toBeInTheDocument();
  expect(screen.getByText('Badge B')).toBeInTheDocument();
  expect(screen.getByText('Badge C')).toBeInTheDocument();
});

test('Expect label rendered when provided', () => {
  render(CardSelector, { options, label: 'My Label' });

  expect(screen.getByText('My Label')).toBeInTheDocument();
});

test('Expect no label rendered when not provided', () => {
  render(CardSelector, { options });

  expect(screen.queryByText('My Label')).not.toBeInTheDocument();
});

test('Expect region has default aria-label when no label provided', () => {
  render(CardSelector, { options });

  expect(screen.getByRole('region', { name: 'Options' })).toBeInTheDocument();
});

test('Expect region uses label as aria-label when provided', () => {
  render(CardSelector, { options, label: 'Pick one' });

  expect(screen.getByRole('region', { name: 'Pick one' })).toBeInTheDocument();
});

test('Expect description rendered when provided', () => {
  render(CardSelector, { options });

  expect(screen.getByText('A description for C')).toBeInTheDocument();
});

test('Expect clicking option selects it', async () => {
  render(CardSelector, { options, selected: '' });

  const buttonA = screen.getByRole('button', { name: 'Option A' });
  await fireEvent.click(buttonA);

  expect(buttonA.className).toContain('border-[var(--pd-content-card-border-selected)]');
});

test('Expect clicking different option changes selection', async () => {
  render(CardSelector, { options, selected: 'a' });

  const buttonB = screen.getByRole('button', { name: 'Option B' });
  await fireEvent.click(buttonB);

  expect(buttonB.className).toContain('border-[var(--pd-content-card-border-selected)]');

  const buttonA = screen.getByRole('button', { name: 'Option A' });
  expect(buttonA.className).toContain('border-[var(--pd-content-card-border)]');
});

test('Expect each option has a button with aria-label using title', () => {
  render(CardSelector, { options });

  expect(screen.getByRole('button', { name: 'Option A' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Option B' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Option C' })).toBeInTheDocument();
});

test('Expect radio indicator filled for selected option', () => {
  const { container } = render(CardSelector, { options, selected: 'b' });

  const buttons = container.querySelectorAll('button');
  const selectedButton = buttons[1]!;
  const radioFill = selectedButton.querySelector('.w-2.h-2.rounded-full');
  expect(radioFill).toBeInTheDocument();

  const unselectedButton = buttons[0]!;
  const noRadioFill = unselectedButton.querySelector('.w-2.h-2.rounded-full');
  expect(noRadioFill).not.toBeInTheDocument();
});

test('Expect deselection when clicking the already selected option', async () => {
  render(CardSelector, { options, selected: 'a' });

  const buttonA = screen.getByRole('button', { name: 'Option A' });
  await fireEvent.click(buttonA);

  expect(buttonA.className).toContain('border-[var(--pd-content-card-border)]');
});

test('Expect no deselection when required is true', async () => {
  render(CardSelector, { options, selected: 'a', required: true });

  const buttonA = screen.getByRole('button', { name: 'Option A' });
  await fireEvent.click(buttonA);

  expect(buttonA.className).toContain('border-[var(--pd-content-card-border-selected)]');
});
