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

import { type Configuration, configuration } from '@openkaiden/api';
import { http, HttpResponse } from 'msw';
import { setupServer, type SetupServerApi } from 'msw/node';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { AiLabDaemonClient } from './ai-lab-daemon-client';

vi.mock(import('@openkaiden/api'));

const PS_URL = 'http://localhost:10434/api/ps';

describe('AiLabDaemonClient', () => {
  let server: SetupServerApi | undefined;
  let apiPortConfiguration: Configuration;
  let client: AiLabDaemonClient;

  beforeEach(() => {
    vi.resetAllMocks();

    server?.close();
    server = setupServer();
    server.listen({ onUnhandledRequest: 'error' });

    apiPortConfiguration = { get: vi.fn(), has: vi.fn(), update: vi.fn() };
    vi.mocked(configuration.getConfiguration).mockReturnValue(apiPortConfiguration);
    vi.mocked(apiPortConfiguration.get).mockReturnValue(undefined);

    client = new AiLabDaemonClient();
  });

  describe('port', () => {
    test('should default to 10434 when the setting is not set', () => {
      expect(client.getPort()).toBe(10434);
      expect(client.getBaseURL()).toBe('http://localhost:10434');
      expect(configuration.getConfiguration).toHaveBeenCalledWith('podman-ai-lab');
      expect(apiPortConfiguration.get).toHaveBeenCalledWith('apiPort');
    });

    test('should use the configured port', () => {
      vi.mocked(apiPortConfiguration.get).mockReturnValue(12345);

      expect(client.getPort()).toBe(12345);
      expect(client.getBaseURL()).toBe('http://localhost:12345');
    });

    test.each([0, 70000, 1.5, 'abc'])('should fall back to 10434 and warn on the invalid value %s', value => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.mocked(apiPortConfiguration.get).mockReturnValue(value);

      expect(client.getPort()).toBe(10434);
      expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('podman-ai-lab.apiPort'));
    });

    test('should query the daemon on the configured port', async () => {
      vi.mocked(apiPortConfiguration.get).mockReturnValue(12345);
      server?.use(http.get('http://localhost:12345/api/ps', () => HttpResponse.json({ models: [{ name: 'm1' }] })));

      await expect(client.listRunningModels()).resolves.toEqual(['m1']);
    });
  });

  describe('listRunningModels', () => {
    test('should return the names of the running models', async () => {
      server?.use(http.get(PS_URL, () => HttpResponse.json({ models: [{ name: 'm1' }, { name: 'm2' }] })));

      await expect(client.listRunningModels()).resolves.toEqual(['m1', 'm2']);
    });

    test('should ignore entries without a string name', async () => {
      server?.use(
        http.get(PS_URL, () => HttpResponse.json({ models: [{ name: 'valid-model' }, { foo: 1 }, { name: 42 }, 'x'] })),
      );

      await expect(client.listRunningModels()).resolves.toEqual(['valid-model']);
    });

    test('should return no model when the payload has no models array', async () => {
      server?.use(http.get(PS_URL, () => HttpResponse.json({ unexpected: 'data' })));

      await expect(client.listRunningModels()).resolves.toEqual([]);
    });

    test('should reject on an error status', async () => {
      server?.use(http.get(PS_URL, () => new HttpResponse(undefined, { status: 503 })));

      await expect(client.listRunningModels()).rejects.toThrow('HTTP error, status: 503');
    });

    test('should reject when the daemon is unreachable', async () => {
      server?.use(http.get(PS_URL, () => HttpResponse.error()));

      await expect(client.listRunningModels()).rejects.toThrow();
    });
  });
});
