<script lang="ts">
import { onDestroy, onMount, tick } from 'svelte';
import { router } from 'tinro';

import App from './App.svelte';
import LoaderAnimation from './lib/images/LoaderAnimation.svelte';
import ColorsStyle from './lib/style/ColorsStyle.svelte';
import { lastPage } from './stores/breadcrumb';

let systemReady = $state(false);
let showTitle = $state(false);

let titleTimer: NodeJS.Timeout;
let extensionsStarterChecker: NodeJS.Timeout;

onMount(async () => {
  titleTimer = setTimeout(() => {
    showTitle = true;
  }, 2_000);

  // check if the server side is ready
  try {
    const isReady = await window.extensionSystemIsReady();
    systemReady = isReady;
    if (systemReady) {
      clearTimeout(titleTimer);
      window.dispatchEvent(new CustomEvent('system-ready', {}));
    }
  } catch (error) {
    console.error('Unable to check if system is ready', error);
  }

  const checkRemoteStarted = async (): Promise<void> => {
    const extensionsStarted = await window.extensionSystemIsExtensionsStarted();
    if (extensionsStarted) {
      window.dispatchEvent(new CustomEvent('extensions-already-started', {}));
      clearInterval(extensionsStarterChecker);
    }
  };

  extensionsStarterChecker = setInterval(() => {
    checkRemoteStarted().catch((error: unknown) => {
      console.error('Unable to check if extensions are started', error);
    });
  }, 100);
});

onDestroy(() => {
  clearTimeout(titleTimer);

  if (extensionsStarterChecker) {
    clearInterval(extensionsStarterChecker);
  }
});

// receive events from main process to install a new extension
window.events?.receive('install-extension:from-id', (extensionId: unknown) => {
  const action = async (): Promise<void> => {
    const redirectPage = `/extensions/details/${extensionId}`;
    // need to open the extension page
    await tick();
    router.goto(redirectPage);
    // make sure the last page is set to the extensions page so breadcrumb will be correct
    lastPage.set({ name: 'Extensions', path: '/extensions' });
  };

  if (!systemReady) {
    // need to wait for the system to be ready, so we delay the install
    window.addEventListener('system-ready', () => {
      action().catch((err: unknown) => console.log('Error while redirecting to extensions', err));
    });
  } else {
    action().catch((err: unknown) => console.log('Error while redirecting to extensions', err));
  }
});

// Wait that the server-side is ready
window.events.receive('starting-extensions', (value: unknown) => {
  systemReady = value === 'true';
  if (systemReady) {
    clearTimeout(titleTimer);
    window.dispatchEvent(new CustomEvent('system-ready', {}));
  }
});
</script>

<ColorsStyle />

{#if !systemReady}
  <main class="flex flex-row w-screen h-screen justify-center" style="-webkit-app-region: drag;">
    <div class="flex flex-col justify-center">
      <LoaderAnimation />
      <h1 class="text-center text-xl" class:invisible={!showTitle}>Initializing...</h1>
    </div>
  </main>
{:else}
  <App />
{/if}
