<script lang="ts">
import { faRobot } from '@fortawesome/free-solid-svg-icons/faRobot';
import { EmptyScreen } from '@podman-desktop/ui-svelte';
</script>

<EmptyScreen title="No agent workspaces" icon={faRobot}>
  <span class="text-(--pd-content-text)">
    Agent workspaces will appear here once created.
  </span>
</EmptyScreen>
