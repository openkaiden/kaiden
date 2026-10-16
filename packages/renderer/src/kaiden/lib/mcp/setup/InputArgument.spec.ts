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

import type { components } from '@openkaiden/mcp-registry-types';
import { render } from '@testing-library/svelte';
import { expect, test, vi } from 'vitest';

import InputArgument from '/@/kaiden/lib/mcp/setup/InputArgument.svelte';

const STRING_INPUT: components['schemas']['Input'] = {
  format: 'string',
  value: 'foo',
  description: 'string input',
  isRequired: false,
  isSecret: false,
};

const FILEPATH_INPUT: components['schemas']['Input'] = {
  format: 'filepath',
  value: 'foo',
  description: 'string input',
  isRequired: false,
  isSecret: false,
};

const SECRET_INPUT: components['schemas']['Input'] = {
  format: 'string',
  value: 'foo',
  description: 'secret string input',
  isRequired: false,
  isSecret: true,
};

test('secret string input should be rendered as password', async () => {
  const { getByLabelText } = render(InputArgument, {
    object: SECRET_INPUT,
    onChange: vi.fn(),
  });

  const input = getByLabelText('password');
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(input).toHaveAttribute('type', 'password');
});

test('string input should be rendered as text', async () => {
  const { getByRole, queryByRole } = render(InputArgument, {
    object: STRING_INPUT,
    onChange: vi.fn(),
  });

  const input = getByRole('textbox');
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(input).toHaveAttribute('type', 'text');

  // no button should be rendered for string input
  const btn = queryByRole('button', { name: 'browse' });
  expect(btn).toBeNull();
});

test('filepath input should be rendered as text with a browse button', async () => {
  const { getByRole } = render(InputArgument, {
    object: FILEPATH_INPUT,
    onChange: vi.fn(),
  });

  const input = getByRole('textbox');
  expect(input).toBeInstanceOf(HTMLInputElement);
  expect(input).toHaveAttribute('type', 'text');

  const btn = getByRole('button', { name: 'browse' });
  expect(btn).toBeInstanceOf(HTMLButtonElement);
});
