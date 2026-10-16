<script lang="ts">
import { faPlusCircle } from '@fortawesome/free-solid-svg-icons';

import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { handleNavigation } from '/@/navigation';
import type { MCPServerDetail } from '/@api/mcp/mcp-server-info';
import { NavigationPage } from '/@api/navigation-page';

export let object: MCPServerDetail;

function createRegistry(): void {
  const serverId = object.serverId;
  if (!serverId) {
    console.error('No id found for MCP registry server');
    return;
  }
  handleNavigation({ page: NavigationPage.MCP_INSTALL_FROM_REGISTRY, parameters: { serverId } });
}
</script>

<ListItemButtonIcon
  title="Install Remote server"
  icon={faPlusCircle}
  onClick={createRegistry}
/>
