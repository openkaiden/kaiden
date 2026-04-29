<script lang="ts">
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { ErrorMessage, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { fetchProviders, providerInfos } from '/@/stores/providers';

import type { AgentDefinition } from '../agent-registry';
import type { OnboardingState } from '../guided-setup-steps';

interface Props {
  definition?: AgentDefinition;
  onboarding?: OnboardingState;
}

let { definition, onboarding }: Props = $props();

const extensionId = $derived(definition?.extensionId ?? 'claude');
const secretType = $derived(definition?.secretType ?? 'anthropic');

let apiKey = $state('');
let errorMessage = $state('');

let claudeProvider = $derived($providerInfos.find(p => p.id === extensionId));

async function validate(): Promise<boolean> {
  errorMessage = '';

  if (!claudeProvider) {
    errorMessage = 'Claude provider extension is not available. Make sure the Claude extension is enabled.';
    return false;
  }

  if (!apiKey.trim()) {
    errorMessage = 'Please enter your Anthropic API key.';
    return false;
  }

  try {
    await window.createSecret({
      name: secretType,
      type: secretType,
      value: apiKey.trim(),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('already exists')) {
      errorMessage = `Failed to store secret: ${msg}`;
      return false;
    }
  }

  try {
    const loggerKey = Symbol('onboarding-claude');
    const noop = (): void => {};
    await window.createInferenceProviderConnection(
      claudeProvider.internalId,
      { 'claude.factory.apiKey': apiKey.trim() },
      loggerKey,
      noop,
      undefined,
      undefined,
    );

    await fetchProviders();
    return true;
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
    return false;
  }
}

$effect(() => {
  if (onboarding) {
    onboarding.beforeAdvance = validate;
  }
  return (): void => {
    if (onboarding?.beforeAdvance === validate) {
      onboarding.beforeAdvance = undefined;
    }
  };
});
</script>

<div
  class="rounded-xl border border-(--pd-content-divider) bg-(--pd-content-card-inset-bg) p-6"
  data-testid="claude-panel">
  <h3 class="text-xs font-bold uppercase tracking-wider text-(--pd-content-card-text) opacity-50 mb-3">
    API Key
  </h3>
  <p class="text-xs text-(--pd-content-card-text) opacity-50 mb-4 leading-relaxed">
    Enter your Anthropic API key. It will be verified and stored when you continue to the next step.
  </p>

  <div class="flex flex-col gap-3" data-testid="claude-form">
    {#if !claudeProvider}
      <div
        class="flex items-center gap-2 rounded-lg bg-(--pd-content-card-bg) border border-(--pd-state-warning) p-3"
        role="alert"
        data-testid="claude-provider-missing">
        <Icon icon={faTriangleExclamation} size="sm" class="text-(--pd-state-warning) shrink-0" />
        <span class="text-xs text-(--pd-state-warning)">Claude provider extension not detected.</span>
      </div>
    {/if}

    <Input
      type="password"
      placeholder="sk-ant-..."
      bind:value={apiKey}
      aria-label="Anthropic API key"
      disabled={!claudeProvider} />

    {#if errorMessage}
      <ErrorMessage error={errorMessage} />
    {/if}
  </div>
</div>
