<script lang="ts">
import { EmptyScreen } from '@podman-desktop/ui-svelte';

import NoLogIcon from '/@/lib/ui/NoLogIcon.svelte';
</script>

<EmptyScreen title="No models" icon={NoLogIcon}>
  <p class="text-[var(--pd-content-text)]">
    No inference providers are connected. Install an LLM provider extension to get started.
  </p>
</EmptyScreen>
