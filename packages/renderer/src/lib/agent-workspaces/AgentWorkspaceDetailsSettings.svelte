<script lang="ts">
import { SettingsNavItem } from '@podman-desktop/ui-svelte';
import { router } from 'tinro';

type SettingsSection = 'general' | 'skills' | 'mcp' | 'knowledge' | 'file-access' | 'network' | 'advanced';

interface SectionConfig {
  id: SettingsSection;
  label: string;
}

const sections: SectionConfig[] = [
  { id: 'general', label: 'General' },
  { id: 'skills', label: 'Agent Skills' },
  { id: 'mcp', label: 'MCP Servers' },
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'file-access', label: 'File Access' },
  { id: 'network', label: 'Network' },
  { id: 'advanced', label: 'Advanced' },
];

let activeSection: SettingsSection = $state('general');
const activeLabel = $derived(sections.find(s => s.id === activeSection)?.label ?? '');
</script>

<div class="flex flex-row w-full h-full">
  <nav
    class="z-1 w-leftsidebar min-w-leftsidebar flex flex-col bg-[var(--pd-secondary-nav-bg)] border-[var(--pd-global-nav-bg-border)] border-r-[1px]"
    aria-label="Settings sections">
    <div class="pt-4 px-3 mb-5">
      <p class="text-xl font-semibold text-[color:var(--pd-secondary-nav-header-text)] border-l-[4px] border-transparent">
        Settings
      </p>
    </div>
    <div class="h-full overflow-y-auto" style="margin-bottom:auto">
      {#each sections as section (section.id)}
        <SettingsNavItem
          title={section.label}
          href={$router.path}
          selected={activeSection === section.id}
          onClick={(): void => {
            activeSection = section.id;
          }} />
      {/each}
    </div>
  </nav>

  <div class="flex flex-col flex-1 min-w-0 h-full bg-[var(--pd-content-bg)]">
    <div class="p-8 overflow-auto h-full">
      <div class="max-w-[800px]">
        <h2 class="text-xl font-semibold text-[var(--pd-content-header)] mb-2">{activeLabel}</h2>
        <p class="text-sm text-[var(--pd-content-text)] mb-7">
          Configure {activeLabel.toLowerCase()} settings for this workspace.
        </p>
        <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-card-border)] rounded-lg p-6">
          <p class="text-sm text-[var(--pd-content-text)] opacity-60">
            {activeLabel} settings will be available in a future update.
          </p>
        </div>
      </div>
    </div>
  </div>
</div>
