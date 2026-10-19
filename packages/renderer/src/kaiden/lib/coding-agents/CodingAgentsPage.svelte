<script lang="ts">
import { faTerminal } from '@fortawesome/free-solid-svg-icons';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import { agentInfos } from '/@/kaiden/stores/agents';
import IconImage from '/@/lib/appearance/IconImage.svelte';
import type { AgentInfo } from '/@api/agent-info';

import CodingAgentDetail from './CodingAgentDetail.svelte';

let activeAgentId: string | undefined = $state(undefined);

let activeAgent: AgentInfo | undefined = $derived($agentInfos.find(a => a.id === activeAgentId) ?? $agentInfos[0]);

$effect(() => {
  if ($agentInfos.length > 0 && (!activeAgentId || !$agentInfos.some(a => a.id === activeAgentId))) {
    activeAgentId = $agentInfos[0]?.id;
  }
});

function selectAgent(agentId: string): void {
  activeAgentId = agentId;
}

function getAgentSubtitle(agent: AgentInfo): string {
  return agent.tags?.join(' · ') ?? '';
}
</script>

<div class="flex flex-row w-full h-full">
  <nav
    class="z-1 w-leftsidebar min-w-leftsidebar flex flex-col transition-all duration-500 ease-in-out bg-(--pd-secondary-nav-bg) border-(--pd-global-nav-bg-border) border-r"
    aria-label="Coding agents">
    <div class="flex items-center">
      <div class="pt-4 px-3 mb-5">
        <p class="text-xl font-semibold text-(--pd-secondary-nav-header-text) border-l-4 border-transparent">
          Coding agents
        </p>
      </div>
    </div>
    <div class="h-full overflow-y-auto" style="margin-bottom:auto">
      {#each $agentInfos as agent (agent.id)}
        {@const isSelected = activeAgent?.id === agent.id}
        <button
          type="button"
          class="flex w-full px-3 py-2.5 items-center gap-3 cursor-pointer border-l-4 text-left
            {isSelected
              ? 'bg-(--pd-secondary-nav-selected-bg) border-(--pd-secondary-nav-selected-highlight) text-(--pd-secondary-nav-text-selected)'
              : 'border-(--pd-secondary-nav-bg) text-(--pd-secondary-nav-text) hover:text-(--pd-secondary-nav-text-hover) hover:bg-(--pd-secondary-nav-text-hover-bg)'}"
          aria-label={agent.name}
          onclick={selectAgent.bind(undefined, agent.id)}>
          <div class="shrink-0 w-6 h-6 flex items-center justify-center">
            <IconImage image={agent.icon?.logo ?? agent.icon?.icon} alt={agent.name} class="w-5 h-5">
              <Icon icon={faTerminal} size="lg" />
            </IconImage>
          </div>
          <div class="flex-1 min-w-0">
            <span class="text-sm font-medium truncate block">{agent.name}</span>
            {#if getAgentSubtitle(agent)}
              <span class="text-[10px] opacity-60 truncate block">{getAgentSubtitle(agent)}</span>
            {/if}
          </div>
        </button>
      {/each}
    </div>

    <div class="px-3 py-4 border-t border-(--pd-content-divider)">
      <p class="text-xs font-semibold text-(--pd-content-card-text) opacity-80 uppercase tracking-wide mb-2">About</p>
      <p class="text-[11px] text-(--pd-content-card-text) opacity-60 leading-relaxed">
        Pick an agent to configure its defaults for <strong class="text-(--pd-modal-text)">kdn</strong>.
        Session creation still chooses which agent a workspace uses.
      </p>
    </div>
  </nav>

  <div class="flex flex-col flex-1 min-w-0 h-full bg-(--pd-content-bg)">
    {#if activeAgent}
      {#key activeAgent.id}
      <CodingAgentDetail agentInfo={activeAgent} />
      {/key}
    {:else if $agentInfos.length === 0}
      <div class="flex items-center justify-center h-full">
        <div class="text-center text-(--pd-content-text)">
          <Icon icon={faTerminal} class="mb-3 opacity-40" size="2.5em" />
          <p class="text-sm">No coding agents registered</p>
          <p class="text-xs mt-1 opacity-60">Install an agent extension to see agents here</p>
        </div>
      </div>
    {/if}
  </div>
</div>
