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

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import * as acp from '@agentclientprotocol/sdk';
import { inject, injectable, preDestroy } from 'inversify';
import type { IPty } from 'node-pty';
import { spawn as ptySpawn } from 'node-pty';

import { AgentRegistry } from '/@/plugin/agent-registry.js';
import { Directories } from '/@/plugin/directories.js';
import { OpenshellCli } from '/@/plugin/openshell-cli/openshell-cli.js';
import type {
  AcpAttachment,
  AcpElicitationResponseData,
  AcpFlowEvent,
  AcpPermissionResponseData,
  AcpSessionConfigOption,
  AcpSessionCreateOptions,
  AcpSessionInfo,
  AcpSessionStatus,
  AcpUserResponse,
} from '/@api/acp-session-info.js';
import type { AgentInfo } from '/@api/agent-info.js';
import { ApiSenderType } from '/@api/api-sender/api-sender-type.js';
import type { SandboxInfo } from '/@api/openshell-gateway-info.js';
import { AGENT_LABEL } from '/@api/openshell-gateway-info.js';

import { createAcpDebug } from './acp-debug.js';

const MAX_STDERR_LINES = 100;
const PTY_COLS = 65_535;
// eslint-disable-next-line sonarjs/publicly-writable-directories
const ATTACHMENT_UPLOAD_DIR = '/tmp/kaiden-attachments';

const debugPty = createAcpDebug('pty');
const debugProtocol = createAcpDebug('protocol');
const debugLifecycle = createAcpDebug('lifecycle');

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

interface UploadedAttachment extends AcpAttachment {
  isText: boolean;
  textContent?: string;
  remotePath?: string;
}

interface AcpSession {
  info: AcpSessionInfo;
  ptyProcess: IPty;
  connection: acp.ClientSideConnection;
  acpSessionId?: string;
  events: AcpFlowEvent[];
  pendingRequests: Map<string, PendingRequest>;
  stderrLines: string[];
  messageTurn: number;
  connectionClosed: boolean;
  agentCommand: string[];
  gatewayName?: string;
}

@injectable()
export class AcpSessionManager {
  private sessions = new Map<string, AcpSession>();
  private renameLocks = new Map<string, Promise<void>>();

  constructor(
    @inject(ApiSenderType) private readonly apiSender: ApiSenderType,
    @inject(OpenshellCli) private readonly openshellCli: OpenshellCli,
    @inject(AgentRegistry) private readonly agentRegistry: AgentRegistry,
    @inject(Directories) private readonly directories: Directories,
  ) {}

  async init(): Promise<void> {
    await this.loadFromDisk();
    await this.validateSandboxes();
  }

  async resolveAgentCommand(
    options: AcpSessionCreateOptions,
    sandbox: SandboxInfo,
  ): Promise<{ agentInfo: AgentInfo; command: string[] }> {
    const agentId = options.agentId ?? sandbox.labels?.[AGENT_LABEL];
    if (!agentId) {
      throw new Error('No agent specified. Select an agent or use a sandbox created by a workspace.');
    }

    const agentInfo = await this.agentRegistry.getAgent(agentId);
    if (!agentInfo) {
      throw new Error(`Agent "${agentId}" not found in the agent registry`);
    }
    if (!agentInfo.acp) {
      throw new Error(`Agent "${agentInfo.name}" does not support ACP`);
    }

    const command = [agentInfo.acp.command ?? agentInfo.command, ...agentInfo.acp.args];
    return { agentInfo, command };
  }

  private ptyToStreams(
    pty: IPty,
    label: string,
    stderrLines: string[],
  ): { input: WritableStream<Uint8Array>; output: ReadableStream<Uint8Array> } {
    const encoder = new TextEncoder();
    const sentMessages = new Set<string>();

    const input = new WritableStream<Uint8Array>({
      write(chunk): void {
        const text = new TextDecoder().decode(chunk);
        for (const line of text.split('\n').filter(l => l.trim())) {
          debugPty(`${label} >>> ${line.slice(0, 200)}`);
          try {
            sentMessages.add(JSON.stringify(JSON.parse(line.trim())));
          } catch {
            // not JSON, skip echo tracking
          }
        }
        pty.write(text.replace(/\n/g, '\r'));
      },
    });

    let outputController: ReadableStreamDefaultController<Uint8Array>;
    const output = new ReadableStream<Uint8Array>({
      start(controller): void {
        outputController = controller;
      },
    });

    let buffer = '';
    let jsonAssembly = '';
    pty.onData((data: string) => {
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const cleaned = raw.replace(/\r/g, '').trim();
        if (!cleaned) continue;

        if (jsonAssembly) {
          jsonAssembly += cleaned;
        } else if (cleaned.startsWith('{')) {
          jsonAssembly = cleaned;
        } else {
          console.error(`[ACP ${label}] stderr: ${cleaned}`);
          if (stderrLines.length >= MAX_STDERR_LINES) {
            stderrLines.shift();
          }
          stderrLines.push(stripVTControlCharacters(cleaned));
          continue;
        }

        try {
          JSON.parse(jsonAssembly);
          if (sentMessages.delete(JSON.stringify(JSON.parse(jsonAssembly)))) {
            jsonAssembly = '';
            continue;
          }
          debugPty(`${label} <<< ${jsonAssembly.slice(0, 200)}`);
          outputController.enqueue(encoder.encode(jsonAssembly + '\n'));
          jsonAssembly = '';
        } catch {
          // incomplete JSON, keep assembling
        }
      }
    });

