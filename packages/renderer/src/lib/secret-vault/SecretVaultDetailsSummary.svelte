<script lang="ts">
import { getServiceLabel } from '/@/lib/secret-vault/secret-vault-utils';
import { agentWorkspaces } from '/@/stores/agent-workspaces.svelte';
import type { AgentWorkspaceConfiguration } from '/@api/agent-workspace-info';
import type { SecretVaultInfo } from '/@api/secret-vault/secret-vault-info';

interface Props {
  secretInfo: SecretVaultInfo | undefined;
}

let { secretInfo }: Props = $props();

interface UsedByEntry {
  id: string;
  name: string;
  kind: string;
}

let usedBy: UsedByEntry[] = $state([]);

function workspaceUsesSecret(config: AgentWorkspaceConfiguration, secretName: string): boolean {
  if (config.secrets?.includes(secretName)) return true;
  if (config.environment?.some(e => e.secret === secretName)) return true;
  return false;
}

$effect(() => {
  const name = secretInfo?.name;
  if (!name) {
    usedBy = [];
    return;
  }

  const workspaces = $agentWorkspaces;
  let current = true;

  Promise.all(
    workspaces.map(async ws => {
      try {
        const config = await window.getAgentWorkspaceConfiguration(ws.id);
        if (workspaceUsesSecret(config, name)) {
          return { id: ws.id, name: ws.name, kind: 'Workspace' } satisfies UsedByEntry;
        }
      } catch {
        // skip workspaces whose configuration cannot be read
      }
      return undefined;
    }),
  )
    .then(results => {
      if (current) {
        usedBy = results.filter((r): r is UsedByEntry => r !== undefined);
      }
    })
    .catch(() => {
      if (current) usedBy = [];
    });

  return (): void => {
    current = false;
  };
});

interface DetailField {
  label: string;
  value: string;
}

const detailFields: DetailField[] = $derived.by(() => {
  if (!secretInfo) return [];
  const fields: DetailField[] = [];

  if (secretInfo.type) {
    fields.push({ label: 'Type', value: getServiceLabel(secretInfo.type) });
  }
  if (secretInfo.description) {
    fields.push({ label: 'Description', value: secretInfo.description });
  }
  if (secretInfo.hosts?.length) {
    fields.push({ label: 'Hosts', value: secretInfo.hosts.join(', ') });
  }
  if (secretInfo.path) {
    fields.push({ label: 'Path', value: secretInfo.path });
  }
  if (secretInfo.header) {
    fields.push({ label: 'Header', value: secretInfo.header });
  }
  if (secretInfo.headerTemplate) {
    fields.push({ label: 'Header template', value: secretInfo.headerTemplate });
  }
  if (secretInfo.envs?.length) {
    fields.push({ label: 'Environment variables', value: secretInfo.envs.join(', ') });
  }
  return fields;
});
</script>

<div class="flex flex-col gap-5 px-5 py-5 overflow-auto" data-testid="secret-vault-details-summary">
  <!-- Details card -->
  {#if detailFields.length > 0}
    <div
      class="rounded-xl border border-(--pd-content-divider) bg-(--pd-content-card-inset-bg) p-6"
      data-testid="details-card">
      <h3 class="text-xs font-bold uppercase tracking-wider text-(--pd-content-card-text) opacity-50 mb-4">
        Details
      </h3>
      <div class="grid grid-cols-[160px_1fr] gap-y-3">
        {#each detailFields as field (field.label)}
          <span class="text-sm text-(--pd-content-card-text) opacity-60">{field.label}</span>
          <span class="text-sm text-(--pd-content-card-text)">{field.value}</span>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Used by card -->
  {#if usedBy.length > 0}
    <div
      class="rounded-xl border border-(--pd-content-divider) bg-(--pd-content-card-inset-bg) p-6"
      data-testid="used-by-card">
      <h3 class="text-xs font-bold uppercase tracking-wider text-(--pd-content-card-text) opacity-50 mb-4">
        Used By
      </h3>
      <div class="flex flex-col">
        {#each usedBy as entry, i (entry.id)}
          <div
            class="flex items-center justify-between py-3"
            class:border-t={i > 0}
            class:border-(--pd-content-divider)={i > 0}>
            <span class="text-sm font-medium text-(--pd-content-card-text)">{entry.name}</span>
            <span class="text-sm text-(--pd-content-card-text) opacity-50">{entry.kind}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>
