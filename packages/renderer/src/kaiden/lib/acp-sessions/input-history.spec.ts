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

import { describe, expect, test } from 'vitest';

import { InputHistory } from './input-history.js';

describe('InputHistory', () => {
  test('should return undefined when navigating back with no history', () => {
    const history = new InputHistory();
    expect(history.navigateBack('')).toBeUndefined();
  });

  test('should return undefined when navigating forward with no history', () => {
    const history = new InputHistory();
    expect(history.navigateForward()).toBeUndefined();
  });

  test('should navigate back through sent messages', () => {
    const history = new InputHistory();
    history.push('msg1');
    history.push('msg2');
    history.push('msg3');

    expect(history.navigateBack('')).toBe('msg3');
    expect(history.navigateBack('msg3')).toBe('msg2');
    expect(history.navigateBack('msg2')).toBe('msg1');
  });

  test('should stay on oldest entry when navigating back at start', () => {
    const history = new InputHistory();
    history.push('msg1');
    history.push('msg2');

    expect(history.navigateBack('')).toBe('msg2');
    expect(history.navigateBack('msg2')).toBe('msg1');
    // Already at oldest — should return undefined
    expect(history.navigateBack('msg1')).toBeUndefined();
  });

  test('should navigate forward through sent messages', () => {
    const history = new InputHistory();
    history.push('msg1');
    history.push('msg2');
    history.push('msg3');

    // Navigate back to oldest
    history.navigateBack('');
    history.navigateBack('msg3');
    history.navigateBack('msg2');

    // Navigate forward
    expect(history.navigateForward()).toBe('msg2');
    expect(history.navigateForward()).toBe('msg3');
  });

  test('should restore draft when navigating past newest entry', () => {
    const history = new InputHistory();
    history.push('msg1');

    // Start with a draft typed
    expect(history.navigateBack('my draft')).toBe('msg1');
    // Navigate forward past the newest — should restore draft
    expect(history.navigateForward()).toBe('my draft');
  });

  test('should save empty draft and restore it', () => {
    const history = new InputHistory();
    history.push('msg1');

    expect(history.navigateBack('')).toBe('msg1');
    expect(history.navigateForward()).toBe('');
  });

  test('should not navigate forward when not in history mode', () => {
    const history = new InputHistory();
    history.push('msg1');

    // Not navigating — forward does nothing
    expect(history.navigateForward()).toBeUndefined();
  });

  test('should ignore empty or whitespace-only messages', () => {
    const history = new InputHistory();
    history.push('');
    history.push('   ');
    history.push('\n');

    expect(history.navigateBack('')).toBeUndefined();
  });

  test('should deduplicate consecutive identical messages', () => {
    const history = new InputHistory();
    history.push('hello');
    history.push('hello');
    history.push('hello');

    expect(history.navigateBack('')).toBe('hello');
    // Should have only one entry
    expect(history.navigateBack('hello')).toBeUndefined();
  });

  test('should allow non-consecutive duplicates', () => {
    const history = new InputHistory();
    history.push('hello');
    history.push('world');
    history.push('hello');

    expect(history.navigateBack('')).toBe('hello');
    expect(history.navigateBack('hello')).toBe('world');
    expect(history.navigateBack('world')).toBe('hello');
  });

  test('should reset cursor after push', () => {
    const history = new InputHistory();
    history.push('msg1');
    history.push('msg2');

    // Navigate into history
    history.navigateBack('');

    // Push a new message
    history.push('msg3');

    // Should start from the newest again
    expect(history.navigateBack('')).toBe('msg3');
  });

  test('should trim messages before storing', () => {
    const history = new InputHistory();
    history.push('  hello  ');

    expect(history.navigateBack('')).toBe('hello');
  });

  test('full cycle: send 3, navigate back and forward, then restore draft', () => {
    const history = new InputHistory();
    history.push('msg1');
    history.push('msg2');
    history.push('msg3');

    // ArrowUp three times from draft
    expect(history.navigateBack('draft text')).toBe('msg3');
    expect(history.navigateBack('msg3')).toBe('msg2');
    expect(history.navigateBack('msg2')).toBe('msg1');

    // At oldest — stay
    expect(history.navigateBack('msg1')).toBeUndefined();

    // ArrowDown back to newest and then to draft
    expect(history.navigateForward()).toBe('msg2');
    expect(history.navigateForward()).toBe('msg3');
    expect(history.navigateForward()).toBe('draft text');

    // No longer navigating
    expect(history.navigateForward()).toBeUndefined();
  });

  test('should pre-populate history from prompt events', () => {
    const history = new InputHistory();
    history.populateFromEvents(['first prompt', 'second prompt']);

    expect(history.navigateBack('')).toBe('second prompt');
    expect(history.navigateBack('second prompt')).toBe('first prompt');
  });

  test('should only populate from events once', () => {
    const history = new InputHistory();
    history.populateFromEvents(['prompt1']);
    history.push('user msg');
    // Second call is a no-op
    history.populateFromEvents(['prompt1', 'extra']);

    expect(history.navigateBack('')).toBe('user msg');
    expect(history.navigateBack('user msg')).toBe('prompt1');
    // 'extra' should not be present
    expect(history.navigateBack('prompt1')).toBeUndefined();
  });

  test('should handle empty prompt events', () => {
    const history = new InputHistory();
    history.populateFromEvents([]);

    expect(history.navigateBack('')).toBeUndefined();
  });
});
