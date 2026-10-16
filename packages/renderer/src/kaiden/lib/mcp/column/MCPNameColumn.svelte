<script lang="ts">
import { handleNavigation } from '/@/navigation';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import { NavigationPage } from '/@api/navigation-page';

interface Props {
  object: MCPRemoteServerInfo;
}

let { object }: Props = $props();

function openMCPDetails(object: MCPRemoteServerInfo): void {
  handleNavigation({
    page: NavigationPage.MCP_DETAILS,
    parameters: {
      id: object.id,
    },
  });
}
</script>

<button class="flex flex-col whitespace-nowrap max-w-full" onclick={openMCPDetails.bind(undefined, object)}>
  <div class="flex items-center max-w-full">
    <div class="max-w-full">
      <div class="flex flex-nowrap max-w-full">
        <div
          class="text-[var(--pd-table-body-text-highlight)] overflow-hidden text-ellipsis group-hover:text-[var(--pd-link)]"
          title={object.name}>
          {object.name}
        </div>
      </div>
    </div>
  </div>
</button>
