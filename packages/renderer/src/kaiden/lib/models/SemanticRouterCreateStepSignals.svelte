<script lang="ts">
import { faPlus } from '@fortawesome/free-solid-svg-icons';
import { Button, Checkbox, CloseButton, Dropdown, Input, NumberInput } from '@podman-desktop/ui-svelte';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import type { DecisionConfigDraft, KeywordGroupDraft } from '/@/kaiden/stores/semantic-router-create-draft.svelte';
import SlideToggle from '/@/lib/ui/SlideToggle.svelte';

interface Props {
  keywords: KeywordGroupDraft[];
  decisions: DecisionConfigDraft[];
  availableModels: readonly CatalogModelInfo[];
}

let { keywords = $bindable(), decisions = $bindable(), availableModels }: Props = $props();

let keywordNames: string[] = $derived(keywords.map(k => k.name).filter(n => n.trim().length > 0));

// --- Keyword signal helpers ---

function addKeywordSignal(): void {
  keywords = [...keywords, { name: '', operator: 'OR', keywords: [], caseSensitive: false }];
}

function removeKeywordSignal(index: number): void {
  keywords = keywords.filter((_, i) => i !== index);
}

function updateKeywordField<K extends keyof KeywordGroupDraft>(
  index: number,
  field: K,
  value: KeywordGroupDraft[K],
): void {
  keywords = keywords.map((k, i) => (i === index ? { ...k, [field]: value } : k));
}

function toggleOperator(index: number): void {
  const current = keywords[index].operator;
  updateKeywordField(index, 'operator', current === 'OR' ? 'AND' : 'OR');
}

let pendingChips: string[] = $state([]);

function handleChipKeydown(event: KeyboardEvent, index: number): void {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const value = (pendingChips[index] ?? '').trim();
  if (!value) return;
  const kw = keywords[index];
  if (!kw.keywords.includes(value)) {
    updateKeywordField(index, 'keywords', [...kw.keywords, value]);
  }
  pendingChips[index] = '';
}

function removeChip(signalIndex: number, chipIndex: number): void {
  const kw = keywords[signalIndex];
  updateKeywordField(
    signalIndex,
    'keywords',
    kw.keywords.filter((_, i) => i !== chipIndex),
  );
}

// --- Decision helpers ---

function addDecision(): void {
  const defaultConditions = keywordNames.length > 0 ? [{ type: 'keyword' as const, name: keywordNames[0] }] : [];

  const defaultModelRefs =
    availableModels.length > 0
      ? [
          {
            providerId: availableModels[0].providerId,
            connectionId: availableModels[0].connectionId ?? '',
            label: availableModels[0].label,
            useReasoning: false,
          },
        ]
      : [];

  decisions = [
    ...decisions,
    {
      name: '',
      priority: 100,
      rules: [{ operator: 'AND', conditions: defaultConditions, modelRefs: defaultModelRefs }],
    },
  ];
}

function removeDecision(index: number): void {
  decisions = decisions.filter((_, i) => i !== index);
}

function updateDecisionField(index: number, field: 'name' | 'priority', value: string | number): void {
  decisions = decisions.map((d, i) => (i === index ? { ...d, [field]: value } : d));
}

function toggleRuleOperator(decIndex: number): void {
  decisions = decisions.map((d, i) => {
    if (i !== decIndex) return d;
    const rule = d.rules[0];
    return {
      ...d,
      rules: [{ ...rule, operator: rule.operator === 'AND' ? 'OR' : 'AND' }],
    };
  });
}

function toggleCondition(decIndex: number, signalName: string): void {
  decisions = decisions.map((d, i) => {
    if (i !== decIndex) return d;
    const rule = d.rules[0];
    const exists = rule.conditions.some(c => c.name === signalName);
    const newConditions = exists
      ? rule.conditions.filter(c => c.name !== signalName)
      : [...rule.conditions, { type: 'keyword' as const, name: signalName }];
    return { ...d, rules: [{ ...rule, conditions: newConditions }] };
  });
}

function isConditionSelected(decIndex: number, signalName: string): boolean {
  return decisions[decIndex].rules[0].conditions.some(c => c.name === signalName);
}

function onSelectedModelChanged(decIndex: number, label: string): void {
  const model = availableModels.find(m => m.label === label);
  if (model) selectModel(decIndex, model);
}

function selectModel(decIndex: number, model: CatalogModelInfo): void {
  decisions = decisions.map((d, i) => {
    if (i !== decIndex) return d;
    const rule = d.rules[0];
    const ref = {
      providerId: model.providerId,
      connectionId: model.connectionId ?? '',
      label: model.label,
      useReasoning: rule.modelRefs[0]?.useReasoning ?? false,
    };
    return { ...d, rules: [{ ...rule, modelRefs: [ref] }] };
  });
}

