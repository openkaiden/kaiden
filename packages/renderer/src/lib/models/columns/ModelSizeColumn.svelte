<script lang="ts">
import type { CatalogModelInfo } from '/@/lib/models/models-utils';

interface Props {
  object: CatalogModelInfo;
}

// TODO: display object.size once the backend wires up the size field
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let { object }: Props = $props();
</script>

<span class="text-[var(--pd-table-body-text)]">—</span>
