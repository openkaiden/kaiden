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

import type { Configuration, Disposable, ExtensionContext } from '@openkaiden/api';
import { addons, configuration } from '@openkaiden/api';
import { delay, http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { beforeEach, expect, test, vi } from 'vitest';

import { CatalogManager } from '/@/manager/catalog-manager';

vi.mock(import('@openkaiden/api'));

class TestCatalogManager extends CatalogManager {
  protected override readonly timeoutMs = 50;
}

const CATALOG_URL = 'https://catalog.test/api/addons.json';
const GIT_ICON_URL = 'https://catalog.test/api/icons/git.svg';
const PUBLISHER = { name: 'kaiden', displayName: 'Kaiden' };
const GIT_SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
const GIT_SVG_DATA_URI = `data:image/svg+xml;base64,${Buffer.from(GIT_SVG).toString('base64')}`;

const server = setupServer();
server.listen({ onUnhandledRequest: 'error' });

let extensionContext: ExtensionContext;
let catalogManager: TestCatalogManager;
let catalogUrl: string | undefined;

function serveCatalog(entries: Record<string, unknown>[]): void {
  server.use(
    http.get(CATALOG_URL, () =>
      HttpResponse.json({
        addons: entries.map(entry => ({ publisher: PUBLISHER, image: 'ghcr.io/openkaiden/addon@sha256:1', ...entry })),
      }),
    ),
  );
}

function svgResponse(): Response {
  return HttpResponse.text(GIT_SVG, { headers: { 'Content-Type': 'image/svg+xml' } });
}

beforeEach(() => {
  vi.resetAllMocks();
  server.resetHandlers();
  console.error = vi.fn();
  catalogUrl = CATALOG_URL;
  vi.mocked(configuration.getConfiguration).mockReturnValue({
    get: () => catalogUrl,
    has: vi.fn(),
    update: vi.fn(),
  } as unknown as Configuration);
  extensionContext = { subscriptions: [] } as unknown as ExtensionContext;
  catalogManager = new TestCatalogManager(extensionContext);
});

test('registers every catalog entry as an addon of its publisher', async () => {
  const registration: Disposable = { dispose: vi.fn() };
  vi.mocked(addons.registerAddon).mockReturnValue(registration);
  serveCatalog([
    {
      name: 'git',
      displayName: 'Git',
      category: 'devtools',
      description: 'Statically linked Git',
      icon: 'icons/git.svg',
      version: '2.56.1',
      commit: 'abc',
      image: 'ghcr.io/openkaiden/openshell-build-image-addons-git@sha256:1234',
      libc: [],
    },
    { name: 'other', displayName: 'Other', publisher: { name: 'acme', displayName: 'Acme' }, icon: null },
  ]);
  server.use(http.get(GIT_ICON_URL, svgResponse));

  await catalogManager.init();

  expect(configuration.getConfiguration).toHaveBeenCalledWith('addons.catalog');
  expect(addons.registerAddon).toHaveBeenCalledWith({
    name: 'git',
    displayName: 'Git',
    publisher: PUBLISHER,
    description: 'Statically linked Git',
    ociImage: 'ghcr.io/openkaiden/openshell-build-image-addons-git@sha256:1234',
    category: 'devtools',
    version: '2.56.1',
    icon: GIT_SVG_DATA_URI,
  });
  expect(addons.registerAddon).toHaveBeenCalledWith({
    name: 'other',
    displayName: 'Other',
    publisher: { name: 'acme', displayName: 'Acme' },
    description: undefined,
    ociImage: 'ghcr.io/openkaiden/addon@sha256:1',
    category: undefined,
    version: undefined,
    icon: undefined,
  });
  expect(extensionContext.subscriptions).toStrictEqual([registration, registration]);
});

test('registers light and dark icons', async () => {
  const PNG = new Uint8Array([137, 80, 78, 71]);
  serveCatalog([
    { name: 'opencode', displayName: 'OpenCode', icon: { light: 'icons/light.svg', dark: 'icons/dark.png' } },
  ]);
  server.use(
    http.get('https://catalog.test/api/icons/light.svg', svgResponse),
    http.get('https://catalog.test/api/icons/dark.png', () =>
      HttpResponse.arrayBuffer(PNG.buffer, { headers: { 'Content-Type': 'image/png' } }),
    ),
  );

  await catalogManager.init();

  expect(addons.registerAddon).toHaveBeenCalledWith(
    expect.objectContaining({
      name: 'opencode',
      icon: { light: GIT_SVG_DATA_URI, dark: `data:image/png;base64,${Buffer.from(PNG).toString('base64')}` },
    }),
  );
});

test('registers nothing and logs when no catalog URL is configured', async () => {
  catalogUrl = '';

  await catalogManager.init();

  expect(addons.registerAddon).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith('No addons catalog URL is configured in addons.catalog.url');
});

test.each([
  { label: 'an HTTP error', response: (): Response => new HttpResponse(null, { status: 500 }) },
  { label: 'a network error', response: (): Response => HttpResponse.error() },
  {
    label: 'malformed JSON',
    response: (): Response => HttpResponse.text('{', { headers: { 'Content-Type': 'application/json' } }),
  },
  { label: 'an invalid payload', response: (): Response => HttpResponse.json({ addons: 'none' }) },
  {
    label: 'a timeout',
    response: async (): Promise<Response> => {
      await delay('infinite');
      return HttpResponse.json({ addons: [] });
    },
  },
])('registers nothing and logs on $label', async ({ response }) => {
  server.use(http.get(CATALOG_URL, response));

  await catalogManager.init();

  expect(addons.registerAddon).not.toHaveBeenCalled();
  expect(extensionContext.subscriptions).toStrictEqual([]);
  expect(console.error).toHaveBeenCalledWith(
    `Unable to load the addons catalog from ${CATALOG_URL}`,
    expect.anything(),
  );
});

test('registers the valid entries and logs the invalid ones', async () => {
  serveCatalog([
    { name: 'codex', displayName: 'Codex', icon: { light: 'icons/codex.svg' } },
    { name: 'git', displayName: 'Git' },
  ]);

  await catalogManager.init();

  expect(addons.registerAddon).toHaveBeenCalledOnce();
  expect(addons.registerAddon).toHaveBeenCalledWith(expect.objectContaining({ name: 'git' }));
  expect(console.error).toHaveBeenCalledWith('Ignoring invalid addons catalog entry 0', expect.any(Error));
});

test.each([
  {
    label: 'cannot be loaded',
    icon: 'icons/git.svg',
    response: (): Response => new HttpResponse(null, { status: 404 }),
  },
  { label: 'is not a valid URL', icon: 'http://[', response: svgResponse },
  { label: 'is on another origin', icon: 'https://elsewhere.test/git.svg', response: svgResponse },
  { label: 'has an unsupported format', icon: 'icons/git.gif', response: svgResponse },
  {
    label: 'is served with another content type',
    icon: 'icons/git.svg',
    response: (): Response => HttpResponse.text('<html/>', { headers: { 'Content-Type': 'text/html' } }),
  },
  {
    label: 'redirects to another origin',
    icon: 'icons/git.svg',
    response: (): Response => HttpResponse.redirect('https://elsewhere.test/git.svg', 302),
  },
  {
    label: 'is too large',
    icon: 'icons/git.svg',
    response: (): Response =>
      HttpResponse.arrayBuffer(new ArrayBuffer(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/svg+xml' } }),
  },
  {
    label: 'times out',
    icon: 'icons/git.svg',
    response: async (): Promise<Response> => {
      await delay('infinite');
      return svgResponse();
    },
  },
])('registers the addon without icon and logs when its icon $label', async ({ icon, response }) => {
  serveCatalog([
    { name: 'git', displayName: 'Git', icon },
    { name: 'codex', displayName: 'Codex' },
  ]);
  server.use(http.get(GIT_ICON_URL, response));

  await catalogManager.init();

  expect(addons.registerAddon).toHaveBeenCalledWith(expect.objectContaining({ name: 'git', icon: undefined }));
  expect(addons.registerAddon).toHaveBeenCalledWith(expect.objectContaining({ name: 'codex' }));
  expect(console.error).toHaveBeenCalledWith(`Unable to load the icon '${icon}' of addon git`, expect.anything());
});

test('registers no icon when one of the light and dark icons fails', async () => {
  serveCatalog([
    { name: 'opencode', displayName: 'OpenCode', icon: { light: 'icons/light.svg', dark: 'icons/dark.svg' } },
  ]);
  server.use(
    http.get('https://catalog.test/api/icons/light.svg', svgResponse),
    http.get('https://catalog.test/api/icons/dark.svg', () => new HttpResponse(null, { status: 404 })),
  );

  await catalogManager.init();

  expect(addons.registerAddon).toHaveBeenCalledWith(expect.objectContaining({ name: 'opencode', icon: undefined }));
});

test('keeps registering the next addons when one registration fails', async () => {
  const registration: Disposable = { dispose: vi.fn() };
  const error = new Error('already registered');
  vi.mocked(addons.registerAddon)
    .mockImplementationOnce(() => {
      throw error;
    })
    .mockReturnValue(registration);
  serveCatalog([
    { name: 'git', displayName: 'Git' },
    { name: 'codex', displayName: 'Codex' },
  ]);

  await catalogManager.init();

  expect(addons.registerAddon).toHaveBeenCalledWith(expect.objectContaining({ name: 'codex' }));
  expect(extensionContext.subscriptions).toStrictEqual([registration]);
  expect(console.error).toHaveBeenCalledWith('Unable to register addon git', error);
});

test('registers nothing when disposed while the icons are loading', async () => {
  const iconRequested = Promise.withResolvers<void>();
  serveCatalog([{ name: 'git', displayName: 'Git', icon: 'icons/git.svg' }]);
  server.use(
    http.get(GIT_ICON_URL, async () => {
      iconRequested.resolve();
      await delay('infinite');
      return svgResponse();
    }),
  );

  const loading = catalogManager.init();
  await iconRequested.promise;
  catalogManager.dispose();
  await loading;

  expect(addons.registerAddon).not.toHaveBeenCalled();
  expect(extensionContext.subscriptions).toStrictEqual([]);
});
