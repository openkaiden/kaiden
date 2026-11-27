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

/**
 * Talks to the AI Lab daemon, the Ollama-compatible HTTP API exposed by Podman AI Lab.
 */
@injectable()
export class AiLabDaemonClient {
  protected static readonly RunningModelSchema = z.object({ name: z.string() });
  protected static readonly ProcessListSchema = z.object({ models: z.array(z.unknown()) });

  /**
   * Base URL of the daemon listening on the given port, as reachable from Kaiden itself.
   */
  getBaseURL(port: number): string {
    return `http://localhost:${port}`;
  }

  /**
   * Lists the names of the models whose inference server is running (`GET /api/ps`).
   * Rejects when the daemon is unreachable or answers with an error status.
   */
  async listRunningModels(port: number, signal?: AbortSignal): Promise<string[]> {
    const url = `${this.getBaseURL(port)}/api/ps`;
    const res = await fetch(url, { signal });
    if (!res.ok) {
      throw new Error(`HTTP error, status: ${res.status}`);
    }
    const processList = AiLabDaemonClient.ProcessListSchema.safeParse(await res.json());
    if (!processList.success) {
      // another service may answer on this port, or the AI Lab payload changed: say why no model is listed
      console.debug(`Unexpected response from ${url}, no running model listed:`, processList.error);
      return [];
    }
    return processList.data.models.flatMap(entry => {
      const parsed = AiLabDaemonClient.RunningModelSchema.safeParse(entry);
      return parsed.success ? [parsed.data.name] : [];
    });
  }
}
