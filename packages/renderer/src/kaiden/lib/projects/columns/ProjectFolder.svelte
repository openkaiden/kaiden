<script lang="ts">
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

interface Props {
  object: WorkspaceProjectInfo;
}

let { object }: Props = $props();
</script>

<span
  class="text-(--pd-table-body-text) text-sm overflow-hidden text-ellipsis whitespace-nowrap"
  title={object.folder}>
  {object.folder}
</span>
