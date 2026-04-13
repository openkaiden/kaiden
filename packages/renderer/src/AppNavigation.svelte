<svelte:options runes={true} />

<script lang="ts">
import { onDestroy, onMount } from 'svelte';
import type { TinroRouteMeta } from 'tinro';

import { showChatWindow } from '/@/stores/chat-window';
import { NavigationPage } from '/@api/navigation-page';

import { AppearanceSettings } from '../../main/src/plugin/appearance-settings';
import { CommandRegistry } from './lib/CommandRegistry';
import NewContentOnDashboardBadge from './lib/dashboard/NewContentOnDashboardBadge.svelte';
import MessageIcon from './lib/images/MessageIcon.svelte';
import SettingsIcon from './lib/images/SettingsIcon.svelte';
import NavItem from './lib/ui/NavItem.svelte';
import NavRegistryEntry from './lib/ui/NavRegistryEntry.svelte';
import { handleNavigation } from './navigation';
import { onDidChangeConfiguration } from './stores/configurationProperties';
import { navigationRegistry } from './stores/navigation/navigation-registry';

interface Props {
  exitSettingsCallback: () => void;
  meta: TinroRouteMeta;
}
let { exitSettingsCallback, meta = $bindable() }: Props = $props();

let iconWithTitle = $state(false);

const iconSize = '22';
const NAV_BAR_LAYOUT = `${AppearanceSettings.SectionName}.${AppearanceSettings.NavigationAppearance}`;

onDidChangeConfiguration.addEventListener(NAV_BAR_LAYOUT, onDidChangeConfigurationCallback);

let minNavbarWidth = $derived(iconWithTitle ? 'min-w-fit' : 'min-w-leftnavbar');

onMount(async () => {
  const commandRegistry = new CommandRegistry();
  commandRegistry.init();
  iconWithTitle = (await window.getConfigurationValue(NAV_BAR_LAYOUT)) === AppearanceSettings.IconAndTitle;
});

onDestroy(() => {
  onDidChangeConfiguration.removeEventListener(NAV_BAR_LAYOUT, onDidChangeConfigurationCallback);
});

function handleClick(): void {
  if (meta.url.startsWith('/preferences')) {
    exitSettingsCallback();
  } else {
    handleNavigation({ page: NavigationPage.RESOURCES });
  }
}

function onDidChangeConfigurationCallback(e: Event): void {
  if ('detail' in e) {
    const detail = e.detail as { key: string; value: string };
    if (NAV_BAR_LAYOUT === detail?.key) {
      iconWithTitle = detail.value === AppearanceSettings.IconAndTitle;
    }
  }
}
</script>

<svelte:window />
<nav
  class="group w-leftnavbar {minNavbarWidth} flex flex-col hover:overflow-y-none bg-[var(--pd-global-nav-bg)] border-[var(--pd-global-nav-bg-border)] border-r-[1px]"
  aria-label="AppNavigation">
  {#if $showChatWindow}
  <NavItem href="/" tooltip="Chat" bind:meta={meta}>
    <div class="relative w-full">
      <div class="flex flex-col items-center w-full h-full">
        <div class="flex items-center w-fit h-full relative">
          <MessageIcon size={iconSize} />
          <NewContentOnDashboardBadge />
        </div>
        {#if iconWithTitle}
          <div class="text-xs text-center ml-[2px]" aria-label="Chat title">
            Chat
          </div>
        {/if}
      </div>
    </div>
  </NavItem>
  {/if}
  {#each $navigationRegistry as navigationRegistryItem, index (index)}
    {#if navigationRegistryItem.items && navigationRegistryItem.type === 'group'}
      <!-- This is a group, list all items from the entry -->
      {#each navigationRegistryItem.items as item, index (index)}
        <NavRegistryEntry entry={item} bind:meta={meta} iconWithTitle={iconWithTitle} />
      {/each}
    {:else if navigationRegistryItem.type === 'entry' || navigationRegistryItem.type === 'submenu'}
      <NavRegistryEntry entry={navigationRegistryItem} bind:meta={meta} iconWithTitle={iconWithTitle} />
    {/if}
  {/each}

  <div class="grow"></div>

  <NavItem href="/preferences" tooltip="Settings" bind:meta={meta} onClick={handleClick}>
    <SettingsIcon size={iconSize} />
    {#if iconWithTitle}
      <div class="text-xs text-center ml-[2px]" aria-label="Settings title">
        Settings
      </div>
    {/if}
  </NavItem>
</nav>
