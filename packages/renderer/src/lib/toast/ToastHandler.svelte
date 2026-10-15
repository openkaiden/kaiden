<style>
.svelte-toast-wrapper {
  font-size: 0.8rem;
  --toastPadding: '0';
  --toastMsgPadding: '0';
  --toastMinHeight: 2rem;
  --toastBorderRadius: 0.3rem;
  --toastWidth: 16rem;
  --toastContainerTop: auto;
  --toastContainerRight: 0.8rem;
  --toastContainerBottom: 1rem;
  --toastContainerLeft: auto;
  --toastBackground: var(--pd-modal-bg);
  --toastBarHeight: 3px;
}
</style>

<script lang="ts">
import { SvelteToast, toast } from '@zerodevx/svelte-toast';
import { onDestroy, onMount } from 'svelte';

import { toastThemes } from './toast-themes';

let callback: (object: { type: string; message: string }) => void;

onMount(() => {
  callback = (object: { type: string; message: string }): void => {
    const theme = toastThemes[object.type] ?? {};
    toast.push(object.message, { pausable: true, theme });
  };

  window.events?.receive('toast:handler', (object: unknown) => {
    const value = object as { type: string; message: string };
    callback(value);
  });
});

onDestroy(() => {
  callback = (): void => {};
});
</script>

<div class="svelte-toast-wrapper">
  <SvelteToast />
</div>
