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

import type { RunError, RunOptions } from '@openkaiden/api';
import { inject, injectable, preDestroy } from 'inversify';
import z from 'zod';

import { CliToolRegistry } from '/@/plugin/cli-tool-registry.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { Exec } from '/@/plugin/util/exec.js';
import type { Event } from '/@api/event.js';
import {
  type CreateProviderOptions,
  type GatewayAddOptions,
  type GatewayInfo,
  GatewayInfoSchema,
  type GatewayRuntimeInfo,
  GatewayRuntimeInfoSchema,
  type GatewaySandboxes,
  type OpenshellProfile,
  OpenshellProfileSchema,
  type OpenshellProviderInfo,
  OpenshellProviderInfoSchema,
  type SandboxInfo,
  SandboxInfoSchema,
  type SetInferenceOptions,
} from '/@api/openshell-gateway-info.js';

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
 *   - `openshell sandbox list`
 *   - `openshell sandbox start`
 *   - `openshell sandbox stop`
 *   - `openshell sandbox connect`
 *   - `openshell --version`
 *
 * Policy commands:
 *   - `openshell policy update`
 *
 * Gateway registration commands:
 *   - `openshell gateway add <endpoint>`
 *   - `openshell gateway remove [name]`
 *   - `openshell gateway select [name]`
 *   - `openshell gateway list`
 *   - `openshell status`
 *
 * Provider commands:
 *   - `openshell provider list`
 *   - `openshell provider delete <name>`
 *   - `openshell provider create`
 */
const TRANSITIONAL_PHASES = new Set(['Deleting', 'Provisioning']);
const TRANSITIONAL_POLL_INTERVAL_MS = 5_000;
const MAX_TRANSITIONAL_POLL_RETRIES = 3;

@injectable()
export class OpenshellCli {
  private readonly _onDidSandboxListChange = new Emitter<GatewaySandboxes[]>();
  readonly onDidSandboxListChange: Event<GatewaySandboxes[]> = this._onDidSandboxListChange.event;
  private _transitionalPollTimer: ReturnType<typeof setTimeout> | undefined;

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

  async listSandboxes(gatewayName?: string): Promise<SandboxInfo[]> {
    const args = ['sandbox', 'list'];
    if (gatewayName) {
      args.push('-g', gatewayName);
    }
    const data = await this.execCLI<unknown>(args);
    return z.array(SandboxInfoSchema).parse(data);
  }

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

  async listSandboxesForGateway(gatewayName: string): Promise<GatewaySandboxes> {
    const gateways = await this.listGateways();
    const targetGateway = gateways.find(g => g.name === gatewayName);
    if (!targetGateway) {
      throw new Error(`Gateway not found: ${gatewayName}`);
    }

    const sandboxes = await this.listSandboxes(gatewayName);
    return { gateway: targetGateway, sandboxes };
  }

