<script lang="ts">
import { Button } from '@podman-desktop/ui-svelte';
import { SvelteSet } from 'svelte/reactivity';

import WizardStepper from '/@/lib/ui/WizardStepper.svelte';

import { createDefaultOnboardingState, guidedSetupSteps } from './guided-setup-steps';

interface Props {
  onclose: () => void;
}

let { onclose }: Props = $props();

let onboardingState = $state(createDefaultOnboardingState());

let currentStepIndex = $state(0);
let completedSteps = new SvelteSet<string>();
let currentStep = $derived(guidedSetupSteps[currentStepIndex]);
let isFirstStep = $derived(currentStepIndex === 0);
let isLastStep = $derived(currentStepIndex === guidedSetupSteps.length - 1);
const continueLabel = $derived(isLastStep ? 'Go to Dashboard' : 'Continue');

async function persistOnboardingDefaults(): Promise<void> {
  const resolvedAgent = onboardingState.agent;
  onboardingState.workspaceSetting.defaultAgent = resolvedAgent;

  const agentSettings = onboardingState.workspaceSetting.defaultAgentSettings?.[resolvedAgent] ?? {};
  onboardingState.workspaceSetting.defaultAgentSettings ??= {};
  onboardingState.workspaceSetting.defaultAgentSettings[resolvedAgent] = agentSettings;
  agentSettings.defaultModel = onboardingState.model;

  await window.updateConfigurationValue(
    'onboarding.defaultWorkspaceSettings',
    $state.snapshot(onboardingState.workspaceSetting),
  );
}

async function advance(): Promise<void> {
  if (!isLastStep) {
    completedSteps.add(currentStep.id);
    currentStepIndex++;
    return;
  }

  try {
    await persistOnboardingDefaults();
  } catch (err: unknown) {
    console.error('Failed to persist onboarding defaults', err);
  }
  onclose();
}

function goBack(): void {
  if (currentStepIndex > 0) {
    currentStepIndex--;
  }
}

function handleStepClick(index: number): void {
  currentStepIndex = index;
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
    await advance();
  } catch (err: unknown) {
    console.error('advance failed', err);
  } finally {
    advancing = false;
  }
}

function handleSkip(): void {
  onclose();
}
</script>

<div
  class="fixed inset-0 z-50 flex flex-col bg-(--pd-content-card-bg)"
  role="dialog"
  aria-label="Guided Setup">
  <div class="flex justify-center py-6">
    <WizardStepper
      steps={guidedSetupSteps.map(step => ({ id: step.id, title: step.stepperLabel ?? step.title }))}
      currentIndex={currentStepIndex}
      completedIds={completedSteps}
      onStepClick={handleStepClick} />
  </div>

  <div class="flex-1 overflow-y-auto px-8" aria-label="Step content">
    {#if currentStep}
      <div class="mx-auto max-w-5xl">
        <div class="rounded-xl border border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg) p-6">
          <currentStep.component
            stepId={currentStep.id}
            title={currentStep.title}
            description={currentStep.description}
            bind:onboarding={onboardingState} />
        </div>
      </div>
    {/if}
  </div>

  <footer class="flex items-center justify-between px-8 py-6 bg-(--pd-content-bg)">
    <div class="flex items-center gap-4">
      <Button type="secondary" aria-label="Back" onclick={goBack} disabled={isFirstStep}>Back</Button>
      <span class="text-sm text-(--pd-content-card-text) opacity-70">
        Step {currentStepIndex + 1} of {guidedSetupSteps.length}
      </span>
    </div>
    <div class="flex gap-3">
      {#if currentStep?.isSkippable}
        <Button type="secondary" aria-label="Skip" onclick={handleSkip} disabled={advancing}>Skip</Button>
      {/if}
      <Button type="primary" aria-label={continueLabel} onclick={handleContinue} disabled={advancing}>{continueLabel} &rsaquo;</Button>
    </div>
  </footer>
</div>
