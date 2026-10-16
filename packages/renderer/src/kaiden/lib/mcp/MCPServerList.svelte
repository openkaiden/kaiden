<script lang="ts">
import { Button, NavPage } from '@podman-desktop/ui-svelte';

import { mcpRemoteServerInfos } from '/@/kaiden/stores/mcp-remote-servers';

import McpRegistriesEditing from './MCPRegistriesEditing.svelte';
import McpServerListRegistryInstall from './MCPServerListRegistryInstall.svelte';
import McpServerListRemoteReady from './MCPServerListRemoteReady.svelte';

interface Props {
  tab?: string;
}

const { tab }: Props = $props();

let selectedTab = $state<'READY' | 'INSTALLABLE' | 'REGISTRIES-EDITING'>(
  (tab ?? $mcpRemoteServerInfos.length) ? 'READY' : 'INSTALLABLE',
);

let searchTerm = $state('');
</script>

<NavPage bind:searchTerm={searchTerm} title="MCP servers">
    {#snippet tabs()}
    <Button type="tab" on:click={(): string => selectedTab = 'READY'} selected={selectedTab === 'READY'}
      >Ready</Button>
    <Button type="tab" on:click={():string => selectedTab = 'INSTALLABLE'} selected={selectedTab === 'INSTALLABLE'}
      >Install</Button>
    <Button type="tab" on:click={():string => selectedTab = 'REGISTRIES-EDITING'} selected={selectedTab === 'REGISTRIES-EDITING'}
      >Edit registries</Button>
  {/snippet}

  {#snippet content()}
  <div class="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      {#if selectedTab === 'READY'}
        <McpServerListRemoteReady bind:filter={searchTerm}/>
      {:else if selectedTab === 'INSTALLABLE'}
        <McpServerListRegistryInstall bind:filter={searchTerm}/>
      {:else if selectedTab === 'REGISTRIES-EDITING'}
        <McpRegistriesEditing />
        {/if}
    </div>

  {/snippet}
</NavPage>
