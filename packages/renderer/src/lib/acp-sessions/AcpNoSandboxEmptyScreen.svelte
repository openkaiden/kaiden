<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { Button, EmptyScreen } from '@podman-desktop/ui-svelte';

import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}
</script>

<EmptyScreen
  icon={faRobot}
  title="No ready sandboxes"
  message="A ready sandbox is required to create an agent session. Create a workspace first.">
  <Button icon={faPlus} onclick={navigateToCreate}>
    Create Workspace
  </Button>
</EmptyScreen>
