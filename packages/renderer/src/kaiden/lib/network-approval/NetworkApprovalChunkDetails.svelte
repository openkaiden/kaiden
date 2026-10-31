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
import { faExclamationTriangle } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { DraftPolicyChunk } from '/@api/draft-policy-info';

import { formatPolicyConfidence, formatPolicyRequest } from './network-approval-utils';

interface Props {
  chunk: DraftPolicyChunk;
  showPolicy?: boolean;
}

let { chunk, showPolicy = false }: Props = $props();
</script>

<div class="flex flex-col gap-1.5 mb-2 text-[11px]">
  <div class="flex gap-1.5">
    <span class="text-(--pd-content-text) opacity-50 shrink-0">Request</span>
    <code class="text-(--pd-content-text) break-words bg-(--pd-content-card-hover-bg) px-1 py-0.5 rounded text-[10px]">
      {formatPolicyRequest(chunk)}
    </code>
  </div>
  {#if chunk.binaries.length > 0}
    <div class="flex gap-1.5">
      <span class="text-(--pd-content-text) opacity-50 shrink-0">Binary</span>
      <span class="text-(--pd-content-text) break-words font-mono text-[10px]">{chunk.binaries.join(', ')}</span>
    </div>
  {/if}
  {#if chunk.confidence !== undefined}
    <div class="flex gap-1.5">
      <span class="text-(--pd-content-text) opacity-50 shrink-0">Confidence</span>
      <span class="text-(--pd-content-text)">{formatPolicyConfidence(chunk.confidence)}</span>
    </div>
  {/if}
  {#if chunk.rationale}
    <div class="flex gap-1.5">
      <span class="text-(--pd-content-text) opacity-50 shrink-0">Rationale</span>
      <span class="text-(--pd-content-text) break-words">{chunk.rationale}</span>
    </div>
  {/if}
  {#if showPolicy}
    <div class="flex gap-1.5 items-center">
      <span class="text-(--pd-content-text) opacity-50 shrink-0">Policy</span>
      <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-[color-mix(in_srgb,var(--pd-status-dead)_15%,transparent)] text-(--pd-status-dead)">Deny</span>
      <span class="text-(--pd-content-text) opacity-70">
        {#if chunk.protocol === 'graphql'}
          — operation not in allow list
        {:else if chunk.isL7}
          — method/path not in allow list
        {:else}
          — host not in allowed list
        {/if}
      </span>
    </div>
  {/if}
  {#if chunk.applicationError}
    <div class="flex items-start gap-1 text-[10px] text-(--pd-status-dead)">
      <Icon icon={faExclamationTriangle} class="text-[10px] mt-0.5 shrink-0" />
      <span class="break-words">{chunk.applicationError}</span>
    </div>
  {/if}
</div>
