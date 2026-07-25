<script lang="ts">
  import { base } from "$app/paths";
  import Section from "$lib/components/ui/Section.svelte";
  import Card from "$lib/components/ui/Card.svelte";
  import Badge from "$lib/components/ui/Badge.svelte";
  import { COMMANDS, HARNESSES, PACKAGES, PROFILES, STACK } from "$lib/data/meta";
</script>

<!-- Hero -->
<Section tag="header">
  <div class="text-center py-8">
    <h1 class="text-4xl sm:text-5xl font-bold text-white mb-4 tracking-tight">
      Regenerable Software Lab
    </h1>
    <p class="text-lg sm:text-xl text-slate-400 max-w-2xl mx-auto leading-relaxed">
      An experimental benchmark for evaluating whether AI coding agents can repeatedly generate
      software from a durable, implementation-independent verification bundle.
    </p>
    <div class="mt-8 flex flex-wrap gap-3 justify-center">
      <a href="https://github.com/rmax-ai/regenerable-software-lab"
         class="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg font-medium transition">
        GitHub
      </a>
      <a href="https://github.com/rmax-ai/regenerable-software-lab/blob/main/SPEC.md"
         class="inline-flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 px-5 py-2.5 rounded-lg font-medium transition">
        Read the Spec
      </a>
    </div>
  </div>
</Section>

<!-- What -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-4">What</h2>
  <p class="text-slate-400 leading-relaxed mb-6">
    Most AI coding benchmarks evaluate issue resolution against an existing repository.
    Regenerable Software Lab treats source code as a <strong class="text-slate-200">replaceable candidate implementation</strong>
    and measures whether agents can satisfy progressively stronger verification profiles
    from the same specification bundle.
  </p>
  <p class="text-slate-400 leading-relaxed">
    The first benchmark is a small HTTP order-pricing API. Multiple coding models and agent harnesses
    receive the same specification and must produce an implementation that passes
    <strong class="text-slate-200">three verification profiles</strong> spanning public tests,
    hidden behavioral tests, mutation testing, and operational constraints.
  </p>
</Section>

<!-- Architecture SVG -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">How It Works</h2>
  <div class="bg-slate-900/50 border border-slate-800 rounded-lg p-6 overflow-x-auto">
    <svg viewBox="0 0 720 380" class="w-full h-auto max-w-2xl mx-auto" xmlns="http://www.w3.org/2000/svg">
      <!-- Spec -->
      <rect x="260" y="10" width="200" height="40" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
      <text x="360" y="35" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="600">SPEC + Benchmarks</text>

      <!-- Arrow down -->
      <line x1="360" y1="50" x2="360" y2="75" stroke="#6366f1" stroke-width="2" marker-end="url(#arrow)"/>

      <!-- CLI -->
      <rect x="230" y="80" width="260" height="40" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
      <text x="360" y="105" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="600">rsl CLI (6 commands)</text>

      <!-- Arrow down -->
      <line x1="360" y1="120" x2="360" y2="145" stroke="#6366f1" stroke-width="2" marker-end="url(#arrow)"/>

      <!-- Runner -->
      <rect x="260" y="150" width="200" height="36" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
      <text x="360" y="173" text-anchor="middle" fill="#e2e8f0" font-size="13">Runner (orchestration)</text>

      <!-- Two branches -->
      <line x1="300" y1="186" x2="180" y2="215" stroke="#6366f1" stroke-width="2" marker-end="url(#arrow)"/>
      <line x1="420" y1="186" x2="540" y2="215" stroke="#6366f1" stroke-width="2" marker-end="url(#arrow)"/>

      <!-- Agent workspace -->
      <rect x="70" y="220" width="220" height="55" rx="6" fill="#1e293b" stroke="#6366f1" stroke-width="1.5"/>
      <text x="180" y="245" text-anchor="middle" fill="#e2e8f0" font-size="13" font-weight="600">Agent Workspace</text>
      <text x="180" y="264" text-anchor="middle" fill="#94a3b8" font-size="11">Harness adapter → LLM → code</text>

      <!-- Evaluator -->
      <rect x="430" y="220" width="220" height="55" rx="6" fill="#1e293b" stroke="#22c55e" stroke-width="1.5"/>
      <text x="540" y="245" text-anchor="middle" fill="#e2e8f0" font-size="13" font-weight="600">Evaluator</text>
      <text x="540" y="264" text-anchor="middle" fill="#94a3b8" font-size="11">9-stage verification pipeline</text>

      <!-- Merge to report -->
      <line x1="180" y1="275" x2="300" y2="315" stroke="#6366f1" stroke-width="2" marker-end="url(#arrow)"/>
      <line x1="540" y1="275" x2="420" y2="315" stroke="#6366f1" stroke-width="2" marker-end="url(#arrow)"/>

      <!-- Results -->
      <rect x="230" y="320" width="260" height="40" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
      <text x="360" y="345" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="600">Reports + Traces + Metrics</text>

      <!-- Arrow marker -->
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1"/>
        </marker>
      </defs>
    </svg>
  </div>