  async listSandboxesPerGateway(): Promise<GatewaySandboxes[]> {
    const gateways = await this.listGateways();
    if (gateways.length === 0) {
      return [];
    }

    const results: GatewaySandboxes[] = [];
    for (const gateway of gateways) {
      try {
        const sandboxes = await this.listSandboxes(gateway.name);
        results.push({ gateway, sandboxes });
      } catch (err: unknown) {
        console.warn(
          `[openshell] failed to list sandboxes for gateway ${gateway.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        results.push({ gateway, sandboxes: [] });
      }
    }

    this.scheduleTransitionalPollIfNeeded(results);
    return results;
  }

  private snapshotPhases(sandboxes: SandboxInfo[]): string {
    return sandboxes
      .map(s => `${s.id}:${s.phase}`)
      .sort((a, b) => a.localeCompare(b))
      .join(',');
  }

  private scheduleTransitionalPollIfNeeded(results: GatewaySandboxes[], retries = 0): void {
    const allSandboxes = results.flatMap(entry => entry.sandboxes);
    const transitionalCount = allSandboxes.filter(s => TRANSITIONAL_PHASES.has(s.phase)).length;
    if (
      transitionalCount === 0 ||
      retries > MAX_TRANSITIONAL_POLL_RETRIES ||
      this._transitionalPollTimer !== undefined
    ) {
      return;
    }
    const previousSnapshot = this.snapshotPhases(allSandboxes);
    this._transitionalPollTimer = setTimeout(() => {
      this._transitionalPollTimer = undefined;
      this.listSandboxesPerGateway()
        .then(updated => {
          const updatedSandboxes = updated.flatMap(entry => entry.sandboxes);
          if (this.snapshotPhases(updatedSandboxes) !== previousSnapshot) {
            this._onDidSandboxListChange.fire(updated);
          }
        })
        .catch((err: unknown) => {
          console.warn(
            `[openshell] transitional-poll refresh failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          this.scheduleTransitionalPollIfNeeded(results, retries + 1);
        });
    }, TRANSITIONAL_POLL_INTERVAL_MS);
  }

  // ── gateway registration commands ─────────────────────────────────

  async addGateway(options: GatewayAddOptions): Promise<void> {
    const args = ['gateway', 'add', options.endpoint];
    if (options.name) {
      args.push('--name', options.name);
    }
    if (options.remote) {
      args.push('--remote', options.remote);
    }
    if (options.local) {
      args.push('--local');
    }
    await this.runCli(args);
  }

  async removeGateway(name?: string): Promise<void> {
    const args = ['gateway', 'remove'];
    if (name) {
      args.push(name);
    }
    await this.runCli(args);
  }

  async selectGateway(name?: string): Promise<void> {
    const args = ['gateway', 'select'];
    if (name) {
      args.push(name);
    }
    await this.runCli(args);
  }

  async listGateways(): Promise<GatewayInfo[]> {
    const data = await this.execCLI<unknown>(['gateway', 'list']);
    return z.array(GatewayInfoSchema).parse(data);
  }

  async getGatewayInfo(gatewayName?: string): Promise<GatewayRuntimeInfo> {
    const args = ['gateway', 'info'];
    if (gatewayName) {
      args.push('-g', gatewayName);
    }
    const data = await this.execCLI<unknown>(args);
    return GatewayRuntimeInfoSchema.parse(data);
  }

  async checkEndpointStatus(endpoint: string): Promise<boolean> {
    const args = ['status', '--gateway-endpoint', endpoint];
    if (endpoint.startsWith('http://')) {
      args.push('--gateway-insecure');
    }
    try {
      await this.runCli(args, { quiet: true });
      return true;
    } catch {
      return false;
    }
  }

  async getGatewayStatus(): Promise<string> {
    const cliPath = this.getCliPath();
    try {
      const result = await this.exec.exec(cliPath, ['status']);
      return result.stdout.trim();
    } catch (err: unknown) {
      const detail = this.extractCliError(err);
      console.error(`openshell failed: ${cliPath} status — ${detail}`);
      throw new Error(detail);
    }
  }

  // ── provider commands ──────────────────────────────────────────────

  async listProviders(gateway?: string): Promise<OpenshellProviderInfo[]> {
    const args = ['provider', 'list'];
    if (gateway) {
      args.push('-g', gateway);
    }
    const data = await this.execCLI<unknown>(args);
    return z.array(OpenshellProviderInfoSchema).parse(data);
  }

  async listProfiles(): Promise<OpenshellProfile[]> {
    const data = await this.execCLI<unknown>(['provider', 'list-profiles']);
    return z.array(OpenshellProfileSchema).parse(data);
  }

  async deleteProvider(name: string, gateway?: string): Promise<void> {
    const args = ['provider', 'delete', name];
    if (gateway) {
      args.push('-g', gateway);
    }
    await this.runCli(args);
  }

  async createProvider(options: CreateProviderOptions, gateway?: string): Promise<void> {
    if (Object.keys(options.credentials).length === 0 && !options.flags?.length) {
      throw new Error('credentials must not be empty');
    }
    const args = ['provider', 'create', '--name', options.name, '--type', options.type];
    if (gateway) {
      args.push('-g', gateway);
    }
    const env: Record<string, string> = options.env ?? {};
    for (const [key, value] of Object.entries(options.credentials)) {
      env[key] = value;
      args.push('--credential', key);
    }
    if (options.flags) {
      for (const flag of options.flags) {
        args.push(flag);
      }
    }
    if (options.config) {
      for (const [key, value] of Object.entries(options.config)) {
        args.push('--config', `${key}=${value}`);
      }
    }
    await this.runCli(args, { env, redact: true });
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

  // ── policy commands ──────────────────────────────────────────────

  async updatePolicy(sandboxName: string, endpoints: string[], binaries?: string[]): Promise<void> {
    const args = ['policy', 'update', sandboxName];
    for (const ep of endpoints) {
      args.push('--add-endpoint', ep);
    }
    for (const bin of binaries ?? []) {
      args.push('--binary', bin);
    }
    await this.runCli(args);
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

  private async execCLI<T>(args: string[], options?: RunOptions): Promise<T> {
    const cliPath = this.getCliPath();
    const fullArgs = [...args, '-o', 'json'];
    try {
      const result = await this.exec.exec(cliPath, fullArgs, options);
      return JSON.parse(result.stdout) as T;
    } catch (err: unknown) {
      const detail = this.extractCliError(err);
      console.error(`openshell failed: ${cliPath} ${fullArgs.join(' ')} — ${detail}`);
      throw new Error(detail);
    }
  }

  @preDestroy()
  dispose(): void {
    if (this._transitionalPollTimer !== undefined) {
      clearTimeout(this._transitionalPollTimer);
      this._transitionalPollTimer = undefined;
    }
    this._onDidSandboxListChange.dispose();
  }
}