    pty.onExit(() => {
      try {
        outputController.close();
      } catch {
        // already closed
      }
    });

    return { input, output };
  }

  async createSession(options: AcpSessionCreateOptions): Promise<AcpSessionInfo> {
    const sandboxes = await this.openshellCli.listSandboxes();
    const sandbox = sandboxes.find(s => s.name === options.sandboxName);
    if (!sandbox) {
      throw new Error(`Sandbox "${options.sandboxName}" not found`);
    }
    if (sandbox.phase !== 'Ready') {
      throw new Error(`Sandbox "${sandbox.name}" is not ready (phase: ${sandbox.phase})`);
    }

    const { agentInfo, command } = await this.resolveAgentCommand(options, sandbox);

    const sessionId = randomUUID();
    const openshellPath = this.openshellCli.getCliPath();

    const gatewayName = sandbox.labels?.['gateway'];
    const spawnArgs = ['sandbox', 'exec', '-n', sandbox.name, '--tty'];
    if (gatewayName) {
      spawnArgs.push('-g', gatewayName);
    }
    spawnArgs.push('--', ...command);
    debugPty(`${sandbox.name} spawning: ${openshellPath} ${spawnArgs.join(' ')}`);

    const ptyProcess = ptySpawn(openshellPath, spawnArgs, {
      name: 'xterm-256color',
      cols: PTY_COLS,
      env: { ...(process.env as Record<string, string>), OPENCODE_ENABLE_QUESTION_TOOL: '1' },
    });

    const info: AcpSessionInfo = {
      id: sessionId,
      sandboxName: sandbox.name,
      sandboxId: sandbox.id,
      prompt: options.prompt,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      agentId: agentInfo.id,
      agentName: agentInfo.name,
    };

    const events: AcpFlowEvent[] = [];
    const pendingRequests = new Map<string, PendingRequest>();
    const stderrLines: string[] = [];

    events.push({
      kind: 'prompt',
      text: options.prompt,
      timestamp: Date.now(),
    });

    const { input, output } = this.ptyToStreams(ptyProcess, sandbox.name, stderrLines);
    const stream = acp.ndJsonStream(input, output);

    const clientImpl = this.createClientImpl(sessionId);
    const connection = new acp.ClientSideConnection((_agent: acp.Agent) => clientImpl, stream);

    const session: AcpSession = {
      info,
      ptyProcess,
      connection,
      events,
      pendingRequests,
      stderrLines,
      messageTurn: 0,
      connectionClosed: false,
      agentCommand: command,
      gatewayName,
    };

    this.sessions.set(sessionId, session);
    this.saveToDisk(sessionId).catch((err: unknown) => {
      console.error(`[ACP] Failed to persist session "${sessionId}":`, err);
    });

    ptyProcess.onExit(({ exitCode }) => {
      debugPty(`${sandbox.name} process exited with code ${exitCode}`);
      const s = this.sessions.get(sessionId);
      if (s) {
        s.connectionClosed = true;
        if (s.info.status !== 'completed' && s.info.status !== 'cancelled') {
          this.updateSessionStatus(sessionId, exitCode === 0 ? 'completed' : 'error');
          if (exitCode !== 0) {
            const stderrMsg = s.stderrLines.join(' ').trim();
            s.info.error = stderrMsg || `Process exited with code ${exitCode}`;
          }
        }
      }
    });

    this.startAcpSession(sessionId, options.prompt).catch((err: unknown) => {
      console.error(`[ACP ${sandbox.name}] session start failed:`, err);
      this.updateSessionStatus(sessionId, 'error');
      const s = this.sessions.get(sessionId);
      if (s) {
        const stderrMsg = s.stderrLines.join(' ').trim();
        s.info.error = stderrMsg || (err instanceof Error ? err.message : String(err));
      }
    });

    this.apiSender.send('acp-session-update');
    return info;
  }

  private async startAcpSession(sessionId: string, prompt: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    debugProtocol('initializing connection...');
    const initResult = await session.connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        // let the agent read/write files through the agent
        fs: { readTextFile: false, writeTextFile: false },
      },
    });
    debugProtocol(`initialized: protocol v${initResult.protocolVersion}`);

    debugProtocol('creating new session...');
    const newSession = await session.connection.newSession({
      cwd: '/sandbox',
      mcpServers: [],
    });
    debugProtocol(`session created: ${newSession.sessionId}, keys: ${Object.keys(newSession).join(',')}`);

    session.acpSessionId = newSession.sessionId;
    if (newSession.modes) {
      session.info.availableModes = newSession.modes.availableModes.map(m => ({
        modeId: m.id,
        name: m.name,
        description: m.description ?? undefined,
      }));
      session.info.currentModeId = newSession.modes.currentModeId;
    }
    if (newSession.configOptions) {
      session.info.configOptions = this.mapConfigOptions(newSession.configOptions);
      debugProtocol(`configOptions: ${newSession.configOptions.length} options received`);
    }
    this.extractModels(session, newSession);
    this.updateSessionStatus(sessionId, 'running');

    debugProtocol(`sending prompt: ${prompt}`);
    const result = await session.connection.prompt({
      sessionId: newSession.sessionId,
      prompt: [{ type: 'text', text: prompt }],
    });
    debugProtocol(`prompt completed: stopReason=${result.stopReason}`);

    if (result.stopReason === 'end_turn' || result.stopReason === 'cancelled') {
      this.updateSessionStatus(sessionId, 'completed');
    }
  }

  private createClientImpl(sessionId: string): acp.Client {
    return {
      sessionUpdate: async (params: acp.SessionNotification): Promise<void> => {
        this.handleSessionUpdate(sessionId, params);
      },
      requestPermission: async (params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> => {
        return this.handlePermissionRequest(sessionId, params);
      },
      readTextFile: async (_params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> => {
        return { content: '' };
      },
      writeTextFile: async (_params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> => {
        return {};
      },
    };
  }

  private handleSessionUpdate(sessionId: string, params: acp.SessionNotification): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const update = params.update;
    debugProtocol(`sessionUpdate: ${update.sessionUpdate}`, JSON.stringify(update).slice(0, 200));
    let flowEvent: AcpFlowEvent | undefined;

    switch (update.sessionUpdate) {
      case 'agent_message_chunk': {
        if (update.content.type === 'text') {
          const currentTurn = session.messageTurn;
          const existing = session.events.findLast(
            (e): e is Extract<AcpFlowEvent, { kind: 'agent_message' }> =>
              e.kind === 'agent_message' && e.messageId === (update.messageId ?? undefined) && e.turn === currentTurn,
          );
          if (existing) {
            existing.text += update.content.text;
            this.emitEvent(sessionId, existing);
            return;
          }
          flowEvent = {
            kind: 'agent_message',
            text: update.content.text,
            messageId: update.messageId ?? undefined,
            turn: currentTurn,
            timestamp: Date.now(),
          };
        } else if ((update.content as { type: string }).type === 'thinking') {
          const thinkingContent = update.content as unknown as { type: 'thinking'; thinking: string };
          const existing = session.events.findLast(
            (e): e is Extract<AcpFlowEvent, { kind: 'thinking' }> =>
              e.kind === 'thinking' && e.messageId === (update.messageId ?? undefined),
          );
          if (existing) {
            existing.text += thinkingContent.thinking;
            this.emitEvent(sessionId, existing);
            return;
          }
          flowEvent = {
            kind: 'thinking',
            text: thinkingContent.thinking,
            messageId: update.messageId ?? undefined,
            timestamp: Date.now(),
          };
        }
        break;
      }
      case 'tool_call': {
        const toolStatus = update.status;
        const toolMeta = (update as unknown as { _meta?: { claudeCode?: { toolName?: string } } })._meta;
        const existingToolCall = session.events.find(
          (e): e is Extract<AcpFlowEvent, { kind: 'tool_call' }> =>
            e.kind === 'tool_call' && e.toolCallId === update.toolCallId,
        );
        if (existingToolCall) {
          existingToolCall.title = update.title;
          if (toolStatus) {
            existingToolCall.status =
              toolStatus === 'completed' ? 'completed' : toolStatus === 'failed' ? 'error' : 'running';
          }
          if (toolMeta?.claudeCode?.toolName) existingToolCall.toolName = toolMeta.claudeCode.toolName;
          this.emitEvent(sessionId, existingToolCall);
          return;
        }
        flowEvent = {
          kind: 'tool_call',
          toolCallId: update.toolCallId,
          title: update.title,
          toolName: toolMeta?.claudeCode?.toolName,
          status: toolStatus === 'completed' ? 'completed' : toolStatus === 'failed' ? 'error' : 'running',
          timestamp: Date.now(),
        };
        break;
      }
      case 'tool_call_update': {
        const existing = session.events.find(
          (e): e is Extract<AcpFlowEvent, { kind: 'tool_call' }> =>
            e.kind === 'tool_call' && e.toolCallId === update.toolCallId,
        );
        if (existing) {
          const updatedStatus = update.status;
          if (updatedStatus) {
            existing.status =
              updatedStatus === 'completed' ? 'completed' : updatedStatus === 'failed' ? 'error' : 'running';
          }
          if (updatedStatus === 'completed' || updatedStatus === 'failed') {
            session.messageTurn++;
          }
          if (update.title) {
            existing.title = update.title;
          }
          const rawUpdate = update as unknown as {
            _meta?: { claudeCode?: { toolName?: string } };
            rawInput?: { command?: string; description?: string };
            content?: { type: string; content: { type: string; text: string } }[];
          };
          if (rawUpdate._meta?.claudeCode?.toolName && !existing.toolName) {
            existing.toolName = rawUpdate._meta.claudeCode.toolName;
          }
          if (rawUpdate.rawInput?.command) {
            existing.command = rawUpdate.rawInput.command;
          }
          if (rawUpdate.rawInput?.description) {
            existing.description = rawUpdate.rawInput.description;
          }
          if (rawUpdate.content) {
            existing.content = rawUpdate.content
              .filter(c => c.content?.type === 'text')
              .map(c => c.content.text)
              .join('\n');
          }
          this.emitEvent(sessionId, existing);
          return;
        }
        break;
      }
      case 'plan': {
        flowEvent = {
          kind: 'plan',
          steps: update.entries.map(entry => ({
            title: entry.content,
            state:
              entry.status === 'completed'
                ? ('done' as const)
                : entry.status === 'in_progress'
                  ? ('running' as const)
                  : ('queued' as const),
          })),
          progress: 0,
          timestamp: Date.now(),
        };
        const plan = flowEvent as Extract<AcpFlowEvent, { kind: 'plan' }>;
        const doneCount = plan.steps.filter(s => s.state === 'done').length;
        plan.progress = plan.steps.length > 0 ? Math.round((doneCount / plan.steps.length) * 100) : 0;
        break;
      }
      case 'usage_update': {
        session.info.contextUsed = update.used;
        session.info.contextSize = update.size;
        if (update.cost) {
          flowEvent = {
            kind: 'cost_update',
            cost: {
              inputTokens: 0,
              outputTokens: 0,
              totalCost: update.cost.amount,
              currency: update.cost.currency,
            },
            timestamp: Date.now(),
          };
          session.info.cost = (flowEvent as Extract<AcpFlowEvent, { kind: 'cost_update' }>).cost;
        }
        session.info.updatedAt = Date.now();
        break;
      }
      case 'current_mode_update': {
        const modeUpdate = update as unknown as { currentModeId: string };
        session.info.currentModeId = modeUpdate.currentModeId;
        session.info.updatedAt = Date.now();
        this.apiSender.send('acp-session-update');
        return;
      }
      case 'config_option_update': {
        const configUpdate = update as unknown as { configOptions: acp.SessionConfigOption[] };
        session.info.configOptions = this.mapConfigOptions(configUpdate.configOptions);
        session.info.updatedAt = Date.now();
        this.apiSender.send('acp-session-update');
        return;
      }
      case 'available_commands_update': {
        const cmds = (
          update as unknown as {
            availableCommands: Array<{ name: string; description: string; input?: { hint: string } | null }>;
          }
        ).availableCommands;
        session.info.availableCommands = cmds.map(c => ({
          name: c.name,
          description: c.description,
          inputHint: c.input?.hint,
        }));
        session.info.updatedAt = Date.now();
        this.apiSender.send('acp-session-update');
        return;
      }
      default: {
        const rawUpdate = update as {
          sessionUpdate: string;
          content?: { type: string; text: string };
          messageId?: string | null;
        };
        if (rawUpdate.sessionUpdate === 'agent_thought_chunk' && rawUpdate.content?.type === 'text') {
          const lastEvent = session.events.at(-1);
          const existing = lastEvent?.kind === 'thinking' ? lastEvent : undefined;
          if (existing) {
            existing.text += rawUpdate.content.text;
            this.emitEvent(sessionId, existing);
            return;
          }
          flowEvent = {
            kind: 'thinking',
            text: rawUpdate.content.text,
            messageId: rawUpdate.messageId ?? undefined,
            timestamp: Date.now(),
          };
        }
        break;
      }
    }

    if (flowEvent) {
      session.events.push(flowEvent);
      session.info.updatedAt = Date.now();
      this.emitEvent(sessionId, flowEvent);
    }
  }

  private async handlePermissionRequest(
    sessionId: string,
    params: acp.RequestPermissionRequest,
  ): Promise<acp.RequestPermissionResponse> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    const requestId = randomUUID();
    const previousStatus = session.info.status;
    this.updateSessionStatus(sessionId, 'waiting_input');

    const toolCallId = params.toolCall.toolCallId;
    const permissionData = {
      requestId,
      options: params.options.map(opt => ({
        name: opt.name,
        kind: opt.kind,
        optionId: opt.optionId,
      })),
      resolved: false,
    };

    let toolCallEvent = session.events.find(
      (e): e is Extract<AcpFlowEvent, { kind: 'tool_call' }> => e.kind === 'tool_call' && e.toolCallId === toolCallId,
    );

    if (toolCallEvent) {
      toolCallEvent.permissionRequest = permissionData;
      this.emitEvent(sessionId, toolCallEvent);
    } else {
      toolCallEvent = {
        kind: 'tool_call',
        toolCallId,
        title: params.toolCall.title ?? 'Permission required',
        status: 'running',
        timestamp: Date.now(),
        permissionRequest: permissionData,
      };
      session.events.push(toolCallEvent);
      this.emitEvent(sessionId, toolCallEvent);
    }

    const targetEvent = toolCallEvent;

    return new Promise<acp.RequestPermissionResponse>((resolve, reject) => {
      session.pendingRequests.set(requestId, {
        resolve: (value: unknown) => {
          if (targetEvent.permissionRequest) {
            targetEvent.permissionRequest.resolved = true;
            targetEvent.permissionRequest.selectedOptionId = (value as AcpPermissionResponseData).optionId;
            this.emitEvent(sessionId, targetEvent);
          }
          this.updateSessionStatus(sessionId, previousStatus === 'idle' ? 'running' : previousStatus);
          resolve({
            outcome: {
              outcome: 'selected',
              optionId: (value as AcpPermissionResponseData).optionId,
            },
          });
        },
        reject,
      });
    });
  }

  respondToRequest(response: AcpUserResponse): void {
    const session = this.sessions.get(response.sessionId);
    if (!session) {
      throw new Error(`Session "${response.sessionId}" not found`);
    }

    const pending = session.pendingRequests.get(response.requestId);
    if (!pending) {
      throw new Error(`No pending request "${response.requestId}" in session "${response.sessionId}"`);
    }

    session.pendingRequests.delete(response.requestId);

    if (response.type === 'permission') {
      pending.resolve(response.data as AcpPermissionResponseData);
    } else if (response.type === 'elicitation') {
      pending.resolve(response.data as AcpElicitationResponseData);
    }
  }

  private async reconnectSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    debugLifecycle(`${session.info.sandboxName} reconnecting...`);

    if (!session.agentCommand.length && session.info.agentId) {
      const agentInfo = await this.agentRegistry.getAgent(session.info.agentId);
      if (agentInfo?.acp) {
        session.agentCommand = [agentInfo.command, ...agentInfo.acp.args];
      }
    }
    if (!session.agentCommand.length) {
      throw new Error(`Cannot reconnect session "${sessionId}": agent command is unknown`);
    }

    const openshellPath = this.openshellCli.getCliPath();
    const reconnectArgs = ['sandbox', 'exec', '-n', session.info.sandboxName, '--tty'];
    if (session.gatewayName) {
      reconnectArgs.push('-g', session.gatewayName);
    }
    reconnectArgs.push('--', ...session.agentCommand);
    debugPty(`${session.info.sandboxName} spawning: ${openshellPath} ${reconnectArgs.join(' ')}`);

    const ptyProcess = ptySpawn(openshellPath, reconnectArgs, {
      name: 'xterm-256color',
      cols: PTY_COLS,
      env: { ...(process.env as Record<string, string>), OPENCODE_ENABLE_QUESTION_TOOL: '1' },
    });

    session.stderrLines.length = 0;

    const { input, output } = this.ptyToStreams(ptyProcess, session.info.sandboxName, session.stderrLines);
    const stream = acp.ndJsonStream(input, output);
    const clientImpl = this.createClientImpl(sessionId);
    const connection = new acp.ClientSideConnection((_agent: acp.Agent) => clientImpl, stream);

    session.ptyProcess = ptyProcess;
    session.connection = connection;
    session.connectionClosed = false;

    ptyProcess.onExit(({ exitCode }) => {
      debugPty(`${session.info.sandboxName} process exited with code ${exitCode}`);
      const s = this.sessions.get(sessionId);
      if (s) {
        s.connectionClosed = true;
        if (s.info.status !== 'completed' && s.info.status !== 'cancelled') {
          this.updateSessionStatus(sessionId, exitCode === 0 ? 'completed' : 'error');
          if (exitCode !== 0) {
            const stderrMsg = s.stderrLines.join(' ').trim();
            s.info.error = stderrMsg || `Process exited with code ${exitCode}`;
          }
        }
      }
    });

    const initResult = await connection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
      },
    });
    debugProtocol(`${session.info.sandboxName} reconnected: protocol v${initResult.protocolVersion}`);

    const canResume = !!initResult.agentCapabilities?.sessionCapabilities?.resume;

    if (canResume && session.acpSessionId) {
      debugProtocol(`${session.info.sandboxName} resuming session: ${session.acpSessionId}`);
      const resumeResult = await connection.resumeSession({
        sessionId: session.acpSessionId,
        cwd: '/sandbox',
      });
      if (resumeResult.configOptions) {
        session.info.configOptions = this.mapConfigOptions(resumeResult.configOptions);
      }
      this.extractModels(session, resumeResult);
    } else {
      const newSession = await connection.newSession({
        cwd: '/sandbox',
        mcpServers: [],
      });
      debugProtocol(`${session.info.sandboxName} new session: ${newSession.sessionId}`);
      session.acpSessionId = newSession.sessionId;
      if (newSession.modes) {
        session.info.availableModes = newSession.modes.availableModes.map(m => ({
          modeId: m.id,
          name: m.name,
          description: m.description ?? undefined,
        }));
        session.info.currentModeId = newSession.modes.currentModeId;
      }
      if (newSession.configOptions) {
        session.info.configOptions = this.mapConfigOptions(newSession.configOptions);
      }
      this.extractModels(session, newSession);
    }
  }

  async sendFollowUp(sessionId: string, prompt: string, attachments?: AcpAttachment[]): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    if (!session.info.sandboxId) {
      throw new Error(`Sandbox "${session.info.sandboxName}" no longer exists`);
    }
    if (!session.acpSessionId && !session.connectionClosed) {
      throw new Error(`Session "${sessionId}" not initialized`);
    }

    session.messageTurn++;
    session.events.push({
      kind: 'prompt',
      text: prompt,
      attachments: attachments?.map(a => ({ fileName: a.fileName, mimeType: a.mimeType })),
      timestamp: Date.now(),
    });
    this.emitEvent(sessionId, session.events[session.events.length - 1]!);
    this.updateSessionStatus(sessionId, 'running');

    if (session.connectionClosed) {
      await this.reconnectSession(sessionId);
    }

    if (!session.acpSessionId) {
      throw new Error(`Session "${sessionId}" not initialized after reconnection`);
    }

    let contentBlocks: acp.ContentBlock[];
    try {
      const uploadedAttachments = await this.uploadAttachments(
        session.info.sandboxName,
        attachments,
        session.gatewayName,
      );
      contentBlocks = this.buildContentBlocks(prompt, uploadedAttachments);
    } catch (err: unknown) {
      console.error(`[ACP ${session.info.sandboxName}] attachment upload failed:`, err);
      this.updateSessionStatus(sessionId, 'error');
      session.info.error = err instanceof Error ? err.message : String(err);
      throw err;
    }

    try {
      const result = await session.connection.prompt({
        sessionId: session.acpSessionId,
        prompt: contentBlocks,
      });

      if (result.stopReason === 'end_turn' || result.stopReason === 'cancelled') {
        this.updateSessionStatus(sessionId, 'completed');
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.toLowerCase().includes('connection closed')) {
        debugLifecycle(`${session.info.sandboxName} connection died during prompt, reconnecting...`);
        await this.reconnectSession(sessionId);
        const result = await session.connection.prompt({
          sessionId: session.acpSessionId!,
          prompt: contentBlocks,
        });
        if (result.stopReason === 'end_turn' || result.stopReason === 'cancelled') {
          this.updateSessionStatus(sessionId, 'completed');
        }
        return;
      }
      console.error(`[ACP ${session.info.sandboxName}] follow-up failed:`, err);
      this.updateSessionStatus(sessionId, 'error');
      const stderrMsg = session.stderrLines.join(' ').trim();
      session.info.error = stderrMsg || (err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  private async uploadAttachments(
    sandboxName: string,
    attachments?: AcpAttachment[],
    gatewayName?: string,
  ): Promise<UploadedAttachment[] | undefined> {
    if (!attachments?.length) return undefined;

    const results: UploadedAttachment[] = [];
    for (const attachment of attachments) {
      const isText =
        attachment.mimeType.startsWith('text/') ||
        AcpSessionManager.TEXT_EXTENSIONS.has(extname(attachment.filePath).toLowerCase());

      if (isText) {
        const data = await readFile(attachment.filePath, 'utf-8');
        results.push({ ...attachment, isText: true, textContent: data });
      } else {
        const destDir = `${ATTACHMENT_UPLOAD_DIR}/${randomUUID()}/`;
        await this.openshellCli.uploadToSandbox(sandboxName, attachment.filePath, destDir, gatewayName);
        const remotePath = `${destDir}${basename(attachment.filePath)}`;
        results.push({ ...attachment, isText: false, remotePath });
      }
    }
    return results;
  }

  private buildContentBlocks(text: string, attachments?: UploadedAttachment[]): acp.ContentBlock[] {
    const blocks: acp.ContentBlock[] = [];

    if (attachments) {
      for (const attachment of attachments) {
        if (attachment.isText) {
          blocks.push({
            type: 'resource',
            resource: {
              uri: `file://${attachment.remotePath ?? attachment.filePath}`,
              text: attachment.textContent!,
              mimeType: attachment.mimeType,
            },
          });
        } else {
          blocks.push({
            type: 'resource_link',
            uri: `file://${attachment.remotePath!}`,
            name: attachment.fileName,
            mimeType: attachment.mimeType,
          });
        }
      }
    }

    blocks.push({ type: 'text', text });
    return blocks;
  }

  private static readonly TEXT_EXTENSIONS = new Set([
    '.txt',
    '.md',
    '.json',
    '.yaml',
    '.yml',
    '.xml',
    '.csv',
    '.tsv',
    '.js',
    '.ts',
    '.jsx',
    '.tsx',
    '.py',
    '.rb',
    '.go',
    '.rs',
    '.java',
    '.c',
    '.cpp',
    '.h',
    '.hpp',
    '.cs',
    '.swift',
    '.kt',
    '.sh',
    '.bash',
    '.html',
    '.css',
    '.scss',
    '.less',
    '.sql',
    '.toml',
    '.ini',
    '.cfg',
    '.env',
    '.log',
    '.svelte',
    '.vue',
  ]);

  private extractModels(session: AcpSession, newSessionResponse: unknown): void {
    const raw = newSessionResponse as {
      models?: {
        availableModels?: Array<{ modelId?: string; id?: string; name: string; description?: string | null }>;
        currentModelId?: string;
      };
    };
    if (raw.models) {
      session.info.availableModels = raw.models.availableModels?.map(m => ({
        modelId: m.modelId ?? m.id ?? m.name,
        name: m.name,
        description: m.description ?? undefined,
      }));
      session.info.currentModelId = raw.models.currentModelId;
      debugProtocol(
        `models: ${session.info.availableModels?.length ?? 0} available, current=${session.info.currentModelId}`,
      );
    }
  }

  async setSessionModel(sessionId: string, modelId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.acpSessionId) {
      throw new Error(`Session "${sessionId}" not found or not initialized`);
    }

    const conn = (
      session.connection as unknown as {
        connection: { sendRequest: (method: string, params: unknown) => Promise<unknown> };
      }
    ).connection;
    await conn.sendRequest('session/set_model', {
      sessionId: session.acpSessionId,
      modelId,
    });

    session.info.currentModelId = modelId;
    session.info.updatedAt = Date.now();
    this.apiSender.send('acp-session-update');
  }

  async setSessionMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.acpSessionId) {
      throw new Error(`Session "${sessionId}" not found or not initialized`);
    }

    await session.connection.setSessionMode({
      sessionId: session.acpSessionId,
      modeId,
    });

    session.info.currentModeId = modeId;
    session.info.updatedAt = Date.now();
    this.apiSender.send('acp-session-update');
  }

  async setSessionConfigOption(sessionId: string, configId: string, value: string | boolean): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.acpSessionId) {
      throw new Error(`Session "${sessionId}" not found or not initialized`);
    }

    const params =
      typeof value === 'boolean'
        ? { sessionId: session.acpSessionId, configId, type: 'boolean' as const, value }
        : { sessionId: session.acpSessionId, configId, value };

    const response = await session.connection.setSessionConfigOption(params);
    session.info.configOptions = this.mapConfigOptions(response.configOptions);
    session.info.updatedAt = Date.now();
    this.apiSender.send('acp-session-update');
  }

  private mapConfigOptions(sdkOptions: acp.SessionConfigOption[]): AcpSessionConfigOption[] {
    return sdkOptions.map(opt => {
      const base = {
        id: opt.id,
        name: opt.name,
        category: opt.category ?? undefined,
        description: opt.description ?? undefined,
        type: opt.type,
      };
      if (opt.type === 'select') {
        const isGrouped = opt.options.length > 0 && 'group' in opt.options[0]!;
        const mappedOptions = isGrouped
          ? (opt.options as acp.SessionConfigSelectGroup[]).map(g => ({
              group: g.group,
              name: g.name,
              options: g.options.map(o => ({
                value: o.value,
                name: o.name,
                description: o.description ?? undefined,
              })),
            }))
          : (opt.options as acp.SessionConfigSelectOption[]).map(o => ({
              value: o.value,
              name: o.name,
              description: o.description ?? undefined,
            }));
        return {
          ...base,
          type: opt.type,
          currentValue: opt.currentValue,
          options: mappedOptions,
        };
      }
      return { ...base, type: opt.type, currentValue: opt.currentValue };
    });
  }

  async renameSession(sessionId: string, name: string): Promise<void> {
    const previous = this.renameLocks.get(sessionId) ?? Promise.resolve();
    const task = previous.then(async () => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session "${sessionId}" not found`);
      }
      const previousName = session.info.name;
      const previousUpdatedAt = session.info.updatedAt;
      session.info.name = name;
      session.info.updatedAt = Date.now();
      try {
        await this.saveToDisk(sessionId);
      } catch (err: unknown) {
        session.info.name = previousName;
        session.info.updatedAt = previousUpdatedAt;
        throw err;
      }
      this.apiSender.send('acp-session-update');
    });
    this.renameLocks.set(
      sessionId,
      task.catch(() => {}),
    );
    return task;
  }

  async listSessions(): Promise<AcpSessionInfo[]> {
    await this.validateSandboxes();
    return Array.from(this.sessions.values()).map(s => ({ ...s.info }));
  }

  getSessionEvents(sessionId: string): AcpFlowEvent[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }
    return [...session.events];
  }

  async stopPrompt(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session?.acpSessionId) {
      throw new Error(`Session "${sessionId}" not found or not initialized`);
    }

    await session.connection.cancel({ sessionId: session.acpSessionId });
  }

  cancelSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    for (const [, pending] of session.pendingRequests) {
      pending.reject(new Error('Session cancelled'));
    }
    session.pendingRequests.clear();

    if (session.acpSessionId && session.connection) {
      session.connection.cancel({ sessionId: session.acpSessionId }).catch(() => {});
    }

    this.killPtyProcess(session);
    this.updateSessionStatus(sessionId, 'cancelled');
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Session "${sessionId}" not found`);
    }

    for (const [, pending] of session.pendingRequests) {
      pending.reject(new Error('Session deleted'));
    }
    session.pendingRequests.clear();

    if (session.acpSessionId && !session.connectionClosed && session.connection) {
      try {
        await session.connection.closeSession({ sessionId: session.acpSessionId });
      } catch {
        // best effort
      }
    }

    this.killPtyProcess(session);

    this.sessions.delete(sessionId);
    await this.removeFromDisk(sessionId);
    this.apiSender.send('acp-session-update');
  }

  private killPtyProcess(session: AcpSession): void {
    if (!session.ptyProcess) {
      return;
    }
    try {
      session.ptyProcess.write('\x03');
      session.ptyProcess.write('\x04');
    } catch {
      // stream may be closed
    }
    setTimeout(() => {
      try {
        session.ptyProcess.kill('SIGKILL');
      } catch {
        // already dead
      }
    }, 1000);
  }

  private updateSessionStatus(sessionId: string, status: AcpSessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const previousStatus = session.info.status;
    session.info.status = status;
    session.info.updatedAt = Date.now();

    if (status === 'completed' || status === 'cancelled' || status === 'error') {
      for (const event of session.events) {
        if (event.kind === 'tool_call' && event.status === 'running') {
          event.status = 'completed';
        }
      }
    }

    if (previousStatus !== status) {
      session.events.push({
        kind: 'status_change',
        from: previousStatus,
        to: status,
        timestamp: Date.now(),
      });
    }

    this.apiSender.send('acp-session-update');
    this.saveToDisk(sessionId).catch((err: unknown) => {
      console.error(`[ACP] Failed to persist session "${sessionId}":`, err);
    });
  }

  private emitEvent(sessionId: string, _event: AcpFlowEvent): void {
    this.apiSender.send('acp-session-update');
    this.saveToDisk(sessionId).catch((err: unknown) => {
      console.error(`[ACP] Failed to persist session "${sessionId}":`, err);
    });
  }

  @preDestroy()
  dispose(): void {
    for (const [, session] of this.sessions) {
      for (const [, pending] of session.pendingRequests) {
        pending.reject(new Error('Manager disposing'));
      }
      this.killPtyProcess(session);
    }
    this.sessions.clear();
  }

  private async loadFromDisk(): Promise<void> {
    const dir = this.directories.getAcpSessionsDirectory();
    if (!existsSync(dir)) {
      return;
    }
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        continue;
      }
      try {
        const raw = await readFile(join(dir, entry), 'utf-8');
        const data = JSON.parse(raw) as {
          info: AcpSessionInfo;
          events: AcpFlowEvent[];
          acpSessionId?: string;
          agentCommand?: string[];
          gatewayName?: string;
        };
        const info = data.info;

        if (info.status !== 'completed' && info.status !== 'cancelled' && info.status !== 'error') {
          info.status = 'completed';
          info.updatedAt = Date.now();
        }

        const events = data.events ?? [];
        const maxTurn = events.reduce(
          (max, e) => ('turn' in e && typeof e.turn === 'number' && e.turn > max ? e.turn : max),
          -1,
        );
        const session: AcpSession = {
          info,
          ptyProcess: undefined!,
          connection: undefined!,
          acpSessionId: data.acpSessionId,
          events,
          pendingRequests: new Map(),
          stderrLines: [],
          messageTurn: maxTurn + 1,
          connectionClosed: true,
          agentCommand: data.agentCommand ?? [],
          gatewayName: data.gatewayName,
        };
        this.sessions.set(info.id, session);
      } catch (e: unknown) {
        console.error(`Failed to load ACP session file "${entry}"`, e);
      }
    }
  }

  private async validateSandboxes(): Promise<void> {
    if (this.sessions.size === 0) return;
    try {
      const sandboxes = await this.openshellCli.listSandboxes();
      const readySandboxes = new Map(sandboxes.filter(s => s.phase === 'Ready').map(s => [s.name, s.id]));
      for (const session of this.sessions.values()) {
        if (readySandboxes.has(session.info.sandboxName)) {
          session.info.sandboxId = readySandboxes.get(session.info.sandboxName);
        } else {
          session.info.sandboxId = undefined;
        }
      }
    } catch {
      // CLI may be unavailable — skip validation
    }
  }

  private async saveToDisk(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    const dir = this.directories.getAcpSessionsDirectory();
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    const data = {
      info: session.info,
      events: session.events,
      acpSessionId: session.acpSessionId,
      agentCommand: session.agentCommand,
      gatewayName: session.gatewayName,
    };
    await writeFile(join(dir, `${sessionId}.json`), JSON.stringify(data, undefined, 2) + '\n', 'utf-8');
  }

  private async removeFromDisk(sessionId: string): Promise<void> {
    const filePath = join(this.directories.getAcpSessionsDirectory(), `${sessionId}.json`);
    try {
      await rm(filePath);
    } catch {
      // file may not exist
    }
  }
}
