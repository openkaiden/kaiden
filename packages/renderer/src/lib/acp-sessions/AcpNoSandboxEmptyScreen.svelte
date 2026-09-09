<script lang="ts">
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { EmptyScreen } from '@podman-desktop/ui-svelte';

import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}
</script>

<EmptyScreen
  icon={faRobot}
  title="No ready sandboxes"
  message="A ready sandbox is required to create an agent session. Create a workspace first."
  commandline="Create Workspace"
  onclick={navigateToCreate}
/>
