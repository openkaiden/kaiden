<script lang="ts">
import { Button, Dropdown, ErrorMessage, Input } from '@podman-desktop/ui-svelte';

import { openshellGateways, openshellGatewaysReady } from '/@/kaiden/stores/openshell-gateways';
import FormPage from '/@/lib/ui/FormPage.svelte';
import PasswordInput from '/@/lib/ui/PasswordInput.svelte';
import { selectGateway } from '/@/lib/ui/select-gateway';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import { isUsableGateway, type OpenshellProfile } from '/@api/openshell-gateway-info';
import type { SecretCreateOptions } from '/@api/secret-info';

import SecretTypeSelector from './SecretTypeSelector.svelte';

let gateways = $derived($openshellGateways.filter(isUsableGateway));
let pickedGateway = $state<string>();
let gateway = $derived(selectGateway(gateways, pickedGateway));
// Placeholder first while nothing is selected, so the dropdown does not display a gateway that is not used.
let gatewayOptions = $derived([
  ...(gateway ? [] : [{ value: '', label: 'Select a gateway' }]),
  ...gateways.map(g => ({ value: g.name, label: `${g.name} — ${g.endpoint}` })),
]);

// Reading `gateway` is intentional: the selected secret type is reset when the gateway changes.
let selectedProfile = $derived.by((): OpenshellProfile | undefined => {
  gateway;
  return undefined;
});
let type = $derived(selectedProfile?.id ?? '');
let name = $state('');
let saving = $state(false);
let error = $state('');
let credentialValues = $state<Record<string, string>>({});

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
  if (!gateway) return false;
  if (!name.trim()) return false;
  if (!selectedProfile) return false;
  const creds = selectedProfile.credentials ?? [];
  return creds.filter(c => c.required).every(c => credentialValues[c.name]?.trim());
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

    await window.createSecret(options, gateway);
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

          {#if gateways.length > 1}
            <div>
              <label for="secret-gateway" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">Gateway</label>
              <Dropdown
                id="secret-gateway"
                name="secret-gateway"
                class="w-full"
                value={gateway}
                options={gatewayOptions}
                onChange={(value: string): void => {
                  pickedGateway = value;
                }} />
            </div>
          {/if}

          {#if gateway}
            {#key gateway}
              <svelte:boundary>
                <SecretTypeSelector
                  {gateway}
                  onSelect={(profile: OpenshellProfile | undefined): void => {
                    selectedProfile = profile;
                  }}
                />
                {#snippet pending()}
                  <p class="text-sm text-(--pd-content-card-text) opacity-70">Loading secret types…</p>
                {/snippet}
              </svelte:boundary>
            {/key}
          {:else if !$openshellGatewaysReady}
            <p class="text-sm text-(--pd-content-card-text) opacity-70">Loading secret types…</p>
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
