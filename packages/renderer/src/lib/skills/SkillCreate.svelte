<script lang="ts">
import { faFileImport } from '@fortawesome/free-solid-svg-icons/faFileImport';
import { Button, ErrorMessage, Input } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { load } from 'js-yaml';

import Dialog from '/@/lib/dialogs/Dialog.svelte';
import type { SkillFileContent } from '/@api/skill/skill-info';

import SkillFolderCards from './SkillFolderCards.svelte';

interface Props {
  onclose: () => void;
}

let { onclose }: Props = $props();

let target = $state('');
let name = $state('');
let description = $state('');
let skillContent = $state('');

let creating = $state(false);
let error = $state<string | undefined>();
let dragging = $state(false);
let selectedFile = $state('');

const isValid = $derived(
  target.length > 0 && name.trim().length > 0 && description.trim().length > 0 && skillContent.trim().length > 0,
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
        sourcePath: selectedFile || undefined,
      },
      target,
    );
    onclose();
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
    selectedFile = file.name;

    const parsed = parseSkillContent(raw);
    if (parsed) {
      prefillFromParsed(parsed);
    } else {
      skillContent = raw;
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

  selectedFile = selected;

  try {
    const parsed = await window.getSkillFileContent(selected);
    prefillFromParsed(parsed);
  } catch {
    skillContent = '';
  }
}
</script>

<Dialog title="Create Skill" onclose={onclose}>
  {#snippet content()}
    <div class="w-full">
      <SkillFolderCards bind:selected={target} />

      {#if !selectedFile}
        <button
          class="mt-2 w-full cursor-pointer flex flex-col items-center px-4 py-8 border-2 border-dashed rounded-md transition-colors
            bg-[var(--pd-content-card-inset-bg)]
            {dragging
              ? 'border-[var(--pd-content-card-border-selected)] bg-[var(--pd-content-card-hover-inset-bg)]'
              : 'border-gray-600 hover:border-[var(--pd-content-card-border-selected)] hover:bg-[var(--pd-content-card-hover-inset-bg)]'}"
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

        <div class="flex items-center gap-3 my-3">
          <div class="flex-1 h-px bg-[var(--pd-content-divider)]"></div>
          <span class="text-sm text-[var(--pd-content-text)] opacity-60">or create manually</span>
          <div class="flex-1 h-px bg-[var(--pd-content-divider)]"></div>
        </div>
      {:else}
        <div class="mt-2">
          <label for="skill-file-path" class="block my-2 text-sm font-bold text-[var(--pd-modal-text)]">File</label>
          <div class="flex flex-row gap-2 items-center">
            <Input id="skill-file-path" value={selectedFile} aria-label="Selected file" readonly class="grow" />
            <Button type="link" onclick={handleBrowse} aria-label="Change file">Change</Button>
          </div>
        </div>
      {/if}

      <label for="skill-name" class="block my-2 text-sm font-bold text-[var(--pd-modal-text)]">Name</label>
      <Input
        id="skill-name"
        bind:value={name}
        placeholder="my-skill-name"
        aria-label="Skill name"
        required
        disabled={creating} />

      <label for="skill-description" class="block my-2 text-sm font-bold text-[var(--pd-modal-text)]">Description</label>
      <Input
        id="skill-description"
        bind:value={description}
        placeholder="A short description of the skill"
        aria-label="Skill description"
        required
        disabled={creating} />

      <label for="skill-content" class="block my-2 text-sm font-bold text-[var(--pd-modal-text)]">Content</label>
      <textarea
        id="skill-content"
        bind:value={skillContent}
        placeholder="Skill instructions in markdown..."
        aria-label="Skill content"
        class="w-full min-h-[80px] rounded-md border border-[var(--pd-content-card-border)] bg-[var(--pd-input-field-bg)]
          focus:bg-[var(--pd-input-field-focused-bg)] text-[var(--pd-content-text)] px-3 py-2 text-sm outline-none resize-y"
        rows="4"
        disabled={creating}></textarea>
      {#if error}
        <ErrorMessage {error} />
      {/if}
    </div>
  {/snippet}

  {#snippet buttons()}
    <Button type="link" onclick={onclose} disabled={creating}>Cancel</Button>
    <Button type="primary" inProgress={creating} disabled={!isValid || creating} onclick={create}>
      Create
    </Button>
  {/snippet}
</Dialog>
