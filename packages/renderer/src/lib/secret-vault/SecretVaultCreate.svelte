<script lang="ts">
import { faGithub } from '@fortawesome/free-brands-svg-icons';
import { faChevronDown, faChevronUp, faGear, faKey } from '@fortawesome/free-solid-svg-icons';
import { Button, ErrorMessage, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';

import CardSelector from '/@/lib/ui/CardSelector.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import PasswordInput from '/@/lib/ui/PasswordInput.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SecretCreateOptions } from '/@api/secret-info';

interface TypeMeta {
  title: string;
  subtitle: string;
}

const TYPE_META: Record<string, TypeMeta> = {
  github: {
    title: 'GitHub Secret',
    subtitle: 'Store a GitHub personal access token. Automatically injected as a Bearer token for api.github.com.',
  },
  gemini: {
    title: 'Gemini Secret',
    subtitle: 'Store a Gemini API key. Automatically injected for Google AI endpoints.',
  },
  other: {
    title: 'Other Secret',
    subtitle: 'Configure a custom secret to inject as a header into matching requests.',
  },
};

const typeOptions = [
  {
    title: 'GitHub',
    badge: 'GitHub',
    value: 'github',
    icon: faGithub,
    description: 'Personal access token for GitHub API',
  },
  {
    title: 'Gemini',
    badge: 'Gemini',
    value: 'gemini',
    icon: faKey,
    description: 'API key for Google Gemini',
  },
  {
    title: 'Other',
    badge: 'Custom',
    value: 'other',
    icon: faKey,
    description: 'Custom secret with configurable injection',
  },
];

let type = $state('other');
let name = $state('');
let secret = $state('');
let hostPattern = $state('');
let pathPattern = $state('');
let headerName = $state('');
let valueFormat = $state('');
let injectionOpen = $state(true);
let saving = $state(false);
let error = $state('');

let effectiveType = $derived(type || 'other');
let meta = $derived(TYPE_META[effectiveType] ?? TYPE_META.other);
let isGeneric = $derived(effectiveType === 'other');

let canSave = $derived.by(() => {
  if (!name.trim() || !secret.trim()) return false;
  if (isGeneric && (!hostPattern.trim() || !headerName.trim())) return false;
  return true;
});

function cancel(): void {
  handleNavigation({ page: NavigationPage.SECRET_VAULT });
}

function toggleInjection(): void {
  injectionOpen = !injectionOpen;
}

async function addSecret(): Promise<void> {
  if (!canSave) return;
  saving = true;
  error = '';
  try {
    const options: SecretCreateOptions = {
      name: name.trim(),
      type: effectiveType,
      value: secret,
    };

    if (isGeneric) {
      options.hosts = [hostPattern.trim()];
      options.header = headerName.trim();
      if (pathPattern.trim()) {
        options.path = pathPattern.trim();
      }
      if (valueFormat.trim()) {
        options.headerTemplate = valueFormat.trim().replaceAll('{value}', '${value}');
      }
    }

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

          <CardSelector
            label="Secret type"
            options={typeOptions}
            bind:selected={type}
          />

          <div>
            <h1 class="text-2xl font-bold text-(--pd-modal-text)">{meta.title}</h1>
            <p class="text-sm text-(--pd-content-card-text) opacity-70 mt-2">{meta.subtitle}</p>
          </div>

          <div>
            <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">Name</span>
            <Input bind:value={name} placeholder="e.g. GitHub Token" aria-label="Name" />
          </div>

          <div>
            <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">Secret value</span>
            <PasswordInput
              bind:password={secret}
              placeholder="Enter secret value"
              aria-label="Secret value"
            />
            <p class="text-xs text-(--pd-content-card-text) opacity-60 mt-1.5">
              Encrypted at rest. You won't be able to view this value again.
            </p>
          </div>

          {#if isGeneric}
            <div>
              <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">Host pattern</span>
              <Input bind:value={hostPattern} placeholder="e.g. api.example.com or *.example.com" aria-label="Host pattern" />
              <p class="text-xs text-(--pd-content-card-text) opacity-60 mt-1.5">
                The host this secret applies to. Use *.example.com for wildcard subdomains.
              </p>
            </div>

            <div class="rounded-lg border border-(--pd-content-card-border) overflow-hidden">
              <button
                class="w-full flex items-center gap-3 px-4 py-3 bg-(--pd-content-card-inset-bg)
                  hover:bg-(--pd-content-card-hover-inset-bg) cursor-pointer"
                aria-expanded={injectionOpen}
                aria-controls="injection-settings"
                onclick={toggleInjection}
              >
                <Icon icon={faGear} size="sm" />
                <span class="text-sm font-semibold text-(--pd-modal-text) flex-1 text-left">Injection settings</span>
                <Icon icon={injectionOpen ? faChevronUp : faChevronDown} size="sm" />
              </button>

              {#if injectionOpen}
                <div id="injection-settings" class="px-4 pb-4 pt-2 space-y-4 bg-(--pd-content-card-inset-bg)">
                  <div>
                    <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                      Path pattern
                      <span class="font-normal text-(--pd-content-card-text) opacity-60">(optional)</span>
                    </span>
                    <Input bind:value={pathPattern} placeholder="e.g. /v1/*" aria-label="Path pattern" />
                  </div>

                  <div>
                    <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">Header name</span>
                    <Input bind:value={headerName} placeholder="Authorization" aria-label="Header name" />
                  </div>

                  <div>
                    <span class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
                      Value format
                      <span class="font-normal text-(--pd-content-card-text) opacity-60">(optional)</span>
                    </span>
                    <Input bind:value={valueFormat} placeholder="Bearer {'{value}'}" aria-label="Value format" />
                    <p class="text-xs text-(--pd-content-card-text) opacity-60 mt-1.5">
                      Use {'{value}'} as a placeholder for the secret. Defaults to the raw value.
                    </p>
                  </div>
                </div>
              {/if}
            </div>
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
