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

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { RunError } from '@openkaiden/api';
import { inject, injectable } from 'inversify';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { Exec } from '/@/plugin/util/exec.js';

/**
 * Low-level wrapper around the `openshell` CLI binary.
 *
 * Sandbox commands:
 *   - `openshell sandbox start`
 *   - `openshell sandbox stop`
 *   - `openshell sandbox connect`
 *   - `openshell --version`
 *
 * Policy commands:
 *   - `openshell policy update`
 *
 * Provider commands:
 *   - `openshell provider list`
 *   - `openshell provider delete <name>`
 *   - `openshell provider create`
 */
@injectable()
export class OpenshellCli {
  constructor(
    @inject(Exec)
    private readonly exec: Exec,
    @inject(CliToolRegistry)
    private readonly cliToolRegistry: CliToolRegistry,
  ) {}

  getCliPath(): string {
    const tool = this.cliToolRegistry.getCliToolInfos().find(t => t.name === 'openshell');
    if (tool?.path) {
      return tool.path;
    }

    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    if (resourcesPath) {
      const bundledPath = join(resourcesPath, 'openshell', 'openshell');
      if (existsSync(bundledPath)) {
        return bundledPath;
      }
    }

    return 'openshell';
  }

  private extractCliError(err: unknown): string {
    if (err instanceof Error && 'stdout' in err) {
      const runErr = err as RunError;

      const jsonError = this.tryExtractJsonError(runErr.stdout) ?? this.tryExtractJsonError(runErr.stderr);
      if (jsonError) {
        return jsonError;
      }

      if (runErr.stderr?.trim()) {
        return `${err.message} (stderr: ${runErr.stderr.trim()})`;
      }
      if (runErr.stdout?.trim()) {
        return `${err.message} (stdout: ${runErr.stdout.trim()})`;
      }
    }
    return err instanceof Error ? err.message : String(err);
  }

  private tryExtractJsonError(output: string | undefined): string | undefined {
    if (typeof output !== 'string' || !output) {
      return undefined;
    }
    try {
      const parsed: unknown = JSON.parse(output);
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed) {
        const errorField = (parsed as { error: unknown }).error;
        if (typeof errorField === 'string' && errorField) {
          return errorField;
        }
      }
    } catch {
      // not JSON
    }
    return undefined;
  }

  async getVersion(): Promise<string> {
    const cliPath = this.getCliPath();
    try {
      const result = await this.exec.exec(cliPath, ['--version']);
      return result.stdout.trim();
    } catch (err: unknown) {
      const detail = this.extractCliError(err);
      console.error(`openshell failed: ${cliPath} --version — ${detail}`);
      throw new Error(detail);
    }
  }
}