function toggleReasoning(decIndex: number): void {
  decisions = decisions.map((d, i) => {
    if (i !== decIndex) return d;
    const rule = d.rules[0];
    if (rule.modelRefs.length === 0) return d;
    const ref = rule.modelRefs[0];
    return {
      ...d,
      rules: [{ ...rule, modelRefs: [{ ...ref, useReasoning: !ref.useReasoning }] }],
    };
  });
}

function getSelectedModelLabel(decIndex: number): string {
  const ref = decisions[decIndex]?.rules[0]?.modelRefs[0];
  return ref?.label ?? '';
}
</script>

<div class="flex flex-col gap-8">
  <!-- Signals section -->
  <div>
    <h2 class="text-lg font-semibold text-(--pd-modal-text) pb-1">Signals</h2>
    <p class="text-sm text-(--pd-content-card-text) opacity-60 pb-5">
      Signals detect patterns in incoming requests. Decisions consume signals and pick a model.
    </p>

    {#if keywords.length === 0}
      <div class="flex items-center justify-center py-8 rounded-lg border border-dashed border-(--pd-content-divider)">
        <p class="text-sm text-(--pd-content-card-text) opacity-50">
          No signals defined yet. Add a keyword signal to get started.
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        {#each keywords as kw, index (index)}
          <div class="rounded-lg border border-(--pd-content-card-border) bg-(--pd-content-card-bg) p-4">
            <div class="flex items-center justify-between pb-3">
              <span class="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-(--pd-label-primary-bg) text-(--pd-label-primary-text)">
                Keyword
              </span>
              <CloseButton onclick={(): void => removeKeywordSignal(index)} />
            </div>

            <div class="flex items-end gap-3 pb-3">
              <div class="flex-1">
                <label for="signal-name-{index}" class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">
                  Signal name
                </label>
                <Input
                  id="signal-name-{index}"
                  value={kw.name}
                  oninput={(e: Event): void => updateKeywordField(index, 'name', (e.target as HTMLInputElement).value)}
                  placeholder="e.g. coding_keywords"
                  aria-label="Signal name" />
              </div>
              <div>
                <span class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">Operator</span>
                <div class="flex items-center gap-1">
                  <span class="w-6 text-right text-xs font-medium mr-3" class:text-(--pd-input-toggle-on-text)={kw.operator === 'OR'} class:opacity-40={kw.operator !== 'OR'}>OR</span>
                  <SlideToggle
                    id="signal-operator-{index}"
                    aria-label="Toggle operator"
                    checked={kw.operator === 'AND'}
                    on:checked={(): void => toggleOperator(index)} />
                  <span class="w-6 text-xs font-medium" class:text-(--pd-input-toggle-on-text)={kw.operator === 'AND'} class:opacity-40={kw.operator !== 'AND'}>AND</span>
                </div>
              </div>
            </div>

            <div class="flex items-center gap-2 pb-3">
              <Checkbox
                checked={kw.caseSensitive}
                title="Case sensitive"
                onclick={(): void => updateKeywordField(index, 'caseSensitive', !kw.caseSensitive)} />
              <span class="text-xs text-(--pd-content-card-text)">Case sensitive</span>
            </div>

            <!-- Keyword chips -->
            <div>
              <span class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">Keywords</span>
              <div class="flex flex-wrap gap-1.5 min-h-[36px] p-2 rounded-md border border-(--pd-content-card-border) bg-(--pd-input-field-bg)">
                {#each kw.keywords as chip, chipIdx (chipIdx)}
                  <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-(--pd-label-primary-bg) text-(--pd-label-primary-text)">
                    {chip}
                    <CloseButton onclick={(): void => removeChip(index, chipIdx)} />
                  </span>
                {/each}
                <Input
                  class="flex-1 min-w-[100px]"
                  placeholder={kw.keywords.length === 0 ? 'Type a keyword and press Enter' : 'Add more...'}
                  bind:value={pendingChips[index]}
                  onkeypress={(e: KeyboardEvent): void => handleChipKeydown(e, index)}
                  aria-label="Add keyword" />
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="pt-3">
      <Button type="secondary" icon={faPlus} onclick={addKeywordSignal}>
        Add keyword signal
      </Button>
    </div>
  </div>

  <!-- Decisions section -->
  <div>
    <h2 class="text-lg font-semibold text-(--pd-modal-text) pb-1">Decisions</h2>
    <p class="text-sm text-(--pd-content-card-text) opacity-60 pb-5">
      Evaluated by priority (highest first). First matching rule selects the backend.
    </p>

    {#if decisions.length === 0}
      <div class="flex items-center justify-center py-8 rounded-lg border border-dashed border-(--pd-content-divider)">
        <p class="text-sm text-(--pd-content-card-text) opacity-50">
          No decisions defined yet. Add a decision to create routing rules.
        </p>
      </div>
    {:else}
      <div class="flex flex-col gap-4">
        {#each decisions as dec, decIdx (decIdx)}
          <div class="rounded-lg border border-(--pd-content-card-border) bg-(--pd-content-card-bg) p-4">
            <div class="flex items-center justify-between pb-3">
              <span class="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-(--pd-label-primary-bg) text-(--pd-label-primary-text)">
                Decision
              </span>
              <CloseButton onclick={(): void => removeDecision(decIdx)} />
            </div>

            <div class="flex items-end gap-3 pb-3">
              <div class="flex-1">
                <label for="decision-name-{decIdx}" class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">
                  Decision name
                </label>
                <Input
                  id="decision-name-{decIdx}"
                  value={dec.name}
                  oninput={(e: Event): void => updateDecisionField(decIdx, 'name', (e.target as HTMLInputElement).value)}
                  placeholder="e.g. coding-route"
                  aria-label="Decision name" />
              </div>
              <div>
                <span class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">Match signals</span>
                <div class="flex items-center gap-1">
                  <span class="w-6 text-right text-xs font-medium mr-3" class:text-(--pd-input-toggle-on-text)={dec.rules[0]?.operator !== 'AND'} class:opacity-40={dec.rules[0]?.operator === 'AND'}>OR</span>
                  <SlideToggle
                    id="rule-operator-{decIdx}"
                    aria-label="Toggle rule operator"
                    checked={dec.rules[0]?.operator === 'AND'}
                    on:checked={(): void => toggleRuleOperator(decIdx)} />
                  <span class="w-6 text-xs font-medium" class:text-(--pd-input-toggle-on-text)={dec.rules[0]?.operator === 'AND'} class:opacity-40={dec.rules[0]?.operator !== 'AND'}>AND</span>
                </div>
              </div>
              <div class="w-24">
                <span class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">Priority</span>
                <NumberInput
                  value={dec.priority}
                  oninput={(e: Event): void => updateDecisionField(decIdx, 'priority', Number((e.target as HTMLInputElement).value))}
                  minimum={1}
                  maximum={100}
                  type="integer"
                  aria-label="Decision priority" />
              </div>
            </div>

            <!-- Conditions -->
            <div class="pb-3">
              {#if keywordNames.length === 0}
                <p class="text-xs text-(--pd-content-card-text) opacity-50 italic">
                  Define keyword signals above first.
                </p>
              {:else}
                <div class="flex flex-col gap-1.5">
                  {#each keywordNames as sigName (sigName)}
                    {@const signal = keywords.find(k => k.name === sigName)}
                    <div class="flex items-center gap-2">
                      <Checkbox
                        class='ml-3'
                        checked={isConditionSelected(decIdx, sigName)}
                        title="Toggle signal {sigName}"
                        onclick={(): void => toggleCondition(decIdx, sigName)} />
                      <span class="text-xs font-medium text-(--pd-content-card-text)">{sigName}</span>
                      {#if signal}
                        <span class="text-[10px] text-(--pd-content-card-text) opacity-50">
                          {signal.keywords.length} keywords · {signal.operator}
                        </span>
                      {/if}
                    </div>
                  {/each}
                </div>
              {/if}
            </div>

            <!-- Target model -->
            <div class="pb-3">
              <span class="block text-xs font-semibold text-(--pd-modal-text) pb-1.5">Target model</span>
              {#if availableModels.length === 0}
                <p class="text-xs text-(--pd-content-card-text) opacity-50 italic">
                  No models available in the catalog.
                </p>
              {:else}
                <Dropdown
                  ariaLabel="Target model"
                  value={getSelectedModelLabel(decIdx)}
                  options={availableModels.map(m => ({ label: `${m.label} (${m.providerName})`, value: m.label }))}
                  onChange={(val: string): void => onSelectedModelChanged(decIdx, val)} />
              {/if}
            </div>

            <!-- Reasoning toggle -->
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <Checkbox
                checked={dec.rules[0]?.modelRefs[0]?.useReasoning ?? false}
                title="Enable reasoning mode"
                onclick={(): void => toggleReasoning(decIdx)} />
              <span class="text-xs text-(--pd-content-card-text)">Enable reasoning mode</span>
            </label>
          </div>
        {/each}
      </div>
    {/if}

    <div class="pt-3">
      <Button type="secondary" icon={faPlus} onclick={addDecision}>
        Add decision
      </Button>
    </div>
  </div>
</div>
