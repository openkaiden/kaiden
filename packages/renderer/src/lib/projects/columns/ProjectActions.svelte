<script lang="ts">
import { faRocket, faTrash } from '@fortawesome/free-solid-svg-icons';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { handleNavigation } from '/@/navigation';
import { initializeDraftFromProject } from '/@/stores/agent-workspace-create-draft.svelte';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

interface Props {
  object: WorkspaceProjectInfo;
}

let { object }: Props = $props();

function handleCreateWorkspace(): void {
  initializeDraftFromProject(object);
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}

function handleRemove(): void {
  withConfirmation(
    () => window.removeWorkspaceProject(object.id).catch(console.error),
    `remove project ${object.name}`,
  );
}
</script>

<div class="flex items-center gap-1">
  <ListItemButtonIcon title="Create workspace" icon={faRocket} onClick={handleCreateWorkspace} />
  <ListItemButtonIcon title="Remove project" icon={faTrash} onClick={handleRemove} />
</div>
