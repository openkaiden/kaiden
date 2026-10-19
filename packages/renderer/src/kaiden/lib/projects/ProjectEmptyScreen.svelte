<script lang="ts">
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons/faFolderOpen';
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { Button, EmptyScreen } from '@podman-desktop/ui-svelte';

import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.PROJECT_CREATE });
}
</script>

<EmptyScreen title="No projects" icon={faFolderOpen}>
  <span class="text-(--pd-content-text)">
    Projects will appear here once created.
  </span>
  <div class="mt-4">
    <Button icon={faPlus} onclick={navigateToCreate}>New Project</Button>
  </div>
</EmptyScreen>
