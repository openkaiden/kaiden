<script lang="ts">
import { Checkbox } from '@podman-desktop/ui-svelte';

import type { SkillInfo } from '/@api/skill/skill-info';

interface Props {
  object: SkillInfo;
}

let { object }: Props = $props();

function onToggle(_checked: boolean): void {
  const promise = object.enabled ? window.disableSkill(object.name) : window.enableSkill(object.name);
  promise.catch((err: unknown) => console.error('Error toggling skill:', err));
}
</script>

<Checkbox checked={object.enabled} onclick={onToggle} title={object.enabled ? 'Disable skill' : 'Enable skill'} />
