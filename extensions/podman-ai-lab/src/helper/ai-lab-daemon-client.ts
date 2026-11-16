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

import { injectable } from 'inversify';
import { z } from 'zod';

// default value of the AI Lab `ai-lab.apiPort` preference
export const AI_LAB_API_PORT = 10434;
export const AI_LAB_DAEMON_URL = `http://localhost:${AI_LAB_API_PORT}`;

const RunningModelSchema = z.object({ name: z.string() });

// a payload without a `models` array is treated as "no running model"
const ProcessListSchema = z.object({ models: z.array(z.unknown()) }).catch({ models: [] });

/**
 * Talks to the AI Lab daemon, the Ollama-compatible HTTP API exposed by Podman AI Lab.
 */
@injectable()
export class AiLabDaemonClient {
  /**
   * Lists the names of the models whose inference server is running (`GET /api/ps`).
   * Rejects when the daemon is unreachable or answers with an error status.
   */
  async listRunningModels(signal?: AbortSignal): Promise<string[]> {
    const res = await fetch(`${AI_LAB_DAEMON_URL}/api/ps`, { signal });
    if (!res.ok) {
      throw new Error(`HTTP error, status: ${res.status}`);
    }
    const { models } = ProcessListSchema.parse(await res.json());
    return models.flatMap(entry => {
      const parsed = RunningModelSchema.safeParse(entry);
      return parsed.success ? [parsed.data.name] : [];
    });
  }
}
