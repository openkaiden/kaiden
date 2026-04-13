<script lang="ts">
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { SvelteSet } from 'svelte/reactivity';

import { guidedSetupSteps } from './guided-setup-steps';

interface Props {
  onclose: () => void;
}

let { onclose }: Props = $props();

let currentStepIndex = $state(0);
let completedSteps = new SvelteSet<string>();

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

function advance(): void {
  if (!hasSteps || isLastStep) {
    onclose();
  } else {
    currentStepIndex++;
  }
}

function handleContinue(): void {
  completedSteps.add(currentStep.id);
  advance();
}

function handleSkip(): void {
  advance();
}

function handleStepClick(index: number): void {
  const state = getStepState(index);
  if (state === 'completed' || index === currentStepIndex) {
    currentStepIndex = index;
  }
}
</script>

<div
  class="fixed inset-0 z-50 flex flex-col bg-[var(--pd-content-card-bg)]"
  role="dialog"
  aria-label="Guided Setup">

  <!-- Stepper bar -->
  <nav class="flex items-center justify-center gap-0 px-8 pt-10 pb-6" aria-label="Setup progress">
    {#each guidedSetupSteps as step, index (step.id)}
      {@const state = getStepState(index)}
      {#if index > 0}
        <div
          class="h-0.5 w-12 mx-1 transition-colors {state === 'upcoming'
            ? 'bg-[var(--pd-content-divider)]'
            : 'bg-[var(--pd-button-primary-bg)]'}"
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
                ? 'bg-[var(--pd-button-primary-bg)] text-[var(--pd-button-text)]'
                : 'bg-[var(--pd-content-card-inset-bg)] text-[var(--pd-content-card-text)]'}">
          {#if state === 'completed'}
            <Icon icon={faCheck} size="0.8x" />
          {:else}
            {index + 1}
          {/if}
        </div>
        <span class="text-xs text-[var(--pd-content-card-text)] whitespace-nowrap">{step.title}</span>
      </button>
    {/each}
  </nav>

  <!-- Step content area -->
  <div class="flex-1 overflow-y-auto px-8" aria-label="Step content">
    {#each guidedSetupSteps as step, index (step.id)}
      {#if index === currentStepIndex}
        <step.component stepId={step.id} title={step.title} description={step.description} />
      {/if}
    {/each}
  </div>

  <!-- Footer -->
  <footer class="flex justify-end gap-3 px-8 py-6 bg-[var(--pd-content-bg)]">
    {#if currentStep?.isSkippable}
      <Button type="secondary" aria-label="Skip" onclick={handleSkip}>Skip</Button>
    {/if}
    <Button type="primary" aria-label={continueLabel} onclick={handleContinue}>{continueLabel}</Button>
  </footer>
</div>
