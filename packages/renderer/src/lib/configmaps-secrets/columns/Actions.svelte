<script lang="ts">
import { ErrorMessage } from '@podman-desktop/ui-svelte';

import ConfigmapSecretActions from '/@/lib/configmaps-secrets/ConfigMapSecretActions.svelte';

import type { Props } from './props';

let { object }: Props = $props();
</script>

{#if object.actionError}
  <ErrorMessage error={object.actionError} icon wrapMessage />
{/if}
<ConfigmapSecretActions configMapSecret={object} />
