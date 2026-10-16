<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons/faPlus';
import { Button, EmptyScreen } from '@podman-desktop/ui-svelte';

import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';

interface Props {
  onclick(): void;
}

let { onclick }: Props = $props();
</script>

<EmptyScreen title="No secrets" icon={NoLogIcon}>
  <Button icon={faPlus} onclick={onclick}>
    Add Secret
  </Button>
</EmptyScreen>
