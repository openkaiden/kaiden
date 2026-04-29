<script lang="ts">
import { Button, Tab } from '@podman-desktop/ui-svelte';
import { Icon } from '@podman-desktop/ui-svelte/icons';
import { router } from 'tinro';

import { withConfirmation } from '/@/lib/dialogs/messagebox-utils';
import { getChunkProviderName, getDatabaseName } from '/@/lib/rag/rag-environment-utils.svelte';
import DetailsPage from '/@/lib/ui/DetailsPage.svelte';
import { getTabUrl, isTabSelected } from '/@/lib/ui/Util';
import Route from '/@/Route.svelte';
import { chunkProviders } from '/@/stores/chunk-providers';
import { providerInfos } from '/@/stores/providers';
import { ragEnvironments } from '/@/stores/rag-environments';

import RAGEnvironmentActions from './columns/RAGEnvironmentActions.svelte';

interface Props {
  name: string;
}
let { name }: Props = $props();

const ragEnvironment = $derived($ragEnvironments.find(env => env.name === decodeURIComponent(name)));

const files = $derived.by(() => {
  if (!ragEnvironment) return [];

  return ragEnvironment.files;
});

const databaseName = $derived(getDatabaseName($providerInfos, ragEnvironment));
const chunkProviderName = $derived(getChunkProviderName($chunkProviders, ragEnvironment));

async function handleAddFile(): Promise<void> {
  if (!ragEnvironment) return;

  try {
    const selectedFiles = await window.openDialog({
      title: 'Select file to add to knowledge database',
      selectors: ['openFile'],
      filters: [
        {
          name: 'Normal text file',
          extensions: ['txt'],
        },
        {
          name: 'Markdown',
          extensions: ['md', 'markdown'],
        },
        {
          name: 'Hyper Text Markup Language',
          extensions: ['htm', 'html', 'shtm', 'shtml', 'xht', 'xhtml', 'hta'],
        },
        {
          name: 'Adobe PDF',
          extensions: ['pdf'],
        },
      ],
    });

    if (selectedFiles && selectedFiles.length > 0) {
      const filePath = selectedFiles[0];
      const result = await window.addFileToPendingFiles(ragEnvironment.name, filePath);

      if (!result) {
        window
          .showMessageBox({ title: 'Error', message: 'Error indexing file in knowledge database' })
          .catch(console.error);
      }
    }
  } catch (error: unknown) {
    window
      .showMessageBox({ title: 'Error', message: 'Error indexing file in knowledge database', detail: String(error) })
      .catch(console.error);
  }
}

async function handleRemoveFile(filePath: string): Promise<void> {
  if (!ragEnvironment) return;

  withConfirmation(async () => {
    try {
      const result = await window.removeFileFromEnvironment(ragEnvironment.name, filePath);

      if (!result) {
        window
          .showMessageBox({ title: 'Error', message: 'Error removing file from knowledge database' })
          .catch(console.error);
      }
    } catch (error: unknown) {
      window
        .showMessageBox({
          title: 'Error',
          message: 'Error removing file from knowledge database',
          detail: String(error),
        })
        .catch(console.error);
    }
  }, `remove file from environment ${ragEnvironment.name}`);
}
</script>

