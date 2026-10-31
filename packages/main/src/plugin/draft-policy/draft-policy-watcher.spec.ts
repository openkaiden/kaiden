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

import { create, type MessageInitShape } from '@bufbuild/protobuf';
import type { OpenShellClient } from '@nvidia/openshell-sdk';
import {
  ApproveDraftChunkResponseSchema,
  type GetDraftPolicyResponse,
  GetDraftPolicyResponseSchema,
  PolicyChunkSchema,
  RejectDraftChunkResponseSchema,
  type SandboxStreamEvent,
  SandboxStreamEventSchema,
  UndoDraftChunkResponseSchema,
} from '@nvidia/openshell-sdk/raw';
import { assert, beforeEach, describe, expect, test, vi } from 'vitest';

import type { IPCHandle } from '/@/plugin/api.js';
import type { OpenshellGatewayConfig } from '/@/plugin/openshell-cli/openshell-gateway-config.js';
import type { OpenshellGatewayManager } from '/@/plugin/openshell-cli/openshell-gateway-manager.js';
import { OpenshellSdkClientManager } from '/@/plugin/openshell-cli/openshell-sdk-client-manager.js';
import { OpenshellWorkspaceDefaults } from '/@/plugin/openshell-cli/openshell-workspace-defaults.js';

import type { DraftPolicyEvent } from './draft-policy-watcher.js';
import { DraftPolicyWatcher } from './draft-policy-watcher.js';
import { SandboxDenialLogParser } from './sandbox-denial-log-parser.js';

vi.mock(import('/@/plugin/openshell-cli/openshell-sdk-client-manager.js'));

// keeps the L4 refetch debounce readable; must stay in sync with DraftPolicyWatcher
const DRAFT_REFETCH_DEBOUNCE_MS = 1500;

type PolicyChunkInit = MessageInitShape<typeof PolicyChunkSchema>;

function makeDraftPolicyResponse(chunks: PolicyChunkInit[]): GetDraftPolicyResponse {
  return create(GetDraftPolicyResponseSchema, {
    chunks: chunks.map(chunk => create(PolicyChunkSchema, chunk)),
  });
}

function makeLogEvent(message: string, fields: Record<string, string> = {}): SandboxStreamEvent {
  return create(SandboxStreamEventSchema, {
    payload: {
      case: 'log',
      value: {
        fields,
        eventTime: { seconds: BigInt(Math.floor(Date.now() / 1000)) },
        message,
        level: 'INFO',
        source: 'sandbox',
      },
    },
  });
}

function makeSandboxEvent(): SandboxStreamEvent {
  return create(SandboxStreamEventSchema, {
    payload: {
      case: 'sandbox',
      value: {},
    },
  });
}

function createOpenShellClient(): OpenShellClient {
  return {
    raw: {
      watchSandbox: vi.fn(),
      getDraftPolicy: vi.fn().mockResolvedValue(makeDraftPolicyResponse([])),
      approveDraftChunk: vi.fn().mockResolvedValue(create(ApproveDraftChunkResponseSchema, { policyVersion: 1 })),
      rejectDraftChunk: vi.fn().mockResolvedValue(create(RejectDraftChunkResponseSchema)),
      undoDraftChunk: vi.fn().mockResolvedValue(create(UndoDraftChunkResponseSchema, { policyVersion: 2 })),
    },
  } as unknown as OpenShellClient;
}

function neverEndingStream(): AsyncIterable<SandboxStreamEvent> {
  return { [Symbol.asyncIterator]: () => ({ next: () => new Promise<IteratorResult<SandboxStreamEvent>>(() => {}) }) };
}

function failingStream(error: Error): AsyncIterable<SandboxStreamEvent> {
  return { [Symbol.asyncIterator]: () => ({ next: () => Promise.reject(error) }) };
}

function emptyStream(): AsyncIterable<SandboxStreamEvent> {
  return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve({ done: true, value: undefined }) }) };
}

function setupStreamWithEvents(events: SandboxStreamEvent[]): AsyncGenerator<SandboxStreamEvent> {
  return (async function* (): AsyncGenerator<SandboxStreamEvent> {
    for (const ev of events) {
      yield ev;
    }
    await new Promise(() => {});
  })();
}

