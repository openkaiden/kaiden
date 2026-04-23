<script lang="ts">
import { faCircleCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Button, Link, Spinner } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

type ProbeStatus = 'idle' | 'checking' | 'detected' | 'not-found';
let probeStatus: ProbeStatus = $state('idle');

async function hasLocalInferenceConnection(): Promise<boolean> {
  try {
    const providers = await window.getProviderInfos();
    return providers.some(p => p.inferenceConnections.some(c => c.type === 'local' && c.status === 'started'));
  } catch {
    return false;
  }
}

async function probeLocalRuntime(): Promise<void> {
  probeStatus = 'checking';
  probeStatus = (await hasLocalInferenceConnection()) ? 'detected' : 'not-found';
}

function openOllamaLink(): void {
  window.openExternal('https://ollama.com').catch(() => {});
}

function openRamalamaLink(): void {
  window.openExternal('https://github.com/containers/ramalama').catch(() => {});
}

function handleRetryProbe(): void {
  probeLocalRuntime().catch((err: unknown) => {
    console.error('Local runtime probe failed', err);
  });
}

$effect(() => {
  if (probeStatus === 'idle') {
    probeLocalRuntime().catch((err: unknown) => {
      console.error('Local runtime probe failed', err);
    });
  }
});
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

  {#if probeStatus === 'checking'}
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
  {:else if probeStatus === 'detected'}
    <div
      class="flex items-center gap-3 rounded-lg bg-green-900/20 border border-green-700/30 p-4"
      role="status"
      aria-live="polite"
      data-testid="probe-detected">
      <Icon icon={faCircleCheck} size="lg" class="text-green-400" />
      <div>
        <strong class="text-sm text-green-300">Local runtime detected</strong>
        <p class="text-xs text-green-300/70 mt-0.5">You can pick a default from the local catalog on the next step.</p>
      </div>
    </div>
  {:else if probeStatus === 'not-found'}
    <div
      class="flex items-start gap-3 rounded-lg bg-amber-900/20 border border-amber-700/30 p-4"
      role="alert"
      data-testid="probe-not-found">
      <Icon icon={faTriangleExclamation} size="lg" class="text-amber-400 shrink-0 mt-0.5" />
      <div>
        <strong class="text-sm text-amber-300">No local model server detected</strong>
        <p class="text-xs text-amber-300/70 mt-1 leading-relaxed">
          Install and start
          <Link on:click={openOllamaLink}>Ollama</Link>
          or
          <Link on:click={openRamalamaLink}>Ramalama</Link>, pull at least one model, then run
          <strong>Check again</strong>.
        </p>
        <Button type="secondary" class="mt-3" aria-label="Check again" onclick={handleRetryProbe}>Check again</Button>
      </div>
    </div>
  {/if}
</div>
