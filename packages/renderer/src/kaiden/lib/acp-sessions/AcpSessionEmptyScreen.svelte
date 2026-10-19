<script lang="ts">
import { faRobot } from '@fortawesome/free-solid-svg-icons';
import { EmptyScreen } from '@podman-desktop/ui-svelte';

interface Props {
  oncreate: () => void;
}

let { oncreate }: Props = $props();
</script>

<EmptyScreen
  icon={faRobot}
  title="No agent sessions"
  message="Start a new session to interact with a coding agent in one of your workspaces."
  commandline="New Session"
  onclick={oncreate}
/>
