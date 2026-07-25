<script lang="ts">
  import { base } from "$app/paths";

  let { text, variant = "default" }: {
    text: string;
    variant?: "default" | "done" | "in-progress" | "planned";
  } = $props();

  const colors: Record<string, string> = {
    default: "bg-slate-800 text-slate-300",
    done: "bg-emerald-900/60 text-emerald-300 border border-emerald-800/50",
    "in-progress": "bg-amber-900/60 text-amber-300 border border-amber-800/50",
    planned: "bg-slate-800/50 text-slate-500 border border-slate-700/50",
  };
</script>

<span class="inline-block px-3 py-1 rounded-full text-xs font-medium {colors[variant]}">
  {text}
</span>
