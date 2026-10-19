<script lang="ts">
import { faDesktop, faNetworkWired, faTrash } from '@fortawesome/free-solid-svg-icons';
import type { InferenceProviderConnectionType } from '@openkaiden/api';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { SvelteSet } from 'svelte/reactivity';

import type { CatalogModelInfo } from '/@/kaiden/lib/models/models-utils';
import { catalogModels } from '/@/kaiden/stores/models';
import type { SemanticRouterInfo } from '/@api/semantic-router-info';

interface Props {
  routers: SemanticRouterInfo[];
}

let { routers }: Props = $props();

let providerTypeMap: Map<string, InferenceProviderConnectionType> = $derived(
  new Map($catalogModels.map((m: CatalogModelInfo) => [m.providerId, m.type])),
);

interface ModelRef {
  label: string;
  providerId: string;
  connectionId: string;
  type: InferenceProviderConnectionType;
  isDefault: boolean;
}

async function removeRouter(name: string): Promise<void> {
  try {
    await window.removeSemanticRouter(name);
  } catch (err: unknown) {
    console.error('Failed to remove semantic router', err);
  }
}

function getEndpoint(router: SemanticRouterInfo): string {
  const listener = router.listeners[0];
  if (!listener) return '';
  const addr = listener.address === '0.0.0.0' ? 'localhost' : listener.address;
  return listener.port > 0 ? `${addr}:${listener.port}` : addr;
}

function getBackendType(providerId: string): InferenceProviderConnectionType {
  return providerTypeMap.get(providerId) ?? 'cloud';
}

function isDefaultModel(
  router: SemanticRouterInfo,
  ref: { providerId: string; connectionId: string; label: string },
): boolean {
  const d = router.routing.defaultModelRef;
  return d?.providerId === ref.providerId && d?.connectionId === ref.connectionId && d?.label === ref.label;
}

function getUniqueModelRefs(router: SemanticRouterInfo): ModelRef[] {
  const seen = new SvelteSet<string>();
  const refs: ModelRef[] = [];
  for (const decision of router.routing.decisions) {
    for (const rule of decision.rules) {
      for (const ref of rule.modelRefs) {
        const key = `${ref.providerId}::${ref.connectionId}::${ref.label}`;
        if (!seen.has(key)) {
          seen.add(key);
          refs.push({
            label: ref.label,
            providerId: ref.providerId,
            connectionId: ref.connectionId,
            type: getBackendType(ref.providerId),
            isDefault: isDefaultModel(router, ref),
          });
        }
      }
    }
  }
  return refs;
}

function getKeywordGroupNames(router: SemanticRouterInfo): string[] {
  return router.routing.keywords.map(k => k.name);
}
</script>

