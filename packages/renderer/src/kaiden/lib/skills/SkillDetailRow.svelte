<script lang="ts">
interface Props {
  label: string;
  value: string;
  title?: string;
  truncate?: boolean;
}

let { label, value, title, truncate = false }: Props = $props();
</script>

<div class="flex justify-between py-3" aria-label={label}>
  <span class="text-sm text-[var(--pd-content-card-text)]">{label}</span>
  <span
    class={`text-sm font-medium text-[var(--pd-content-text)] ${truncate ? 'max-w-[200px] text-right truncate' : 'text-right break-all'}`}
    title={title}
    aria-label="{label} value">
    {value}
  </span>
</div>
