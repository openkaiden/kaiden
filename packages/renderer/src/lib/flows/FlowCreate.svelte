<script lang="ts">
import { Button, ErrorMessage, Input } from '@podman-desktop/ui-svelte';
// eslint-disable-next-line import/no-extraneous-dependencies
import { generate as generateWords } from 'random-words';
import { onMount } from 'svelte';

import MCPSelector from '/@/lib/chat/components/mcp-selector.svelte';
import ModelSelector from '/@/lib/chat/components/model-selector.svelte';
import { Textarea } from '/@/lib/chat/components/ui/textarea';
import { flowCreationData } from '/@/lib/flows/state/flow-creation-data.svelte';
import FormPage from '/@/lib/ui/FormPage.svelte';
import { handleNavigation } from '/@/navigation';
import { isFlowConnectionAvailable } from '/@/stores/flow-provider';
import { mcpRemoteServerInfos } from '/@/stores/mcp-remote-servers';
import { allModels as allModelsStore } from '/@/stores/models';
import { providerInfos } from '/@/stores/providers';
import { FlowGenerationParametersSchema } from '/@api/inference/flow-generation-parameters-schema';
import type { MCPRemoteServerInfo } from '/@api/mcp/mcp-server-info';
import type { ModelInfo } from '/@api/model-registry-info';
import { NavigationPage } from '/@api/navigation-page';

import FlowIcon from '../images/FlowIcon.svelte';
import FlowConnectionSelector from './components/flow-connection-selector.svelte';
import InputFieldsSection from './components/InputFieldsSection.svelte';
import NoFlowProviders from './components/NoFlowProviders.svelte';
import type { InputField } from './types/input-field';

let selectedMCP = $state<MCPRemoteServerInfo[]>(
  Object.entries(flowCreationData?.value?.tools ?? {}).reduce((accumulator, [mcpId, _]) => {
    // for now we cannot specify tools in Flows, so let's select the full MCP
    const server = $mcpRemoteServerInfos.find(r => r.id === mcpId);
    if (server) {
      accumulator.push(server);
    }
    return accumulator;
  }, [] as MCPRemoteServerInfo[]),
);
let models: Array<ModelInfo> = $derived($allModelsStore);
let flowCreationDataModel = $state<ModelInfo | undefined>(flowCreationData.value?.model);
let selectedModel = $derived<ModelInfo | undefined>(flowCreationDataModel ?? models[0]);

// error
let error: string | undefined = $state();
let loading: boolean = $state(false);

// form field
let name: string = $state(flowCreationData.value?.name ?? `flow-${generateWords({ exactly: 2, join: '-' })}`);
let description: string = $state(flowCreationData.value?.description ?? '');
let instruction: string = $state('You are a helpful assistant.');
let prompt: string = $state(flowCreationData.value?.prompt ?? '');
let parameters = $state<InputField[]>([]); // Input fields managed manually in UI
let flowProviderConnectionKey: string | undefined = $state<string>();

// Store chatId before clearing flowCreationData (for detect fields feature)
let chatId: string | undefined = $state(flowCreationData.value?.chatId);

flowCreationData.value = undefined;

// Detect fields state
let detectingFields: boolean = $state(false);

// Can detect fields if we have a non-empty prompt
const hasPrompt = $derived(prompt.trim().length > 0);

/**
 * Detect flow fields from the prompt (and chat conversation if available).
 * Uses AI to analyze the prompt and extract parameters.
 */
async function handleDetectFields(): Promise<void> {
  if (!selectedModel || detectingFields || !hasPrompt) return;

  detectingFields = true;
  error = undefined;

  try {
    const result = await window.inferenceDetectFlowFields({
      chatId,
      prompt,
      providerId: selectedModel.providerId,
      connectionId: selectedModel.connectionId,
      modelId: selectedModel.label,
    });

    // Update prompt with placeholders
    prompt = result.prompt;

    // Update parameters from AI detection
    parameters = result.parameters.map(
      (p: { name: string; description: string; format: string; default?: string; required: boolean }) => ({
        name: p.name,
        description: p.description,
        format: p.format as 'string',
        default: p.default,
        required: p.required,
      }),
    );
  } catch (err: unknown) {
    console.error('Failed to detect flow fields:', err);
    error = `Failed to detect fields: ${String(err)}`;
  } finally {
    detectingFields = false;
  }
}

let showFlowConnectionSelector = $state(true);