<DetailsPage title={ragEnvironment?.name ?? ''}>
  {#snippet tabsSnippet()}
    <Tab title="Summary" selected={isTabSelected($router.path, 'summary')} url={getTabUrl($router.path, 'summary')} />
    <Tab title="Sources" selected={isTabSelected($router.path, 'sources')} url={getTabUrl($router.path, 'sources')} />
    <Tab title="VectorStore" selected={isTabSelected($router.path, 'vectorstore')} url={getTabUrl($router.path, 'vectorstore')} />
    <Tab title="Chunker" selected={isTabSelected($router.path, 'chunker')} url={getTabUrl($router.path, 'chunker')} />
  {/snippet}
  {#snippet actionsSnippet()}
    {#if ragEnvironment}
      <RAGEnvironmentActions object={ragEnvironment} />
    {/if}
  {/snippet}
  {#snippet contentSnippet()}
    <Route path="/summary" breadcrumb="Summary" navigationHint="tab">
      {#if ragEnvironment}
        <div class="flex flex-col px-5 py-4 gap-4">
          <div class="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
            <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-divider)] rounded-lg p-5">
              <h3 class="text-sm font-semibold text-[var(--pd-content-text-secondary)] mb-4 uppercase tracking-wider">General Information</h3>
              <div class="flex justify-between py-3" aria-label="Name">
                <span class="text-sm text-[var(--pd-content-text-secondary)]">Name</span>
                <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{ragEnvironment.name}</span>
              </div>
            </div>

            <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-divider)] rounded-lg p-5">
              <h3 class="text-sm font-semibold text-[var(--pd-content-text-secondary)] mb-4 uppercase tracking-wider">Configuration</h3>
              <div class="flex justify-between py-3 border-b border-[var(--pd-content-divider)]" aria-label="Vector Store">
                <span class="text-sm text-[var(--pd-content-text-secondary)]">Vector Store</span>
                <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{databaseName}</span>
              </div>
              <div class="flex justify-between py-3 border-b border-[var(--pd-content-divider)]" aria-label="Embedding Model">
                <span class="text-sm text-[var(--pd-content-text-secondary)]">Embedding Model</span>
                <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{chunkProviderName}</span>
              </div>
              <div class="flex justify-between py-3" aria-label="Source Files">
                <span class="text-sm text-[var(--pd-content-text-secondary)]">Source Files</span>
                <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{files.length} files</span>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-sm text-[var(--pd-content-text-secondary)]">Knowledge database not found.</div>
        </div>
      {/if}
    </Route>
    <Route path="/sources" breadcrumb="Sources" navigationHint="tab">
      {#if ragEnvironment}
        <div class="flex flex-col px-5 py-4 gap-4">
          <button
            onclick={handleAddFile}
            class="flex flex-col items-center border-2 border-dashed border-[var(--pd-content-divider)] rounded-lg py-8 px-6 text-center hover:border-[var(--pd-button-primary)] hover:bg-[color-mix(in_srgb,var(--pd-button-primary)_5%,transparent)] transition-all duration-200 bg-transparent cursor-pointer"
          >
            <Icon icon="fas fa-upload" class="fa-2x text-[var(--pd-content-text-secondary)] mb-3"/>
            <div class="text-base text-[var(--pd-content-text)] mb-1">Click to upload</div>
            <div class="text-sm text-[var(--pd-content-text-secondary)]">Supports PDF, TXT, MD, and more</div>
          </button>

          <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-divider)] rounded-lg overflow-hidden">
            <div class="px-5 py-4 border-b border-[var(--pd-content-divider)] bg-[var(--pd-content-card-inset-bg)]">
              <h3 class="text-base font-semibold text-[var(--pd-content-text)]">Uploaded Files ({files.length})</h3>
            </div>

            {#if files.length > 0}
              {#each files as file (file.path)}
                <div class="flex items-center justify-between px-5 py-4 border-b border-[var(--pd-content-divider)] last:border-b-0 hover:bg-[var(--pd-content-card-inset-bg)] transition-colors duration-200" aria-label="source file">
                  <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-[var(--pd-content-card-inset-bg)] rounded-md flex items-center justify-center text-[var(--pd-content-text-secondary)]">
                      <Icon icon="fas fa-file" class="fa-2x"/>
                    </div>
                    <div>
                      <h4 class="text-sm font-medium text-[var(--pd-content-text)] m-0 mb-1">{file.path.split('/').pop() ?? file.path}</h4>
                      <div class="text-xs text-[var(--pd-content-text-secondary)]">{file.status}</div>
                    </div>
                  </div>
                  <Button
                    onclick={handleRemoveFile.bind(undefined, file.path)}
                    type="link"
                    aria-label="Remove file"
                    title="Remove file from knowledge database"
                    icon="fas fa-trash"
                  >
                  </Button>
                </div>
              {/each}
            {:else}
              <div class="flex items-center justify-center py-12">
                <div class="text-sm text-[var(--pd-content-text-secondary)]">No files in this knowledge database.</div>
              </div>
            {/if}
          </div>
        </div>
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-sm text-[var(--pd-content-text-secondary)]">Knowledge database not found.</div>
        </div>
      {/if}
    </Route>
    <Route path="/vectorstore" breadcrumb="VectorStore" navigationHint="tab">
      {#if ragEnvironment}
        <div class="flex flex-col px-5 py-4">
          <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-divider)] rounded-lg p-5 max-w-2xl">
            <h3 class="text-sm font-semibold text-[var(--pd-content-text-secondary)] mb-4 uppercase tracking-wider">{databaseName} Configuration</h3>
            <div class="flex justify-between py-3 border-b border-[var(--pd-content-divider)]" aria-label="Database Type">
              <span class="text-sm text-[var(--pd-content-text-secondary)]">Database Type</span>
              <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{databaseName}</span>
            </div>
            <div class="flex justify-between py-3" aria-label="Collection Name">
              <span class="text-sm text-[var(--pd-content-text-secondary)]">Collection Name</span>
              <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{ragEnvironment.name.replace(/\W/g, '_')}</span>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-sm text-[var(--pd-content-text-secondary)]">Knowledge database not found.</div>
        </div>
      {/if}
    </Route>
    <Route path="/chunker" breadcrumb="Chunker" navigationHint="tab">
      {#if ragEnvironment}
        <div class="flex flex-col px-5 py-4">
          <div class="bg-[var(--pd-content-card-bg)] border border-[var(--pd-content-divider)] rounded-lg p-5 max-w-2xl">
            <h3 class="text-sm font-semibold text-[var(--pd-content-text-secondary)] mb-4 uppercase tracking-wider">{chunkProviderName} Configuration</h3>
            <div class="flex justify-between py-3" aria-label="Model">
              <span class="text-sm text-[var(--pd-content-text-secondary)]">Model</span>
              <span class="text-sm text-[var(--pd-content-text)] font-medium" data-testid="info-value">{chunkProviderName}</span>
            </div>
          </div>
        </div>
      {:else}
        <div class="flex items-center justify-center h-full">
          <div class="text-sm text-[var(--pd-content-text-secondary)]">Knowledge database not found.</div>
        </div>
      {/if}
    </Route>
  {/snippet}
</DetailsPage>
