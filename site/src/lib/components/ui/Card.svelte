<script lang="ts">
  import { base } from "$app/paths";

  let { title, icon, children }: {
    title: string;
    icon?: string;
    children?: import("svelte").Snippet;
  } = $props();
</script>

<div class="bg-slate-900/50 border border-slate-800 rounded-lg p-6">
  {#if icon}
    <div class="text-2xl mb-3">{icon}</div>
  {/if}
  <h3 class="text-white font-semibold text-lg mb-2">{title}</h3>
  <div class="text-slate-400 text-sm leading-relaxed">
    {@render children?.()}
  </div>
</div>
