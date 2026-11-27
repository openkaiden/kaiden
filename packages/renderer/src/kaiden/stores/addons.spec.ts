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

import type { Addon } from '@openkaiden/api';
import { get } from 'svelte/store';
import { beforeEach, expect, test, vi } from 'vitest';

import { addons } from './addons';

const addon: Addon = {
  id: 'kaiden.git',
  name: 'git',
  displayName: 'Git',
  publisher: { name: 'kaiden', displayName: 'Kaiden' },
  ociImage: 'ghcr.io/addons/git:1',
};

beforeEach(() => {
  vi.resetAllMocks();
  addons.set([]);
});

test.each(['system-ready', 'extensions-already-started'])('fetches addons on %s', async eventName => {
  vi.mocked(window.getAddons).mockResolvedValue([addon]);

  window.dispatchEvent(new Event(eventName));

  await vi.waitFor(() => expect(get(addons)).toStrictEqual([addon]));
});
