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

import { access, lstat, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join, posix, resolve } from 'node:path';

import type { ExecInteractiveSession } from '@nvidia/openshell-sdk';
import type { Disposable } from '@openkaiden/api';
import { SerializeAddon } from '@xterm/addon-serialize';
import { Terminal as HeadlessTerminal } from '@xterm/headless';
import type { WebContents } from 'electron';
import { inject, injectable, preDestroy } from 'inversify';

import { AgentRegistry } from '/@/plugin/agent-registry.js';
import { updateWorkspaceConfig, writeWorkspaceConfig } from '/@/plugin/agent-workspace/workspace-config-writer.js';
import { WritableConfigurationFile } from '/@/plugin/agent-workspace/writable-configuration-file.js';
import { IPCHandle, WebContentsType } from '/@/plugin/api.js';
import { Directories } from '/@/plugin/directories.js';
import { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import { OpenshellGateway } from '/@/plugin/openshell-cli/openshell-gateway.js';
import { OpenshellGatewayStateManager } from '/@/plugin/openshell-cli/openshell-gateway-state-manager.js';
import { buildPolicyObject, rewriteLocalhostUrl } from '/@/plugin/openshell-cli/openshell-network-policy.js';
import { OpenshellPolicyManager } from '/@/plugin/openshell-cli/openshell-policy-manager.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { mapSdkSandboxRef } from '/@/plugin/openshell-cli/openshell-sdk-sandbox-mapper.js';
import { ProviderRegistry } from '/@/plugin/provider-registry.js';
import { SecretManager } from '/@/plugin/secret-manager/secret-manager.js';
import { TaskManager } from '/@/plugin/tasks/task-manager.js';
import { resolveHomePath } from '/@/plugin/util/resolve-home-path.js';
import { AgentWorkspaceSettings } from '/@api/agent-workspace/agent-workspace-settings.js';
import type {
  AgentWorkspaceConfiguration,
  AgentWorkspaceCreateOptions,
  AgentWorkspaceId,
  AgentWorkspaceSummary,
} from '/@api/agent-workspace-info.js';
import { getSandboxNameValidationError } from '/@api/agent-workspace-info.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { IConfigurationNode } from '/@api/configuration/models.js';
import { IConfigurationRegistry } from '/@api/configuration/models.js';
import type {
  CreateLocalGatewayOptions,
  GatewayInfo,
  GatewaySandboxes,
  OpenshellBindMount,
  OpenshellUpload,
  SandboxInfo,
} from '/@api/openshell-gateway-info.js';
import { AGENT_LABEL, decodeWorkspaceLabels, WORKSPACE_LABEL } from '/@api/openshell-gateway-info.js';
import { TerminalSettings } from '/@api/terminal/terminal-settings.js';

import { dedupeOpenshellMounts, partitionOpenshellUploads, resolveOpenshellMountTarget } from './openshell-mounts.js';

const HOME_VARIABLE = '${HOME}';
const LABEL_MAX_LENGTH = 63;
const SOURCES_VARIABLE = '$SOURCES';
const MOUNT_HOME_PREFIX = '$HOME';
// Timeouts for sandbox startup and deletion cleanup for sdk.
const SANDBOX_READY_TIMEOUT_SECONDS = 300;
const SANDBOX_DELETE_TIMEOUT_SECONDS = 120;
const DEFAULT_TERMINAL_SCROLLBACK = 1000;

export interface AgentTerminalClient {
  onData: (content: string) => void;
  onError?: (error: string) => void;
  onEnd: () => void;
}

export interface AgentTerminalHandle {
  write: (content: string) => void;
  resize: (cols: number, rows: number) => void;
  detach: () => void;
}

// an agent session being started; cancelled when its workspace is deleted or the manager is disposed meanwhile
interface PendingAgentStart {
  sandboxName: string;
  gateway: string;
  cancelled: boolean;
  promise: Promise<WorkspaceTerminalSession>;
}

interface WorkspaceTerminalSession {
  // attached consumers: renderer terminals and others (e.g. the CLI through the API server)
  clients: Set<AgentTerminalClient>;
  execSession: ExecInteractiveSession;
  abortController: AbortController;
  write: (param: string) => void;
  resize: (w: number, h: number) => void;
  sandboxName: string;
  gateway: string;
  // mirror of the terminal screen, replayed when a client attaches
  screen: HeadlessTerminal;
  serializer: SerializeAddon;
  ended: boolean;
}

export function encodeWorkspaceLabels(sourcePath: string): Record<string, string> {
  const encoded = Buffer.from(sourcePath).toString('base64url');
  if (encoded.length <= LABEL_MAX_LENGTH) {
    return { [WORKSPACE_LABEL]: encoded };
  }
  const labels: Record<string, string> = {};
  for (let i = 0, chunk = 0; i < encoded.length; i += LABEL_MAX_LENGTH, chunk++) {
    labels[`${WORKSPACE_LABEL}.${chunk}`] = encoded.slice(i, i + LABEL_MAX_LENGTH);
  }
  return labels;
}

/**
 * Manages agent workspaces by delegating to the `kdn` CLI.
 */
@injectable()
export class AgentWorkspaceManager implements Disposable {
  private readonly workspaceTerminals = new Map<string, WorkspaceTerminalSession>();
  private readonly startingAgentSessions = new Map<string, PendingAgentStart>();
  // renderer terminals by callback id; ids restart from zero on a renderer reload, so a stale entry is replaced on attach
  private readonly rendererTerminals = new Map<number, AgentTerminalHandle>();
  // bumped on every renderer reload so that a terminal request from the previous renderer is dropped
  private rendererGeneration = 0;
  private readonly disposables: Disposable[] = [];

  constructor(
    @inject(ApiSenderType)
    private readonly apiSender: ApiSenderType,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(TaskManager)
    private readonly taskManager: TaskManager,
    @inject(WebContentsType)
    private readonly webContents: WebContents,
    @inject(IConfigurationRegistry)
    private readonly configurationRegistry: IConfigurationRegistry,
    @inject(ProviderRegistry)
    private readonly providerRegistry: ProviderRegistry,
    @inject(SecretManager)
    private readonly secretManager: SecretManager,
    @inject(OpenshellCli)
    private readonly openshellCli: OpenshellCli,
    @inject(OpenshellSdkClientManager)
    private readonly openshellSdkClientManager: OpenshellSdkClientManager,
    @inject(AgentRegistry)
    private readonly agentRegistry: AgentRegistry,
    @inject(OpenshellGateway)
    private readonly openshellGateway: OpenshellGateway,
    @inject(OpenshellGatewayStateManager)
    private readonly openshellGatewayStateManager: OpenshellGatewayStateManager,
    @inject(Directories)
    private readonly directories: Directories,
    @inject(OpenshellPolicyManager)
    private readonly openshellPolicyManager: OpenshellPolicyManager,
  ) {}

  private getGlobalConfigDir(gateway: string, sandboxName: string): string {
    if (/[\\/]|\.\./.test(gateway) || /[\\/]|\.\./.test(sandboxName)) {
      throw new Error(`Invalid workspace identifier: "${gateway}/${sandboxName}"`);
    }
    return join(this.directories.getAgentWorkspacesConfigDirectory(), gateway, sandboxName);
  }

  async create(options: AgentWorkspaceCreateOptions): Promise<AgentWorkspaceId> {
    const suffix = options.name ? ` "${options.name}"` : '';
    const task = this.taskManager.createTask({ title: `Creating workspace${suffix}` });
    task.state = 'running';
    task.status = 'in-progress';
    try {
      if (options.sourcePath) {
        options.sourcePath = resolveHomePath(options.sourcePath);
      }
      if (!options.model) {
        throw new Error('model is required to create a workspace');
      }

      await this.openshellGatewayStateManager.whenReady();
      const gateway = this.openshellGatewayStateManager
        .listGateways()
        .find(candidate => candidate.name === options.gateway);
      if (!gateway?.gatewayState?.reachable) {
        throw new Error(`gateway "${options.gateway}" is unreachable`);
      }

      if (options.replaceConfig) {
        if (options.sourcePath) {
          await rm(join(options.sourcePath, '.kaiden', 'workspace.json'), { force: true });
        } else if (options.name) {
          await rm(join(this.getGlobalConfigDir(options.gateway, options.name), 'workspace.json'), { force: true });
        }
      }

      const secretName = await this.ensureModelSecret(options);
      const workspaceId = await this.createOpenshell(options, gateway, secretName);
      task.status = 'success';
      return workspaceId;
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      task.status = 'failure';
      task.error = `Failed to create workspace: ${detail}`;
      throw new Error(detail);
    } finally {
      this.apiSender.send('agent-workspace-update');
      task.state = 'completed';
    }
  }

  private async createOpenshell(
    options: AgentWorkspaceCreateOptions,
    gateway: GatewayInfo,
    secretName?: string,
  ): Promise<AgentWorkspaceId> {
    const connectionInfo = this.providerRegistry.getInferenceConnectionCredentials(options.model);

    const modelName = options.model.split('::')[1] ?? '';
    const rawEndpoint = connectionInfo?.endpoint ?? options.model.split('::')[2] ?? undefined;
    const endpoint = rawEndpoint ? rewriteLocalhostUrl(rawEndpoint) : undefined;

    const sandboxName = options.name ?? (options.sourcePath ? basename(options.sourcePath) : undefined);
    if (!sandboxName) {
      throw new Error('workspace name is required when no project folder is specified');
    }
    const sandboxNameError = getSandboxNameValidationError(sandboxName);
    if (sandboxNameError) {
      throw new Error(sandboxNameError);
    }

    const configDir = options.sourcePath ? undefined : this.getGlobalConfigDir(options.gateway, sandboxName);
    const workspace = await writeWorkspaceConfig(options, configDir);
    const agent = this.agentRegistry.getAgentRegistration(options.agent);
    const configurationUploads: OpenshellUpload[] = [];
    const supportsMounts = await this.openshellGateway.supportsMounts(gateway);
    if (!agent) {
      throw new Error(`Unable to create workspace: agent ${options.agent} not registered`);
    }

    const writable = await Promise.all(
      agent.configurationFiles.map(
        async (base, i) =>
          new WritableConfigurationFile(base, await base.read(), join(tmpdir(), `kaiden-config-${Date.now()}-${i}`)),
      ),
    );

    await agent.preWorkspaceStart({
      model: {
        llmMetadata: connectionInfo?.llmMetadataName ? { name: connectionInfo.llmMetadataName } : undefined,
        model: { label: modelName ?? '' },
        endpoint,
      },
      configurationFiles: writable,
      workspace,
    });

    for (const file of writable) {
      await writeFile(file.localPath, await file.read(), 'utf-8');
      configurationUploads.push({ local: file.localPath, remote: file.path });
    }

    const skillUploads = await this.buildOpenshellSkillUploads(options.skills, agent.destinationSkillsFolder);

    if (secretName !== undefined) {
      const connection = this.providerRegistry.getInferenceConnection(options.model);
      if (connection) {
        const provider = this.providerRegistry.getProvider(connection?.providerId);
        const { config, connectionProperties } = this.secretManager.getConnectionProperties(
          connection.connection,
          provider,
        );
        const inferenceSetupEntry = connectionProperties.find(([fullKey]) => fullKey.endsWith('._needsInferenceSetup'));
        const needsInferenceSetup = inferenceSetupEntry ? config.get<boolean>(inferenceSetupEntry[0]) : false;
        if (needsInferenceSetup) {
          await this.openshellCli.setInference({
            provider: secretName,
            model: modelName,
          });
        }
      }
    }

    const workspaceFiles = await this.buildOpenshellFilesystem(options.sourcePath, workspace, supportsMounts);
    const skillFiles = await partitionOpenshellUploads(skillUploads, { supportsMounts, readOnly: true });
    const uploads = this.dedupeOpenshellUploads([
      ...configurationUploads,
      ...skillFiles.uploads,
      ...workspaceFiles.uploads,
    ]);
    const mounts = dedupeOpenshellMounts([...workspaceFiles.mounts, ...skillFiles.mounts]);

    const env = workspace.environment
      ?.filter(entry => typeof entry.value === 'string' && entry.value !== '')
      .reduce<Record<string, string>>((acc, entry) => {
        acc[entry.name] = entry.value as string;
        return acc;
      }, {});
    const t0 = performance.now();

    const v2Globally = await this.openshellCli.isV2ProviderEnabled();
    if (!v2Globally) {
      await this.openshellCli.enableV2Provider();
    }

    const tV2 = performance.now();
    console.log(`[workspace-timing] enableV2Provider: ${(tV2 - t0).toFixed(0)}ms`);

    const sdkClient = await this.openshellSdkClientManager.getClient(options.gateway);
    await sdkClient.sandbox.create({
      name: sandboxName,
      image: options.image ?? agent.baseImage,
      providers: options.secrets,
      environment: env && Object.keys(env).length > 0 ? env : undefined,
      labels: {
        gateway: options.gateway,
        ...(options.sourcePath ? encodeWorkspaceLabels(options.sourcePath) : {}),
        [AGENT_LABEL]: options.agent,
      },
      tty: true,
      rawSpec:
        gateway.driver && mounts.length > 0
          ? {
              template: {
                image: options.image ?? agent.baseImage,
                driverConfig: { [gateway.driver]: { mounts: mounts.map(mount => ({ ...mount })) } },
              },
            }
          : undefined,
    });
    // Show phase for provisioning now then create will refreshes the ready or error phase later
    this.apiSender.send('agent-workspace-update');
    const sandboxRef = await sdkClient.sandbox.waitReady(sandboxName, SANDBOX_READY_TIMEOUT_SECONDS);
    const tSandbox = performance.now();
    console.log(`[workspace-timing] createSandbox: ${(tSandbox - tV2).toFixed(0)}ms`);

    try {
      for (const upload of uploads) {
        await this.openshellCli.uploadToSandbox(sandboxName, upload.local, upload.remote, options.gateway);
      }

      const networkPolicy = buildPolicyObject(workspace.network, endpoint);
      if (networkPolicy) {
        await this.openshellPolicyManager.updatePolicy(sandboxName, networkPolicy, options.gateway);
      }

      const tPolicy = performance.now();
      console.log(`[workspace-timing] updatePolicy: ${(tPolicy - tSandbox).toFixed(0)}ms`);
      console.log(`[workspace-timing] total createOpenshell: ${(tPolicy - t0).toFixed(0)}ms`);
    } catch (err) {
      try {
        await sdkClient.sandbox.delete(sandboxName);
        await sdkClient.sandbox.waitDeleted(sandboxName, SANDBOX_DELETE_TIMEOUT_SECONDS);
      } catch (cleanupError) {
        const detail = err instanceof Error ? err.message : String(err);
        const cleanupDetail = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
        throw new Error(`${detail}; failed to clean up sandbox "${sandboxName}": ${cleanupDetail}`, { cause: err });
      }
      throw err;
    }

    // the agent lifecycle belongs to the workspace: start it now so the terminal only has to attach
    try {
      await this.ensureAgentSession(sandboxRef.id, sandboxName, options.gateway, async () => agent.command);
    } catch (err: unknown) {
      console.warn(`[AgentWorkspace] unable to start agent in workspace "${sandboxName}":`, err);
    }

    return { id: sandboxName };
  }

  async checkWorkspaceConfigExists(sourcePath: string): Promise<boolean> {
    if (!sourcePath) return false;
    try {
      await access(join(resolveHomePath(sourcePath), '.kaiden', 'workspace.json'));
      return true;
    } catch {
      return false;
    }
  }

  async checkGlobalWorkspaceConfigExists(gateway: string, name: string): Promise<boolean> {
    if (!gateway || getSandboxNameValidationError(name)) return false;
    try {
      await access(join(this.getGlobalConfigDir(gateway, name), 'workspace.json'));
      return true;
    } catch {
      return false;
    }
  }

  private async buildOpenshellSkillUploads(
    skills: string[] | undefined,
    destinationSkillsFolder: string,
  ): Promise<OpenshellUpload[]> {
    if (!skills?.length) {
      return [];
    }

    const remoteBase = this.resolveOpenshellSkillsDestination(destinationSkillsFolder);
    const resolved = await Promise.all(skills.map(skillPath => realpath(skillPath)));
    return resolved.map(local => ({ local, remote: remoteBase }));
  }

  private async buildOpenshellFilesystem(
    sourcePath: string | undefined,
    workspace: AgentWorkspaceConfiguration,
    supportsMounts: boolean,
  ): Promise<{ uploads: OpenshellUpload[]; mounts: OpenshellBindMount[] }> {
    const { uploads, mounts } = await partitionOpenshellUploads(
      sourcePath ? [{ local: await realpath(sourcePath), remote: '.' }] : [],
      { supportsMounts },
    );

    for (const mount of workspace.mounts ?? []) {
      const raw = this.resolveHostPath(mount.host, sourcePath);
      const remote = this.resolveOpenshellSandboxPath(mount.target);
      if (!raw || !remote) {
        console.warn(
          `[AgentWorkspaceManager] skipping mount "${mount.host}" → "${mount.target}": cannot resolve without a project folder`,
        );
        continue;
      }
      let local: string;
      try {
        local = await realpath(raw);
      } catch {
        throw new Error(`Mount host path does not exist: ${raw}`);
      }
      const mountTarget = supportsMounts ? resolveOpenshellMountTarget(remote) : undefined;
      if (mountTarget) {
        mounts.push({ type: 'bind', source: local, target: mountTarget, read_only: mount.ro });
      } else {
        uploads.push({ local, remote: await this.resolveUploadRemotePath(local, remote) });
      }
    }
    return { uploads, mounts };
  }

  private async resolveUploadRemotePath(local: string, remote: string): Promise<string> {
    try {
      const stats = await lstat(local);
      if (stats.isDirectory()) {
        const localBase = basename(local);
        if (localBase !== '' && posix.basename(remote) === localBase) {
          return posix.dirname(remote);
        }
      }
    } catch {
      // Leave remote unchanged when the local path cannot be inspected.
    }
    return remote;
  }

  private resolveHostPath(path: string, sourcePath: string | undefined): string | undefined {
    if (path === SOURCES_VARIABLE) {
      return sourcePath;
    }
    if (path.startsWith(`${SOURCES_VARIABLE}/`)) {
      return sourcePath ? resolve(sourcePath, path.slice(SOURCES_VARIABLE.length + 1)) : undefined;
    }
    if (path === MOUNT_HOME_PREFIX) {
      return homedir();
    }
    if (path.startsWith(`${MOUNT_HOME_PREFIX}/`)) {
      return resolve(homedir(), path.slice(MOUNT_HOME_PREFIX.length + 1));
    }
    if (path === '~' || path.startsWith('~/')) {
      return resolveHomePath(path);
    }
    if (isAbsolute(path)) {
      return path;
    }
    return undefined;
  }

  private resolveOpenshellSandboxPath(path: string): string | undefined {
    if (path === SOURCES_VARIABLE) {
      return '.';
    }
    if (path.startsWith(`${SOURCES_VARIABLE}/`)) {
      return path.slice(SOURCES_VARIABLE.length + 1);
    }
    if (path === MOUNT_HOME_PREFIX) {
      return '~';
    }
    if (path.startsWith(`${MOUNT_HOME_PREFIX}/`)) {
      return posix.join('~', path.slice(MOUNT_HOME_PREFIX.length + 1));
    }
    if (path.length > 0) {
      return path;
    }
    return undefined;
  }

  private dedupeOpenshellUploads(uploads: OpenshellUpload[]): OpenshellUpload[] {
    const deduped: OpenshellUpload[] = [];
    const seen = new Set<string>();
    for (const upload of uploads) {
      const key = `${upload.local}\u0000${upload.remote}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(upload);
    }
    return deduped;
  }

  private resolveOpenshellSkillsDestination(destinationSkillsFolder: string): string {
    if (destinationSkillsFolder === HOME_VARIABLE) {
      return '.';
    }

    for (const str of [`${HOME_VARIABLE}/`, '~/']) {
      if (destinationSkillsFolder.startsWith(str)) {
        return destinationSkillsFolder.slice(str.length);
      }
    }

    if (destinationSkillsFolder.includes('..')) {
      throw new Error(`Invalid destination skills folder: ${destinationSkillsFolder}`);
    }

    return destinationSkillsFolder;
  }

  /**
   * Return the secret related to the inference connection linked to the
   * model. Return undefined if there is no secret associated with this connection
·   */
  async ensureModelSecret(options: AgentWorkspaceCreateOptions): Promise<string | undefined> {
    if (options.workspaceConfiguration?.secrets?.length) {
      return undefined;
    }

    return this.ensureModelSecretFromConfig(options);
  }

  private async ensureModelSecretFromConfig(options: AgentWorkspaceCreateOptions): Promise<string | undefined> {
    const secret = await this.secretManager.ensureSecretForModel(options.model, options.gateway);
    if (!secret) return undefined;

    options.secrets = [...new Set([...(options.secrets ?? []), secret.name])];

    return secret.name;
  }

  async remove(id: string, gateway: string): Promise<AgentWorkspaceId> {
    const workspaces = await this.listOpenshellSandboxes();
    const workspace = workspaces
      .filter(entry => entry.gateway.name === gateway)
      .flatMap(entry => entry.sandboxes)
      .find(ws => ws.id === id);
    const workspaceName = workspace?.name ?? id;
    await this.deleteWorkspace(workspaceName, gateway);
    return { id };
  }

  private async deleteWorkspace(name: string, gateway: string): Promise<void> {
    const task = this.taskManager.createTask({ title: `Deleting workspace "${name}"` });
    task.state = 'running';
    task.status = 'in-progress';
    let earlyRefresh: ReturnType<typeof setTimeout> | undefined;
    try {
      const sdkClient = await this.openshellSdkClientManager.getClient(gateway);
      // Preserve the cli's early refresh while delete waits for the sandbox to stop.
      earlyRefresh = setTimeout(() => this.apiSender.send('agent-workspace-update'), 500);
      // delete doesnt log like create does so matched the convention here
      console.log(`[workspace-timing] deleteSandbox: deleting "${name}" on gateway "${gateway}"`);
      await sdkClient.sandbox.delete(name);
      try {
        await sdkClient.sandbox.waitDeleted(name, SANDBOX_DELETE_TIMEOUT_SECONDS);
      } catch (waitErr: unknown) {
        const detail = waitErr instanceof Error ? waitErr.message : String(waitErr);
        console.warn(`[workspace-timing] deleteSandbox: waitDeleted failed for "${name}": ${detail}`);
      }
      this.apiSender.send('agent-workspace-update');
      this.closeWorkspaceTerminals(name, gateway);
      await rm(this.getGlobalConfigDir(gateway, name), { recursive: true, force: true });
      task.status = 'success';
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      task.status = 'failure';
      task.error = `Failed to delete workspace: ${detail}`;
      throw new Error(detail);
    } finally {
      clearTimeout(earlyRefresh);
      this.apiSender.send('agent-workspace-update');
      task.state = 'completed';
    }
  }

  private findSandboxWithGateway(
    workspaces: GatewaySandboxes[],
    id: string,
  ): { sandbox: GatewaySandboxes['sandboxes'][number]; gatewayName: string } | undefined {
    for (const gw of workspaces) {
      const sandbox = gw.sandboxes.find(ws => ws.id === id);
      if (sandbox) {
        return { sandbox, gatewayName: gw.gateway.name };
      }
    }
    return undefined;
  }

  private resolveConfigDir(sandbox: { sourcePath?: string; name: string }, gatewayName: string): string {
    return sandbox.sourcePath
      ? join(sandbox.sourcePath, '.kaiden')
      : this.getGlobalConfigDir(gatewayName, sandbox.name);
  }

  async getConfiguration(id: string): Promise<AgentWorkspaceConfiguration> {
    const workspaces = await this.listOpenshellSandboxes();
    const match = this.findSandboxWithGateway(workspaces, id);
    if (!match) {
      throw new Error(`workspace "${id}" not found. Use "workspace list" to see available workspaces.`);
    }
    const configPath = join(this.resolveConfigDir(match.sandbox, match.gatewayName), 'workspace.json');
    try {
      const content = await readFile(configPath, 'utf-8');
      return JSON.parse(content) as AgentWorkspaceConfiguration;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return {} as AgentWorkspaceConfiguration;
      }
      throw error;
    }
  }

  async updateConfiguration(id: string, config: Partial<AgentWorkspaceConfiguration>): Promise<void> {
    const workspaces = await this.listOpenshellSandboxes();
    const match = this.findSandboxWithGateway(workspaces, id);
    if (!match) {
      throw new Error(`workspace "${id}" not found. Use "workspace list" to see available workspaces.`);
    }
    await updateWorkspaceConfig(this.resolveConfigDir(match.sandbox, match.gatewayName), config);
    this.apiSender.send('agent-workspace-update');
  }

  async updateSummary(id: string, update: Pick<AgentWorkspaceSummary, 'name'>): Promise<void> {
    const instancesPath = join(homedir(), '.kdn', 'instances.json');
    const raw = await readFile(instancesPath, 'utf-8');
    const instances: unknown[] = JSON.parse(raw) as unknown[];
    const entry = instances.find(
      (item): item is Record<string, unknown> =>
        typeof item === 'object' && item !== null && (item as Record<string, unknown>)['id'] === id,
    );
    if (!entry) {
      throw new Error(`workspace "${id}" not found in instances.json`);
    }
    if (update.name !== undefined) {
      entry['name'] = update.name;
    }
    await writeFile(instancesPath, JSON.stringify(instances, undefined, 4) + '\n', 'utf-8');
  }

  async listOpenshellSandboxes(): Promise<GatewaySandboxes[]> {
    const gateways = this.openshellGatewayStateManager.listGateways();
    if (gateways.length === 0) {
      return [];
    }

    const results: GatewaySandboxes[] = [];
    for (const gateway of gateways) {
      try {
        const client = await this.openshellSdkClientManager.getClient(gateway.name);
        const refs = await client.sandbox.list();
        const sandboxes: SandboxInfo[] = refs.map(mapSdkSandboxRef);
        for (const sandbox of sandboxes) {
          if (sandbox.labels) {
            sandbox.sourcePath = decodeWorkspaceLabels(sandbox.labels);
          }
        }
        results.push({ gateway, sandboxes });
      } catch (err: unknown) {
        console.warn(
          `[openshell] failed to list sandboxes for gateway ${gateway.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
        results.push({ gateway, sandboxes: [] });
      }
    }
    return results;
  }

  async listOpenshellGateways(): Promise<GatewayInfo[]> {
    return [...this.openshellGatewayStateManager.listGateways()];
  }

  async createLocalGateway(options: CreateLocalGatewayOptions): Promise<GatewayInfo[]> {
    const task = this.taskManager.createTask({ title: `Creating local gateway "${options.name.trim()}"` });
    task.state = 'running';
    task.status = 'in-progress';
    try {
      await this.openshellGateway.createLocalGateway(options);
      await this.openshellGatewayStateManager.refresh();
      task.status = 'success';
      return this.listOpenshellGateways();
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : String(err);
      task.status = 'failure';
      task.error = `Failed to create local gateway: ${detail}`;
      throw new Error(detail);
    } finally {
      task.state = 'completed';
    }
  }

  async deleteOpenshellSandbox(name: string, gateway: string): Promise<void> {
    await this.deleteWorkspace(name, gateway);
  }

  async shellInAgentWorkspace(
    name: string,
    gateway: string,
    onData: (data: string) => void,
    onError: (error: string) => void,
    onEnd: () => void,
  ): Promise<{
    write: (param: string) => void;
    resize: (w: number, h: number) => void;
    execSession: ExecInteractiveSession;
    abortController: AbortController;
  }> {
    const abortController = new AbortController();
    const sdkClient = await this.openshellSdkClientManager.getClient(gateway);
    const execSession = await sdkClient.sandbox.execInteractive(name, ['/bin/sh'], {
      tty: true,
      signal: abortController.signal,
    });

    (async (): Promise<void> => {
      for await (const event of execSession.output) {
        if ('type' in event) {
          break;
        }
        const text = event.data.toString();
        if (event.stream === 'stdout') {
          onData(text);
        } else {
          onError(text);
        }
      }
      onEnd();
    })().catch((err: unknown) => {
      console.error(`[AgentWorkspace] terminal stream error for "${name}":`, err);
      onEnd();
    });

    return {
      write: (param: string): void => {
        execSession.write(Buffer.from(param));
      },
      resize: (cols: number, rows: number): void => {
        execSession.resize(cols, rows);
      },
      execSession,
      abortController,
    };
  }

  // one agent session per workspace: concurrent callers (creation, gateway start, terminal) share the same start
  private async ensureAgentSession(
    workspaceId: string,
    sandboxName: string,
    gateway: string,
    resolveAgentCommand: () => Promise<string | undefined>,
  ): Promise<WorkspaceTerminalSession> {
    const existing = this.workspaceTerminals.get(workspaceId);
    if (existing) {
      return existing;
    }
    let starting = this.startingAgentSessions.get(workspaceId);
    if (!starting) {
      const start = { sandboxName, gateway, cancelled: false } as PendingAgentStart;
      start.promise = resolveAgentCommand()
        .then(agentCommand => this.startAgentSession(workspaceId, start, agentCommand))
        .finally(() => this.startingAgentSessions.delete(workspaceId));
      this.startingAgentSessions.set(workspaceId, start);
      starting = start;
    }
    return starting.promise;
  }

  private async resolveAgentCommand(sandbox: SandboxInfo): Promise<string | undefined> {
    const agentId = sandbox.labels?.[AGENT_LABEL];
    if (!agentId) {
      return undefined;
    }
    try {
      return (await this.agentRegistry.getAgent(agentId))?.command;
    } catch (err: unknown) {
      console.error(`Failed to resolve agent command for workspace "${sandbox.id}":`, err);
      return undefined;
    }
  }

  private async startAgentSession(
    workspaceId: string,
    start: PendingAgentStart,
    agentCommand: string | undefined,
  ): Promise<WorkspaceTerminalSession> {
    const { sandboxName, gateway } = start;
    const screen = new HeadlessTerminal({
      allowProposedApi: true,
      scrollback:
        this.configurationRegistry
          .getConfiguration(TerminalSettings.SectionName)
          .get<number>(TerminalSettings.Scrollback) ?? DEFAULT_TERMINAL_SCROLLBACK,
    });
    const serializer = new SerializeAddon();
    screen.loadAddon(serializer);
    // created before the exec so that early output is not lost
    const clients = new Set<AgentTerminalClient>();
    const session: Partial<WorkspaceTerminalSession> = {
      sandboxName,
      gateway,
      screen,
      serializer,
      clients,
      ended: false,
    };
    let commandPending = !!agentCommand;
    let sawOutput = false;
    // the agent command is typed once the shell has printed something (i.e. is ready)
    const sendAgentCommand = (): void => {
      if (commandPending && sawOutput && session.write) {
        commandPending = false;
        session.write(`${agentCommand}\n`);
      }
    };
    let invocation: Awaited<ReturnType<AgentWorkspaceManager['shellInAgentWorkspace']>>;
    try {
      invocation = await this.shellInAgentWorkspace(
        sandboxName,
        gateway,
        (content: string) => {
          sawOutput = true;
          screen.write(content);
          for (const client of clients) client.onData(content);
          sendAgentCommand();
        },
        (error: string) => {
          for (const client of clients) client.onError?.(error);
        },
        () => {
          session.ended = true;
          if (this.workspaceTerminals.get(workspaceId) === session) {
            this.workspaceTerminals.delete(workspaceId);
          }
          screen.dispose();
          for (const client of clients) client.onEnd();
          clients.clear();
        },
      );
    } catch (err: unknown) {
      screen.dispose();
      throw err;
    }
    Object.assign(session, invocation, {
      resize: (cols: number, rows: number): void => {
        invocation.resize(cols, rows);
        screen.resize(cols, rows);
      },
    });
    const started = session as WorkspaceTerminalSession;
    if (start.cancelled) {
      // the workspace was deleted or the manager disposed while the shell was starting
      this.closeSession(started);
      throw new Error(`agent session in workspace "${sandboxName}" was cancelled`);
    }
    if (started.ended) {
      throw new Error(`agent session in workspace "${sandboxName}" ended before it could be used`);
    }
    this.workspaceTerminals.set(workspaceId, started);
    sendAgentCommand();
    return started;
  }

  // replays the current screen to the client, then forwards live output until detached
  private attachClient(session: WorkspaceTerminalSession, client: AgentTerminalClient): AgentTerminalHandle {
    if (session.ended) {
      client.onEnd();
      return { write: (): void => {}, resize: (): void => {}, detach: (): void => {} };
    }
    // output received from now on is queued after the snapshot marker, so it is not part of the snapshot: buffer it
    let pending: string[] | undefined = [];
    let detached = false;
    const listener: AgentTerminalClient = {
      onData: content => (pending ? pending.push(content) : client.onData(content)),
      onError: error => client.onError?.(error),
      onEnd: () => client.onEnd(),
    };
    session.clients.add(listener);
    session.screen.write('', () => {
      // the write queue still flushes after the screen was disposed
      if (detached || session.ended) {
        return;
      }
      const snapshot = session.serializer.serialize();
      if (snapshot) {
        client.onData(snapshot);
      }
      for (const content of pending ?? []) client.onData(content);
      pending = undefined;
    });
    return {
      write: session.write,
      // last writer wins when the UI and a CLI are attached with different sizes
      resize: session.resize,
      detach: (): void => {
        detached = true;
        session.clients.delete(listener);
      },
    };
  }

  // attaches a non-renderer client to the agent session of a workspace: replays the screen then forwards live output
  async attachAgentTerminal(
    sandboxName: string,
    gateway: string | undefined,
    client: AgentTerminalClient,
  ): Promise<AgentTerminalHandle> {
    const match = (await this.listOpenshellSandboxes())
      .flatMap(gw => gw.sandboxes.map(sandbox => ({ sandbox, gatewayName: gw.gateway.name })))
      .find(({ sandbox, gatewayName }) => sandbox.name === sandboxName && (!gateway || gatewayName === gateway));
    if (!match) {
      throw new Error(`workspace "${sandboxName}" not found. Use "workspace list" to see available workspaces.`);
    }
    const { sandbox, gatewayName } = match;
    const session = await this.ensureAgentSession(sandbox.id, sandbox.name, gatewayName, () =>
      this.resolveAgentCommand(sandbox),
    );
    return this.attachClient(session, client);
  }

  private sendToRenderer(channel: string, ...args: unknown[]): void {
    if (!this.webContents.isDestroyed()) {
      this.webContents.send(channel, ...args);
    }
  }

  // attaches a renderer terminal (identified by its preload callback id) to the agent session of a workspace
  private attachRendererTerminal(session: WorkspaceTerminalSession, callbackId: number, generation: number): void {
    // the request came from a renderer that has since reloaded: its callback id now belongs to another terminal
    if (generation !== this.rendererGeneration) {
      return;
    }
    // a renderer reload restarts callback ids from zero: an entry with this id belongs to a terminal that is gone
    this.rendererTerminals.get(callbackId)?.detach();
    this.rendererTerminals.delete(callbackId);
    if (session.ended) {
      this.sendToRenderer('agent-workspace:terminal-onEnd', callbackId);
      return;
    }
    const handle = this.attachClient(session, {
      onData: content => this.sendToRenderer('agent-workspace:terminal-onData', callbackId, content),
      onError: error => this.sendToRenderer('agent-workspace:terminal-onError', callbackId, error),
      onEnd: () => {
        if (this.rendererTerminals.get(callbackId) === handle) {
          this.rendererTerminals.delete(callbackId);
        }
        this.sendToRenderer('agent-workspace:terminal-onEnd', callbackId);
      },
    });
    this.rendererTerminals.set(callbackId, handle);
  }

  private detachRendererTerminals(): void {
    for (const handle of this.rendererTerminals.values()) {
      handle.detach();
    }
    this.rendererTerminals.clear();
  }

  // start agents of existing workspaces (e.g. after an application restart) without waiting for a terminal
  private async startAgentSessions(): Promise<void> {
    const targets = (await this.listOpenshellSandboxes()).flatMap(({ gateway, sandboxes }) =>
      sandboxes
        .filter(sandbox => sandbox.phase === 'Ready' && sandbox.labels?.[AGENT_LABEL])
        .map(sandbox => ({ gateway, sandbox })),
    );
    await Promise.all(
      targets.map(({ gateway, sandbox }) =>
        this.ensureAgentSession(sandbox.id, sandbox.name, gateway.name, () => this.resolveAgentCommand(sandbox)).catch(
          (err: unknown) => {
            console.warn(`[AgentWorkspace] unable to start agent in workspace "${sandbox.name}":`, err);
          },
        ),
      ),
    );
  }

  private closeWorkspaceTerminals(sandboxName: string, gateway: string): void {
    for (const start of this.startingAgentSessions.values()) {
      if (start.sandboxName === sandboxName && start.gateway === gateway) {
        start.cancelled = true;
      }
    }
    for (const [workspaceId, session] of this.workspaceTerminals) {
      if (session.sandboxName === sandboxName && session.gateway === gateway) {
        this.closeSession(session);
        this.workspaceTerminals.delete(workspaceId);
      }
    }
  }

  private closeSession(session: WorkspaceTerminalSession): void {
    session.ended = true;
    try {
      session.execSession.close();
    } catch {
      /* already closed */
    }
    session.abortController.abort();
    session.screen.dispose();
  }

  init(): void {
    const runtimeConfiguration: IConfigurationNode = {
      id: `preferences.${AgentWorkspaceSettings.SectionName}`,
      title: 'Agent Workspace',
      type: 'object',
      properties: {
        [`${AgentWorkspaceSettings.SectionName}.${AgentWorkspaceSettings.DefaultBaseImage}`]: {
          description: 'Default base image for agent workspaces when the agent does not specify one.',
          type: 'string',
        },
      },
    };
    this.configurationRegistry.registerConfigurations([runtimeConfiguration]);

    this.ipcHandle(
      'agent-workspace:checkConfigExists',
      async (_listener: unknown, sourcePath: string): Promise<boolean> => {
        return this.checkWorkspaceConfigExists(sourcePath);
      },
    );

    this.ipcHandle(
      'agent-workspace:checkGlobalConfigExists',
      async (_listener: unknown, gateway: string, name: string): Promise<boolean> => {
        return this.checkGlobalWorkspaceConfigExists(gateway, name);
      },
    );

    this.ipcHandle(
      'agent-workspace:create',
      async (_listener: unknown, options: AgentWorkspaceCreateOptions): Promise<AgentWorkspaceId> => {
        return this.create(options);
      },
    );

    this.ipcHandle(
      'agent-workspace:remove',
      async (_listener: unknown, id: string, gateway: string): Promise<AgentWorkspaceId> => {
        return this.remove(id, gateway);
      },
    );

    this.ipcHandle(
      'agent-workspace:getConfiguration',
      async (_listener: unknown, id: string): Promise<AgentWorkspaceConfiguration> => {
        return this.getConfiguration(id);
      },
    );

    this.ipcHandle(
      'agent-workspace:updateConfiguration',
      async (_listener: unknown, id: string, config: Partial<AgentWorkspaceConfiguration>): Promise<void> => {
        return this.updateConfiguration(id, config);
      },
    );

    this.ipcHandle(
      'agent-workspace:updateSummary',
      async (_listener: unknown, id: string, update: Pick<AgentWorkspaceSummary, 'name'>): Promise<void> => {
        return this.updateSummary(id, update);
      },
    );

    this.ipcHandle('agent-workspace:listOpenshellSandboxes', async (): Promise<GatewaySandboxes[]> => {
      return this.listOpenshellSandboxes();
    });

    this.ipcHandle('agent-workspace:listOpenshellGateways', async (): Promise<GatewayInfo[]> => {
      return this.listOpenshellGateways();
    });

    this.ipcHandle(
      'agent-workspace:createLocalGateway',
      async (_listener, options: CreateLocalGatewayOptions): Promise<GatewayInfo[]> => {
        return this.createLocalGateway(options);
      },
    );

    this.ipcHandle(
      'agent-workspace:deleteOpenshellSandbox',
      async (_listener: unknown, name: string, gateway: string): Promise<void> => {
        return this.deleteOpenshellSandbox(name, gateway);
      },
    );

    this.ipcHandle(
      'agent-workspace:terminal',
      async (_listener: unknown, id: string, onDataId: number, kind: 'agent' | 'shell' = 'agent'): Promise<number> => {
        const generation = this.rendererGeneration;
        const workspaces = await this.listOpenshellSandboxes();
        let workspace: SandboxInfo | undefined;
        let gatewayName: string | undefined;
        for (const gw of workspaces) {
          const found = gw.sandboxes.find(ws => ws.id === id);
          if (found) {
            workspace = found;
            gatewayName = gw.gateway.name;
            break;
          }
        }
        if (!workspace || !gatewayName) {
          throw new Error(`workspace "${id}" not found. Use "workspace list" to see available workspaces.`);
        }

        if (kind === 'shell') {
          // a plain shell kept alongside the agent session (no agent command): it survives the terminal closing
          const shell = await this.ensureAgentSession(
            `${id}:shell`,
            workspace.name,
            gatewayName,
            async () => undefined,
          );
          this.attachRendererTerminal(shell, onDataId, generation);
          return onDataId;
        }

        // no running session (app restarted before the gateway was up or the shell exited): start the agent again
        const session = await this.ensureAgentSession(id, workspace.name, gatewayName, () =>
          this.resolveAgentCommand(workspace),
        );
        this.attachRendererTerminal(session, onDataId, generation);
        return onDataId;
      },
    );

    this.ipcHandle(
      'agent-workspace:terminalSend',
      async (_listener: unknown, onDataId: number, content: string): Promise<void> => {
        this.rendererTerminals.get(onDataId)?.write(content);
      },
    );

    this.ipcHandle(
      'agent-workspace:terminalResize',
      async (_listener: unknown, onDataId: number, width: number, height: number): Promise<void> => {
        this.rendererTerminals.get(onDataId)?.resize(width, height);
      },
    );

    // the renderer terminal went away: keep the agent running, only stop forwarding its output
    this.ipcHandle('agent-workspace:terminalClose', async (_listener: unknown, onDataId: number): Promise<void> => {
      this.rendererTerminals.get(onDataId)?.detach();
      this.rendererTerminals.delete(onDataId);
    });

    // a renderer reload restarts callback ids from zero: drop every renderer attachment before it comes back
    // (only main-frame document navigations: subframes and in-page navigations keep the terminals attached)
    const onRendererNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
      if (details.isMainFrame && !details.isSameDocument) {
        this.rendererGeneration++;
        this.detachRendererTerminals();
      }
    };
    this.webContents.on('did-start-navigation', onRendererNavigation);
    this.disposables.push({
      dispose: (): void => {
        if (!this.webContents.isDestroyed()) {
          this.webContents.removeListener('did-start-navigation', onRendererNavigation);
        }
      },
    });

    this.disposables.push(
      this.openshellGateway.onDidGatewayStart(() => {
        this.openshellGatewayStateManager
          .refresh()
          .catch((err: unknown) => {
            console.warn(
              `[AgentWorkspaceManager] unable to refresh gateways after startup: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          })
          .then(() => this.startAgentSessions())
          .catch((err: unknown) => {
            console.warn('[AgentWorkspaceManager] unable to start agents after gateway startup:', err);
          });
        this.apiSender.send('agent-workspace-update');
      }),
    );

    this.disposables.push(
      this.openshellGateway.onDidGatewayInitFailed(() => {
        this.openshellGatewayStateManager.refresh().catch((err: unknown) => {
          console.warn(
            `[AgentWorkspaceManager] unable to refresh gateways after startup failure: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
      }),
    );

    this.disposables.push(
      this.openshellGatewayStateManager.onDidUpdateGateways(() => {
        this.apiSender.send('agent-gateway-update');
      }),
    );
  }

  @preDestroy()
  dispose(): void {
    for (const start of this.startingAgentSessions.values()) {
      start.cancelled = true;
    }
    this.detachRendererTerminals();
    for (const session of this.workspaceTerminals.values()) {
      this.closeSession(session);
    }
    this.workspaceTerminals.clear();
    for (const disposable of this.disposables) disposable.dispose();
  }
}
