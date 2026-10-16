<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { Button, FilteredEmptyScreen, NavPage, Table, TableColumn, TableRow } from '@podman-desktop/ui-svelte';

import SkillEnabledColumn from '/@/kaiden/lib/skills/columns/SkillEnabledColumn.svelte';
import SkillNameColumn from '/@/kaiden/lib/skills/columns/SkillNameColumn.svelte';
import { filteredSkillInfos, skillSearchPattern } from '/@/kaiden/stores/skills';
import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SkillInfo } from '/@api/skill/skill-info';

import { SkillDescriptionColumn } from './columns/skill-columns';
import SkillActions from './SkillActions.svelte';
import SkillEmptyScreen from './SkillEmptyScreen.svelte';

type SkillSelectable = SkillInfo & { selected: boolean };

let searchTerm = $state('');

$effect(() => {
  skillSearchPattern.set(searchTerm);
});

const row = new TableRow<SkillSelectable>({});

const nameColumn = new TableColumn<SkillSelectable>('Name', {
  width: '2fr',
  renderer: SkillNameColumn,
  comparator: (a, b): number => a.name.localeCompare(b.name),
});

const enabledColumn = new TableColumn<SkillSelectable>('Enabled', {
  width: '80px',
  align: 'center',
  renderer: SkillEnabledColumn,
  comparator: (a, b): number => Number(b.enabled) - Number(a.enabled),
});

const actionsColumn = new TableColumn<SkillSelectable>('Actions', {
  align: 'right',
  renderer: SkillActions,
  overflow: true,
});

const columns = [nameColumn, new SkillDescriptionColumn(), enabledColumn, actionsColumn];

const skills: SkillSelectable[] = $derived($filteredSkillInfos.map(skill => ({ ...skill, selected: false })));

function openCreatePage(): void {
  handleNavigation({ page: NavigationPage.SKILL_CREATE });
}
</script>

<NavPage bind:searchTerm={searchTerm} title="Skills">
  {#snippet additionalActions()}
    <Button icon={faPlus} onclick={openCreatePage}>
      New skill
    </Button>
  {/snippet}

  {#snippet content()}
    <div class="flex min-w-full h-full">
      {#if skills.length === 0}
        {#if searchTerm}
          <FilteredEmptyScreen icon={NoLogIcon} kind="skills" bind:searchTerm={searchTerm} />
        {:else}
          <SkillEmptyScreen onclick={openCreatePage} />
        {/if}
      {:else}
        <Table
          kind="skills"
          data={skills}
          columns={columns}
          row={row}
          defaultSortColumn="Name"
        />
      {/if}
    </div>
  {/snippet}
</NavPage>
