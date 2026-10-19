<script lang="ts">
interface Props {
  value: string;
  id?: string;
  placeholder?: string;
}

let { value = $bindable(), id = 'workspace-description', placeholder = '' }: Props = $props();
</script>

<textarea
  {id}
  aria-label="Description"
  maxlength={500}
  rows="3"
  {placeholder}
  class="w-full rounded-sm text-sm bg-[var(--pd-input-field-bg)] text-[var(--pd-input-field-focused-text)] border border-[var(--pd-input-field-stroke)] p-2 resize-none"
  bind:value></textarea>
{#if value.length > 0}
  <span class="block text-right text-xs opacity-40 mt-1">{value.length}/500</span>
{/if}
