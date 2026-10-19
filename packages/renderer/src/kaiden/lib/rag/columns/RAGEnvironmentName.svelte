<script lang="ts">
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { RagEnvironment } from '/@api/rag/rag-environment';

interface Props {
  object: RagEnvironment;
}

const { object }: Props = $props();

function openRAGEnvironmentDetails(object: RagEnvironment): void {
  handleNavigation({
    page: NavigationPage.RAG_ENVIRONMENT_DETAILS,
    parameters: {
      name: object.name,
    },
  });
}
</script>

<button class="flex flex-col whitespace-nowrap max-w-full" onclick={openRAGEnvironmentDetails.bind(undefined, object)}>
  <div class="flex items-center max-w-full">
    <div class="max-w-full">
      <div class="flex flex-nowrap max-w-full">
        <div
          class="text-[var(--pd-table-body-text-highlight)] overflow-hidden text-ellipsis group-hover:text-[var(--pd-link)]"
          title={object.name}>
          {object.name}
        </div>
      </div>
    </div>
  </div>
</button>
