<script lang="ts">
import { StatusIcon } from '@podman-desktop/ui-svelte';

import type { RagEnvironment } from '/@api/rag/rag-environment';

interface Props {
  object: RagEnvironment;
}

const { object }: Props = $props();

const status = $derived(object.mcpServer ? 'RUNNING' : 'STOPPED');
</script>

<StatusIcon {status} />