describe('DraftPolicyWatcher', () => {
  let watcher: DraftPolicyWatcher;
  let client: OpenShellClient;
  let ipcHandle: IPCHandle;
  let sdkClientManager: OpenshellSdkClientManager;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    client = createOpenShellClient();
    ipcHandle = vi.fn();
    sdkClientManager = new OpenshellSdkClientManager({} as OpenshellGatewayManager, {} as OpenshellGatewayConfig);
    vi.mocked(sdkClientManager.getClient).mockResolvedValue(client);
    watcher = new DraftPolicyWatcher(sdkClientManager, ipcHandle, new SandboxDenialLogParser());
  });

  describe('init', () => {
    test('registers the draft policy IPC handlers', () => {
      watcher.init();

      expect(ipcHandle).toHaveBeenCalledWith('draft-policy:approveChunk', expect.any(Function));
      expect(ipcHandle).toHaveBeenCalledWith('draft-policy:rejectChunk', expect.any(Function));
    });
  });

  describe('watchSandbox', () => {
    test('fetches existing drafts on connect', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [{ path: '/usr/bin/curl' }],
        },
        rationale: 'Denied by policy',
        securityNotes: '',
        confidence: 0.9,
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));

      // Create an empty async iterable that never yields
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      // Let the microtask for getDraftPolicy resolve
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      assert(events[0]);
      expect(events[0].sandboxId).toBe('sandbox-1');
      expect(events[0].chunks).toHaveLength(1);
      assert(events[0].chunks[0]);
      expect(events[0].chunks[0].host).toBe('example.com');
      expect(events[0].chunks[0].port).toBe(443);
      expect(events[0].chunks[0].status).toBe('pending');
    });

    test('does not duplicate subscriptions for same sandbox', async () => {
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await watcher.watchSandbox('sandbox-1', 'my-sandbox');

      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(1);
    });

    test('keeps watching until all subscribers dispose', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      const first = await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      const second = await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      first.dispose();
      expect(watcher.getAllChunks('sandbox-1')).toHaveLength(1);

      second.dispose();
      expect(watcher.getAllChunks('sandbox-1')).toHaveLength(0);
    });

    test('stops the initial fetch when the watch is cancelled', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
      };
      let resolveDrafts!: (response: GetDraftPolicyResponse) => void;
      vi.mocked(client.raw.getDraftPolicy).mockReturnValue(
        new Promise<GetDraftPolicyResponse>(resolve => {
          resolveDrafts = resolve;
        }),
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(event => events.push(event));

      const watchPromise = watcher.watchSandbox('sandbox-1', 'my-sandbox');
      // let the initial fetch start so cancelling exercises the guard after getDraftPolicy,
      // not just the guard before it
      await vi.advanceTimersByTimeAsync(0);
      expect(client.raw.getDraftPolicy).toHaveBeenCalled();
      watcher.unwatchSandbox('sandbox-1');
      resolveDrafts(makeDraftPolicyResponse([pendingChunk]));
      await watchPromise;
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);
      expect(client.raw.watchSandbox).not.toHaveBeenCalled();
      expect(watcher.getAllChunks('sandbox-1')).toHaveLength(0);
    });

    test('returns disposable that unwatches', async () => {
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      const disposable = await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      disposable.dispose();

      // Should be able to watch again after disposing
      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(2);
    });
  });

  describe('approveDraftChunk', () => {
    test('calls approveDraftChunk RPC for L4 proposals', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
        reviewToken: 'token-abc',
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox', 'gateway-1');
      await vi.advanceTimersByTimeAsync(0);

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(event => events.push(event));

      const approvePromise = watcher.approveDraftChunk('sandbox-1', 'chunk-1');
      await vi.advanceTimersByTimeAsync(200);
      await approvePromise;

      expect(client.raw.approveDraftChunk).toHaveBeenCalledWith({
        sandbox: 'my-sandbox',
        chunkId: 'chunk-1',
        reviewToken: 'token-abc',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
      expect(events.at(-1)?.chunks[0]?.status).toBe('approved');
    });

    test('throws for unknown sandbox', async () => {
      await expect(watcher.approveDraftChunk('unknown', 'chunk-1')).rejects.toThrow('Not watching sandbox');
    });

    test('throws for unknown chunk', async () => {
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());
      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      await expect(watcher.approveDraftChunk('sandbox-1', 'unknown-chunk')).rejects.toThrow('not found');
    });

    test('approves a previously rejected chunk', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
        reviewToken: 'token-abc',
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox', 'gateway-1');
      await vi.advanceTimersByTimeAsync(0);

      await watcher.rejectDraftChunk('sandbox-1', 'chunk-1');

      const approvePromise = watcher.approveDraftChunk('sandbox-1', 'chunk-1');
      await vi.advanceTimersByTimeAsync(200);
      await approvePromise;

      expect(client.raw.approveDraftChunk).toHaveBeenCalledWith({
        sandbox: 'my-sandbox',
        chunkId: 'chunk-1',
        reviewToken: 'token-abc',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
    });
  });

  describe('rejectDraftChunk', () => {
    test('calls rejectDraftChunk RPC for L4 proposals', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(event => events.push(event));

      await watcher.rejectDraftChunk('sandbox-1', 'chunk-1');

      expect(client.raw.rejectDraftChunk).toHaveBeenCalledWith({
        sandbox: 'my-sandbox',
        chunkId: 'chunk-1',
        reason: 'Rejected by user',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
      expect(events.at(-1)?.chunks[0]?.status).toBe('rejected');
    });

    test('undoes approval before rejecting a previously approved chunk', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
        reviewToken: 'token-abc',
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());
      vi.mocked(client.raw.undoDraftChunk).mockResolvedValue(
        create(UndoDraftChunkResponseSchema, { policyVersion: 3 }),
      );

      await watcher.watchSandbox('sandbox-1', 'my-sandbox', 'gateway-1');
      await vi.advanceTimersByTimeAsync(0);

      const approvePromise = watcher.approveDraftChunk('sandbox-1', 'chunk-1');
      await vi.advanceTimersByTimeAsync(200);
      await approvePromise;

      const rejectPromise = watcher.rejectDraftChunk('sandbox-1', 'chunk-1');
      await vi.advanceTimersByTimeAsync(200);
      await rejectPromise;

      expect(client.raw.undoDraftChunk).toHaveBeenCalledWith({
        sandbox: 'my-sandbox',
        chunkId: 'chunk-1',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
      expect(client.raw.rejectDraftChunk).toHaveBeenCalledWith({
        sandbox: 'my-sandbox',
        chunkId: 'chunk-1',
        reason: 'Rejected by user',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
    });

    test('refetches the draft policy after rejecting an L4 proposal', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);
      vi.mocked(client.raw.getDraftPolicy).mockClear();

      await watcher.rejectDraftChunk('sandbox-1', 'chunk-1');

      expect(client.raw.getDraftPolicy).toHaveBeenCalledWith({
        sandbox: 'my-sandbox',
        workspaceScope: OpenshellWorkspaceDefaults.WORKSPACE_SCOPE,
      });
    });

    test('dismisses an L7 chunk locally without calling the gateway', async () => {
      const logEvent = makeLogEvent(
        'HTTP:POST [MED] DENIED curl(1234) -> POST https://api.github.com:443/repos [policy:default]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(event => events.push(event));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);
      const l7Chunk = events.at(0)?.chunks[0];
      assert(l7Chunk);
      vi.mocked(client.raw.getDraftPolicy).mockClear();

      await watcher.rejectDraftChunk('sandbox-1', l7Chunk.chunkId);

      expect(client.raw.rejectDraftChunk).not.toHaveBeenCalled();
      expect(client.raw.undoDraftChunk).not.toHaveBeenCalled();
      expect(client.raw.getDraftPolicy).not.toHaveBeenCalled();
      expect(events.at(-1)?.chunks[0]?.status).toBe('rejected');
    });
  });

  describe('unwatchSandbox', () => {
    test('cleans up state', async () => {
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      watcher.unwatchSandbox('sandbox-1');

      // Should not throw for non-existent sandbox
      watcher.unwatchSandbox('sandbox-1');
    });
  });

  describe('log-based denial detection', () => {
    test('schedules refetch for L4 denial from OCSF shorthand', async () => {
      const draftChunk = {
        id: 'draft-npm',
        status: 'pending',
        ruleName: 'allow_registry_npmjs_org_443',
        proposedRule: {
          endpoints: [{ host: 'registry.npmjs.org', port: 443 }],
          binaries: [{ path: '/usr/bin/curl' }],
        },
        rationale: 'Allow curl to connect to registry.npmjs.org:443 (HTTPS).',
        securityNotes: '',
        confidence: 0.65,
      };
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([]))
        .mockResolvedValueOnce(makeDraftPolicyResponse([draftChunk]));

      const logEvent = makeLogEvent(
        'NET:CONNECT [MED] DENIED curl(1234) -> registry.npmjs.org:443 [policy:default] [reason:host not in allow list]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(DRAFT_REFETCH_DEBOUNCE_MS);

      expect(events).toHaveLength(1);
      assert(events[0]?.chunks[0]);
      expect(events[0].chunks[0].host).toBe('registry.npmjs.org');
    });

    test('emits L7 denial immediately from OCSF shorthand', async () => {
      const logEvent = makeLogEvent(
        'HTTP:POST [MED] DENIED curl(1234) -> POST https://api.github.com:443/repos/octocat/hello-world/issues [policy:default] [reason:method/path not in allow list]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      assert(events[0]);
      const chunk = events[0].chunks[0];
      assert(chunk);
      expect(chunk.host).toBe('api.github.com');
      expect(chunk.port).toBe(443);
      expect(chunk.isL7).toBe(true);
      expect(chunk.method).toBe('POST');
      expect(chunk.status).toBe('pending');
    });

    test('does not emit duplicate L7 denial when same method already covered', async () => {
      const logEvent1 = makeLogEvent(
        'HTTP:POST [MED] DENIED curl(1234) -> POST https://api.github.com:443/repos/octocat/hello-world/issues [policy:default]',
      );
      const logEvent2 = makeLogEvent(
        'HTTP:POST [MED] DENIED curl(1234) -> POST https://api.github.com:443/repos/octocat/hello-world/pulls [policy:default]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent1, logEvent2]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      assert(events[0]?.chunks[0]);
      expect(events[0].chunks[0].method).toBe('POST');
    });

    test('refetches draft policy for transparent_tcp_policy_denied instead of showing raw chunk', async () => {
      const draftChunk = {
        id: 'draft-pyronaut',
        status: 'pending',
        ruleName: 'allow_pyronaut_io_443',
        proposedRule: {
          endpoints: [{ host: 'pyronaut.io', port: 443 }],
          binaries: [{ path: '/sandbox/.opencode/bin/opencode' }],
        },
        rationale: 'Allow opencode to connect to pyronaut.io:443 (HTTPS).',
        securityNotes: 'rule requires review; no additional risk detected',
        confidence: 0.65,
      };
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([]))
        .mockResolvedValueOnce(makeDraftPolicyResponse([draftChunk]));

      const logEvent = makeLogEvent(
        'NET:CONNECT [MED] DENIED opencode(1234) -> pyronaut.io:443 [policy:default] [reason:transparent_tcp_policy_denied]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(DRAFT_REFETCH_DEBOUNCE_MS);

      expect(events).toHaveLength(1);
      assert(events[0]?.chunks[0]);
      expect(events[0].chunks[0].host).toBe('pyronaut.io');
      expect(events[0].chunks[0].rationale).toBe('Allow opencode to connect to pyronaut.io:443 (HTTPS).');
    });

    test('schedules refetch for L4 denial from structured fields', async () => {
      const logEvent = makeLogEvent('some log message', {
        l4_decision: 'deny',
        dst_host: 'registry.npmjs.org',
        dst_port: '443',
        binary: '/usr/bin/curl',
        l4_deny_reason: 'host not in allow list',
      });
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([]))
        .mockResolvedValueOnce(makeDraftPolicyResponse([]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(DRAFT_REFETCH_DEBOUNCE_MS);

      expect(client.raw.getDraftPolicy).toHaveBeenCalledTimes(2);
    });

    test('emits L7 denial immediately from structured fields', async () => {
      const logEvent = makeLogEvent('some log message', {
        l7_decision: 'deny',
        dst_host: 'api.github.com',
        dst_port: '443',
        l7_action: 'POST',
        l7_target: '/repos/octocat/hello-world/issues',
        l7_deny_reason: 'method/path not in allow list',
      });
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      assert(events[0]);
      const chunk = events[0].chunks[0];
      assert(chunk);
      expect(chunk.host).toBe('api.github.com');
      expect(chunk.port).toBe(443);
      expect(chunk.isL7).toBe(true);
      expect(chunk.method).toBe('POST');
    });

    test('emits structured L7 denial even when method and path are absent', async () => {
      const logEvent = makeLogEvent('some log message', {
        l7_decision: 'deny',
        dst_host: 'api.github.com',
        dst_port: '443',
      });
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      const chunk = events[0]?.chunks[0];
      assert(chunk);
      expect(chunk.isL7).toBe(true);
      expect(chunk.method).toBeUndefined();
      expect(chunk.path).toBeUndefined();

      await vi.advanceTimersByTimeAsync(DRAFT_REFETCH_DEBOUNCE_MS);
      expect(client.raw.getDraftPolicy).toHaveBeenCalledTimes(1);
    });

    test('ignores transient policy-changed denials', async () => {
      const logEvent = makeLogEvent(
        'NET:CONNECT [MED] DENIED curl(1234) -> api.anthropic.com:443 [reason:L7 tunnel closed before inspection because policy changed while CONNECT was dialing upstream [captured_generation:2 current_generation:3]]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);
    });

    test('refetches draft policy for transparent_tcp_mapping_denied instead of showing raw IP', async () => {
      const draftChunk = {
        id: 'draft-1',
        status: 'pending',
        ruleName: 'allow-api-github-com-443',
        proposedRule: {
          endpoints: [{ host: 'api.github.com', port: 443 }],
          binaries: [],
        },
        rationale: 'L4 CONNECT denied',
        securityNotes: '',
        confidence: 0.9,
      };
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([]))
        .mockResolvedValueOnce(makeDraftPolicyResponse([draftChunk]));

      const logEvent = makeLogEvent(
        'NET:CONNECT [MED] DENIED curl(1234) -> 198.18.0.5:11434 [policy:default] [reason:transparent_tcp_mapping_denied]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(DRAFT_REFETCH_DEBOUNCE_MS);

      expect(events).toHaveLength(1);
      assert(events[0]?.chunks[0]);
      expect(events[0].chunks[0].host).toBe('api.github.com');
      expect(events[0].chunks[0].port).toBe(443);
    });

    test('ignores non-denial log lines', async () => {
      const logEvent = makeLogEvent('INFO some normal log message');
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);
    });

    test('emits GraphQL denial from L7_REQUEST format', async () => {
      const logEvent = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=mutation name=PullRequestCreate fields=createPullRequest [policy:default]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      assert(events[0]);
      const chunk = events[0].chunks[0];
      assert(chunk);
      expect(chunk.host).toBe('api.github.com');
      expect(chunk.port).toBe(443);
      expect(chunk.isL7).toBe(true);
      expect(chunk.protocol).toBe('graphql');
      expect(chunk.operationType).toBe('mutation');
      expect(chunk.operationName).toBe('PullRequestCreate');
      expect(chunk.graphqlFields).toEqual(['createPullRequest']);
    });

    test('does not duplicate GraphQL denial with same operation type', async () => {
      const logEvent1 = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=mutation name=PullRequestCreate fields=createPullRequest',
      );
      const logEvent2 = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=mutation name=AddReview fields=addPullRequestReview',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent1, logEvent2]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      // Both are mutation type on same host:port, first pending suppresses second
      expect(events).toHaveLength(1);
    });

    test('does not treat a REST denial as covering a GraphQL one on the same host and port', async () => {
      const restEvent = makeLogEvent(
        'HTTP:POST [MED] DENIED curl(1234) -> POST https://api.github.com:443/repos/octocat/hello-world/issues [policy:default]',
      );
      const graphqlEvent = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=mutation name=PullRequestCreate fields=createPullRequest',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([restEvent, graphqlEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(2);
      assert(events[0]?.chunks[0]);
      assert(events[1]?.chunks[0]);
      expect(events[0].chunks[0].method).toBe('POST');
      expect(events[0].chunks[0].protocol).toBe('rest');
      expect(events[1].chunks[0].protocol).toBe('graphql');
      expect(events[1].chunks[0].operationType).toBe('mutation');
    });

    test('does not treat a GraphQL denial as covering a REST one on the same host and port', async () => {
      const graphqlEvent = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=mutation name=PullRequestCreate fields=createPullRequest',
      );
      const restEvent = makeLogEvent(
        'HTTP:POST [MED] DENIED curl(1234) -> POST https://api.github.com:443/repos/octocat/hello-world/issues [policy:default]',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([graphqlEvent, restEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(2);
      assert(events[0]?.chunks[0]);
      assert(events[1]?.chunks[0]);
      expect(events[0].chunks[0].protocol).toBe('graphql');
      expect(events[1].chunks[0].protocol).toBe('rest');
      expect(events[1].chunks[0].method).toBe('POST');
    });

    test('emits different GraphQL operation types separately', async () => {
      const logEvent1 = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=mutation name=CreatePR fields=createPullRequest',
      );
      const logEvent2 = makeLogEvent(
        'L7_REQUEST deny POST api.github.com:443/graphql graphql_ops=type=query name=GetRepo fields=repository',
      );
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent1, logEvent2]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(2);
      assert(events[0]?.chunks[0]);
      assert(events[1]?.chunks[0]);
      expect(events[0].chunks[0].operationType).toBe('mutation');
      expect(events[1].chunks[0].operationType).toBe('query');
    });

    test('schedules refetch for L4 denial from NET:CONNECT with no arrow actor prefix', async () => {
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([]))
        .mockResolvedValueOnce(makeDraftPolicyResponse([]));
      const logEvent = makeLogEvent('NET:CONNECT [HIGH] DENIED registry.npmjs.org:443 [reason:blocked]');
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([logEvent]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(DRAFT_REFETCH_DEBOUNCE_MS);

      expect(client.raw.getDraftPolicy).toHaveBeenCalledTimes(2);
    });
  });

  describe('sandbox state change triggers draft refetch', () => {
    test('refetches draft policy on sandbox state event', async () => {
      const sandboxEvent = makeSandboxEvent();

      vi.mocked(client.raw.watchSandbox).mockReturnValue(
        (async function* (): AsyncGenerator<SandboxStreamEvent> {
          yield sandboxEvent;
          await new Promise(() => {});
        })(),
      );

      // First getDraftPolicy call (on initial connect) returns empty
      // Second call (after sandbox state change) returns a chunk
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([]))
        .mockResolvedValueOnce(
          makeDraftPolicyResponse([
            {
              id: 'chunk-new',
              status: 'pending',
              ruleName: 'allow-new',
              proposedRule: {
                endpoints: [{ host: 'pypi.org', port: 443 }],
                binaries: [],
              },
              rationale: 'L4 denied',
              securityNotes: '',
              confidence: 0.8,
            },
          ]),
        );

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(1);
      assert(events[0]?.chunks[0]);
      expect(events[0].chunks[0].host).toBe('pypi.org');
      expect(client.raw.getDraftPolicy).toHaveBeenCalledTimes(2);
    });
  });

  describe('policyChunkToFlowChunk mapping', () => {
    test('maps PolicyChunk fields correctly', async () => {
      const pendingChunk = {
        id: 'chunk-42',
        status: 'pending',
        ruleName: 'allow-api-github',
        proposedRule: {
          endpoints: [{ host: 'api.github.com', port: 443 }],
          binaries: [{ path: '/usr/bin/git' }, { path: '/usr/bin/curl' }],
        },
        rationale: 'L4 CONNECT denied',
        securityNotes: 'May expose credentials',
        confidence: 0.7,
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      assert(events[0]);
      const chunk = events[0].chunks[0];
      assert(chunk);
      expect(chunk.chunkId).toBe('chunk-42');
      expect(chunk.ruleName).toBe('allow-api-github');
      expect(chunk.status).toBe('pending');
      expect(chunk.host).toBe('api.github.com');
      expect(chunk.port).toBe(443);
      expect(chunk.binaries).toEqual(['/usr/bin/git', '/usr/bin/curl']);
      expect(chunk.rationale).toBe('L4 CONNECT denied');
      expect(chunk.hasSecurityNotes).toBe(true);
      expect(chunk.isL7).toBe(false);
    });
  });

  describe('external status updates', () => {
    interface ServerPolicyChunk {
      id: string;
      status: 'pending' | 'approved' | 'rejected';
      ruleName: string;
      proposedRule: {
        endpoints: Array<{ host: string; port: number }>;
        binaries: Array<{ path: string }>;
      };
      rationale: string;
      securityNotes: string;
      confidence: number;
    }

    function makeServerChunk(status: ServerPolicyChunk['status']): ServerPolicyChunk {
      return {
        id: 'chunk-1',
        status,
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
      };
    }

    test.each(['approved', 'rejected'] as const)('syncs externally %s chunk status on refetch', async status => {
      vi.mocked(client.raw.getDraftPolicy)
        .mockResolvedValueOnce(makeDraftPolicyResponse([makeServerChunk('pending')]))
        .mockResolvedValueOnce(makeDraftPolicyResponse([makeServerChunk(status)]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(setupStreamWithEvents([makeSandboxEvent()]));

      const events: DraftPolicyEvent[] = [];
      watcher.onDraftPolicyUpdate(e => events.push(e));

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      await vi.advanceTimersByTimeAsync(0);

      expect(events).toHaveLength(2);
      const updatedChunk = events[1]?.chunks[0];
      assert(updatedChunk);
      expect(updatedChunk.status).toBe(status);
      expect(watcher.getAllChunks('sandbox-1')[0]?.status).toBe(status);
    });
  });

  describe('dispose', () => {
    test('disposes active watches', async () => {
      const pendingChunk = {
        id: 'chunk-1',
        status: 'pending',
        ruleName: 'allow-example',
        proposedRule: {
          endpoints: [{ host: 'example.com', port: 443 }],
          binaries: [],
        },
        rationale: 'Denied',
        securityNotes: '',
        confidence: 0.9,
      };
      vi.mocked(client.raw.getDraftPolicy).mockResolvedValue(makeDraftPolicyResponse([pendingChunk]));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sandbox-1', 'my-sandbox');
      watcher.dispose();

      expect(watcher.getAllChunks('sandbox-1')).toHaveLength(0);
    });
  });

  describe('reconnect and error handling', () => {
    test('reconnects with exponential backoff on stream error', async () => {
      const streamError = new Error('transport closed');
      vi.mocked(client.raw.watchSandbox)
        .mockReturnValueOnce(failingStream(streamError))
        .mockReturnValueOnce(failingStream(streamError))
        .mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sb-1', 'my-sandbox', 'gw-1');

      // First error → reconnect after 1000ms (2^0 * 1000)
      await vi.advanceTimersByTimeAsync(0);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(2);

      // Second error → reconnect after 2000ms (2^1 * 1000)
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(3);
    });

    test('resets backoff counter after receiving a stream event', async () => {
      const streamError = new Error('transport closed');
      vi.mocked(client.raw.watchSandbox)
        .mockReturnValueOnce(
          (async function* (): AsyncGenerator<SandboxStreamEvent> {
            yield makeSandboxEvent();
            throw streamError;
          })(),
        )
        .mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sb-1', 'my-sandbox', 'gw-1');
      // Let the stream yield one event (resets counter) then throw
      await vi.advanceTimersByTimeAsync(0);

      // After reset, delay should be 1000ms (2^0), not 2000ms
      await vi.advanceTimersByTimeAsync(1000);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(2);
    });

    test('backs off after normal stream completion', async () => {
      vi.mocked(client.raw.watchSandbox)
        .mockReturnValueOnce(emptyStream())
        .mockReturnValueOnce(emptyStream())
        .mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sb-1', 'my-sandbox', 'gw-1');

      // First normal close → reconnect after 1000ms (2^0 * 1000)
      await vi.advanceTimersByTimeAsync(0);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(2);

      // Second normal close → reconnect after 2000ms (2^1 * 1000)
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(3);
    });

    test('does not reconnect after abort', async () => {
      vi.mocked(client.raw.watchSandbox).mockReturnValue(failingStream(new Error('transport closed')));

      const disposable = await watcher.watchSandbox('sb-1', 'my-sandbox', 'gw-1');
      await vi.advanceTimersByTimeAsync(0);
      disposable.dispose();

      await vi.advanceTimersByTimeAsync(5000);
      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(1);
    });

    test('continues watching after fetchExistingDrafts failure', async () => {
      vi.mocked(client.raw.getDraftPolicy).mockRejectedValueOnce(new Error('RPC unavailable'));
      vi.mocked(client.raw.watchSandbox).mockReturnValue(neverEndingStream());

      await watcher.watchSandbox('sb-1', 'my-sandbox', 'gw-1');
      await vi.advanceTimersByTimeAsync(0);

      expect(client.raw.watchSandbox).toHaveBeenCalledTimes(1);
    });
  });
});
