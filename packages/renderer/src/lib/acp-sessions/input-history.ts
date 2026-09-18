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

/**
 * Manages sent-message history navigation for chat inputs.
 *
 * Pressing ArrowUp in an empty (or history-navigated) input cycles
 * backward through previously sent messages. ArrowDown cycles forward.
 * The in-progress draft text is saved when the user first presses
 * ArrowUp and restored when they navigate past the newest entry.
 */
export class InputHistory {
  readonly #entries: string[] = [];
  #cursor = -1;
  #draft = '';
  #populated = false;

  /** Record a sent message. Resets the navigation cursor. */
  push(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Avoid consecutive duplicates
    if (this.#entries.length > 0 && this.#entries[this.#entries.length - 1] === trimmed) {
      this.#resetCursor();
      return;
    }
    this.#entries.push(trimmed);
    this.#resetCursor();
  }

  /**
   * Navigate backward (older). Returns the entry text to display,
   * or `undefined` if there is no history to navigate to.
   *
   * @param currentText The current input value (saved as draft on
   *   the first backward navigation).
   */
  navigateBack(currentText: string): string | undefined {
    if (this.#entries.length === 0) return undefined;

    if (this.#cursor === -1) {
      // Entering history mode — save the current draft
      this.#draft = currentText;
      this.#cursor = this.#entries.length - 1;
      return this.#entries[this.#cursor];
    }

    if (this.#cursor > 0) {
      this.#cursor--;
      return this.#entries[this.#cursor];
    }

    // Already at the oldest entry — stay put
    return undefined;
  }

  /**
   * Navigate forward (newer). Returns the entry text to display,
   * or `undefined` if already at the newest position (draft restored
   * via a separate return path).
   *
   * When the user moves past the newest entry, the saved draft is
   * returned and the cursor resets.
   */
  navigateForward(): string | undefined {
    if (this.#cursor === -1) return undefined;

    if (this.#cursor < this.#entries.length - 1) {
      this.#cursor++;
      return this.#entries[this.#cursor];
    }

    // Past the newest entry — restore draft
    const draft = this.#draft;
    this.#resetCursor();
    return draft;
  }

  /**
   * Pre-populate history from existing prompt events (e.g. when
   * loading a session from disk). No-op after the first call so
   * live-session event refreshes don't re-add entries.
   */
  populateFromEvents(promptTexts: string[]): void {
    if (this.#populated) return;
    this.#populated = true;
    for (const text of promptTexts) {
      this.push(text);
    }
  }

  #resetCursor(): void {
    this.#cursor = -1;
    this.#draft = '';
  }
}
