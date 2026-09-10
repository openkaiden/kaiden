<script lang="ts">
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons';
import { Tooltip } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { onDestroy } from 'svelte';

interface Props {
  text: string;
}

let { text }: Props = $props();

let copied = $state(false);
let copiedResetTimer: ReturnType<typeof setTimeout> | undefined;

async function copyToClipboard(): Promise<void> {
  if (copiedResetTimer) clearTimeout(copiedResetTimer);
  await window.clipboardWriteText(text);
  copied = true;
  copiedResetTimer = setTimeout(() => {
    copied = false;
    copiedResetTimer = undefined;
  }, 2000);
}

onDestroy(() => {
  if (copiedResetTimer) clearTimeout(copiedResetTimer);
});
</script>

<Tooltip top tip={copied ? 'Copied!' : 'Copy'}>
  <button
    class="inline-flex items-center justify-center w-7 h-7 rounded-md text-[var(--pd-content-text)] opacity-50 hover:opacity-100 hover:bg-[var(--pd-content-card-hover-bg)] transition-all"
    aria-label="Copy to clipboard"
    onclick={copyToClipboard}
  >
    <Icon icon={copied ? faCheck : faCopy} class="text-xs" />
  </button>
</Tooltip>
