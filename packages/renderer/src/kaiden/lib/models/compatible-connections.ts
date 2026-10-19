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

import type { ModelType } from '@openkaiden/api';

import type { CatalogModelInfo, InferenceConnectionSummary } from '/@api/model-registry-info';

export function getCompatibleUnconfiguredConnections(
  summaries: readonly InferenceConnectionSummary[],
  supportedModelTypes: readonly ModelType[] | undefined,
): InferenceConnectionSummary[] {
  if (!supportedModelTypes || supportedModelTypes.length === 0) return [];
  const typeNames = new Set(supportedModelTypes.map(t => t.name));
  return summaries.filter(
    c =>
      c.configurable &&
      c.status === 'not-configured' &&
      c.llmMetadata?.name !== undefined &&
      typeNames.has(c.llmMetadata.name),
  );
}

export function getCompatibleModels(
  models: readonly CatalogModelInfo[],
  supportedModelTypes: readonly ModelType[] | undefined,
): CatalogModelInfo[] {
  if (supportedModelTypes === undefined) return models.slice();
  if (supportedModelTypes.length === 0) return [];
  const typeNames = new Set(supportedModelTypes.map(t => t.name));
  return models.filter(m => m.llmMetadata?.name !== undefined && typeNames.has(m.llmMetadata.name));
}
