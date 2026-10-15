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
 ***********************************************************************/
-->
<script lang="ts">
import { faStop } from '@fortawesome/free-solid-svg-icons';

import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { GatewayInfo } from '/@api/openshell-gateway-info';

import type { GatewayStopAction } from './gateway-stop-action.svelte';

interface Props {
  gateway: GatewayInfo;
  stopAction: GatewayStopAction;
}

let { gateway, stopAction }: Props = $props();
</script>

{#if gateway.canStop}
  <div class="ml-auto shrink-0">
    <ListItemButtonIcon
      title="Stop gateway {gateway.name}"
      icon={faStop}
      enabled={!stopAction.stoppingGateways.includes(gateway.name)}
      inProgress={stopAction.stoppingGateways.includes(gateway.name)}
      onClick={(): Promise<void> => stopAction.stop(gateway.name)} />
  </div>
{/if}
