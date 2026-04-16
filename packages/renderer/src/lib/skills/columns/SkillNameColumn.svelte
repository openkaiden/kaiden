<script lang="ts">
import { handleNavigation } from '/@/navigation';
import { NavigationPage } from '/@api/navigation-page';
import type { SkillInfo } from '/@api/skill/skill-info';

interface Props {
  object: SkillInfo;
}

let { object }: Props = $props();

function openDetails(): void {
  handleNavigation({
    page: NavigationPage.SKILL_DETAILS,
    parameters: { name: object.name },
  });
}
</script>

<button class="flex flex-col whitespace-nowrap max-w-full" onclick={openDetails}>
  <div
    class="text-[var(--pd-table-body-text-highlight)] overflow-hidden text-ellipsis group-hover:text-[var(--pd-link)]"
    title={object.name}>
    {object.name}
  </div>
</button>
