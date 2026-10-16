<script lang="ts">
import { Button, ErrorMessage, Input } from '@podman-desktop/ui-svelte';
import { onMount } from 'svelte';

import type { CardSelectorOption } from '/@/lib/ui/CardSelector.svelte';
import CardSelector from '/@/lib/ui/CardSelector.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import PasswordInput from '/@/lib/ui/PasswordInput.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { OpenshellProfile } from '/@api/openshell-gateway-info';
import type { SecretCreateOptions } from '/@api/secret-info';

import { getServiceIcon } from './secret-vault-utils';

let services = $state<OpenshellProfile[]>([]);
let loading = $state(true);

let type = $state('');
let name = $state('');
let saving = $state(false);
let error = $state('');
let credentialValues = $state<Record<string, string>>({});

let serviceMap = $derived(new Map(services.map(s => [s.id, s])));

let typeOptions = $derived<CardSelectorOption[]>(
  services.map(s => ({
    title: s.display_name,
    badge: s.display_name,
    value: s.id,
    icon: getServiceIcon(s.id),
  })),
);

let selectedProfile = $derived(serviceMap.get(type));

$effect(() => {
  type;
  credentialValues = {};
});

function formatCredentialLabel(credName: string): string {
  return credName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatCredentialPlaceholder(credName: string): string {
  return `Enter ${credName.replace(/_/g, ' ')}`;
}

let title = $derived(selectedProfile ? `${selectedProfile.display_name} Secret` : 'Secret');
let subtitle = $derived(selectedProfile?.description ?? '');

let canSave = $derived.by(() => {
  if (loading) return false;
  if (!name.trim()) return false;
  if (!selectedProfile) return false;
  const creds = selectedProfile.credentials ?? [];
  return creds.filter(c => c.required).every(c => credentialValues[c.name]?.trim());
});

onMount(async () => {
  try {
    services = (await window.listSecretServices()).filter(s => s.credentials?.length);
  } catch (err: unknown) {
    console.error('Failed to load secret services', err);
  } finally {
    loading = false;
  }
});

function cancel(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT });
}

async function addSecret(): Promise<void> {
  if (!canSave) return;
  saving = true;
  error = '';
  try {
    const creds = selectedProfile?.credentials ?? [];
    const value = {
      credentials: Object.fromEntries(
        creds
          .filter(c => credentialValues[c.name]?.trim())
          .flatMap(c => {
            const val = credentialValues[c.name]!.trim();
            const keys = c.env_vars?.length ? c.env_vars : [c.name];
            return keys.map(k => [k, val]);
          }),
      ),
    };

    const options: SecretCreateOptions = {
      name: name.trim(),
      type,
      value,
    };

    await window.createSecret(options);
    handleNavigation({ page: NavigationPage.SECRET_VAULT });
  } catch (err: unknown) {
    error = err instanceof Error ? err.message : String(err);
  } finally {
    saving = false;
  }
}
</script>

<FormPage title="Add Secret">
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
      <div class="bg-(--pd-content-card-bg) py-6">
        <div class="flex flex-col px-6 max-w-4xl mx-auto space-y-5">

          {#if loading}
            <p class="text-sm text-(--pd-content-card-text) opacity-70">Loading secret types…</p>
          {:else}
            <CardSelector
              label="Secret type"
              options={typeOptions}
              bind:selected={type}
              required
            />
          {/if}

          <div>
            <h1 class="text-2xl font-bold text-(--pd-modal-text)">{title}</h1>
            <p class="text-sm text-(--pd-content-card-text) opacity-70 mt-2">{subtitle}</p>
          </div>

          <div>
            <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">Name</span>
            <Input bind:value={name} placeholder="e.g. GitHub Token" aria-label="Name" />
          </div>

          {#if selectedProfile?.credentials}
            {#each selectedProfile.credentials as credential (credential.name)}
              <div>
                <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                  {formatCredentialLabel(credential.name)} {#if credential.description}({credential.description}){/if}
                  {#if !credential.required}
                    <span class="font-normal text-(--pd-content-card-text) opacity-60">(optional)</span>
                  {/if}
                </span>
                <PasswordInput
                  bind:password={credentialValues[credential.name]}
                  placeholder={formatCredentialPlaceholder(credential.name)}
                  aria-label={formatCredentialLabel(credential.name)}
                />
              </div>
            {/each}
          {/if}

          {#if error}
            <ErrorMessage error={error} />
          {/if}

          <div class="flex items-center justify-end gap-3 pt-4 border-t border-(--pd-content-card-border)">
            <Button onclick={cancel}>Cancel</Button>
            <Button disabled={!canSave || saving} onclick={addSecret}>
              {saving ? 'Adding...' : 'Add Secret'}
            </Button>
          </div>

        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
