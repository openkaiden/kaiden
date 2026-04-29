<script lang="ts">
interface Props {
  size?: number;
  class?: string;
}

let { size = 44, class: className = '' }: Props = $props();

let innerSize = $derived(Math.round(size * 0.55));
</script>

<div
  class="rounded-xl flex items-center justify-center flex-shrink-0 {className}"
  style="width:{size}px;height:{size}px;background:#1a1a1a">
  <svg
    width={innerSize}
    height={innerSize}
    viewBox="0 0 240 300"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true">
    <path d="M180 240H60V120H180V240Z" fill="white" opacity="0.4" />
    <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="white" />
  </svg>
</div>
