<script lang="ts">
import DetailsCell from '/@/lib/details/DetailsCell.svelte';
import DetailsTable from '/@/lib/details/DetailsTable.svelte';
import DetailsTitle from '/@/lib/details/DetailsTitle.svelte';
import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';

interface Props {
  workspaceSummary: AgentWorkspaceSummaryUI | undefined;
  configuration: AgentWorkspaceConfiguration;
}

let { workspaceSummary, configuration }: Props = $props();
</script>

<div class="h-min">
  <DetailsTable>
    {#if workspaceSummary?.project}
      <tr>
        <DetailsCell>Project</DetailsCell>
        <DetailsCell>{workspaceSummary.project}</DetailsCell>
      </tr>
    {/if}
    {#if workspaceSummary?.agent}
      <tr>
        <DetailsCell>Agent</DetailsCell>
        <DetailsCell>{workspaceSummary.agent}</DetailsCell>
      </tr>
    {/if}
    {#if workspaceSummary?.state}
      <tr>
        <DetailsCell>State</DetailsCell>
        <DetailsCell>{workspaceSummary.state}</DetailsCell>
      </tr>
    {/if}
    {#if workspaceSummary?.model}
      <tr>
        <DetailsCell>Model</DetailsCell>
        <DetailsCell>{workspaceSummary.model}</DetailsCell>
      </tr>
    {/if}
    {#if configuration?.mounts?.length}
      <tr>
        <DetailsTitle>Mounts</DetailsTitle>
      </tr>
      {#each configuration.mounts as mount (`${mount.host}:${mount.target}`)}
        <tr>
          <DetailsCell>{mount.host}</DetailsCell>
          <DetailsCell>{mount.target}{mount.ro ? ' (read-only)' : ''}</DetailsCell>
        </tr>
      {/each}
    {/if}
    {#if configuration?.environment?.length}
      <tr>
        <DetailsTitle>Environment</DetailsTitle>
      </tr>
      {#each configuration.environment as envVar (envVar.name)}
        <tr>
          <DetailsCell>{envVar.name}</DetailsCell>
          <DetailsCell>{envVar.value ?? `(secret: ${envVar.secret})`}</DetailsCell>
        </tr>
      {/each}
    {/if}
    <!-- TODO: secrets section — configuration.secrets (string[]) -->
    <!-- TODO: skills section — configuration.skills (string[] of skill folder paths) -->
    <!-- TODO: MCP tools section — configuration.mcp.servers and configuration.mcp.commands -->
    <!-- TODO: network section — configuration.network.mode + configuration.network.hosts -->
  </DetailsTable>
</div>