<div class="grid gap-4 px-5 grid-cols-[repeat(auto-fill,minmax(320px,1fr))]" role="list" aria-label="Semantic Routers">
  {#each routers as router (router.name)}
    {@const endpoint = getEndpoint(router)}
    {@const modelRefs = getUniqueModelRefs(router)}
    {@const keywordGroups = getKeywordGroupNames(router)}

    <div
      class="flex flex-col rounded-xl border border-[var(--pd-content-card-border)] bg-[var(--pd-content-card-bg)] overflow-hidden transition-colors hover:bg-[var(--pd-content-card-hover-bg)]"
      role="listitem">
      <!-- Header -->
      <div class="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-[var(--pd-content-divider)]">
        <div class="w-9 h-9 rounded-lg bg-[color-mix(in_srgb,var(--pd-button-primary-bg)_12%,transparent)] border border-[color-mix(in_srgb,var(--pd-button-primary-bg)_25%,transparent)] grid place-items-center flex-shrink-0 text-[var(--pd-button-primary-bg)]">
          <Icon icon={faNetworkWired} size="lg" />
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold text-[var(--pd-content-card-header-text)] truncate">{router.name}</div>
          {#if endpoint}
            <div class="text-[11px] font-mono text-[var(--pd-state-info)]">{endpoint}</div>
          {/if}
        </div>
        <button
          class="w-7 h-7 rounded-md flex items-center justify-center text-[var(--pd-content-card-text)] opacity-50 hover:opacity-100 hover:text-[var(--pd-status-terminated)] hover:bg-[color-mix(in_srgb,var(--pd-status-terminated)_10%,transparent)] transition-all flex-shrink-0"
          aria-label={`Delete ${router.name}`}
          onclick={(): Promise<void> => removeRouter(router.name)}>
          <Icon icon={faTrash} />
        </button>
      </div>

      <!-- Flow diagram -->
      <div class="grid grid-cols-[auto_1fr_auto_1fr_auto] items-start gap-0 px-4 py-3 border-b border-[var(--pd-content-divider)]">
        <div class="flex flex-col items-center gap-1">
          <div class="grid place-items-center w-8 h-8 rounded-lg bg-[color-mix(in_srgb,var(--pd-state-info)_10%,transparent)] border border-[color-mix(in_srgb,var(--pd-state-info)_20%,transparent)] text-[var(--pd-state-info)]">
            <Icon icon={faDesktop} size="sm" />
          </div>
          <span class="text-[9px] font-bold uppercase tracking-wide text-[var(--pd-content-card-text)] opacity-50">Agents</span>
        </div>

        <div class="flex items-center h-8 px-1">
          <div class="flex-1 h-[1px] bg-[var(--pd-content-card-text)] opacity-30"></div>
          <div class="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-[color-mix(in_srgb,var(--pd-content-card-text)_40%,transparent)]"></div>
        </div>

        <div class="flex flex-col items-center gap-1">
          <div class="grid place-items-center w-8 h-8 rounded-lg bg-[color-mix(in_srgb,var(--pd-button-primary-bg)_18%,transparent)] border border-[color-mix(in_srgb,var(--pd-button-primary-bg)_35%,transparent)] text-[var(--pd-button-primary-bg)]">
            <Icon icon={faNetworkWired} size="sm" />
          </div>
          <span class="text-[9px] font-bold uppercase tracking-wide text-[var(--pd-content-card-text)] opacity-50">Router</span>
        </div>

        <div class="flex items-center h-8 px-1">
          <div class="flex-1 h-[1px] bg-[var(--pd-content-card-text)] opacity-30"></div>
          <div class="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-[color-mix(in_srgb,var(--pd-content-card-text)_40%,transparent)]"></div>
        </div>

        <div class="flex flex-col items-center gap-1">
          <div class="grid grid-flow-col auto-cols-auto gap-x-1 gap-y-[3px] items-center justify-center h-8 grid-rows-[repeat(3,auto)]">
            {#each modelRefs as ref (ref.providerId + '::' + ref.label)}
              <span
                class="w-2.5 h-2.5 rounded-full"
                class:bg-[var(--pd-status-running)]={ref.type === 'local'}
                class:bg-[var(--pd-state-info)]={ref.type === 'cloud'}
                class:bg-[var(--pd-state-warning)]={ref.type === 'self-hosted'}>
              </span>
            {/each}
          </div>
          <span class="text-[9px] font-bold uppercase tracking-wide text-[var(--pd-content-card-text)] opacity-50">Backends</span>
        </div>
      </div>

      <!-- Backend model list -->
      {#if modelRefs.length > 0}
        <div class="flex flex-col gap-1.5 px-4 py-3 border-b border-[var(--pd-content-divider)]">
          {#each modelRefs as ref (ref.providerId + '::' + ref.label)}
            <div class="flex items-center gap-2">
              <span
                class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                class:bg-[var(--pd-status-running)]={ref.type === 'local'}
                class:bg-[var(--pd-state-info)]={ref.type === 'cloud'}
                class:bg-[var(--pd-state-warning)]={ref.type === 'self-hosted'}>
              </span>
              <span class="text-xs font-mono text-[var(--pd-content-card-text)] truncate">{ref.label}</span>
              {#if ref.isDefault}
                <span class="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--pd-button-primary-bg)_12%,transparent)] text-[var(--pd-button-primary-bg)] border border-[color-mix(in_srgb,var(--pd-button-primary-bg)_25%,transparent)]">default</span>
              {/if}
              <span
                class="ml-auto text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full flex-shrink-0 border"
                class:bg-[color-mix(in_srgb,var(--pd-status-running)_10%,transparent)]={ref.type === 'local'}
                class:text-[var(--pd-status-running)]={ref.type === 'local'}
                class:border-[color-mix(in_srgb,var(--pd-status-running)_20%,transparent)]={ref.type === 'local'}
                class:bg-[color-mix(in_srgb,var(--pd-state-info)_10%,transparent)]={ref.type === 'cloud'}
                class:text-[var(--pd-state-info)]={ref.type === 'cloud'}
                class:border-[color-mix(in_srgb,var(--pd-state-info)_20%,transparent)]={ref.type === 'cloud'}
                class:bg-[color-mix(in_srgb,var(--pd-state-warning)_10%,transparent)]={ref.type === 'self-hosted'}
                class:text-[var(--pd-state-warning)]={ref.type === 'self-hosted'}
                class:border-[color-mix(in_srgb,var(--pd-state-warning)_20%,transparent)]={ref.type === 'self-hosted'}>
                {ref.type === 'self-hosted' ? 'in-house' : ref.type}
              </span>
            </div>
          {/each}
        </div>
      {/if}

      <!-- Feature badges (keyword groups) -->
      {#if keywordGroups.length > 0}
        <div class="flex flex-wrap gap-1.5 px-4 py-3">
          {#each keywordGroups as group (group)}
            <span class="text-[10px] px-2 py-0.5 rounded-full bg-[color-mix(in_srgb,var(--pd-state-info)_10%,transparent)] text-[var(--pd-state-info)] border border-[color-mix(in_srgb,var(--pd-state-info)_20%,transparent)]">
              {group}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
</div>
