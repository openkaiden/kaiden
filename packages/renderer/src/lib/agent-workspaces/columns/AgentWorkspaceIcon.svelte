<script lang="ts">
import type { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { faCode, faO, faRobot, faWrench } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { AgentWorkspaceSummaryUI } from '/@/stores/agent-workspaces.svelte';

interface Props {
  object: AgentWorkspaceSummaryUI;
}

let { object }: Props = $props();

const agentIcons: Record<string, IconDefinition> = {
  opencode: faO,
  claude: faRobot,
  cursor: faCode,
  goose: faWrench,
};

const icon = $derived(agentIcons[object.agent] ?? faRobot);
</script>

<div class="flex items-center justify-center" title={object.agent}>
  <Icon {icon} size="1.1x" />
</div>
