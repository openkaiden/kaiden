<script lang="ts">
import type { GuidedSetupStepProps } from './guided-setup-steps';

let { stepId, title, description }: GuidedSetupStepProps = $props();
</script>

<div data-testid="stub-step-{stepId}">{title} - {description}</div>
