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
import z from 'zod';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { SetInferenceOptions } from '/@api/openshell-gateway-info.js';

const SettingValue = z.union([z.string(), z.boolean(), z.number()]);

const OpenshellSettingsSchema = z.looseObject({
  scope: z.string(),
  settings: z.looseObject({
    agent_policy_proposals_enabled: SettingValue,
    ocsf_json_enabled: SettingValue,
    proposal_approval_mode: SettingValue,
    providers_v2_enabled: SettingValue,
  }),
  settings_revision: z.number(),
});

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

  // ── sandbox commands ──────────────────────────────────────────────

  async startSandbox(name: string): Promise<void> {
    await this.runCli(['sandbox', 'start', name]);
  }

  async stopSandbox(name: string): Promise<void> {
    await this.runCli(['sandbox', 'stop', name]);
  }

  async deleteAllSandboxes(gatewayName?: string): Promise<void> {
    const args = ['sandbox', 'delete', '--all'];
    if (gatewayName) {
      args.push('-g', gatewayName);
    }
    await this.runCli(args);
  }

  async connectSandbox(name: string): Promise<void> {
    await this.runCli(['sandbox', 'connect', name]);
  }

  async uploadToSandbox(sandboxName: string, localPath: string, dest: string, gatewayName?: string): Promise<void> {
    const args = ['sandbox', 'upload', sandboxName, localPath, dest];
    if (gatewayName) {
      args.push('-g', gatewayName);
    }
    await this.runCli(args);
  }

  async setInference(options: SetInferenceOptions): Promise<void> {
    return this.runCli(['inference', 'set', '--provider', options.provider, '--model', options.model, '--no-verify']);
  }

  async isV2ProviderEnabled(): Promise<boolean> {
    const cliPath = this.getCliPath();
    try {
      const result = await this.exec.exec(cliPath, ['settings', 'get', '--global', '--json']);
      const parsed = OpenshellSettingsSchema.parse(JSON.parse(result.stdout));
      const value = parsed.settings.providers_v2_enabled;
      return value === true || value === 'true';
    } catch {
      return false;
    }
  }

  async enableV2Provider(): Promise<void> {
    return this.runCli(['settings', 'set', '--global', '--key', 'providers_v2_enabled', '--value', 'true', '--yes']);
  }

  // ── helpers ───────────────────────────────────────────────────────

  private async runCli(
    args: string[],
    options?: { redact?: boolean; env?: { [p: string]: string }; quiet?: boolean },
  ): Promise<void> {
    const cliPath = this.getCliPath();
    const displayArgs = options?.redact ? this.redactSensitiveArgs(args) : args;
    if (!options?.quiet) {
      console.log(`Executing: ${cliPath} ${displayArgs.join(' ')}`);
    }
    try {
      await this.exec.exec(cliPath, args, options?.env ? { env: options.env } : undefined);
    } catch (err: unknown) {
      const detail = this.extractCliError(err);
      if (!options?.quiet) {
        console.error(`openshell failed: ${cliPath} ${displayArgs.join(' ')} — ${detail}`);
      }
      throw new Error(detail);
    }
  }

  private redactSensitiveArgs(args: string[]): string[] {
    const sensitiveFlags = new Set(['--credential', '--config', '--env']);
    return args.map((arg, i) => {
      if (i > 0 && sensitiveFlags.has(args[i - 1]!)) {
        return '***';
      }
      return arg;
    });
  }
}
