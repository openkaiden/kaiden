<script lang="ts">
import { faFileImport } from '@fortawesome/free-solid-svg-icons/faFileImport';
import { Button, ErrorMessage, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { load } from 'js-yaml';

import FormPage from '/@/lib/ui/FormPage.svelte';
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SkillFileContent } from '/@api/skill/skill-info';

import SkillFolderCards from './SkillFolderCards.svelte';

let target = $state('');
let name = $state('');
let description = $state('');
let skillContent = $state('');

let creating = $state(false);
let error = $state<string | undefined>();
let dragging = $state(false);
let selectedFile = $state('');
let sourceFilePath = $state('');
let errorEl = $state<HTMLDivElement>();

$effect(() => {
  if (error && errorEl?.scrollIntoView) {
    errorEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
});

const isValid = $derived(
  target.length > 0 &&
    name.trim().length > 0 &&
    description.trim().length > 0 &&
    (sourceFilePath.length > 0 || skillContent.trim().length > 0),
);

async function create(): Promise<void> {
  if (creating || !isValid) return;

  creating = true;
  error = undefined;

  try {
    await window.createSkill(
      {
        name: name.trim(),
        description: description.trim(),
        content: skillContent.trim() || undefined,
        sourcePath: sourceFilePath || undefined,
      },
      target,
    );
    handleNavigation({ page: NavigationPage.SKILLS });
  } catch (err: unknown) {
    error = String(err);
  } finally {
    creating = false;
  }
}

function handleDragOver(e: DragEvent): void {
  e.preventDefault();
  dragging = true;
}

function handleDragLeave(): void {
  dragging = false;
}

function parseSkillContent(raw: string): SkillFileContent | undefined {
  const trimmed = raw.trimStart();
  const DELIMITER = '---';
  if (!trimmed.startsWith(DELIMITER)) return undefined;

  const endIndex = trimmed.indexOf(`\n${DELIMITER}`, DELIMITER.length);
  if (endIndex === -1) return undefined;

  const yamlBlock = trimmed.slice(DELIMITER.length + 1, endIndex);
  const parsed = load(yamlBlock);
  if (!parsed || typeof parsed !== 'object') return undefined;

  const metadata = parsed as { name?: string; description?: string };
  const body = trimmed.slice(endIndex + DELIMITER.length + 2).trim();
  return {
    name: metadata.name ?? '',
    description: metadata.description ?? '',
    content: body,
  };
}

function prefillFromParsed(parsed: SkillFileContent): void {
  if (parsed.name) name = parsed.name;
  if (parsed.description) description = parsed.description;
  if (parsed.content) skillContent = parsed.content;
}

async function handleDrop(e: DragEvent): Promise<void> {
  e.preventDefault();
  dragging = false;

  const file = e.dataTransfer?.files[0];
  if (!file) return;

  try {
    const raw = await file.text();

    const parsed = parseSkillContent(raw);
    if (parsed) {
      error = undefined;
      sourceFilePath = '';
      selectedFile = file.name;
      prefillFromParsed(parsed);
    } else {
      error = `No metadata found in ${file.name}. The file must contain YAML frontmatter (---).`;
    }
  } catch {
    error = 'Failed to read the dropped file.';
  }
}

async function handleBrowse(): Promise<void> {
  const result = await window.openDialog({
    title: 'Select a SKILL.md file',
    selectors: ['openFile'],
    filters: [{ name: 'Markdown', extensions: ['md'] }],
  });
  const selected = result?.[0];
  if (!selected) return;

  try {
    const parsed = await window.getSkillFileContent(selected);
    error = undefined;
    selectedFile = selected;
    sourceFilePath = selected;
    prefillFromParsed(parsed);
  } catch {
    const fileName = selected.split(/[/\\]/).pop() ?? selected;
    error = `No metadata found in ${fileName}. The file must contain YAML frontmatter (---).`;
  }
}

function cancel(): void {
  handleNavigation({ page: NavigationPage.SKILLS });
}
</script>

<FormPage title="Create Skill">
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
      <div class="bg-[var(--pd-content-card-bg)] py-6">
        <div class="flex flex-col px-6 max-w-4xl mx-auto gap-5">
          <div style:--card-selector-option-min-height="8rem">
            <SkillFolderCards bind:selected={target} />
          </div>

          {#if !selectedFile}
            <div>
              <button
                class="w-full cursor-pointer flex flex-col items-center px-4 py-8 border-2 border-dashed rounded-md transition-colors
                  bg-[var(--pd-content-card-inset-bg)]
                  {dragging
                    ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
                    : 'border-[var(--pd-content-card-border)] hover:border-[var(--pd-content-card-border-selected)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
                aria-label="Drop or click to select a SKILL.md file"
                onclick={handleBrowse}
                ondragover={handleDragOver}
                ondragleave={handleDragLeave}
                ondrop={handleDrop}>
                <Icon icon={faFileImport} class="text-[var(--pd-link)]" size="1.5x" />
                <span class="text-[var(--pd-content-text)]">
                  Drag & Drop or <strong class="text-[var(--pd-link)]">Choose file</strong> to import
                </span>
                <span class="opacity-50 text-sm text-[var(--pd-content-text)]">Supported formats: .md</span>
              </button>

              <div class="flex items-center gap-3 mt-5">
                <div class="flex-1 h-px bg-[var(--pd-content-divider)]"></div>
                <span class="text-sm text-[var(--pd-content-text)] opacity-60">or create manually</span>
                <div class="flex-1 h-px bg-[var(--pd-content-divider)]"></div>
              </div>
            </div>
          {:else}
            <div>
              <label for="skill-file-path" class="block mb-2 text-sm font-semibold text-[var(--pd-modal-text)]">
                File
              </label>
              <div class="flex flex-row gap-2 items-center">
                <Input id="skill-file-path" value={selectedFile} aria-label="Selected file" readonly class="grow" />
                <Button type="link" onclick={handleBrowse} aria-label="Change file">Change</Button>
              </div>
            </div>
          {/if}

          <div>
            <label for="skill-name" class="block mb-2 text-sm font-semibold text-[var(--pd-modal-text)]">Name</label>
            <Input
              id="skill-name"
              bind:value={name}
              placeholder="my-skill-name"
              aria-label="Skill name"
              required
              disabled={creating} />
          </div>

          <div>
            <label for="skill-description" class="block mb-2 text-sm font-semibold text-[var(--pd-modal-text)]">
              Description
            </label>
            <Input
              id="skill-description"
              bind:value={description}
              placeholder="A short description of the skill"
              aria-label="Skill description"
              required
              disabled={creating} />
          </div>

          <div>
            <label for="skill-content" class="block mb-2 text-sm font-semibold text-[var(--pd-modal-text)]">
              Content
            </label>
            <textarea
              id="skill-content"
              bind:value={skillContent}
              placeholder="Skill instructions in markdown..."
              aria-label="Skill content"
              class="w-full min-h-32 rounded-md border border-[var(--pd-content-card-border)] bg-[var(--pd-input-field-bg)]
                focus:bg-[var(--pd-input-field-focused-bg)] text-[var(--pd-content-text)] px-3 py-2 text-sm outline-none resize-y"
              disabled={creating}></textarea>
          </div>

          {#if error}
            <div bind:this={errorEl}>
              <ErrorMessage {error} />
            </div>
          {/if}

          <div class="flex items-center justify-end gap-3 pt-4 border-t border-[var(--pd-content-card-border)]">
            <Button type="link" onclick={cancel} disabled={creating}>Cancel</Button>
            <Button type="primary" inProgress={creating} disabled={!isValid || creating} onclick={create}>
              Create
            </Button>
          </div>
        </div>
      </div>
    </div>
  {/snippet}
</FormPage>
