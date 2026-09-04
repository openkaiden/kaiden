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

import * as path from 'node:path';

import type { App as ElectronApp } from 'electron';
import { nativeImage } from 'electron';

import product from '/@product.json' with { type: 'json' };

import { isMac } from './util.js';

/**
 * Configures a separate identity for dev instances so they can run
 * alongside the packaged application without conflicts.
 *
 * Must be called before {@link ElectronApp.requestSingleInstanceLock}
 * so that the lock is scoped to the dev-specific userData directory.
 */
export function configureDevInstance(app: ElectronApp): void {
  if (!import.meta.env.DEV) return;

  const devUserData = path.join(app.getPath('appData'), `${product.paths.config}-dev`);
  app.setPath('userData', devUserData);

  app.setName(`${product.name} Dev`);
}

/**
 * Sets the macOS Dock icon to the dev variant after the app is ready.
 */
export function applyDevDockIcon(app: ElectronApp): void {
  if (!import.meta.env.DEV) return;
  if (!isMac()) return;

  const devIconPath = path.resolve(app.getAppPath(), 'buildResources/icon-dev.png');
  const devIcon = nativeImage.createFromPath(devIconPath);
  app.dock?.setIcon(devIcon);
}

/**
 * Returns the path to the dev icon for use as a window icon (Linux/Windows),
 * or undefined in production.
 */
export function getDevIconPath(app: ElectronApp): string | undefined {
  if (!import.meta.env.DEV) return undefined;
  return path.resolve(app.getAppPath(), 'buildResources/icon-dev.png');
}
