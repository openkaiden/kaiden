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

export const ListenerConfigSchema = z.object({
  address: z.string().optional().default('0.0.0.0'),
  port: z.number().int().optional().default(-1),
  timeout: z.number().int().optional(),
});

export const KeywordGroupSchema = z.object({
  name: z.string(),
  operator: z.enum(['OR', 'AND']),
  keywords: z.array(z.string()),
  caseSensitive: z.boolean(),
});

export const RuleConditionSchema = z.object({
  type: z.literal('keyword'),
  name: z.string(),
});

export const ModelRefSchema = z.object({
  providerId: z.string(),
  connectionId: z.string(),
  label: z.string(),
  useReasoning: z.boolean(),
});

export type ModelRef = z.infer<typeof ModelRefSchema>;

export const DecisionRuleSchema = z.object({
  operator: z.enum(['AND', 'OR']),
  conditions: z.array(RuleConditionSchema),
  modelRefs: z.array(ModelRefSchema),
});

export const DecisionConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  priority: z.number().int(),
  rules: z.array(DecisionRuleSchema),
});

export const RoutingConfigSchema = z.object({
  keywords: z.array(KeywordGroupSchema),
  decisions: z.array(DecisionConfigSchema),
  defaultModelRef: ModelRefSchema.optional(),
});

export const SemanticRouterConfigSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  listeners: z.array(ListenerConfigSchema),
  routing: RoutingConfigSchema,
});

export type SemanticRouterConfigInfo = z.output<typeof SemanticRouterConfigSchema>;

export interface SemanticRouterConnectionInfo {
  providerInternalId: string;
  connectionId: string;
}

export type SemanticRouterInfo = SemanticRouterConfigInfo & {
  connection?: SemanticRouterConnectionInfo;
};
