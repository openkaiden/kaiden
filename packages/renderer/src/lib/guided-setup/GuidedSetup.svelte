<script lang="ts">
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { SvelteSet } from 'svelte/reactivity';

import { createDefaultOnboardingState, guidedSetupSteps } from './guided-setup-steps';

interface Props {
  onclose: () => void;
}

let { onclose }: Props = $props();

let currentStepIndex = $state(0);
let completedSteps = new SvelteSet<string>();
let onboardingState = $state(createDefaultOnboardingState());

let hasSteps = $derived(guidedSetupSteps.length > 0);
let currentStep = $derived(guidedSetupSteps[currentStepIndex]);
let isLastStep = $derived(currentStepIndex === guidedSetupSteps.length - 1);
let continueLabel = $derived(isLastStep ? 'Go to Dashboard' : 'Continue');

function getStepState(index: number): 'completed' | 'active' | 'upcoming' {
  const step = guidedSetupSteps[index];
  if (completedSteps.has(step.id)) return 'completed';
  if (index === currentStepIndex) return 'active';
  return 'upcoming';
}

async function persistOnboardingDefaults(): Promise<void> {
  await window.updateConfigurationValue('onboarding.defaultAgent', onboardingState.agent);
}

async function advance(): Promise<void> {
  if (!hasSteps || isLastStep) {
    try {
      await persistOnboardingDefaults();
    } catch (err: unknown) {
      console.error('Failed to persist onboarding defaults', err);
    }
    onclose();
  } else {
    currentStepIndex++;
  }
}

let advancing = $state(false);

async function handleContinue(): Promise<void> {
  if (advancing) return;
  advancing = true;
  try {
    if (onboardingState.beforeAdvance) {
      const ok = await onboardingState.beforeAdvance();
      if (!ok) return;
    }
    completedSteps.add(currentStep.id);
    await advance();
  } catch (err: unknown) {
    console.error('advance failed', err);
  } finally {
    advancing = false;
  }
}

async function handleSkip(): Promise<void> {
  if (advancing) return;
  advancing = true;
  try {
    await advance();
  } catch (err: unknown) {
    console.error('advance failed', err);
  } finally {
    advancing = false;
  }
}

function handleStepClick(index: number): void {
  const stepState = getStepState(index);
  if (stepState === 'completed' || index === currentStepIndex) {
    currentStepIndex = index;
  }
}
</script>

<div
  class="fixed inset-0 z-50 flex flex-col bg-(--pd-content-card-bg)"
  role="dialog"
  aria-label="Guided Setup">

  <!-- Stepper bar -->
  <nav class="flex items-center justify-center gap-0 px-8 pt-10 pb-6" aria-label="Setup progress">
    {#each guidedSetupSteps as step, index (step.id)}
      {@const state = getStepState(index)}
      {#if index > 0}
        <div
          class="h-0.5 w-12 mx-1 transition-colors {state === 'upcoming'
            ? 'bg-(--pd-content-divider)'
            : 'bg-(--pd-button-primary-bg)'}"
          aria-hidden="true">
        </div>
      {/if}
      <button
        class="flex flex-col items-center gap-1.5 min-w-[80px] cursor-pointer transition-opacity
          {state === 'upcoming' ? 'opacity-50' : 'opacity-100'}
          {state === 'completed' || index === currentStepIndex ? '' : 'cursor-default'}"
        aria-label="{step.title} step"
        aria-current={index === currentStepIndex ? 'step' : undefined}
        disabled={state === 'upcoming'}
        onclick={handleStepClick.bind(undefined, index)}>
        <div
          class="flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors
            {state === 'completed'
              ? 'bg-green-600 text-white'
              : state === 'active'
                ? 'bg-(--pd-button-primary-bg) text-(--pd-button-text)'
                : 'bg-(--pd-content-card-inset-bg) text-(--pd-content-card-text)'}">
          {#if state === 'completed'}
            <Icon icon={faCheck} size="0.8x" />
          {:else}
            {index + 1}
          {/if}
        </div>
        <span class="text-xs text-(--pd-content-card-text) whitespace-nowrap">{step.title}</span>
      </button>
    {/each}
  </nav>

  <!-- Step content area -->
  <div class="flex-1 overflow-y-auto px-8" aria-label="Step content">
    {#each guidedSetupSteps as step, index (step.id)}
      {#if index === currentStepIndex}
        <step.component stepId={step.id} title={step.title} description={step.description} onboarding={onboardingState} />
      {/if}
    {/each}
  </div>

  <!-- Footer -->
  <footer class="flex justify-end gap-3 px-8 py-6 bg-(--pd-content-bg)">
    {#if currentStep?.isSkippable}
      <Button type="secondary" aria-label="Skip" onclick={handleSkip} disabled={advancing}>Skip</Button>
    {/if}
    <Button type="primary" aria-label={continueLabel} onclick={handleContinue} disabled={advancing}>{continueLabel} &rsaquo;</Button>
  </footer>
</div>
