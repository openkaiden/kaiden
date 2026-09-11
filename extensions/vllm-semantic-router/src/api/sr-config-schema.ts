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

import { z } from 'zod';

const SRListenerSchema = z.object({
  name: z.string(),
  address: z.string(),
  port: z.number().int(),
  timeout: z.string().optional(),
});

const SRBackendRefSchema = z.object({
  name: z.string(),
  endpoint: z.string(),
  protocol: z.string(),
  weight: z.number().int(),
});

const SRModelSchema = z.object({
  name: z.string(),
  provider_model_id: z.string(),
  backend_refs: z.array(SRBackendRefSchema),
});

const SRKeywordSchema = z.object({
  name: z.string(),
  operator: z.enum(['OR', 'AND']),
  keywords: z.array(z.string()),
  case_sensitive: z.boolean(),
});

const SRConditionSchema = z.object({
  type: z.string(),
  name: z.string(),
});

const SRModelRefSchema = z.object({
  model: z.string(),
  use_reasoning: z.boolean(),
});

const SRRuleSchema = z.object({
  operator: z.enum(['AND', 'OR']),
  conditions: z.array(SRConditionSchema),
});

const SRDecisionSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  priority: z.number().int(),
  rules: SRRuleSchema,
  modelRefs: z.array(SRModelRefSchema),
});

const SRModelCardSchema = z.object({
  name: z.string(),
  modality: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
});

const SRRoutingSchema = z.object({
  signals: z.object({
    keywords: z.array(SRKeywordSchema),
  }),
  modelCards: z.array(SRModelCardSchema),
  decisions: z.array(SRDecisionSchema),
});

const SRGlobalSchema = z.object({
  services: z.object({
    router_replay: z.object({
      enabled: z.boolean(),
      store_backend: z.string(),
    }),
  }),
});

export const SRConfigSchema = z.object({
  version: z.string(),
  listeners: z.array(SRListenerSchema),
  providers: z.object({
    models: z.array(SRModelSchema),
  }),
  routing: SRRoutingSchema,
  global: SRGlobalSchema,
});

export type SRConfig = z.infer<typeof SRConfigSchema>;
export type SRModel = z.infer<typeof SRModelSchema>;
export type SRBackendRef = z.infer<typeof SRBackendRefSchema>;
