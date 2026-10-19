<script lang="ts">
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

interface Props {
  object: WorkspaceProjectInfo;
}

let { object }: Props = $props();

function openDetails(): void {
  handleNavigation({ page: NavigationPage.PROJECT_DETAILS, parameters: { id: object.id } });
}
</script>

<div class="flex items-center overflow-hidden max-w-full">
  <button class="flex items-start" onclick={openDetails}>
    <span
      class="text-(--pd-table-body-text-highlight) text-[14px] font-semibold leading-normal overflow-hidden text-ellipsis whitespace-nowrap"
      title={object.name}>
      {object.name}
    </span>
  </button>
</div>
