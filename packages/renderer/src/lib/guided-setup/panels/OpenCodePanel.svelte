<script lang="ts">
import { faCircleCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Button, Link, Spinner } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { fetchProviders, providerInfos } from '/@/stores/providers';

let checking = $state(false);

let hasLocalInference = $derived(
  $providerInfos.some(p => p.inferenceConnections.some(c => c.type === 'local' && c.status === 'started')),
);

function openOllamaLink(): void {
  window.openExternal('https://ollama.com').catch(() => {});
}

function openRamalamaLink(): void {
  window.openExternal('https://github.com/containers/ramalama').catch(() => {});
}

function handleRetryProbe(): void {
  checking = true;
  fetchProviders()
    .catch((err: unknown) => {
      console.error('Local runtime probe failed', err);
    })
    .finally(() => {
      checking = false;
    });
}
</script>

<div
  class="rounded-xl border border-(--pd-content-divider) bg-(--pd-content-card-inset-bg) p-6"
  data-testid="opencode-panel">
  <h3 class="text-xs font-bold uppercase tracking-wider text-(--pd-content-card-text) opacity-50 mb-3">
    Local Runtime
  </h3>
  <p class="text-xs text-(--pd-content-card-text) opacity-50 mb-4 leading-relaxed">
    We check for local inference providers (such as <strong>Ollama</strong> or <strong>Ramalama</strong>) registered
    with the extension system. Results update the default-model step.
  </p>

  {#if checking}
    <div
      class="flex items-center gap-3 rounded-lg bg-(--pd-content-card-bg) p-4"
      role="status"
      aria-live="polite"
      data-testid="probe-checking">
      <Spinner size="1.25em" />
      <div>
        <strong class="text-sm text-(--pd-content-card-text)">Checking local runtimes…</strong>
        <p class="text-xs text-(--pd-content-card-text) opacity-50 mt-0.5">
          Looking for Ollama or Ramalama on this machine.
        </p>
      </div>
    </div>
  {:else if hasLocalInference}
    <div
      class="flex items-center gap-3 rounded-lg bg-(--pd-content-card-bg) border border-(--pd-state-success) p-4"
      role="status"
      aria-live="polite"
      data-testid="probe-detected">
      <Icon icon={faCircleCheck} size="lg" class="text-(--pd-state-success)" />
      <div>
        <strong class="text-sm text-(--pd-state-success)">Local runtime detected</strong>
        <p class="text-xs text-(--pd-content-card-text) opacity-70 mt-0.5">You can pick a default from the local catalog on the next step.</p>
      </div>
    </div>
  {:else}
    <div
      class="flex items-start gap-3 rounded-lg bg-(--pd-content-card-bg) border border-(--pd-state-warning) p-4"
      role="alert"
      data-testid="probe-not-found">
      <Icon icon={faTriangleExclamation} size="lg" class="text-(--pd-state-warning) shrink-0 mt-0.5" />
      <div>
        <strong class="text-sm text-(--pd-state-warning)">No local model server detected</strong>
        <p class="text-xs text-(--pd-content-card-text) opacity-70 mt-1 leading-relaxed">
          Install and start
          <Link on:click={openOllamaLink}>Ollama</Link>
          or
          <Link on:click={openRamalamaLink}>Ramalama</Link>, pull at least one model, then run
          <strong>Check again</strong>.
        </p>
        <Button type="secondary" class="mt-3" onclick={handleRetryProbe}>Check again</Button>
      </div>
    </div>
  {/if}
</div>
