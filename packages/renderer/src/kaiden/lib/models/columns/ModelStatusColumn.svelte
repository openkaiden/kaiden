<script lang="ts">
import { StatusIcon } from '@podman-desktop/ui-svelte';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import { disabledModels, isModelEnabled } from '/@/kaiden/stores/model-catalog';

interface Props {
  object: CatalogModelInfo;
}

let { object }: Props = $props();

let enabled: boolean = $derived(isModelEnabled($disabledModels, object.providerId, object.label));

const statusMap: Record<string, string> = {
  started: 'RUNNING',
  starting: 'STARTING',
  stopped: 'CREATED',
  stopping: 'DELETING',
  failed: 'DEGRADED',
  unknown: 'RUNNING',
};

let iconStatus: string = $derived(enabled ? (statusMap[object.connectionStatus] ?? 'RUNNING') : 'DISABLED');
</script>

<StatusIcon status={iconStatus} />
