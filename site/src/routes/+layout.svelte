<script lang="ts">
  import "../app.css";
  import { base } from "$app/paths";
  let { children }: { children?: import("svelte").Snippet } = $props();
</script>

<div class="min-h-screen bg-slate-950">
  <nav class="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-10">
    <div class="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
      <a href="{base}/" class="text-white font-bold text-lg">Regenerable Software Lab</a>
      <a href="https://github.com/rmax-ai/regenerable-software-lab" class="text-slate-400 hover:text-white transition text-sm">
        GitHub →
      </a>
    </div>
  </nav>
  {@render children?.()}
  <footer class="border-t border-slate-800 py-8 px-4">
    <div class="max-w-4xl mx-auto text-center text-slate-600 text-sm">
      MIT License · <a href="https://github.com/rmax-ai/regenerable-software-lab" class="hover:text-slate-400 transition">GitHub</a>
    </div>
  </footer>
</div>
