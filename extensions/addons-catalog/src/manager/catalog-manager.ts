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

import { posix } from 'node:path';

import type { AddonRegistration, ExtensionContext } from '@openkaiden/api';
import { addons, configuration } from '@openkaiden/api';
import { inject, injectable } from 'inversify';
import { z } from 'zod';

import { ExtensionContextSymbol } from '/@/inject/symbol';

@injectable()
export class CatalogManager {
  protected static readonly CONFIGURATION_SECTION = 'addons.catalog';
  protected static readonly CONFIGURATION_KEY = 'url';
  private static readonly MAX_ICON_BYTES = 1024 * 1024;
  private static readonly CATALOG_SCHEMA = z.object({ addons: z.array(z.unknown()) });
  private static readonly ENTRY_SCHEMA = z.looseObject({
    name: z.string(),
    displayName: z.string(),
    publisher: z.object({ name: z.string(), displayName: z.string() }),
    description: z.string().optional(),
    category: z.string().optional(),
    version: z.string().optional(),
    // the catalog uses null for "no icon"
    icon: z
      .union([z.string(), z.object({ light: z.string(), dark: z.string() })])
      .nullish()
      .transform(icon => icon ?? undefined),
    image: z.string(),
  });
  private static readonly ICON_CONTENT_TYPES = new Map([
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
  ]);

  protected readonly timeoutMs: number = 10_000;

  readonly #abortController = new AbortController();

  constructor(@inject(ExtensionContextSymbol) private readonly extensionContext: ExtensionContext) {}

  async init(): Promise<void> {
    const setting = `${CatalogManager.CONFIGURATION_SECTION}.${CatalogManager.CONFIGURATION_KEY}`;
    const catalogUrl = configuration
      .getConfiguration(CatalogManager.CONFIGURATION_SECTION)
      .get<string>(CatalogManager.CONFIGURATION_KEY);
    if (!catalogUrl) {
      console.error(`No addons catalog URL is configured in ${setting}`);
      return;
    }

    let entries: unknown[];
    try {
      const response = await fetch(catalogUrl, { signal: this.signal() });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      entries = CatalogManager.CATALOG_SCHEMA.parse(await response.json()).addons;
    } catch (error: unknown) {
      console.error(`Unable to load the addons catalog from ${catalogUrl}`, error);
      return;
    }

    const validEntries = entries.flatMap((entry, index) => {
      const result = CatalogManager.ENTRY_SCHEMA.safeParse(entry);
      if (!result.success) {
        console.error(`Ignoring invalid addons catalog entry ${index}`, result.error);
        return [];
      }
      return [result.data];
    });

    const icons = await Promise.all(validEntries.map(entry => this.fetchIcons(catalogUrl, entry.name, entry.icon)));

    // the extension may have been stopped while the catalog and icons were loading
    if (this.#abortController.signal.aborted) {
      return;
    }

    for (const [index, entry] of validEntries.entries()) {
      try {
        this.extensionContext.subscriptions.push(
          addons.registerAddon({
            name: entry.name,
            displayName: entry.displayName,
            publisher: entry.publisher,
            description: entry.description,
            ociImage: entry.image,
            category: entry.category,
            version: entry.version,
            icon: icons[index],
          }),
        );
      } catch (error: unknown) {
        console.error(`Unable to register addon ${entry.name}`, error);
      }
    }
  }

  dispose(): void {
    this.#abortController.abort();
  }

  private signal(): AbortSignal {
    return AbortSignal.any([this.#abortController.signal, AbortSignal.timeout(this.timeoutMs)]);
  }

  private async fetchIcons(
    catalogUrl: string,
    addonName: string,
    icon: AddonRegistration['icon'],
  ): Promise<AddonRegistration['icon']> {
    if (!icon) {
      return undefined;
    }
    if (typeof icon === 'string') {
      return this.fetchIcon(catalogUrl, addonName, icon);
    }
    const [light, dark] = await Promise.all([
      this.fetchIcon(catalogUrl, addonName, icon.light),
      this.fetchIcon(catalogUrl, addonName, icon.dark),
    ]);
    return light && dark ? { light, dark } : undefined;
  }

  // icons are inlined as data URIs, so only the catalog origin is ever fetched (redirects are refused)
  private async fetchIcon(catalogUrl: string, addonName: string, icon: string): Promise<string | undefined> {
    try {
      const url = new URL(icon, catalogUrl);
      const catalogOrigin = new URL(catalogUrl).origin;
      if (url.origin !== catalogOrigin) {
        throw new Error(`the icon is not served from the catalog origin ${catalogOrigin}`);
      }
      const contentType = CatalogManager.ICON_CONTENT_TYPES.get(posix.extname(url.pathname));
      if (!contentType) {
        throw new Error('only svg and png icons are supported');
      }
      const response = await fetch(url, { redirect: 'error', signal: this.signal() });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const responseType = response.headers.get('content-type')?.split(';')[0].trim();
      if (responseType !== contentType) {
        throw new Error(`the icon is served as ${responseType} instead of ${contentType}`);
      }
      const data = await response.arrayBuffer();
      if (data.byteLength > CatalogManager.MAX_ICON_BYTES) {
        throw new Error(`the icon is larger than ${CatalogManager.MAX_ICON_BYTES} bytes`);
      }
      return `data:${contentType};base64,${Buffer.from(data).toString('base64')}`;
    } catch (error: unknown) {
      console.error(`Unable to load the icon '${icon}' of addon ${addonName}`, error);
      return undefined;
    }
  }
}
