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

import { faClaude, faGithub, faGoogle } from '@fortawesome/free-brands-svg-icons';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import { faKey, faPlug } from '@fortawesome/free-solid-svg-icons';

const SERVICE_ICONS: Record<string, IconDefinition> = {
  github: faGithub,
  gemini: faGoogle,
  anthropic: faClaude,
};

const SERVICE_LABELS: Record<string, string> = {
  github: 'GitHub',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
};

export const OTHER_TYPE = 'other';

export const KNOWN_SERVICES = new Set(Object.keys(SERVICE_LABELS));
export const KNOWN_GROUP_LABEL = 'Built-in integrations';
export const OTHER_GROUP_LABEL = 'Other secrets';

export function isKnownService(type?: string): boolean {
  return !!type && KNOWN_SERVICES.has(type);
}

export function getSecretGroupLabel(type?: string): string {
  return isKnownService(type) ? KNOWN_GROUP_LABEL : OTHER_GROUP_LABEL;
}

export function getServiceIcon(name: string): IconDefinition {
  return SERVICE_ICONS[name] ?? faPlug;
}

export function getServiceLabel(name: string): string {
  return SERVICE_LABELS[name] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

export function getSecretIcon(type?: string): IconDefinition {
  if (!type || type === OTHER_TYPE) return faKey;
  return getServiceIcon(type);
}
