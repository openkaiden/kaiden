<script lang="ts">
interface Props {
  size?: number;
  class?: string;
}

let { size = 24, class: className = '' }: Props = $props();
</script>

<!-- Google Cloud / Vertex AI — cloud outline mark. Uses currentColor. -->
<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
  class={className}>
  <path
    fill="currentColor"
    d="M19.35 10.04A7.49 7.49 0 0 0 12 4C9.11 4 6.6 5.64 5.35 8.04A5.994 5.994 0 0 0 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" />
</svg>
