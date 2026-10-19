<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, ErrorMessage, Input, NumberInput } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import SemanticRouterCreateStepModels from '/@/kaiden/lib/models/SemanticRouterCreateStepModels.svelte';
import { resetRouterDraft, routerWizard } from '/@/kaiden/stores/semantic-router-create-draft.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import WizardStepper from '/@/lib/ui/WizardStepper.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SemanticRouterConfigInfo } from '/@api/semantic-router-info';

import SemanticRouterCreateStepSignals from './SemanticRouterCreateStepSignals.svelte';

const WIZARD_STEPS = [
  { id: 'basic', title: 'Basic setup' },
  { id: 'models', title: 'Backend models' },
  { id: 'signals', title: 'Signals & decisions' },
];

let currentStepIndex = $derived(routerWizard.draft.currentStepIndex);
let currentStepId = $derived(WIZARD_STEPS[currentStepIndex]?.id ?? '');
let isLastStep = $derived(currentStepIndex === WIZARD_STEPS.length - 1);

let selectedModels: CatalogModelInfo[] = $state([]);
let defaultModel: CatalogModelInfo | undefined = $state(undefined);

let error = $state('');
let creating = $state(false);

let isBasicStepValid = $derived(
  routerWizard.draft.name.trim().length > 0 &&
    routerWizard.draft.listenerPort >= 1024 &&
    routerWizard.draft.listenerPort <= 65535 &&
    routerWizard.draft.timeout > 0 &&
    routerWizard.draft.timeout <= 3600,
);

let canProceedModels = $derived(selectedModels.length > 0);

let isSignalsStepValid = $derived.by(() => {
  const { keywords, decisions } = routerWizard.draft;
  const allSignalsNamed = keywords.every(k => k.name.trim().length > 0);
  const allDecisionsNamed = decisions.every(d => d.name.trim().length > 0);
  const allDecisionsHaveSignal = decisions.every(d => d.rules[0]?.conditions.length > 0);
  const allDecisionsHaveModel = decisions.every(d => d.rules[0]?.modelRefs.length > 0);
  return allSignalsNamed && allDecisionsNamed && allDecisionsHaveSignal && allDecisionsHaveModel;
});

let canProceed = $derived(
  currentStepId === 'basic' ? isBasicStepValid : currentStepId === 'models' ? canProceedModels : isSignalsStepValid,
);

function buildModelRefs(): Array<{ providerId: string; connectionId: string; label: string; useReasoning: boolean }> {
  return selectedModels.map(m => ({
    providerId: m.providerId,
    connectionId: m.connectionId,
    label: m.label,
    useReasoning: false,
  }));
}

function goBack(): void {
  if (routerWizard.draft.currentStepIndex > 0) {
    routerWizard.draft.currentStepIndex--;
  }
}

function handleStepClick(index: number): void {
  routerWizard.draft.currentStepIndex = index;
}

function resolveDefaultModelRef():
  | { providerId: string; connectionId: string; label: string; useReasoning: boolean }
  | undefined {
  const target = defaultModel ?? selectedModels[0];
  if (!target) return undefined;
  return { providerId: target.providerId, connectionId: target.connectionId, label: target.label, useReasoning: false };
}

function buildConfig(): SemanticRouterConfigInfo {
  const d = $state.snapshot(routerWizard.draft);
  const modelRefs = buildModelRefs();
  return {
    name: d.name.trim(),
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional: || converts empty string to undefined
    description: d.description.trim() || undefined,
    listeners: [{ address: d.listenerAddress, port: d.listenerPort, timeout: d.timeout }],
    routing: {
      keywords: d.keywords,
      decisions:
        d.decisions.length > 0
          ? d.decisions
          : modelRefs.length > 0
            ? [{ name: 'default', priority: 0, rules: [{ operator: 'OR', conditions: [], modelRefs }] }]
            : [],
      defaultModelRef: resolveDefaultModelRef(),
    },
  };
}

async function createRouter(): Promise<void> {
  if (creating) return;
  error = '';
  creating = true;
  try {
    await window.createSemanticRouter(buildConfig());
    resetRouterDraft();
    handleNavigation({ page: NavigationPage.SEMANTIC_ROUTERS });
  } catch (err: unknown) {
    error = String(err);
  } finally {
    creating = false;
  }
}

async function goNext(): Promise<void> {
  if (!isLastStep) {
    routerWizard.draft.currentStepIndex++;
    return;
  }
  await createRouter();
}

function cancel(): void {
  resetRouterDraft();
  handleNavigation({ page: NavigationPage.SEMANTIC_ROUTERS });
}
</script>

