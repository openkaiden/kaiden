<script lang="ts">
import type { RagEnvironment } from '/@api/rag/rag-environment';

interface Props {
  object: RagEnvironment;
}

const { object }: Props = $props();

const sourcesCount = object.files.length;
</script>

<div class="flex items-center justify-center">
  <span
    class="inline-flex items-center justify-center min-w-6 h-5 px-1.5 bg-[var(--pd-label-bg)] text-[var(--pd-label-text)] rounded-full text-xs font-medium">
    {sourcesCount}
  </span>
</div>
