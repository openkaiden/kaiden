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
import { faTrash } from '@fortawesome/free-solid-svg-icons';

import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { GatewayInfo } from '/@api/openshell-gateway-info';

import type { GatewayDeleteAction } from './gateway-delete-action.svelte';

interface Props {
  gateway: GatewayInfo;
  deleteAction: GatewayDeleteAction;
}

let { gateway, deleteAction }: Props = $props();

const deleting = $derived(deleteAction.deletingGateways.includes(gateway.name));
</script>

{#if deleteAction.canDelete(gateway)}
  <div class="shrink-0">
    <ListItemButtonIcon
      title="Delete gateway {gateway.name}"
      icon={faTrash}
      inProgress={deleting}
      onClick={(): Promise<void> => deleteAction.delete(gateway.name)} />
  </div>
{/if}
