<script lang="ts">
import { onMount, untrack } from 'svelte';

import type { CardSelectorOption } from '/@/lib/ui/CardSelector.svelte';
import CardSelector from '/@/lib/ui/CardSelector.svelte';

import { type AgentDefinition, agentDefinitions } from './agent-registry';
import type { CliAgent, GuidedSetupStepProps } from './guided-setup-steps';

let { title, description, onboarding }: GuidedSetupStepProps = $props();

let cliAgents: string[] | undefined = $state();

onMount(async () => {
  try {
    const info = await window.getCliInfo();
    cliAgents = info.agents;
  } catch (err) {
    console.warn('Failed to fetch CLI agents, showing all registry entries', err);
    cliAgents = agentDefinitions.map(d => d.cliName);
  }
});

let filteredDefinitions = $derived(
  cliAgents ? agentDefinitions.filter(d => cliAgents!.includes(d.cliName)) : agentDefinitions,
);

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
    <activeDefinition.panel />
  {/if}
</div>