<FormPage title="Add Semantic Router">
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
      <div class="bg-(--pd-content-card-bg) py-6">
        <div class="flex flex-col px-6 max-w-4xl mx-auto space-y-5">

          <!-- Page header -->
          <div class="mb-2">
            <span
              class="text-xs font-semibold uppercase tracking-widest text-(--pd-label-primary-text)
                bg-(--pd-label-primary-bg) px-2 py-0.5 rounded mb-2 inline-flex items-center gap-1.5">
              <Icon icon={faPlus} size="xs" />
              New Semantic Router
            </span>
            <h1 class="text-2xl font-bold text-(--pd-modal-text) mb-1">Configure a Semantic Router</h1>
            <p class="text-sm text-(--pd-content-card-text) opacity-70 max-w-2xl leading-relaxed">
              Define backend model pools, signal rules, and routing decisions. The router exposes a single
              <code class="text-(--pd-button-primary-bg) text-[13px]">/v1/chat/completions</code> endpoint your
              agents use — no code changes needed.
            </p>
          </div>

          <!-- Stepper -->
          <WizardStepper steps={WIZARD_STEPS} currentIndex={currentStepIndex} onStepClick={handleStepClick} />

          <!-- Step content card -->
          <div class="rounded-xl border border-(--pd-content-card-border) bg-(--pd-content-card-inset-bg) p-6">
            {#if currentStepId === 'basic'}
            <h2 class="text-lg font-semibold text-(--pd-modal-text) mb-1">Basic setup</h2>
            <p class="text-sm text-(--pd-content-card-text) opacity-60 mb-5">
              Give the router a name and configure the listener. Agents connect to the listener endpoint; they never
              talk to backends directly.
            </p>

            <div class="space-y-4">
              <div class="grid grid-cols-2 gap-3.5">
                <div>
                  <label for="router-name" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                    Router name <span class="text-(--pd-input-field-error-text)">*</span>
                  </label>
                  <Input id="router-name" bind:value={routerWizard.draft.name} placeholder="e.g. coding-router" aria-label="Router name" />
                  <p class="text-xs text-(--pd-content-card-text) opacity-50 mt-1.5">
                    Used as the identifier when selecting this router in workspace creation.
                  </p>
                </div>
                <div>
                  <label for="router-description" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                    Description
                  </label>
                  <Input id="router-description" bind:value={routerWizard.draft.description} placeholder="Short description of the routing strategy" aria-label="Description" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3.5">
                <div>
                  <label for="listener-address" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                    Listener address
                  </label>
                  <Input id="listener-address" bind:value={routerWizard.draft.listenerAddress} placeholder="0.0.0.0" aria-label="Listener address" />
                  <p class="text-xs text-(--pd-content-card-text) opacity-50 mt-1.5">
                    Use <code class="text-(--pd-button-primary-bg)">host.containers.internal</code> when running
                    inside a container to reach host services.
                  </p>
                </div>
                <div>
                  <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                    Listener port
                  </span>
                  <NumberInput bind:value={routerWizard.draft.listenerPort} minimum={1024} maximum={65535} type="integer" aria-label="Listener port" />
                  <p class="text-xs text-(--pd-content-card-text) opacity-50 mt-1.5">
                    Default: <strong>8899</strong>. Agents connect to
                    <code class="text-(--pd-button-primary-bg)">http://host:{routerWizard.draft.listenerPort}/v1/chat/completions</code>.
                  </p>
                </div>
              </div>

              <div class="max-w-[calc(50%-7px)]">
                <label for="router-timeout" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                  Timeout
                </label>
                <NumberInput bind:value={routerWizard.draft.timeout} minimum={1} maximum={3600} type="integer" aria-label="Timeout" />
                <p class="text-xs text-(--pd-content-card-text) opacity-50 mt-1.5">
                  Maximum time (in seconds) before the request is cancelled.
                </p>
              </div>
            </div>
            {:else if currentStepId === 'models'}
              <SemanticRouterCreateStepModels bind:selectedModels={selectedModels} bind:defaultModel={defaultModel} />
            {:else if currentStepId === 'signals'}
              <SemanticRouterCreateStepSignals
                bind:keywords={routerWizard.draft.keywords}
                bind:decisions={routerWizard.draft.decisions}
                availableModels={selectedModels} />
            {/if}
          </div>

          {#if error}
            <ErrorMessage error={error} />
          {/if}

          <!-- Footer actions -->
          <div class="flex items-center justify-between pt-4 border-t border-(--pd-content-card-border)">
            <span class="text-sm text-(--pd-content-card-text) opacity-70">
              Step {currentStepIndex + 1} of {WIZARD_STEPS.length}
            </span>
            <div class="flex flex-wrap items-center justify-end gap-3">
              {#if currentStepIndex > 0}
                <Button onclick={goBack}>Back</Button>
              {/if}
              <Button onclick={cancel}>Cancel</Button>
              {#if isLastStep}
                <Button onclick={createRouter} disabled={!isBasicStepValid || !canProceedModels || !isSignalsStepValid || creating} inProgress={creating}>
                  Create
                </Button>
              {:else}
                <Button disabled={!canProceed} onclick={goNext}>Continue</Button>
              {/if}
            </div>
          </div>

        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
