<script lang="ts">
import type { Snippet } from 'svelte';
import type { HTMLAttributes } from 'svelte/elements';

interface Props extends HTMLAttributes<HTMLDivElement> {
  class?: string;
  children: Snippet;
}

let { class: className, children, ...restProps }: Props = $props();
</script>

<div class="content-card {className}" {...restProps}>
  {@render children()}
</div>
