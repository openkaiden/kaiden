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

import { configuration } from '@openkaiden/api';
import { injectable } from 'inversify';
import { z } from 'zod';

/**
 * Talks to the AI Lab daemon, the Ollama-compatible HTTP API exposed by Podman AI Lab.
 */
@injectable()
export class AiLabDaemonClient {
  // default value of the AI Lab `ai-lab.apiPort` preference
  protected static readonly DEFAULT_API_PORT = 10434;
  protected static readonly CONFIGURATION_SECTION = 'podman-ai-lab';
  protected static readonly API_PORT_KEY = 'apiPort';

  protected static readonly ApiPortSchema = z.number().int().min(1).max(65535);
  protected static readonly RunningModelSchema = z.object({ name: z.string() });
  // a payload without a `models` array is treated as "no running model"
  protected static readonly ProcessListSchema = z.object({ models: z.array(z.unknown()) }).catch({ models: [] });

  /**
   * Port of the AI Lab daemon, read from the `podman-ai-lab.apiPort` setting on every call
   * so that a change applies without restarting the extension.
   */
  getPort(): number {
    const configured = configuration
      .getConfiguration(AiLabDaemonClient.CONFIGURATION_SECTION)
      .get<number>(AiLabDaemonClient.API_PORT_KEY);
    if (configured === undefined) {
      return AiLabDaemonClient.DEFAULT_API_PORT;
    }
    const parsed = AiLabDaemonClient.ApiPortSchema.safeParse(configured);
    if (!parsed.success) {
      console.warn(
        `Invalid ${AiLabDaemonClient.CONFIGURATION_SECTION}.${AiLabDaemonClient.API_PORT_KEY} value '${configured}', using ${AiLabDaemonClient.DEFAULT_API_PORT}`,
      );
      return AiLabDaemonClient.DEFAULT_API_PORT;
    }
    return parsed.data;
  }

  /**
   * Base URL of the daemon, as reachable from Kaiden itself.
   */
  getBaseURL(): string {
    return `http://localhost:${this.getPort()}`;
  }

  /**
   * Lists the names of the models whose inference server is running (`GET /api/ps`).
   * Rejects when the daemon is unreachable or answers with an error status.
   */
  async listRunningModels(signal?: AbortSignal): Promise<string[]> {
    const res = await fetch(`${this.getBaseURL()}/api/ps`, { signal });
    if (!res.ok) {
      throw new Error(`HTTP error, status: ${res.status}`);
    }
    const { models } = AiLabDaemonClient.ProcessListSchema.parse(await res.json());
    return models.flatMap(entry => {
      const parsed = AiLabDaemonClient.RunningModelSchema.safeParse(entry);
      return parsed.success ? [parsed.data.name] : [];
    });
  }
}
