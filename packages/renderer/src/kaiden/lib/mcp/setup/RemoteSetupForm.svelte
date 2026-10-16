<script lang="ts">
import { faPlug } from '@fortawesome/free-solid-svg-icons/faPlug';
import type { components } from '@openkaiden/mcp-registry-types';
import { Button } from '@podman-desktop/ui-svelte';
import { SvelteMap } from 'svelte/reactivity';

import FormSection from '/@/kaiden/lib/mcp/setup/FormSection.svelte';
import { createInputWithVariables } from '/@/kaiden/lib/mcp/setup/input-with-variable-response-utils';
import type { InputWithVariableResponse, MCPSetupRemoteOptions } from '/@api/mcp/mcp-setup';

interface Props {
  object: components['schemas']['SseTransport'] | components['schemas']['StreamableHttpTransport'];
  loading: boolean;
  remoteIndex: number;
  submit: (options: MCPSetupRemoteOptions) => Promise<void>;
  cancel: () => void;
}

let { object, remoteIndex, loading = $bindable(false), submit, cancel }: Props = $props();

/**
 * Let's build a map for all our expected headers with the default value selected
 */
let responses: Map<string, InputWithVariableResponse> = new SvelteMap(
  (object.headers ?? []).map(header => [header.name, createInputWithVariables(header)]),
);

async function connect(): Promise<void> {
  return submit({
    type: 'remote',
    index: remoteIndex,
    headers: Object.fromEntries(responses.entries()),
  });
}

function onHeaderChange(header: string, value: string): void {
  const existing = responses.get(header);
  if (!existing) throw new Error(`header ${header} is not recognised`);

  responses.set(header, {
    value: value,
    variables: existing.variables,
  });
}

function onHeaderVariableChange(header: string, variable: string, value: string): void {
  const existing = responses.get(header);
  if (!existing) throw new Error(`header ${header} is not recognised`);

  responses.set(header, {
    value: existing.value,
    variables: {
      ...existing.variables,
      [variable]: {
        value: value,
      },
    },
  });
}
</script>

<div class="flex flex-col gap-y-4">
  <!-- remote details -->
  <div class="bg-[var(--pd-content-bg)] rounded-md flex flex-col p-2 space-y-2">
    <label for="headers" class="text-xl font-bold text-[var(--pd-content-card-header-text)]">Remote MCP Definition</label>
    <span>Configure the remote Model Context Protocol server connection</span>

    <div class="grid grid-cols-2">
      <div class="flex flex-col">
        <label for="server-url" class="text-base font-bold text-[var(--pd-content-card-header-text)] mb-1">Server URL</label>
        <div class="flex items-center bg-[var(--pd-label-bg)] p-1 rounded-md text-sm text-[var(--pd-label-text)] gap-x-1 w-min px-2 py-1">
          {object.url}
        </div>
      </div>
      <div class="flex flex-col">
        {#if object.type}
          <label for="server-url" class="text-base font-bold text-[var(--pd-content-card-header-text)] mb-1">Type</label>
          <div class="flex items-center bg-[var(--pd-label-bg)] p-1 rounded-md text-sm text-[var(--pd-label-text)] gap-x-1 w-min  px-2 py-1">
            {object.type}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- headers -->
  {#if object.headers?.length}
    <FormSection
      title="Headers"
      description="Configure headers for authentication and other purposes"
      args={object.headers.map((argument) => ({...argument, key: argument.name }))}
      updateArgumentValue={onHeaderChange.bind(undefined)}
      updateArgumentVariableValue={onHeaderVariableChange.bind(undefined)}
    />
  {/if}
</div>

<div class="flex w-full justify-end gap-x-2">
  <Button type="secondary" onclick={cancel}>
    Cancel
  </Button>
  <Button
    class="w-auto"
    icon={faPlug}
    onclick={connect}
    inProgress={loading}>
    Connect
  </Button>
</div>