onMount(() => {
  try {
    const allFlowConnections = $providerInfos.flatMap(p =>
      (p.flowConnections ?? []).map(c => ({ providerId: p.id, connectionName: c.name })),
    );
    if (allFlowConnections.length === 1) {
      const only = allFlowConnections[0];
      flowProviderConnectionKey = `${only.providerId}:${only.connectionName}`;
      showFlowConnectionSelector = false;
    }
  } catch (e) {
    // ignore errors in auto-select logic to avoid blocking UI
    console.error('Flow auto-select skipped:', e);
  }
});

const validatedInput = $derived(FlowGenerationParametersSchema.safeParse({ name, description, prompt }));

const formValidContent = $derived(
  !!flowProviderConnectionKey && !!selectedModel && validatedInput.data && !!instruction
    ? {
        flowProviderConnectionKey,
        model: {
          providerId: selectedModel.providerId,
          label: selectedModel.label,
        },
        name: validatedInput.data.name,
        description: validatedInput.data.description,
        mcp: $state.snapshot(selectedMCP),
        prompt: validatedInput.data.prompt,
        instruction,
        parameters: $state.snapshot(parameters), // Snapshot for IPC serialization
      }
    : undefined,
);

async function generate(): Promise<void> {
  if (loading || !formValidContent) return;

  const { flowProviderConnectionKey } = formValidContent;

  loading = true;

  try {
    const [providerId, connectionName] = flowProviderConnectionKey.split(':');

    const flowId = await window.generateFlow(providerId, connectionName, formValidContent);

    handleNavigation({
      page: NavigationPage.FLOW_DETAILS,
      parameters: {
        flowId: flowId,
        providerId: providerId,
        connectionName: connectionName,
      },
    });
  } catch (err: unknown) {
    error = String(err);
  } finally {
    loading = false;
  }
}
</script>

<FormPage title="Flow Create" inProgress={loading}>
  {#snippet content()}
    <div class="px-5 pb-5 min-w-full">
    {#if $isFlowConnectionAvailable}
        <div class="bg-[var(--pd-content-card-bg)] py-4">
          <div class="flex flex-col px-6">
            <div>You can create a flow using this form by selecting a model, one or several tools (from MCP servers)
              and specifying instructions.</div>
            <div>A flow can also be created by exporting a chat session. All information's on this page will then automatically be filled.</div>
            <div class="flex flex-row gap-1 items-center">The export feature in the chat window is available through the <FlowIcon /> icon</div>
          </div>
          {#if error}
            <div class="px-6">
              <ErrorMessage {error}/>
            </div>
          {/if}

          <form
            novalidate
            class="p-2 space-y-7 h-fit"
            onsubmit={(e): void => e.preventDefault()}
          >
            <div class="px-6">
              <span>Flow Name</span>
              <Input bind:value={name} placeholder="name" class="grow" required />
            </div>

            <!-- description -->
            <div class="px-6">
              <span>Description</span>
              <Textarea
                placeholder="Description..."
                bind:value={description}
                class='bg-muted max-h-[calc(75dvh)] min-h-[24px] resize-none overflow-hidden rounded-2xl pb-10 !text-base dark:border-zinc-700'
                rows={2}
                autofocus
              />
            </div>
            <div class="flex flex-col px-6">
              <span>Model</span>
                  <ModelSelector
                      class="order-1 md:order-2"
                      models={models}
                      bind:value={selectedModel}
                  />
            </div>

            <!-- tools -->
            <div class="flex flex-col px-6">
              <span>Tools</span>
              <MCPSelector bind:selected={selectedMCP}/>
            </div>

            <!-- prompt -->
            <div class="px-6">
              <span>Prompt</span>
              <Textarea
                placeholder="Prompt"
                bind:value={prompt}
                class='bg-muted max-h-[calc(75dvh)] min-h-[24px] resize-none overflow-hidden rounded-2xl pb-10 !text-base dark:border-zinc-700'
                rows={2}
                autofocus
              />
            </div>

            <InputFieldsSection
              bind:parameters
              onDetectFields={handleDetectFields}
              {detectingFields}
              {hasPrompt}
            />

            <!-- instruction -->
            <div class="px-6">
              <span>Instruction</span>
              <Textarea
                placeholder="Instruction"
                bind:value={instruction}
                class='bg-muted max-h-[calc(75dvh)] min-h-[24px] resize-none overflow-hidden rounded-2xl pb-10 !text-base dark:border-zinc-700'
                rows={2}
                autofocus
              />
            </div>
            <div class="flex w-full px-6">
              {#if showFlowConnectionSelector}
              <FlowConnectionSelector class="" bind:value={flowProviderConnectionKey}/>
              {/if}
              <Button class="ml-auto" inProgress={loading} disabled={!formValidContent} onclick={generate}>Generate</Button>
            </div>
          </form>
        </div>
    {:else}
      <NoFlowProviders />
    {/if}
    </div>
  {/snippet}
</FormPage>
