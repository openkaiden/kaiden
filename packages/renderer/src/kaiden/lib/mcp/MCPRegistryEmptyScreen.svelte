<script lang="ts">
import { EmptyScreen } from '@podman-desktop/ui-svelte';

import McpIcon from '/@/lib/images/MCPIcon.svelte';
</script>

<EmptyScreen
  icon={McpIcon}
  title="No MCP servers found in MCP registries"
  message="Install a MCP registry to browse MCP servers."
   />
