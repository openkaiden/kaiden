<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, FilteredEmptyScreen, NavPage, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';

import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import { workspaceProjectInfos } from '/@/stores/workspace-projects';
import { NavigationPage } from '/@api/navigation-page';
import type { WorkspaceProjectInfo } from '/@api/workspace-project-info';

import ProjectActions from './columns/ProjectActions.svelte';
import ProjectFolder from './columns/ProjectFolder.svelte';
import ProjectName from './columns/ProjectName.svelte';
import ProjectResources from './columns/ProjectResources.svelte';
import ProjectEmptyScreen from './ProjectEmptyScreen.svelte';

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.PROJECT_CREATE });
}

type ProjectSelectable = WorkspaceProjectInfo & { selected: boolean };

let searchTerm = $state('');

const filteredProjects: ProjectSelectable[] = $derived.by(() => {
  const term = searchTerm.trim().toLowerCase();
  return $workspaceProjectInfos
    .filter(p => !term || p.name.toLowerCase().includes(term) || p.folder.toLowerCase().includes(term))
    .map(p => ({ ...p, selected: false }));
});

const row = new TableRow<ProjectSelectable>({});

const nameColumn = new TableColumn<ProjectSelectable>('Name', {
  width: '2fr',
  renderer: ProjectName,
  comparator: (a, b): number => a.name.localeCompare(b.name),
});

const folderColumn = new TableColumn<ProjectSelectable>('Folder', {
  width: '2fr',
  renderer: ProjectFolder,
  comparator: (a, b): number => a.folder.localeCompare(b.folder),
});

const resourcesColumn = new TableColumn<ProjectSelectable>('Resources', {
  width: '2fr',
  renderer: ProjectResources,
});

const actionsColumn = new TableColumn<ProjectSelectable>('', {
  align: 'right',
  width: '80px',
  renderer: ProjectActions,
  overflow: true,
});

const columns = [nameColumn, folderColumn, resourcesColumn, actionsColumn];
</script>

<NavPage bind:searchTerm={searchTerm} title="Projects">
  {#snippet additionalActions()}
    <Button icon={faPlus} onclick={navigateToCreate}>New Project</Button>
  {/snippet}

  {#snippet content()}
    <div class="flex min-w-full h-full">
      {#if filteredProjects.length === 0}
        {#if searchTerm}
          <FilteredEmptyScreen icon={NoLogIcon} kind="projects" bind:searchTerm={searchTerm} />
        {:else}
          <ProjectEmptyScreen />
        {/if}
      {:else}
        <Table
          kind="projects"
          data={filteredProjects}
          columns={columns}
          row={row}
          defaultSortColumn="Name"
        />
      {/if}
    </div>
  {/snippet}
</NavPage>
