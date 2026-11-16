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

import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { AiLabDaemonClient } from './ai-lab-daemon-client';

const PS_URL = 'http://localhost:10434/api/ps';

describe('AiLabDaemonClient', () => {
  const server = setupServer();
  let client: AiLabDaemonClient;

  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  beforeEach(() => {
    server.resetHandlers();
    client = new AiLabDaemonClient();
  });

  afterAll(() => {
    server.close();
  });

  test('should return the names of the running models', async () => {
    server.use(http.get(PS_URL, () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })));

    await expect(client.listRunningModels()).resolves.toEqual(['m1', 'm2']);
  });

  test('should ignore entries without a string name', async () => {
    server.use(
      http.get(PS_URL, () => HttpResponse.json({ models: [{ name: 'valid-model' }, { foo: 1 }, { name: 42 }, 'x'] })),
    );

    await expect(client.listRunningModels()).resolves.toEqual(['valid-model']);
  });

  test('should return no model when the payload has no models array', async () => {
    server.use(http.get(PS_URL, () => HttpResponse.json({ unexpected: 'data' })));

    await expect(client.listRunningModels()).resolves.toEqual([]);
  });

  test('should reject on an error status', async () => {
    server.use(http.get(PS_URL, () => new HttpResponse(undefined, { status: 503 })));

    await expect(client.listRunningModels()).rejects.toThrow('HTTP error, status: 503');
  });

  test('should reject when the daemon is unreachable', async () => {
    server.use(http.get(PS_URL, () => HttpResponse.error()));

    await expect(client.listRunningModels()).rejects.toThrow();
  });
});
