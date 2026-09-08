/**********************************************************************
 * Copyright (C) 2023-2025 Red Hat, Inc.
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

import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { TinroRouteMeta } from 'tinro';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { IConfigurationPropertyRecordedSchema } from '/@api/configuration/models';

import { settingsNavigationEntries } from './PreferencesNavigation';
import PreferencesNavigation from './PreferencesNavigation.svelte';
import { configurationProperties } from './stores/configurationProperties';

// fake the window.events object
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(global, 'window', {
    value: {
      getConfigurationValue: vi.fn(),
      events: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        receive: (_channel: string, func: any) => {
          func();
        },
      },
    },
    writable: true,
  });
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValue(true);
});

test('Test rendering of the preferences navigation bar and its items', () => {
  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  const navigationBar = screen.getByRole('navigation', { name: 'PreferencesNavigation' });
  expect(navigationBar).toBeVisible();

  const resources = screen.getByRole('link', { name: 'Resources' });
  expect(resources).toBeVisible();
  const proxy = screen.getByRole('link', { name: 'Proxy' });
  expect(proxy).toBeVisible();
});

test.skip('Test rendering of the compatibility docker pag if config is available', async () => {
  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  // wait docker compatibility is being set
  await tick();

  // expect getConfigurationValue to be called
  expect(window.getConfigurationValue).toBeCalledWith('dockerCompatibility.enabled');

  const dockerCompatLink = screen.getByRole('link', { name: 'Docker Compatibility' });
  expect(dockerCompatLink).toBeVisible();
});

test.skip('Test rendering of the compatibility docker page is hidden if disabled', async () => {
  // mock window.getConfigurationValue
  vi.mocked(window.getConfigurationValue<boolean>).mockReset();
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValue(false);

  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  // wait docker compatibility is being set
  await tick();

  // expect getConfigurationValue to be called
  expect(window.getConfigurationValue).toBeCalledWith('dockerCompatibility.enabled');

  // should not be displayed
  const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });
  expect(dockerCompatLink).toBeNull();
});

test.skip('Test rendering of the compatibility docker page does change if config changes from enabled to disabled', async () => {
  // mock window.getConfigurationValue
  vi.mocked(window.getConfigurationValue<boolean>).mockClear();
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValueOnce(true);
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValue(false);

  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  // wait docker compatibility is being set
  await tick();

  // expect getConfigurationValue to be called
  expect(window.getConfigurationValue).toBeCalledWith('dockerCompatibility.enabled');

  const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });

  expect(dockerCompatLink).not.toBeNull();

  // wait docker compatibility is being set
  configurationProperties.set([]);
  await vi.waitFor(() => {
    const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });
    expect(dockerCompatLink).toBeNull();
  });
});

test.skip('Test rendering of the compatibility docker page does change if config changes from disabled to enabled', async () => {
  // mock window.getConfigurationValue
  vi.mocked(window.getConfigurationValue<boolean>).mockClear();
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValueOnce(false);
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValue(true);

  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  // wait docker compatibility is being set
  await tick();

  // expect getConfigurationValue to be called
  expect(window.getConfigurationValue).toBeCalledWith('dockerCompatibility.enabled');

  const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });

  expect(dockerCompatLink).toBeNull();

  // wait docker compatibility is being set
  configurationProperties.set([]);
  await vi.waitFor(() => {
    const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });
    expect(dockerCompatLink).not.toBeNull();
  });
});

test.skip('Test rendering of the compatibility docker page does change if config changes when other config settings is updated', async () => {
  // mock window.getConfigurationValue
  vi.mocked(window.getConfigurationValue<boolean>).mockClear();
  vi.mocked(window.getConfigurationValue<boolean>).mockResolvedValueOnce(true);

  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  // wait docker compatibility is being set
  await tick();

  // expect getConfigurationValue to be called
  expect(window.getConfigurationValue).toBeCalledWith('dockerCompatibility.enabled');

  const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });

  expect(dockerCompatLink).not.toBeNull();

  // Simultaing other preferences being set - undefined value (should not change the visibility)
  configurationProperties.set([]);
  await vi.waitFor(() => {
    const dockerCompatLink = screen.queryByRole('link', { name: 'Docker Compatibility' });
    expect(dockerCompatLink).not.toBeNull();
  });
});

const EXPERIMENTAL_CONFIG: IConfigurationPropertyRecordedSchema = {
  experimental: {
    githubDiscussionLink: '',
  },
  id: 'dummy-config',
  title: 'Dummy Config',
  default: false,
  parentId: 'preferences.potatoes',
  type: 'boolean',
  scope: 'DEFAULT',
};

test.skip('experimental configuration should be visible if one property has experimental property', async () => {
  configurationProperties.set([EXPERIMENTAL_CONFIG]);
  const { getByRole } = render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  await vi.waitFor(() => {
    const experimental = getByRole('link', { name: 'Experimental' });
    expect(experimental).toBeDefined();
  });
});

test('settings navbar renders root entries in correct order: AI Tools, OpenShell, Connections', () => {
  const titles = settingsNavigationEntries.map(entry => entry.title);

  const aiToolsIndex = titles.indexOf('AI tools');
  const openShellIndex = titles.indexOf('OpenShell');
  const connectionsIndex = titles.indexOf('Connections');

  expect(aiToolsIndex).toBeLessThan(openShellIndex);
  expect(openShellIndex).toBeLessThan(connectionsIndex);
});

test('Gateways nav entry is always visible', () => {
  render(PreferencesNavigation, {
    meta: {
      url: '/',
    } as unknown as TinroRouteMeta,
  });

  const gatewaysLink = screen.getByRole('link', { name: 'Gateways' });
  expect(gatewaysLink).toBeVisible();
  expect(gatewaysLink).toHaveAttribute('href', '/preferences/openshell/gateways');
});

describe('Static navigation entry children', () => {
  let originalLength: number;

  beforeEach(() => {
    originalLength = settingsNavigationEntries.length;
    settingsNavigationEntries.push({
      title: 'Test Parent',
      href: '/preferences/test-parent',
      visible: true,
      children: [
        { title: 'Child One', href: '/preferences/test-parent/child-one', visible: true },
        { title: 'Child Two', href: '/preferences/test-parent/child-two', visible: true },
        { title: 'Hidden Child', href: '/preferences/test-parent/hidden', visible: false },
      ],
    });
  });

  afterEach(() => {
    settingsNavigationEntries.length = originalLength;
  });

  test('should start expanded when entry has expanded set to true', async () => {
    settingsNavigationEntries.push({
      title: 'Auto Expanded',
      href: '/preferences/auto-expanded',
      visible: true,
      expanded: true,
      children: [{ title: 'Auto Child', href: '/preferences/auto-expanded/child', visible: true }],
    });

    render(PreferencesNavigation, {
      meta: { url: '/' } as unknown as TinroRouteMeta,
    });

    await vi.waitFor(() => {
      expect(screen.getByRole('link', { name: 'Auto Expanded' })).toBeVisible();
      expect(screen.getByRole('link', { name: 'Auto Child' })).toBeVisible();
    });
  });

  test('should render parent entry with children as a link', async () => {
    render(PreferencesNavigation, {
      meta: { url: '/' } as unknown as TinroRouteMeta,
    });

    const parentLink = await screen.findByRole('link', { name: 'Test Parent' });
    expect(parentLink).toBeVisible();
  });

  test('should not show children before parent is expanded', async () => {
    render(PreferencesNavigation, {
      meta: { url: '/' } as unknown as TinroRouteMeta,
    });

    await vi.waitFor(() => {
      expect(screen.getByRole('link', { name: 'Test Parent' })).toBeVisible();
    });

    expect(screen.queryByRole('link', { name: 'Child One' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Child Two' })).toBeNull();
  });

  test('should show visible children when parent section is expanded', async () => {
    render(PreferencesNavigation, {
      meta: { url: '/' } as unknown as TinroRouteMeta,
    });

    await fireEvent.click(await screen.findByRole('link', { name: 'Test Parent' }));

    expect(await screen.findByRole('link', { name: 'Child One' })).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Child Two' })).toBeVisible();
  });

  test('should filter out children with visible set to false', async () => {
    render(PreferencesNavigation, {
      meta: { url: '/' } as unknown as TinroRouteMeta,
    });

    await fireEvent.click(await screen.findByRole('link', { name: 'Test Parent' }));

    await vi.waitFor(() => {
      expect(screen.getByRole('link', { name: 'Child One' })).toBeVisible();
      expect(screen.queryByRole('link', { name: 'Hidden Child' })).toBeNull();
    });
  });

  test('should not select parent when current URL matches a child href', async () => {
    render(PreferencesNavigation, {
      meta: { url: '/preferences/test-parent/child-one' } as unknown as TinroRouteMeta,
    });

    await fireEvent.click(await screen.findByRole('link', { name: 'Test Parent' }));

    await vi.waitFor(() => {
      const parentRow = screen.getByRole('link', { name: 'Test Parent' }).firstElementChild;
      expect(parentRow).not.toHaveClass('bg-[var(--pd-secondary-nav-selected-bg)]');

      const childRow = screen.getByRole('link', { name: 'Child One' }).firstElementChild;
      expect(childRow).toHaveClass('bg-[var(--pd-secondary-nav-selected-bg)]');
    });
  });

  test('should select parent when URL matches parent href and no child matches', async () => {
    render(PreferencesNavigation, {
      meta: { url: '/preferences/test-parent' } as unknown as TinroRouteMeta,
    });

    await fireEvent.click(await screen.findByRole('link', { name: 'Test Parent' }));

    await vi.waitFor(() => {
      const parentRow = screen.getByRole('link', { name: 'Test Parent' }).firstElementChild;
      expect(parentRow).toHaveClass('bg-[var(--pd-secondary-nav-selected-bg)]');

      const childRow = screen.getByRole('link', { name: 'Child One' }).firstElementChild;
      expect(childRow).not.toHaveClass('bg-[var(--pd-secondary-nav-selected-bg)]');
    });
  });
});
