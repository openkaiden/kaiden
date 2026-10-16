<script lang="ts">
import { faAddressBook } from '@fortawesome/free-solid-svg-icons';

import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

export let object: MCPRemoteServerInfo;
</script>


 <ListItemButtonIcon
    title="Browse tools from this MCP server"
    icon={faAddressBook}
    />

