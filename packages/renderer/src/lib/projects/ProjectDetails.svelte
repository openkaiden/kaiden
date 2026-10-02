<script lang="ts">
import { faRocket, faTrash } from '@fortawesome/free-solid-svg-icons';
import { EmptyScreen } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import Route from '/@/Route.svelte';
import { initializeDraftFromProject } from '/@/stores/agent-workspace-create-draft.svelte';
import { workspaceProjectInfos } from '/@/stores/workspace-projects';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import ProjectDetailsOverview from './ProjectDetailsOverview.svelte';

interface Props {
  projectId: string;
}

let { projectId }: Props = $props();

const project = $derived($workspaceProjectInfos.find(p => p.id === projectId));

let detailsPage = $state<DetailsPage | undefined>();

$effect(() => {
  if (!project) {
    detailsPage?.close();
  }
});

function handleCreateWorkspace(current: WorkspaceProjectInfo): void {
  initializeDraftFromProject(current);
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}

function handleRemove(): void {
  withConfirmation(
    async () => {
      try {
        await window.removeWorkspaceProject(projectId);
        router.goto('/projects');
      } catch (error: unknown) {
        console.error('Failed to remove project', error);
      }
    },
    `remove project ${project?.name ?? projectId}`,
  );
}
</script>

<DetailsPage title={project?.name ?? ''} bind:this={detailsPage}>
  {#snippet actionsSnippet()}
    {#if project}
      {@const current = project}
      <ListItemButtonIcon title="Create workspace" icon={faRocket} onClick={(): void => handleCreateWorkspace(current)} />
    {/if}
    <ListItemButtonIcon
      title="Remove Project"
      onClick={handleRemove}
      icon={faTrash} />
  {/snippet}
  {#snippet contentSnippet()}
    {#if project}
      <Route path="/overview" breadcrumb="Overview" navigationHint="tab">
        <ProjectDetailsOverview {project} />
      </Route>
    {:else}
      <EmptyScreen title="Project not found" message="This project could not be found" icon={NoLogIcon} />
    {/if}
  {/snippet}
</DetailsPage>
