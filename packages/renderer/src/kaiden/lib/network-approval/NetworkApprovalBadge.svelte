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
import { faShieldAlt } from '@fortawesome/free-solid-svg-icons';
import { Tooltip } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

interface Props {
  pendingCount: number;
  totalCount: number;
  onclick: () => void;
}

let { pendingCount, totalCount, onclick }: Props = $props();
</script>

{#if pendingCount > 0}
  <button
    class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium cursor-pointer transition-colors bg-[color-mix(in_srgb,var(--pd-status-dead)_15%,transparent)] text-(--pd-status-dead) hover:bg-[color-mix(in_srgb,var(--pd-status-dead)_25%,transparent)]"
    {onclick}
    title="Review blocked network requests"
  >
    <Icon icon={faShieldAlt} class="text-[10px]" />
    <span class="w-1.5 h-1.5 rounded-full bg-(--pd-status-dead) animate-pulse motion-reduce:animate-none"></span>
    {pendingCount}
  </button>
{:else if totalCount > 0}
  <Tooltip bottom tip="View network rules">
    <button
      class="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium cursor-pointer transition-colors text-[color-mix(in_srgb,var(--pd-content-text)_50%,transparent)] hover:text-(--pd-content-text) hover:bg-(--pd-content-card-hover-bg)"
      {onclick}
      title="View network rules"
    >
      <Icon icon={faShieldAlt} class="text-[10px]" />
    </button>
  </Tooltip>
{/if}
