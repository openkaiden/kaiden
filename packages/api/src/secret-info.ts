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

import type { components } from '@openkaiden/kdn-api';

/**
 * Returned by secret create/remove commands to confirm which secret was affected.
 */
export type SecretName = components['schemas']['SecretName'];

/**
 * Secret metadata returned by `kdn secret list`.
 */
export type SecretInfo = components['schemas']['SecretInfo'];

export type SecretService = components['schemas']['SecretService'];

/**
 * Options for creating a new secret via `kdn secret create`.
 */
export interface SecretCreateOptions extends SecretInfo {
  value: string;
}
