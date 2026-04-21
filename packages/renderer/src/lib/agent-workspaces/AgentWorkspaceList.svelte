<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, NavPage } from '@podman-desktop/ui-svelte';

import { handleNavigation } from '/@/navigation';
import { agentWorkspaces } from '/@/stores/agent-workspaces.svelte';
import { NavigationPage } from '/@api/navigation-page';

import AgentWorkspaceCard from './AgentWorkspaceCard.svelte';
import AgentWorkspaceEmptyScreen from './AgentWorkspaceEmptyScreen.svelte';

function navigateToCreate(): void {
  handleNavigation({ page: NavigationPage.AGENT_WORKSPACE_CREATE });
}
</script>

<NavPage searchEnabled={false} title="Agent Workspaces">
  {#snippet additionalActions()}
  <Button icon={faPlus} onclick={navigateToCreate}>Create Workspace</Button>
  {/snippet}

  {#snippet content()}
    <div class="flex w-full h-full overflow-auto">
      {#if $agentWorkspaces.length === 0}
        <AgentWorkspaceEmptyScreen />
      {:else}
        <div class="flex flex-col gap-4 p-5 w-full h-fit">
          <span class="text-sm text-(--pd-content-text) opacity-70">{$agentWorkspaces.length} total {$agentWorkspaces.length === 1 ? 'workspace' : 'workspaces'}</span>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 w-full">
            {#each $agentWorkspaces as workspace (workspace.id)}
              <AgentWorkspaceCard {workspace} />
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/snippet}
</NavPage>
