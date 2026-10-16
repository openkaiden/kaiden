/**********************************************************************
 * Copyright (C) 2025 Red Hat, Inc.
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

import type { components } from '@openkaiden/mcp-registry-types';

import type { InputWithVariableResponse } from '/@api/mcp/mcp-setup';

/**
 * This function takes as argument a {@link components['schemas']['InputWithVariables']} and generate a {@link InputWithVariableResponse}
 * It will fill all default value or default to empty string if not defined
 * @param input
 */
export function createInputWithVariables(
  input: components['schemas']['InputWithVariables'],
): InputWithVariableResponse {
  return {
    value: input.value ?? input.default ?? '',
    variables: Object.fromEntries(
      Object.entries(input.variables ?? {}).map(([key, variable]) => [
        key,
        {
          value: variable.value ?? variable.default ?? '',
        },
      ]),
    ),
  };
}
