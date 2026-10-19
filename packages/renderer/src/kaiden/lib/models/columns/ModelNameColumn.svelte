<script lang="ts">
import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';

interface Props {
  object: CatalogModelInfo;
}

let { object }: Props = $props();
</script>

<div class="flex flex-col whitespace-nowrap max-w-full">
  <span
    class="text-[var(--pd-table-body-text-highlight)] overflow-hidden text-ellipsis"
    title={object.label}>
    {object.label}
  </span>
</div>
