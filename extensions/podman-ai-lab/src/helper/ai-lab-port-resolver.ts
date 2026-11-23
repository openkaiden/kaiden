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

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { env } from '@openkaiden/api';
import { injectable } from 'inversify';
import { z } from 'zod';

/**
 * Finds the port of the AI Lab daemon.
 *
 * The daemon does not expose its own port, it is the `ai-lab.apiPort` preference of the AI Lab extension,
 * stored in the Podman Desktop `settings.json`. Podman Desktop only writes a preference when it differs
 * from its default, so a missing key means the default port.
 */
@injectable()
export class AiLabPortResolver {
  // default value of the `ai-lab.apiPort` preference of AI Lab
  protected static readonly DEFAULT_API_PORT = 10434;
  protected static readonly API_PORT_KEY = 'ai-lab.apiPort';
  // AI Lab random port mode: the port is picked at startup and not published anywhere
  protected static readonly RANDOM_PORT = 0;

  protected static readonly ApiPortSchema = z.number().int().min(1).max(65535);
  protected static readonly SettingsSchema = z.record(z.string(), z.unknown());

  // last problem reported, to log it once instead of on every poll
  #lastIssue: string | undefined;

  /**
   * Port of the AI Lab daemon, read on every call as the user may change it in Podman Desktop at any time.
   * Falls back to the default port when the preference cannot be read.
   */
  async getPort(): Promise<number> {
    const configured = (await this.#readSettings())[AiLabPortResolver.API_PORT_KEY];
    if (configured === undefined) {
      this.#lastIssue = undefined;
      return AiLabPortResolver.DEFAULT_API_PORT;
    }
    if (configured === AiLabPortResolver.RANDOM_PORT) {
      this.#reportIssue(
        `Podman AI Lab is configured with a random API port, which Kaiden cannot discover. Using ${AiLabPortResolver.DEFAULT_API_PORT}`,
      );
      return AiLabPortResolver.DEFAULT_API_PORT;
    }
    const parsed = AiLabPortResolver.ApiPortSchema.safeParse(configured);
    if (!parsed.success) {
      this.#reportIssue(
        `Invalid ${AiLabPortResolver.API_PORT_KEY} value '${configured}', using ${AiLabPortResolver.DEFAULT_API_PORT}`,
      );
      return AiLabPortResolver.DEFAULT_API_PORT;
    }
    this.#lastIssue = undefined;
    return parsed.data;
  }

  /**
   * Settings of the first Podman Desktop settings file found, empty when there is none or it is unusable.
   */
  async #readSettings(): Promise<Record<string, unknown>> {
    for (const file of this.#settingsFiles()) {
      let content: string;
      try {
        content = await readFile(file, 'utf-8');
      } catch (err: unknown) {
        // the file of another directory layout, not an issue
        if (err instanceof Error && 'code' in err && err.code === 'ENOENT') continue;
        this.#reportIssue(`Unable to read the Podman Desktop settings file ${file}, using the default port: ${err}`);
        return {};
      }
      try {
        const parsed = AiLabPortResolver.SettingsSchema.safeParse(JSON.parse(content));
        if (parsed.success) return parsed.data;
        this.#reportIssue(`Unexpected content in the Podman Desktop settings file ${file}, using the default port`);
      } catch (err: unknown) {
        this.#reportIssue(`Unable to parse the Podman Desktop settings file ${file}, using the default port: ${err}`);
      }
      return {};
    }
    return {};
  }

  /**
   * Candidate locations of the Podman Desktop settings file, in the order Podman Desktop picks them:
   * - `PODMAN_DESKTOP_HOME_DIR` overrides everything
   * - the legacy layout is used on every platform when it exists
   * - Linux falls back to the XDG layout for new installations
   */
  #settingsFiles(): string[] {
    // biome-ignore lint/complexity/useLiteralKeys: PODMAN_DESKTOP_HOME_DIR comes from an index signature
    const homeDirOverride = process.env['PODMAN_DESKTOP_HOME_DIR'];
    if (homeDirOverride) {
      return [join(homeDirOverride, 'configuration', 'settings.json')];
    }

    const files = [
      join(homedir(), '.local', 'share', 'containers', 'podman-desktop', 'configuration', 'settings.json'),
    ];
    if (env.isLinux) {
      // biome-ignore lint/complexity/useLiteralKeys: XDG_CONFIG_HOME comes from an index signature
      const xdgConfigHome = process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
      files.push(join(xdgConfigHome, 'containers', 'podman-desktop', 'settings.json'));
    }
    return files;
  }

  #reportIssue(message: string): void {
    if (message === this.#lastIssue) return;
    this.#lastIssue = message;
    console.warn(message);
  }
}
