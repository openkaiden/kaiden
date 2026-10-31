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

import type { PolicyChunk } from '@nvidia/openshell-sdk/raw';
import type { IpcMainInvokeEvent } from 'electron/main';
import { inject, injectable, preDestroy } from 'inversify';

import { IPCHandle } from '/@/plugin/api.js';
import { Emitter } from '/@/plugin/events/emitter.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { OpenshellWorkspaceDefaults } from '/@/plugin/openshell-cli/openshell-workspace-defaults.js';
import type { IDisposable } from '/@api/disposable.js';
import type { DraftPolicyChunk } from '/@api/draft-policy-info.js';

import type { SandboxDenial } from './sandbox-denial-log-parser.js';
import { SandboxDenialLogParser } from './sandbox-denial-log-parser.js';

export interface DraftPolicyEvent {
  sandboxId: string;
  sandboxName: string;
  chunks: DraftPolicyChunk[];
}

interface SandboxWatchState {
  sandboxName: string;
  gatewayName?: string;
  abortController: AbortController;
  chunkState: Map<string, InternalChunkState>;
  subscriberCount: number;
  reconnectAttempt: number;
  reconnectTimer?: ReturnType<typeof setTimeout>;
  draftRefetchTimer?: ReturnType<typeof setTimeout>;
}

interface InternalChunkState {
  chunk: DraftPolicyChunk;
  isL4Proposal: boolean;
  reviewToken?: string;
}

@injectable()
export class DraftPolicyWatcher {
  readonly #maxReconnectDelayMs = 30_000;
  readonly #draftRefetchDebounceMs = 1500;

  readonly #subscriptions = new Map<string, SandboxWatchState>();

  readonly #onDraftPolicyUpdate = new Emitter<DraftPolicyEvent>();
  readonly onDraftPolicyUpdate = this.#onDraftPolicyUpdate.event;

  constructor(
    @inject(OpenshellSdkClientManager)
    private readonly sdkClientManager: OpenshellSdkClientManager,
    @inject(IPCHandle)
    private readonly ipcHandle: IPCHandle,
    @inject(SandboxDenialLogParser)
    private readonly denialLogParser: SandboxDenialLogParser,
  ) {}

  init(): void {
    this.ipcHandle('draft-policy:approveChunk', this.approveChunkFromIpc.bind(this));
    this.ipcHandle('draft-policy:rejectChunk', this.rejectChunkFromIpc.bind(this));
  }

  protected async approveChunkFromIpc(_: IpcMainInvokeEvent, sandboxId: string, chunkId: string): Promise<void> {
    return this.approveDraftChunk(sandboxId, chunkId);
  }

  protected async rejectChunkFromIpc(_: IpcMainInvokeEvent, sandboxId: string, chunkId: string): Promise<void> {
    return this.rejectDraftChunk(sandboxId, chunkId);
  }

  async watchSandbox(sandboxId: string, sandboxName: string, gatewayName?: string): Promise<IDisposable> {
    const existing = this.#subscriptions.get(sandboxId);
    if (existing) {
      existing.subscriberCount++;
      return this.#createSubscription(sandboxId);
    }

    const state: SandboxWatchState = {
      sandboxName,
      gatewayName,
      abortController: new AbortController(),
      chunkState: new Map(),
      subscriberCount: 1,
      reconnectAttempt: 0,
    };
    this.#subscriptions.set(sandboxId, state);

    await this.#fetchExistingDrafts(sandboxId, state);
    if (!state.abortController.signal.aborted) {
      this.#startStream(sandboxId, state);
    }

    return this.#createSubscription(sandboxId);
  }

