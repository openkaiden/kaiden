<!--
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
 ***********************************************************************
-->
<script lang="ts">
import {
  faBan,
  faCheck,
  faChevronDown,
  faChevronRight,
  faExclamationTriangle,
  faShieldAlt,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { DraftPolicyChunk } from '/@api/draft-policy-info';

import NetworkApprovalChunkDetails from './NetworkApprovalChunkDetails.svelte';

interface Props {
  chunks: DraftPolicyChunk[];
  onApprove: (chunkId: string) => Promise<void>;
  onReject: (chunkId: string) => Promise<void>;
  onClose: () => void;
}

let { chunks, onApprove, onReject, onClose }: Props = $props();

let responding = $state<string | undefined>();
let errorByChunk = $state<Record<string, string>>({});
let showResolved = $state(false);

const pendingChunks = $derived(chunks.filter(c => c.status === 'pending'));
const resolvedChunks = $derived(chunks.filter(c => c.status !== 'pending'));

async function approveChunk(chunkId: string): Promise<void> {
  await handleChunkAction(chunkId, onApprove);
}

async function rejectChunk(chunkId: string): Promise<void> {
  await handleChunkAction(chunkId, onReject);
}

function toggleResolved(): void {
  showResolved = !showResolved;
}

async function handleChunkAction(chunkId: string, action: (id: string) => Promise<void>): Promise<void> {
  if (responding) return;
  responding = chunkId;
  errorByChunk[chunkId] = '';
  try {
    await action(chunkId);
  } catch (err: unknown) {
    errorByChunk[chunkId] = err instanceof Error ? err.message : String(err);
  } finally {
    responding = undefined;
  }
}
</script>

<div class="w-80 shrink-0 flex flex-col border-l border-(--pd-content-divider) bg-(--pd-content-card-bg) h-full">
  <!-- Panel header -->
  <div class="flex items-center justify-between px-3 py-2 border-b border-(--pd-content-divider)">
    <div class="flex items-center gap-2">
      <Icon icon={faShieldAlt} class="text-(--pd-status-dead) text-xs" />
      <span class="text-xs font-semibold uppercase tracking-wider text-(--pd-content-header-text)">
        Network Rules
      </span>
      {#if pendingChunks.length > 0}
        <span class="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-(--pd-status-dead) text-(--pd-content-card-bg) leading-none">
          {pendingChunks.length}
        </span>
      {/if}
    </div>
    <button
      class="flex items-center justify-center w-5 h-5 rounded text-(--pd-content-text) opacity-50 hover:opacity-100 hover:bg-(--pd-content-card-hover-bg) cursor-pointer transition-opacity"
      onclick={onClose}
      title="Close panel"
    >
      <Icon icon={faXmark} class="text-xs" />
    </button>
  </div>

  <!-- Panel body -->
  <div class="flex-1 overflow-auto p-3">
    {#if pendingChunks.length === 0 && resolvedChunks.length === 0}
      <div class="text-xs text-(--pd-content-text) opacity-50 text-center py-4">
        No network rules yet.
      </div>
    {/if}

    <!-- Pending chunks -->
    {#each pendingChunks as chunk (chunk.chunkId)}
      <div class="mb-3 rounded-lg border border-[color-mix(in_srgb,var(--pd-status-dead)_25%,transparent)] bg-[color-mix(in_srgb,var(--pd-status-dead)_4%,transparent)] overflow-hidden">
        <div class="px-3 py-2">
          <div class="flex items-center gap-1.5 mb-0.5">
            <span class="w-1.5 h-1.5 rounded-full bg-(--pd-status-dead) shrink-0"></span>
            <span class="text-xs font-semibold text-(--pd-status-dead) break-words">{chunk.host}:{chunk.port}</span>
          </div>
          <div class="text-[10px] text-(--pd-content-text) opacity-40 mb-1.5 pl-3 font-mono truncate" title={chunk.ruleName}>
            {chunk.ruleName}
          </div>

          <NetworkApprovalChunkDetails {chunk} showPolicy />

          {#if chunk.securityNotes}
            <div class="flex items-start gap-1 text-[10px] text-(--pd-status-waiting) mb-2">
              <Icon icon={faExclamationTriangle} class="text-[10px] mt-0.5 shrink-0" />
              <span>{chunk.securityNotes}</span>
            </div>
          {:else if chunk.hasSecurityNotes}
            <div class="flex items-center gap-1 text-[10px] text-(--pd-status-waiting) mb-2">
              <Icon icon={faExclamationTriangle} class="text-[10px]" />
              <span>Security considerations — review carefully.</span>
            </div>
          {/if}

          {#if chunk.isL7}
            <div class="flex items-center justify-between gap-1.5">
              <span class="text-[10px] text-(--pd-content-text) opacity-50 italic">
                L7 rules are informational — approval is not supported yet.
              </span>
              <Button
                type="secondary"
                padding="px-2 py-0.5"
                onclick={rejectChunk.bind(undefined, chunk.chunkId)}
                disabled={!!responding}
              >
                Dismiss
              </Button>
            </div>
          {:else}
            <div class="flex items-center gap-1.5">
              <Button
                type="primary"
                padding="px-2 py-0.5"
                onclick={approveChunk.bind(undefined, chunk.chunkId)}
                disabled={!!responding || !!chunk.applicationError}
              >
                Allow
              </Button>
              <Button
                type="secondary"
                padding="px-2 py-0.5"
                onclick={rejectChunk.bind(undefined, chunk.chunkId)}
                disabled={!!responding}
              >
                Reject
              </Button>
            </div>
          {/if}

          {#if errorByChunk[chunk.chunkId]}
            <div class="flex items-start gap-1 mt-1.5 text-[10px] text-(--pd-status-dead)">
              <Icon icon={faExclamationTriangle} class="text-[10px] mt-0.5 shrink-0" />
              <span>{errorByChunk[chunk.chunkId]}</span>
            </div>
          {/if}
        </div>
      </div>
    {/each}

    <!-- Resolved chunks -->
    {#if resolvedChunks.length > 0}
      <button
        class="flex items-center gap-1.5 text-[11px] text-(--pd-content-text) opacity-50 hover:opacity-80 cursor-pointer mb-2 mt-1"
        onclick={toggleResolved}
      >
        <Icon icon={showResolved ? faChevronDown : faChevronRight} class="text-[9px]" />
        {resolvedChunks.length} resolved
      </button>
      {#if showResolved}
        {#each resolvedChunks as chunk (chunk.chunkId)}
          <div class="mb-2 rounded-lg border border-(--pd-content-divider) bg-(--pd-content-card-bg) px-3 py-2">
            <div class="flex items-center gap-1.5 mb-0.5">
              {#if chunk.status === 'approved'}
                <Icon icon={faCheck} class="text-(--pd-status-running) text-[10px]" />
                <span class="text-xs font-semibold text-(--pd-status-running)">Allowed</span>
              {:else}
                <Icon icon={faBan} class="text-(--pd-status-dead) text-[10px]" />
                <span class="text-xs font-semibold text-(--pd-status-dead)">Rejected</span>
              {/if}
              <span class="text-[11px] text-(--pd-content-text)">{chunk.host}:{chunk.port}</span>
            </div>
            <div class="text-[10px] text-(--pd-content-text) opacity-40 mb-1 pl-5 font-mono truncate" title={chunk.ruleName}>
              {chunk.ruleName}
            </div>

            <NetworkApprovalChunkDetails {chunk} />

            {#if !chunk.isL7}
              <div class="flex items-center gap-1.5 mt-1.5">
                {#if chunk.status === 'rejected'}
                  <Button
                    type="primary"
                    padding="px-2 py-0.5"
                    title="Allow access to {chunk.host}:{chunk.port}"
                    onclick={approveChunk.bind(undefined, chunk.chunkId)}
                    disabled={!!responding || !!chunk.applicationError}
                  >
                    Allow
                  </Button>
                {:else}
                  <Button
                    type="secondary"
                    padding="px-2 py-0.5"
                    title="Revoke access to {chunk.host}:{chunk.port}"
                    onclick={rejectChunk.bind(undefined, chunk.chunkId)}
                    disabled={!!responding}
                  >
                    Reject
                  </Button>
                {/if}
              </div>
            {/if}

            {#if errorByChunk[chunk.chunkId]}
              <div class="flex items-start gap-1 mt-1.5 text-[10px] text-(--pd-status-dead)">
                <Icon icon={faExclamationTriangle} class="text-[10px] mt-0.5 shrink-0" />
                <span>{errorByChunk[chunk.chunkId]}</span>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}
  </div>
</div>