</Section>

<!-- Profiles -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">Verification Profiles</h2>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
    {#each PROFILES as profile}
      <Card title={profile.name}>
        <p class="mb-2 text-slate-300">{profile.stages}</p>
        <Badge text={profile.status === "done" ? "Implemented" : "In Progress"}
               variant={profile.status === "done" ? "done" : "in-progress"} />
      </Card>
    {/each}
  </div>
</Section>

<!-- CLI Commands -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">CLI Commands</h2>
  <div class="bg-black rounded-lg border border-slate-800 overflow-hidden">
    <div class="px-4 py-2 border-b border-slate-800 text-slate-500 text-xs font-mono">
      rsl [command]
    </div>
    <div class="p-4 space-y-2 font-mono text-sm">
      {#each COMMANDS as cmd}
        <div class="flex gap-3">
          <span class="text-indigo-400 font-semibold whitespace-nowrap">{cmd.cmd}</span>
          <span class="text-slate-500">—</span>
          <span class="text-slate-400">{cmd.desc}</span>
        </div>
      {/each}
    </div>
  </div>
</Section>

<!-- Harness Adapters -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">Harness Adapters</h2>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
    {#each HARNESSES as h}
      <div class="bg-slate-900/50 border border-slate-800 rounded-lg p-4 flex items-center justify-between">
        <div>
          <div class="text-white font-medium">{h.name}</div>
          <div class="text-slate-500 text-xs font-mono mt-0.5">{h.pkg}</div>
        </div>
        <span class="text-indigo-400 text-xs font-mono">AgentHarness</span>
      </div>
    {/each}
  </div>
</Section>

<!-- Quickstart -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">Quickstart</h2>
  <div class="bg-black rounded-lg border border-slate-800 overflow-hidden">
    <div class="px-4 py-2 border-b border-slate-800 text-slate-500 text-xs">
      Terminal
    </div>
    <div class="p-4 font-mono text-sm leading-relaxed">
      <div><span class="text-slate-500">$</span> <span class="text-slate-300">git clone https://github.com/rmax-ai/regenerable-software-lab.git</span></div>
      <div><span class="text-slate-500">$</span> <span class="text-slate-300">cd regenerable-software-lab</span></div>
      <div><span class="text-slate-500">$</span> <span class="text-slate-300">pnpm install && pnpm build</span></div>
      <div class="mt-3"><span class="text-slate-500">$</span> <span class="text-slate-300">pnpm test</span></div>
      <div class="text-emerald-400 mt-1">✓ 168 tests passed (packages)</div>
      <div class="mt-3"><span class="text-slate-500">$</span> <span class="text-slate-300">cd benchmarks/order-pricing/reference-impl</span></div>
      <div><span class="text-slate-500">$</span> <span class="text-slate-300">pnpm install && pnpm build && pnpm test</span></div>
      <div class="text-emerald-400 mt-1">✓ 136 tests passed (reference impl)</div>
    </div>
  </div>
</Section>

<!-- Stack -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">Tech Stack</h2>
  <div class="flex flex-wrap gap-2">
    {#each STACK as item}
      <Badge text={item} />
    {/each}
  </div>
</Section>

<!-- Packages -->
<Section>
  <h2 class="text-2xl sm:text-3xl font-bold text-white mb-6">Packages</h2>
  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
    {#each PACKAGES as pkg}
      <div class="bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3">
        <div class="text-white font-mono text-sm font-semibold">{pkg.name}</div>
        <div class="text-slate-500 text-xs mt-1">{pkg.desc}</div>
      </div>
    {/each}
  </div>
</Section>
