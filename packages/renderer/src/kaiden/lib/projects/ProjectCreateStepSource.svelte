<script lang="ts">
import { faFolderOpen } from '@fortawesome/free-solid-svg-icons';
import { Button, Input } from '@podman-desktop/ui-svelte';

interface Props {
  sourcePath: string;
  gitUrl: string;
  onBrowseSource: () => Promise<void>;
}

let { sourcePath = $bindable(), gitUrl = $bindable(), onBrowseSource }: Props = $props();
</script>

<h2 class="text-lg font-semibold text-(--pd-modal-text) mb-1">Source</h2>
<p class="text-sm text-(--pd-content-card-text) opacity-60 mb-5">
  Point Kaiden to a local working directory or a git repository, and we'll analyze your project automatically.
</p>

<div class="space-y-5">
  <div>
    <label for="project-source-path" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
      Local working directory
    </label>
    <div class="flex gap-2 items-stretch">
      <Input
        id="project-source-path"
        bind:value={sourcePath}
        placeholder="/home/user/dev/my-project"
        class="grow font-mono text-sm"
      />
      <Button onclick={onBrowseSource} aria-label="Browse for folder" icon={faFolderOpen}>
        Browse
      </Button>
    </div>
  </div>

  <div class="flex items-center gap-4">
    <div class="flex-1 h-px bg-(--pd-content-divider)"></div>
    <span class="text-xs font-medium text-(--pd-content-card-text) opacity-50 uppercase">OR</span>
    <div class="flex-1 h-px bg-(--pd-content-divider)"></div>
  </div>

  <div>
    <label for="project-git-url" class="block text-sm font-semibold text-(--pd-modal-text) mb-2">
      Git repository
    </label>
    <Input
      id="project-git-url"
      bind:value={gitUrl}
      placeholder="https://github.com/org/repo"
      class="w-full font-mono text-sm"
    />
  </div>
</div>
