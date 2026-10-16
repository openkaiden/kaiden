<script lang="ts">
import { faClaude } from '@fortawesome/free-brands-svg-icons';
import { faFileExport, faPlay, faStop, faTrash } from '@fortawesome/free-solid-svg-icons';
import { DropdownMenu } from '@podman-desktop/ui-svelte';

import FlatMenu from '/@/lib/ui/FlatMenu.svelte';
import ListItemButtonIcon from '/@/lib/ui/ListItemButtonIcon.svelte';
import { CLAUDE_CODE, CLAUDE_DESKTOP, CURSOR, type MCPExportTarget, VSCODE } from '/@api/mcp/mcp-export';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';

interface Props {
  object: MCPRemoteServerInfo;
  dropdownMenu?: boolean;
  detailed?: boolean;
}

const { object, dropdownMenu = true, detailed = false }: Props = $props();

let exportInProgress = $state(false);
let startStopInProgress = $state(false);

const isPackage = $derived(object.setupType === 'package');
const isRegistered = $derived(object.status === 'registered');

async function handleStartStop(): Promise<void> {
  startStopInProgress = true;
  try {
    if (isRegistered) {
      await window.startMcpServer(object.id);
    } else {
      await window.stopMcpServer(object.id);
    }
  } catch (error: unknown) {
    const action = isRegistered ? 'starting' : 'stopping';
    await window.showMessageBox({
      title: 'MCP Server',
      type: 'error',
      message: `Error while ${action} "${object.name}": ${error instanceof Error ? error.message : String(error)}`,
      buttons: ['OK'],
    });
  } finally {
    startStopInProgress = false;
  }
}

async function removeMcp(): Promise<void> {
  const options = object.infos;
  await window.removeMcpRemoteServer(object.id, options);
}

async function confirmCredentialWarning(configPath: string): Promise<boolean> {
  const result = await window.showMessageBox({
    title: 'Security Warning',
    message: `Exporting this MCP server will write configuration to:\n${configPath}\nThis may include credentials (API keys, tokens) as plaintext. Do you want to continue?`,
    buttons: ['Continue', 'Cancel'],
  });
  return result?.response === 0;
}

async function exportToTarget(target: MCPExportTarget): Promise<void> {
  exportInProgress = true;
  try {
    const configPath = await window.getMcpExportConfigPath(target);
    const confirmed = await confirmCredentialWarning(configPath);
    if (!confirmed) {
      return;
    }

    await window.exportMcpServer(object.infos.serverId, target);

    await window.showMessageBox({
      title: 'MCP Server Exported',
      message: `MCP server configuration has been written to:\n${configPath}`,
      buttons: ['OK'],
    });
  } catch (err: unknown) {
    await window.showMessageBox({
      title: 'Export Failed',
      message: `Failed to export MCP server: ${err instanceof Error ? err.message : String(err)}`,
      buttons: ['OK'],
    });
  } finally {
    exportInProgress = false;
  }
}

function exportToClaudeDesktop(): Promise<void> {
  return exportToTarget(CLAUDE_DESKTOP);
}

function exportToClaudeCode(): Promise<void> {
  return exportToTarget(CLAUDE_CODE);
}

function exportToCursor(): Promise<void> {
  return exportToTarget(CURSOR);
}

function exportToVSCode(): Promise<void> {
  return exportToTarget(VSCODE);
}

const ActionsStyle = $derived(dropdownMenu ? DropdownMenu : FlatMenu);
</script>

{#if isPackage}
  <ListItemButtonIcon
    title={isRegistered ? 'Start MCP server' : 'Stop MCP server'}
    icon={isRegistered ? faPlay : faStop}
    inProgress={startStopInProgress}
    onClick={handleStartStop} />
{/if}

 <ListItemButtonIcon
    title="Remove instance of MCP"
    icon={faTrash}
    onClick={removeMcp}
    />

<ActionsStyle>
  <ListItemButtonIcon
    title="Claude Desktop"
    icon={faClaude}
    onClick={exportToClaudeDesktop}
    menu={dropdownMenu}
    detailed={detailed}
    inProgress={exportInProgress} />
  <ListItemButtonIcon
    title="Claude Code"
    icon={faClaude}
    onClick={exportToClaudeCode}
    menu={dropdownMenu}
    detailed={detailed}
    inProgress={exportInProgress} />
  <ListItemButtonIcon
    title="Cursor"
    icon={faFileExport}
    onClick={exportToCursor}
    menu={dropdownMenu}
    detailed={detailed}
    inProgress={exportInProgress} />
  <ListItemButtonIcon
    title="VS Code"
    icon={faFileExport}
    onClick={exportToVSCode}
    menu={dropdownMenu}
    detailed={detailed}
    inProgress={exportInProgress} />
</ActionsStyle>