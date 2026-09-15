<script lang="ts">
import { type Chat } from '@ai-sdk/svelte';
import type { UIMessage } from 'ai';
import { toast } from 'svelte-sonner';

import { flowCreationData } from '/@/lib/flows/state/flow-creation-data.svelte';
import { handleNavigation } from '/@/navigation';
import { isFlowConnectionAvailable } from '/@/stores/flow-provider';
import type { ModelInfo } from '/@api/model-registry-info';
import { NavigationPage } from '/@api/navigation-page';

import FlowIcon from '../../images/FlowIcon.svelte';
import { Button } from './ui/button';

let {
  selectedModel,
  selectedMCPTools,
  loading,
  chatClient,
}: {
  selectedModel?: ModelInfo;
  selectedMCPTools: Map<string, Set<string>>;
  loading: boolean;
  chatClient: Chat;
} = $props();

let loadingExportAsFlow = $state(false);

let title = $derived($isFlowConnectionAvailable ? 'Export as Flow' : 'Install flow provider to enable save.');

const exportAsFlow = async (): Promise<void> => {
  if (!selectedModel) {
    toast.error(`There's no selected model to export as a flow.`);
    return;
  }

  loadingExportAsFlow = true;

  try {
    const { providerId, connectionId, label } = selectedModel;

    const tools: Record<string, string[]> = Object.fromEntries(
      selectedMCPTools.entries().reduce(
        (accumulator, [mcpId, tools]) => {
          if (tools.size > 0) {
            accumulator.push([mcpId, Array.from(tools.values())]);
          }
          return accumulator;
        },
        [] as Array<[string, string[]]>,
      ),
    );

    const generatedFlowParams = await window.inferenceGenerateFlowParams({
      providerId,
      connectionId,
      modelId: label,
      tools: tools,
      messages: $state.snapshot(chatClient.messages) as UIMessage[],
    });

    flowCreationData.value = {
      ...generatedFlowParams,
      model: selectedModel,
      tools: tools,
      chatId: chatClient.id,
    };

    handleNavigation({ page: NavigationPage.FLOW_CREATE });
  } catch (e) {
    console.error(e);
  } finally {
    loadingExportAsFlow = false;
  }
};
</script>

<Button
	class="h-8 px-2"
	onclick={async(event): Promise<void> => {
		event.preventDefault();
		await exportAsFlow();
	}}
	disabled={loading || !chatClient.messages.length || loadingExportAsFlow}
	variant="outline"
	{title}
>
  <FlowIcon size={2}/>
  {title}
</Button>
