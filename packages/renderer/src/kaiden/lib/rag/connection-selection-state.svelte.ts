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

import { SvelteSet } from 'svelte/reactivity';

import type { ProviderInfo } from '/@api/provider-info';

/**
 * Represents a selectable connection tile in the connection selection UI.
 */
export interface ConnectionOption {
  /** Unique identifier for the option, typically `providerId:connectionNameOrId`. */
  key: string;
  /** The provider that owns this connection. */
  providerId: string;
  /** User-visible label for the connection. */
  displayName: string;
  /** User-visible label for the owning provider. */
  providerName: string;
}

/**
 * Selection state of a connection section (tiles, "Create new" card, inline creation form).
 *
 * Owned by the parent and passed to `ConnectionSelection`, so the parent derives the
 * selected connection from `selectedKey` instead of receiving it through a callback.
 */
export class ConnectionSelectionState {
  readonly #getOptions: () => readonly ConnectionOption[];
  readonly #getFactoryProviders: () => readonly ProviderInfo[];

  /** The user's explicit tile click (empty when cleared). */
  #userChoice = $state('');
  /** Whether the user explicitly opened the create form. */
  #showCreateForm = $state(false);
  /** Which factory provider the user selected in the picker (if any). */
  #selectedFactoryProviderId = $state<string>();
  /** Connection keys that existed when the current inline creation was submitted. */
  #preCreationKeys = new SvelteSet<string>();
  /** True from the inline form submission until the user selects or reopens the form. */
  #creationPending = $state(false);
  /** Factory that started the pending inline creation. */
  #creationFactoryId = $state<string>();
  /** Bumped to remount a fresh inline creation form. */
  #creationAttempt = $state(0);

  /**
   * Factory provider used by the inline creation form: the one picked by the user,
   * otherwise the only factory when there is exactly one, otherwise `undefined`
   * (the component shows a factory picker).
   */
  activeFactoryProvider = $derived.by((): ProviderInfo | undefined => {
    if (this.#selectedFactoryProviderId) {
      return this.factoryProviders.find(p => p.internalId === this.#selectedFactoryProviderId);
    }
    if (this.factoryProviders.length === 1) return this.factoryProviders[0];
    return undefined;
  });

  /**
   * Key of the first connection from the active factory that did not exist when the
   * pending inline creation was submitted.
   */
  #createdConnectionKey = $derived.by((): string | undefined => {
    const factoryId = this.#creationFactoryId;
    if (!this.#creationPending || !factoryId) return undefined;
    return this.options.find(o => o.providerId === factoryId && !this.#preCreationKeys.has(o.key))?.key;
  });

  /**
   * Key of the selected connection: the user's tile click if it still exists, otherwise
   * the connection created inline, otherwise `''`.
   */
  selectedKey = $derived.by((): string => {
    if (this.#userChoice && this.options.some(o => o.key === this.#userChoice)) return this.#userChoice;
    return this.#createdConnectionKey ?? '';
  });

  formVisible = $derived.by((): boolean => {
    // Collapse the form once the inline-created connection appears.
    if (this.#createdConnectionKey) return false;
    // Show when explicitly opened, while an inline creation is pending,
    // or when no connections exist but a factory can create one.
    return (
      this.#showCreateForm || this.#creationPending || (this.options.length === 0 && this.factoryProviders.length > 0)
    );
  });

  constructor(getOptions: () => readonly ConnectionOption[], getFactoryProviders: () => readonly ProviderInfo[]) {
    this.#getOptions = getOptions;
    this.#getFactoryProviders = getFactoryProviders;
  }

  get options(): readonly ConnectionOption[] {
    return this.#getOptions();
  }

  get factoryProviders(): readonly ProviderInfo[] {
    return this.#getFactoryProviders();
  }

  /** True while an inline creation is pending; the factory picker is locked meanwhile. */
  get creationPending(): boolean {
    return this.#creationPending;
  }

  get creationAttempt(): number {
    return this.#creationAttempt;
  }

  select(key: string): void {
    this.#userChoice = key;
    this.#showCreateForm = false;
    this.#creationPending = false;
  }

  openCreateForm(): void {
    this.#showCreateForm = true;
    this.#userChoice = '';
    this.#creationPending = false;
    this.#preCreationKeys.clear();
    this.#creationAttempt++;
  }

  selectFactoryProvider(internalId: string): void {
    // Switching factory would remount the inline form in the middle of the creation.
    if (this.#creationPending) return;
    this.#selectedFactoryProviderId = internalId;
  }

  /** Snapshots the current connections so the one created inline can be auto-selected. */
  startCreation(): void {
    this.#preCreationKeys.clear();
    for (const option of this.options) this.#preCreationKeys.add(option.key);
    this.#creationFactoryId = this.activeFactoryProvider?.id;
    this.#creationPending = true;
  }

  /** Stops tracking a creation that failed. */
  failCreation(): void {
    this.#creationPending = false;
  }
}
