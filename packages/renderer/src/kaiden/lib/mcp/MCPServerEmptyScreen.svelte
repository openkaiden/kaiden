<script lang="ts">
import { EmptyScreen } from '@podman-desktop/ui-svelte';

import McpIcon from '/@/lib/images/MCPIcon.svelte';
</script>

<EmptyScreen
  icon={McpIcon}
  title="No MCP servers available"
  message="Connect a MCP server browsing MCP registry or create a new one."
   />
