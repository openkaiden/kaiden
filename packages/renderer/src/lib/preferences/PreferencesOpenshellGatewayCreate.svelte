<script lang="ts">
import { Button, Dropdown, ErrorMessage, Input, NumberInput } from '@podman-desktop/ui-svelte';
import { onMount, untrack } from 'svelte';

import Dialog from '/@/lib/dialogs/Dialog.svelte';
import { openshellGateways } from '/@/stores/openshell-gateways';
import { GATEWAY_NAME_PATTERN, KAIDEN_LOCAL_GATEWAY_NAME, type LocalGatewayDriver } from '/@api/openshell-gateway-info';

interface Props {
  existingNames: string[];
  initialDriver: LocalGatewayDriver;
  closeCallback: () => void;
}

let { existingNames, initialDriver, closeCallback }: Props = $props();

let isWindows = $state(false);
onMount(async () => {
  const platform = await window.getOsPlatform();
  isWindows = platform === 'win32';
});

let name = $state('local-gateway');
const bindAddress = '127.0.0.1';
let port = $state(17675);
let driver = $state<Exclude<LocalGatewayDriver, 'vm'>>(
  untrack(() => (initialDriver === 'vm' ? (isWindows ? 'mxc' : 'podman') : initialDriver)),
);
let creating = $state(false);
let error = $state('');
let checkingPort = $state(true);
let portAvailabilityError = $state('');

let nameError = $derived.by((): string => {
  if (!name.trim()) return 'Enter a gateway name';
  if (!GATEWAY_NAME_PATTERN.test(name.trim())) {
    return 'Use lowercase letters, numbers, dots, dashes, or underscores';
  }
  if (name.trim() === KAIDEN_LOCAL_GATEWAY_NAME) return `"${KAIDEN_LOCAL_GATEWAY_NAME}" is reserved by Kaiden`;
  if (existingNames.includes(name.trim())) return 'A gateway with this name already exists';
  return '';
});
let portError = $derived(
  !Number.isInteger(port) || port < 1024 || port > 65_535 ? 'Enter a port between 1024 and 65535' : '',
);
let canCreate = $derived(!nameError && !portError && !portAvailabilityError && !checkingPort && !creating);

$effect(() => {
  const selectedPort = port;
  if (!Number.isInteger(selectedPort) || selectedPort < 1024 || selectedPort > 65_535) {
    checkingPort = false;
    portAvailabilityError = '';
    return;
  }

  checkingPort = true;
  portAvailabilityError = '';
  window.isFreePort(selectedPort).then(
    () => {
      if (port === selectedPort) checkingPort = false;
    },
    () => {
      if (port === selectedPort) {
        checkingPort = false;
        portAvailabilityError = `Port ${selectedPort} is already in use`;
      }
    },
  );
});

async function createGateway(): Promise<void> {
  if (!canCreate) return;
  creating = true;
  error = '';
  try {
    openshellGateways.set(
      await window.createLocalGateway({
        name: name.trim(),
        bindAddress,
        port,
        driver,
      }),
    );
    closeCallback();
  } catch (cause: unknown) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    creating = false;
  }
}
</script>

<Dialog title="Create local gateway" onclose={closeCallback}>
  {#snippet content()}
    <div class="w-[32rem] max-w-full">
      <label class="block mb-2 text-sm font-semibold">
        <span class="block mb-2">Driver</span>
        <Dropdown name="gateway-driver" class="w-full" bind:value={driver}>
          <option value="podman">Podman</option>
          <option value="docker">Docker</option>
          {#if isWindows}
            <option value="mxc">MXC</option>
          {/if}
        </Dropdown>
      </label>

      <label for="gateway-name" class="block mt-3 mb-2 text-sm font-semibold">Name</label>
      <Input id="gateway-name" aria-label="Gateway name" bind:value={name} aria-invalid={nameError !== ''} />
      {#if nameError}<ErrorMessage error={nameError} />{/if}

      <label for="gateway-bind-address" class="block mt-3 mb-2 text-sm font-semibold">Bind address</label>
      <Input id="gateway-bind-address" aria-label="Gateway bind address" value={bindAddress} disabled />

      <label class="block mt-3 mb-2 text-sm font-semibold">
        <span class="block mb-2">Port</span>
        <NumberInput
          name="gateway-port"
          aria-label="Gateway port"
          bind:value={port}
          minimum={1024}
          maximum={65535}
          type="integer"
          showError={false} />
      </label>
      {#if portError}<ErrorMessage error={portError} />{/if}
      {#if portAvailabilityError}<ErrorMessage error={portAvailabilityError} />{/if}
    </div>
  {/snippet}

  {#snippet validation()}
    {#if error}<ErrorMessage error={error} />{/if}
  {/snippet}

  {#snippet buttons()}
    <Button type="secondary" onclick={closeCallback} disabled={creating}>Cancel</Button>
    <Button onclick={createGateway} disabled={!canCreate}>{creating ? 'Creating…' : 'Create'}</Button>
  {/snippet}
</Dialog>
