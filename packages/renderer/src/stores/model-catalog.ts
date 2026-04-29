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

import { writable } from 'svelte/store';

import { configurationProperties } from './configurationProperties';

const DISABLED_MODELS_KEY = 'modelCatalog.disabledModels';
let requestId = 0;

export const disabledModels = writable<Set<string>>(new Set());

configurationProperties.subscribe(() => {
  if (!window?.getConfigurationValue) {
    return;
  }

  const currentRequestId = ++requestId;
  window
    .getConfigurationValue<string[]>(DISABLED_MODELS_KEY)
    ?.then(value => {
      if (currentRequestId === requestId) {
        const raw = value ?? [];
        const migrated = raw.map(key => {
          if (key.includes('::')) return key;
          const idx = key.indexOf(':');
          return idx === -1 ? key : `${key.slice(0, idx)}::${key.slice(idx + 1)}`;
        });
        const normalized = [...new Set(migrated)];
        disabledModels.set(new Set(normalized));
        if (normalized.length !== raw.length || normalized.some((k, i) => k !== raw[i])) {
          window.updateConfigurationValue(DISABLED_MODELS_KEY, normalized).catch((err: unknown) => {
            console.error('Failed to persist migrated disabled models', err);
          });
        }
      }
    })
    ?.catch((err: unknown) => console.error(`Error getting configuration value ${DISABLED_MODELS_KEY}`, err));
});

export function modelKey(providerId: string, label: string): string {
  return `${providerId}::${label}`;
}

export function toggleModel(providerId: string, label: string): void {
  disabledModels.update(set => {
    const key = modelKey(providerId, label);
    const next = new Set(set);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    window.updateConfigurationValue(DISABLED_MODELS_KEY, [...next]).catch((err: unknown) => {
      console.error('Failed to persist disabled models', err);
    });
    return next;
  });
}

export function isModelEnabled(disabled: Set<string>, providerId: string, label: string): boolean {
  return !disabled.has(modelKey(providerId, label));
}
