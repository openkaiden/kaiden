<script lang="ts">
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { getChunkProviderName } from '/@/kaiden/lib/rag/rag-environment-utils';
import { providerInfos } from '/@/stores/providers';
import type { RagEnvironment } from '/@api/rag/rag-environment';

interface Props {
  object: RagEnvironment;
}

const { object }: Props = $props();

const chunkerName = $derived(getChunkProviderName($providerInfos, object));
</script>

<div class="flex items-center">
  <span
    class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium bg-[var(--pd-label-bg)] text-[var(--pd-label-text)]">
    <Icon icon="fas fa-puzzle-piece" />
    <span>{chunkerName}</span>
  </span>
</div>
