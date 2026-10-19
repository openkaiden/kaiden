<script lang="ts">
interface Props {
  object: { gatewayName: string };
}

let { object }: Props = $props();
</script>

<div class="text-sm text-[var(--pd-table-body-text)]">{object.gatewayName}</div>