  #createSubscription(sandboxId: string): IDisposable {
    let disposed = false;
    return {
      dispose: (): void => {
        if (disposed) return;
        disposed = true;
        const state = this.#subscriptions.get(sandboxId);
        if (!state) return;
        state.subscriberCount--;
        if (state.subscriberCount === 0) {
          this.unwatchSandbox(sandboxId);
        }
      },
    };
  }

  unwatchSandbox(sandboxId: string): void {
    const state = this.#subscriptions.get(sandboxId);
    if (!state) return;

    state.abortController.abort();
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    if (state.draftRefetchTimer) clearTimeout(state.draftRefetchTimer);
    this.#subscriptions.delete(sandboxId);
  }

  getAllChunks(sandboxId: string): DraftPolicyChunk[] {
    const state = this.#subscriptions.get(sandboxId);
    if (!state) return [];
    return Array.from(state.chunkState.values()).map(s => s.chunk);
  }

  async approveDraftChunk(sandboxId: string, chunkId: string): Promise<void> {
    const state = this.#subscriptions.get(sandboxId);
    if (!state) throw new Error(`Not watching sandbox ${sandboxId}`);

    const internal = state.chunkState.get(chunkId);
    if (!internal) throw new Error(`Chunk ${chunkId} not found`);

    if (!internal.isL4Proposal) {
      throw new Error(`Chunk ${chunkId} is not yet ready for approval — waiting for server draft policy`);
    }

    const client = await this.sdkClientManager.getClient(state.gatewayName);

    await client.raw.approveDraftChunk({
      sandbox: state.sandboxName,
      chunkId,
      reviewToken: internal.reviewToken ?? '',
      workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
    });

    internal.chunk.status = 'approved';
    this.#emitChunkStatusUpdate(sandboxId, state, internal.chunk);

    await this.#refetchDraftPolicy(sandboxId, state);
  }

  async rejectDraftChunk(sandboxId: string, chunkId: string): Promise<void> {
    const state = this.#subscriptions.get(sandboxId);
    if (!state) throw new Error(`Not watching sandbox ${sandboxId}`);

    const internal = state.chunkState.get(chunkId);
    if (!internal) throw new Error(`Chunk ${chunkId} not found`);

    // L7 chunks are synthesized from sandbox logs and have no server-side draft chunk,
    // so dismissing one only updates local state.
    if (internal.isL4Proposal) {
      const client = await this.sdkClientManager.getClient(state.gatewayName);

      if (internal.chunk.status === 'approved') {
        await client.raw.undoDraftChunk({
          sandbox: state.sandboxName,
          chunkId,
          workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
        });
      }

      await client.raw.rejectDraftChunk({
        sandbox: state.sandboxName,
        chunkId,
        reason: 'Rejected by user',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
    }

    internal.chunk.status = 'rejected';
    this.#emitChunkStatusUpdate(sandboxId, state, internal.chunk);

    if (internal.isL4Proposal) {
      // Mirror approveDraftChunk: pick up server-side status or applicationError changes.
      await this.#refetchDraftPolicy(sandboxId, state);
    }
  }

  async #fetchExistingDrafts(sandboxId: string, state: SandboxWatchState): Promise<void> {
    try {
      const client = await this.sdkClientManager.getClient(state.gatewayName);
      if (state.abortController.signal.aborted) return;
      const response = await client.raw.getDraftPolicy({
        sandbox: state.sandboxName,
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
      if (state.abortController.signal.aborted) return;

      if (response.chunks.length > 0) {
        const mapped = response.chunks.map(c => this.#policyChunkToFlowChunk(c));
        for (const { chunk, reviewToken } of mapped) {
          state.chunkState.set(chunk.chunkId, { chunk, isL4Proposal: true, reviewToken });
        }
        this.#onDraftPolicyUpdate.fire({
          sandboxId,
          sandboxName: state.sandboxName,
          chunks: mapped.map(m => m.chunk),
        });
      }
    } catch (err: unknown) {
      console.error(`[DraftPolicy] failed to fetch existing drafts for ${state.sandboxName}:`, err);
    }
  }

  #startStream(sandboxId: string, state: SandboxWatchState): void {
    const iterate = async (): Promise<void> => {
      try {
        const client = await this.sdkClientManager.getClient(state.gatewayName);
        const stream = client.raw.watchSandbox(
          {
            sandbox: state.sandboxName,
            followLogs: true,
            followStatus: true,
            followEvents: false,
            logSources: ['sandbox'],
            logTailLines: 0,
            workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
          },
          { signal: state.abortController.signal },
        );

        for await (const event of stream) {
          if (!event.payload) continue;
          state.reconnectAttempt = 0;

          switch (event.payload.case) {
            case 'draftPolicyUpdate':
            case 'sandbox':
              await this.#refetchDraftPolicy(sandboxId, state);
              break;
            case 'log':
              this.#handleLogLine(sandboxId, state, event.payload.value);
              break;
            default:
          }
        }
        // Stream ended normally (server closed it, e.g. rolling restart or idle timeout).
        // Back off before reconnecting to avoid a tight loop if the server keeps closing.
        if (!state.abortController.signal.aborted) {
          const delay = Math.min(1000 * 2 ** state.reconnectAttempt, this.#maxReconnectDelayMs);
          state.reconnectAttempt++;
          state.reconnectTimer = setTimeout(() => {
            if (!state.abortController.signal.aborted) {
              this.#startStream(sandboxId, state);
            }
          }, delay);
        }
      } catch (err: unknown) {
        if (state.abortController.signal.aborted) {
          return;
        }

        const delay = Math.min(1000 * 2 ** state.reconnectAttempt, this.#maxReconnectDelayMs);
        state.reconnectAttempt++;
        console.error(
          `[DraftPolicy] stream error for ${state.sandboxName}, reconnecting in ${delay}ms (attempt ${state.reconnectAttempt}):`,
          err,
        );
        state.reconnectTimer = setTimeout(() => {
          if (!state.abortController.signal.aborted) {
            this.#startStream(sandboxId, state);
          }
        }, delay);
      }
    };

    iterate().catch((err: unknown) => {
      console.error(`[DraftPolicy] unexpected iterate error for ${state.sandboxName}:`, err);
    });
  }

  async #refetchDraftPolicy(sandboxId: string, state: SandboxWatchState): Promise<void> {
    try {
      const client = await this.sdkClientManager.getClient(state.gatewayName);
      const response = await client.raw.getDraftPolicy({
        sandbox: state.sandboxName,
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });

      // The SDK's `stage` and `supersedesChunkId` fields are not mapped yet: the gateway
      // does not emit progressive refinements for L4 chunks today. When it does, this loop
      // should remove entries whose chunkId appears as another chunk's supersedesChunkId.
      const changedChunks: DraftPolicyChunk[] = [];
      for (const policyChunk of response.chunks) {
        const existing = state.chunkState.get(policyChunk.id);
        const { chunk, reviewToken } = this.#policyChunkToFlowChunk(policyChunk);

        if (!existing) {
          state.chunkState.set(chunk.chunkId, { chunk, isL4Proposal: true, reviewToken });
          changedChunks.push(chunk);
        } else {
          const prev = existing.chunk;
          // Keep the local status when the server still reports 'pending' after a local
          // approve/reject — the RPC may not be reflected in getDraftPolicy yet.
          const mergedStatus = chunk.status === 'pending' && prev.status !== 'pending' ? prev.status : chunk.status;
          const changed =
            prev.status !== mergedStatus ||
            prev.applicationError !== chunk.applicationError ||
            prev.rationale !== chunk.rationale ||
            prev.confidence !== chunk.confidence ||
            prev.securityNotes !== chunk.securityNotes;
          existing.chunk = { ...chunk, status: mergedStatus };
          existing.reviewToken = reviewToken;
          if (changed) changedChunks.push(existing.chunk);
        }
      }

      if (changedChunks.length > 0) {
        this.#onDraftPolicyUpdate.fire({
          sandboxId,
          sandboxName: state.sandboxName,
          chunks: changedChunks,
        });
      }
    } catch (err: unknown) {
      console.error(`[DraftPolicy] failed to fetch draft policy for ${state.sandboxName}:`, err);
    }
  }

  #handleLogLine(
    sandboxId: string,
    state: SandboxWatchState,
    logLine: {
      fields: { [key: string]: string };
      message: string;
    },
  ): void {
    const denial = this.denialLogParser.parse(logLine);
    if (!denial) return;

    this.#emitDenialFromLog(sandboxId, state, denial);
  }

  #emitDenialFromLog(sandboxId: string, state: SandboxWatchState, denial: SandboxDenial): void {
    if (denial.denyReason?.includes('policy changed') || denial.denyReason?.includes('policy generation is stale'))
      return;

    const isL7 = denial.isL7;

    if (!isL7) {
      this.#scheduleDraftPolicyRefetch(sandboxId, state);
      return;
    }

    const isGraphql = denial.protocol === 'graphql';
    const alreadyCovered = Array.from(state.chunkState.values()).some(s => {
      if (s.chunk.host !== denial.host || s.chunk.port !== denial.port || !s.chunk.isL7) return false;
      // REST and GraphQL denials are distinct rules: only compare like with like, otherwise a
      // pending REST POST chunk would hide a GraphQL denial on the same host:port and vice versa.
      if ((s.chunk.protocol === 'graphql') !== isGraphql) return false;
      if (isGraphql) {
        return s.chunk.operationType === denial.operationType && s.chunk.status !== 'approved';
      }
      return s.chunk.method === denial.method && s.chunk.status !== 'approved';
    });
    if (alreadyCovered) return;

    const chunkId = isGraphql
      ? `gql-${denial.host}-${denial.port}-${denial.operationType}-${denial.operationName}-${Date.now()}`
      : `l7-${denial.host}-${denial.port}-${denial.method}-${Date.now()}`;
    const sanitizedHost = denial.host.replace(/[.-]/g, '_').replace(/\W/g, '');
    const protocolSuffix = isGraphql
      ? `_gql_${denial.operationType ?? 'op'}`
      : `_${(denial.method ?? 'any').toLowerCase()}`;
    const ruleName = `allow_${sanitizedHost}_${denial.port}${protocolSuffix}`;

    const chunk: DraftPolicyChunk = {
      chunkId,
      ruleName,
      status: 'pending',
      host: denial.host,
      port: denial.port,
      binaries: denial.binary ? [denial.binary] : ['/**'],
      rationale:
        denial.denyReason ??
        (isGraphql
          ? `GraphQL ${denial.operationType} ${denial.operationName} was denied`
          : `${denial.method} ${denial.path} was denied`),
      hasSecurityNotes: false,
      // L7 denials are excluded from mechanistic mapping by design (OpenShell#1333): L7
      // context (method, path, query) is too rich for deterministic rules, so only the
      // in-sandbox agent loop can author narrow L7 proposals. However, that loop is
      // broken in multiple ways: the policy advisor skill file is not installed in the
      // sandbox workload since RFC 0012 (OpenShell#3698), and L7 endpoints default to
      // enforcement:audit (OpenShell#4470) so denied requests pass through silently —
      // the agent never sees the 403 with next_steps.
      // These chunks are synthesized client-side from sandbox log lines and have no
      // server-side draft chunk — approve/reject RPCs cannot act on them.
      isL7: true,
      protocol: denial.protocol,
      method: denial.method,
      path: denial.path,
      operationType: denial.operationType,
      operationName: denial.operationName,
      graphqlFields: denial.graphqlFields,
    };

    state.chunkState.set(chunkId, { chunk, isL4Proposal: false });

    this.#onDraftPolicyUpdate.fire({
      sandboxId,
      sandboxName: state.sandboxName,
      chunks: [chunk],
    });
  }

  #policyChunkToFlowChunk(policyChunk: PolicyChunk): { chunk: DraftPolicyChunk; reviewToken?: string } {
    const endpoint = policyChunk.proposedRule?.endpoints[0];
    return {
      chunk: {
        chunkId: policyChunk.id,
        ruleName: policyChunk.ruleName,
        status: this.#mapChunkStatus(policyChunk),
        host: endpoint?.host ?? 'unknown',
        port: endpoint?.port ?? 0,
        binaries: policyChunk.proposedRule?.binaries.map(b => b.path) ?? [],
        rationale: policyChunk.rationale,
        hasSecurityNotes: !!policyChunk.securityNotes,
        securityNotes: policyChunk.securityNotes || undefined,
        confidence: policyChunk.confidence,
        isL7: false,
        applicationError: policyChunk.applicationError,
      },
      reviewToken: policyChunk.reviewToken,
    };
  }

  #mapChunkStatus(policyChunk: PolicyChunk): DraftPolicyChunk['status'] {
    switch (policyChunk.status) {
      case 'pending':
      case 'approved':
      case 'rejected':
        return policyChunk.status;
      default:
        console.warn(
          `[DraftPolicy] unknown status "${policyChunk.status}" for draft chunk ${policyChunk.id}, showing it as rejected`,
        );
        return 'rejected';
    }
  }

  #emitChunkStatusUpdate(sandboxId: string, state: SandboxWatchState, chunk: DraftPolicyChunk): void {
    this.#onDraftPolicyUpdate.fire({
      sandboxId,
      sandboxName: state.sandboxName,
      chunks: [chunk],
    });
  }

  #scheduleDraftPolicyRefetch(sandboxId: string, state: SandboxWatchState): void {
    if (state.draftRefetchTimer) clearTimeout(state.draftRefetchTimer);
    state.draftRefetchTimer = setTimeout(() => {
      // #refetchDraftPolicy reports its own failures: the catch only keeps setTimeout from
      // producing an unhandled rejection (no-floating-promises).
      this.#refetchDraftPolicy(sandboxId, state).catch((err: unknown) => {
        console.error(`[DraftPolicy] scheduled refetch failed for ${state.sandboxName}:`, err);
      });
    }, this.#draftRefetchDebounceMs);
  }

  @preDestroy()
  dispose(): void {
    for (const sandboxId of this.#subscriptions.keys()) {
      this.unwatchSandbox(sandboxId);
    }
    this.#onDraftPolicyUpdate.dispose();
  }
}
