<script lang="ts">
import { Tab } from '@podman-desktop/ui-svelte';
import type { DynamicToolUIPart } from 'ai';
import { onMount } from 'svelte';
import { router } from 'tinro';

import { mcpRemoteServerInfos } from '/@/kaiden/stores/mcp-remote-servers';
import MonacoEditor from '/@/lib/editor/MonacoEditor.svelte';
import MCPIcon from '/@/lib/images/MCPIcon.svelte';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

import ToolParts from './tool-parts.svelte';

interface Props {
  id: string;
}
let { id }: Props = $props();

let messages: Array<DynamicToolUIPart> = $state([]);

async function refreshMessages(): Promise<void> {
  try {
    messages = await window.getMcpExchanges(id);
  } catch (e) {
    console.error('Failed to fetch MCP exchanges', e);
  }
}

const mcpServer: MCPRemoteServerInfo | undefined = $derived($mcpRemoteServerInfos.find(server => server.id === id));
const mcpServerName = $derived(mcpServer?.name ?? id);
const mcpServerUrl = $derived(mcpServer?.url ?? '');
const isRunning = $derived(mcpServer !== undefined && mcpServer.status !== 'registered');
const toolSet: string | undefined = $derived(mcpServer?.tools ? JSON.stringify(mcpServer.tools, null, 2) : undefined);

onMount(() => {
  if (isRunning) {
    refreshMessages().catch(console.error);
  }

  return window.events?.receive('mcp-manager-update', () => {
    if (isRunning) {
      refreshMessages().catch(console.error);
    }
  });
});
</script>

<DetailsPage title={mcpServerName} subtitle={id}>
  {#snippet iconSnippet()}
    <MCPIcon size={24} />
  {/snippet}
  {#snippet tabsSnippet()}
    <Tab title="Summary" selected={isTabSelected($router.path, 'summary')} url={getTabUrl($router.path, 'summary')} />
    <Tab title="Tools" selected={isTabSelected($router.path, 'tools')} url={getTabUrl($router.path, 'tools')} />
    <Tab title="Messages" selected={isTabSelected($router.path, 'messages')} url={getTabUrl($router.path, 'messages')} />
  {/snippet}
  {#snippet contentSnippet()}
    <Route path="/summary" breadcrumb="Summary" navigationHint="tab">
      <div class="flex flex-col p-5 gap-2">
        <span>url: {mcpServerUrl}</span>
        <span>id: {id}</span>
      </div>
    </Route>
    <Route path="/tools" breadcrumb="Tools" navigationHint="tab">
      {#if toolSet}
        <MonacoEditor readOnly content={toolSet} language="json"/>
      {/if}
    </Route>
    <Route path="/messages" breadcrumb="Messages" navigationHint="tab">
      {#if messages.length > 0}
        <div class="overflow-y-auto h-full">
        <ToolParts tools={messages} />
        </div>
      {:else}
        <div class="text-sm text-(--pd-content-card-text) opacity-70">No messages recorded yet.</div>
      {/if}
    </Route>
  {/snippet}
</DetailsPage>
