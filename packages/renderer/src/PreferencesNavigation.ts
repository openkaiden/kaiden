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

import type { IconDefinition } from '@fortawesome/free-regular-svg-icons';
import { faBrain, faLink, faServer, faShield, faTerminal } from '@fortawesome/free-solid-svg-icons';
import type { Component } from 'svelte';

import CLIToolsIcon from '/@/lib/images/CLIToolsIcon.svelte';
import ProxyIcon from '/@/lib/images/ProxyIcon.svelte';
import ResourcesIcon from '/@/lib/images/ResourcesIcon.svelte';

export interface NavItem {
  id: string;
  title: string;
}

export interface SettingsNavItemConfig {
  title: string;
  href: string;
  visible?: boolean;
  icon?: IconDefinition | Component | string;
  children?: Omit<SettingsNavItemConfig, 'children'>[];
  expanded?: boolean;
}

// Static navigation entries for routes not in the main navigation registry
export const settingsNavigationEntries: SettingsNavItemConfig[] = [
  {
    title: 'AI tools',
    href: '/preferences/ai-tools',
    visible: true,
    expanded: true,
    icon: faBrain,
    children: [{ title: 'Coding agents', href: '/preferences/coding-agents', visible: true, icon: faTerminal }],
  },
  {
    title: 'OpenShell',
    href: '/preferences/openshell',
    visible: true,
    expanded: true,
    icon: faShield,
    children: [{ title: 'Gateways', href: '/preferences/openshell/gateways', visible: true, icon: faServer }],
  },
  {
    title: 'Connections',
    href: '/preferences/connections',
    visible: true,
    expanded: true,
    icon: faLink,
    children: [
      { title: 'Resources', href: '/preferences/resources', visible: true, icon: ResourcesIcon },
      { title: 'Proxy', href: '/preferences/proxies', visible: true, icon: ProxyIcon },
      { title: 'CLI Tools', href: '/preferences/cli-tools', visible: true, icon: CLIToolsIcon },
    ],
  },
];
