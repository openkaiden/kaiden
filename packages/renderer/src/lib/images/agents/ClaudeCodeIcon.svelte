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
  style="width:{size}px;height:{size}px;background:#3d1508">
  <svg
    width={innerSize}
    height={innerSize}
    viewBox="0 0 24 24"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true">
    <path
      fill="white"
      d="M17.304 3.541h-3.672l6.696 16.918h3.672L17.304 3.541zm-10.608 0H3.024l6.696 16.918h3.672L6.696 3.541z" />
  </svg>
</div>
