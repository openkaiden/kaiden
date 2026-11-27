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
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import { NetworkHelper } from './network-helper';

// virtual clock: sleep() advances it instantly, so the polling loop runs without real time
class TestNetworkHelper extends NetworkHelper {
  time = 0;
  sleeps: number[] = [];

  protected override now(): number {
    return this.time;
  }

  protected override async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.time += ms;
  }
}

let helper: TestNetworkHelper;
let server: SetupServerApi | undefined;

beforeEach(() => {
  vi.resetAllMocks();
  // close the server of the previous test
  server?.close();
  server = undefined;
  helper = new TestNetworkHelper();
});

const READY_URL = 'http://127.0.0.1:50002/ready';
// production-like values
const OPTIONS = { timeout: 120_000, interval: 10_000 };

// answers with the given responses in order, repeating the last one; returns the number of requests received
function listen(...responses: (() => Response)[]): () => number {
  let call = 0;
  server = setupServer(
    http.get(READY_URL, () => {
      const respond = responses[Math.min(call, responses.length - 1)];
      call++;
      assert(respond);
      return respond();
    }),
  );
  server.listen({ onUnhandledRequest: 'error' });
  return () => call;
}

describe('waitForHttpOk', () => {
  test('resolves on the first 2xx response without waiting', async () => {
    const requests = listen(() => HttpResponse.json({ ready: true }));
    const onNotReady = vi.fn();

    await expect(helper.waitForHttpOk(READY_URL, { ...OPTIONS, onNotReady })).resolves.toBeUndefined();

    expect(requests()).toBe(1);
    expect(helper.sleeps).toEqual([]);
    expect(onNotReady).not.toHaveBeenCalled();
  });

  test('polls every interval while the server answers non-2xx and passes each response to onNotReady', async () => {
    const requests = listen(
      () => HttpResponse.json({ message: 'loading' }, { status: 503 }),
      () => HttpResponse.json({ message: 'warming' }, { status: 503 }),
      () => HttpResponse.json({ ready: true }),
    );
    const onNotReady = vi.fn().mockResolvedValue(undefined);

    await helper.waitForHttpOk(READY_URL, { ...OPTIONS, onNotReady });

    expect(requests()).toBe(3);
    expect(helper.sleeps).toEqual([10_000, 10_000]);
    expect(onNotReady).toHaveBeenCalledTimes(2);
    expect(onNotReady).toHaveBeenNthCalledWith(1, expect.objectContaining({ status: 503 }));
  });

  test('keeps polling while the server is not listening', async () => {
    const requests = listen(
      () => HttpResponse.error(),
      () => HttpResponse.error(),
      () => HttpResponse.json({ ready: true }),
    );

    await expect(helper.waitForHttpOk(READY_URL, OPTIONS)).resolves.toBeUndefined();

    expect(requests()).toBe(3);
  });

  test('times out after the timeout with the last connection error as cause', async () => {
    const requests = listen(() => HttpResponse.error());

    const error = await helper.waitForHttpOk(READY_URL, OPTIONS).catch((err: unknown) => err);

    assert(error instanceof Error);
    expect(error.message).toBe(`Timed out after 120000 ms waiting for ${READY_URL}`);
    expect(error.cause).toBeInstanceOf(Error);
    // a request at 0 s then every 10 s up to 120 s
    expect(requests()).toBe(13);
    expect(helper.sleeps).toEqual(Array(12).fill(10_000));
  });

  test('does not wait past the timeout when it is not a multiple of the interval', async () => {
    listen(() => new HttpResponse(null, { status: 503 }));

    const error = await helper
      .waitForHttpOk(READY_URL, { timeout: 25_000, interval: 10_000 })
      .catch((err: unknown) => err);

    assert(error instanceof Error);
    expect(error.cause).toBeUndefined();
    expect(helper.sleeps).toEqual([10_000, 10_000, 5_000]);
  });
});

describe('convertHost', () => {
  test.each([
    ['localhost', 'host.docker.internal'],
    ['api.example.com', 'api.example.com'],
    ['127.0.0.1', 'host.docker.internal'],
  ])('converts %s to %s', (host, expected) => {
    expect(helper.convertHost(host)).toBe(expected);
  });
});
