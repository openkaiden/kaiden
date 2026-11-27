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
import { setupServer, type SetupServerApi } from 'msw/node';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AiLabDaemonClient } from './ai-lab-daemon-client';

const PS_URL = 'http://localhost:10434/api/ps';

describe('AiLabDaemonClient', () => {
  let server: SetupServerApi | undefined;
  let client: AiLabDaemonClient;

  beforeEach(() => {
    vi.resetAllMocks();

    server?.close();
    server = setupServer();
    server.listen({ onUnhandledRequest: 'error' });

    console.debug = vi.fn();

    client = new AiLabDaemonClient();
  });

  describe('getBaseURL', () => {
    test('should target the daemon on the given port', () => {
      expect(client.getBaseURL(10434)).toBe('http://localhost:10434');
      expect(client.getBaseURL(12345)).toBe('http://localhost:12345');
    });
  });

  describe('listRunningModels', () => {
    test('should query the daemon on the given port', async () => {
      server?.use(http.get('http://localhost:12345/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }] })));

      await expect(client.listRunningModels(12345)).resolves.toEqual(['m1']);
    });

    test('should return the names of the running models', async () => {
      server?.use(http.get(PS_URL, () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })));

      await expect(client.listRunningModels(10434)).resolves.toEqual(['m1', 'm2']);
    });

    test('should ignore entries without a string name', async () => {
      server?.use(
        http.get(PS_URL, () => HttpResponse.json({ models: [{ name: 'valid-model' }, { foo: 1 }, { name: 42 }, 'x'] })),
      );

      await expect(client.listRunningModels(10434)).resolves.toEqual(['valid-model']);
    });

    test('should return no model and log why when the payload has no models array', async () => {
      server?.use(http.get(PS_URL, () => HttpResponse.json({ unexpected: 'data' })));

      await expect(client.listRunningModels(10434)).resolves.toEqual([]);
      expect(console.debug).toHaveBeenCalledWith(expect.stringContaining(PS_URL), expect.anything());
    });

    test('should reject on an error status', async () => {
      server?.use(http.get(PS_URL, () => new HttpResponse(undefined, { status: 503 })));

      await expect(client.listRunningModels(10434)).rejects.toThrow('HTTP error, status: 503');
    });

    test('should reject when the daemon is unreachable', async () => {
      server?.use(http.get(PS_URL, () => HttpResponse.error()));

      await expect(client.listRunningModels(10434)).rejects.toThrow();
    });
  });
});
