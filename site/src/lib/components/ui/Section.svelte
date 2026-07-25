<script lang="ts">
  import { base } from "$app/paths";
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<svelte:element this="section" class="py-16 px-4 sm:px-6 max-w-4xl mx-auto">
  {@render children?.()}
</svelte:element>
