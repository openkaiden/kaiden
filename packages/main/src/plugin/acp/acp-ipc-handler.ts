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

import type { IpcMainInvokeEvent } from 'electron/main';
import { inject, injectable } from 'inversify';

import { AcpSessionManager } from '/@/plugin/acp/acp-session-manager.js';
import { IPCHandle } from '/@/plugin/api.js';
import type {
  AcpAttachment,
  AcpFlowEvent,
  AcpSessionCreateOptions,
  AcpSessionInfo,
  AcpUserResponse,
} from '/@api/acp-session-info.js';

@injectable()
export class AcpIPCHandler {
  constructor(
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(AcpSessionManager)
    private readonly sessionManager: AcpSessionManager,
  ) {}

  init(): void {
    this.ipcHandle('acp:createSession', this.createSession.bind(this));
    this.ipcHandle('acp:listSessions', this.listSessions.bind(this));
    this.ipcHandle('acp:getSessionEvents', this.getSessionEvents.bind(this));
    this.ipcHandle('acp:respondToRequest', this.respondToRequest.bind(this));
    this.ipcHandle('acp:sendFollowUp', this.sendFollowUp.bind(this));
    this.ipcHandle('acp:stopPrompt', this.stopPrompt.bind(this));
    this.ipcHandle('acp:deleteSession', this.deleteSession.bind(this));
    this.ipcHandle('acp:renameSession', this.renameSession.bind(this));
    this.ipcHandle('acp:cancelSession', this.cancelSession.bind(this));
    this.ipcHandle('acp:setSessionModel', this.setSessionModel.bind(this));
    this.ipcHandle('acp:setSessionMode', this.setSessionMode.bind(this));
    this.ipcHandle('acp:setSessionConfigOption', this.setSessionConfigOption.bind(this));
  }

  protected async createSession(_: IpcMainInvokeEvent, options: AcpSessionCreateOptions): Promise<AcpSessionInfo> {
    return this.sessionManager.createSession(options);
  }

  protected async listSessions(_: IpcMainInvokeEvent): Promise<AcpSessionInfo[]> {
    return this.sessionManager.listSessions();
  }

  protected getSessionEvents(_: IpcMainInvokeEvent, sessionId: string): AcpFlowEvent[] {
    return this.sessionManager.getSessionEvents(sessionId);
  }

  protected respondToRequest(_: IpcMainInvokeEvent, response: AcpUserResponse): void {
    this.sessionManager.respondToRequest(response);
  }

  protected async sendFollowUp(
    _: IpcMainInvokeEvent,
    sessionId: string,
    prompt: string,
    attachments?: AcpAttachment[],
  ): Promise<void> {
    return this.sessionManager.sendFollowUp(sessionId, prompt, attachments);
  }

  protected async stopPrompt(_: IpcMainInvokeEvent, sessionId: string): Promise<void> {
    return this.sessionManager.stopPrompt(sessionId);
  }

  protected async deleteSession(_: IpcMainInvokeEvent, sessionId: string): Promise<void> {
    return this.sessionManager.deleteSession(sessionId);
  }

  protected async renameSession(_: IpcMainInvokeEvent, sessionId: string, name: string): Promise<void> {
    return this.sessionManager.renameSession(sessionId, name);
  }

  protected cancelSession(_: IpcMainInvokeEvent, sessionId: string): void {
    this.sessionManager.cancelSession(sessionId);
  }

  protected async setSessionModel(_: IpcMainInvokeEvent, sessionId: string, modelId: string): Promise<void> {
    return this.sessionManager.setSessionModel(sessionId, modelId);
  }

  protected async setSessionMode(_: IpcMainInvokeEvent, sessionId: string, modeId: string): Promise<void> {
    return this.sessionManager.setSessionMode(sessionId, modeId);
  }

  protected async setSessionConfigOption(
    _: IpcMainInvokeEvent,
    sessionId: string,
    configId: string,
    value: string | boolean,
  ): Promise<void> {
    return this.sessionManager.setSessionConfigOption(sessionId, configId, value);
  }
}
