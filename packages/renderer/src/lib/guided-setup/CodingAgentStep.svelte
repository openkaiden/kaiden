<script lang="ts">
import { onMount, untrack } from 'svelte';

import type { CardSelectorOption } from '/@/lib/ui/CardSelector.svelte';
import CardSelector from '/@/lib/ui/CardSelector.svelte';

import { type AgentDefinition, agentDefinitions } from './agent-registry';
import type { CliAgent, GuidedSetupStepProps } from './guided-setup-steps';

let { title, description, onboarding }: GuidedSetupStepProps = $props();

let cliAgents: string[] | undefined = $state();

onMount(async () => {
  const fallback = agentDefinitions.map(d => d.cliName);
  try {
    const info = await window.getCliInfo();
    cliAgents = info.agents.length > 0 ? info.agents : fallback;
  } catch (err) {
    console.warn('Failed to fetch CLI agents, showing all registry entries', err);
    cliAgents = fallback;
  }
});

let filteredDefinitions = $derived.by(() => {
  if (!cliAgents) return agentDefinitions;
  const filtered = agentDefinitions.filter(d => cliAgents!.includes(d.cliName));
  return filtered.length > 0 ? filtered : agentDefinitions;
});

const definitionsByAgent = $derived(new Map<string, AgentDefinition>(filteredDefinitions.map(d => [d.cliName, d])));

const agentOptions: CardSelectorOption[] = $derived(
  filteredDefinitions.map(d => ({
    value: d.cliName,
    title: d.title,
    badge: d.badge,
    description: d.description,
    icon: d.icon,
  })),
);

let selectedAgent = $state(untrack(() => onboarding.agent));
let activeDefinition: AgentDefinition | undefined = $derived(definitionsByAgent.get(selectedAgent));

$effect(() => {
  if (definitionsByAgent.has(selectedAgent)) {
    onboarding.agent = selectedAgent as CliAgent;
  } else if (filteredDefinitions.length > 0) {
    selectedAgent = filteredDefinitions[0]!.cliName;
  }
});
</script>

<div class="mx-auto max-w-3xl py-4">
  <h2 class="text-xl font-semibold text-(--pd-content-card-text) mb-1">{title}</h2>
  <p class="text-sm text-(--pd-content-card-text) opacity-60 mb-6">
    {description}
  </p>

  <div class="mb-8">
    <CardSelector label="Coding agent" options={agentOptions} bind:selected={selectedAgent} required />
  </div>

  {#if activeDefinition?.panel}
    <activeDefinition.panel definition={activeDefinition} {onboarding} />
  {/if}
</div>
