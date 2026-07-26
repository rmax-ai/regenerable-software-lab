<script lang="ts">
  let {
    children,
    tag = "section",
  }: {
    children?: import("svelte").Snippet;
    tag?: string;
  } = $props();
</script>

<svelte:element this={tag} class="py-16 px-4 sm:px-6 max-w-4xl mx-auto">
  {@render children?.()}
</svelte:element>
