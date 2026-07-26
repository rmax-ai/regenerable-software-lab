#!/usr/bin/env node
// Copy static site build into ../docs without deleting markdown docs or CNAME.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const siteRoot = resolve(__dirname, "..");
const buildDir = join(siteRoot, "build");
const docsDir = resolve(siteRoot, "..", "docs");

if (!existsSync(buildDir)) {
  console.error("site/build missing. Run vite build first.");
  process.exit(1);
}

mkdirSync(docsDir, { recursive: true });

// Remove previous generated site assets only.
const generated = ["_app", "index.html", "robots.txt"];
for (const name of generated) {
  const target = join(docsDir, name);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
  }
}

// Copy fresh build outputs.
for (const entry of readdirSync(buildDir)) {
  const from = join(buildDir, entry);
  const to = join(docsDir, entry);
  cpSync(from, to, { recursive: true });
}

// Ensure GitHub Pages markers survive.
writeFileSync(join(docsDir, ".nojekyll"), "");
const cnamePath = join(docsDir, "CNAME");
if (!existsSync(cnamePath)) {
  writeFileSync(cnamePath, "regenerable-software-lab.rmax.tech\n");
}

// Sanity: keep at least one known markdown doc present.
const marker = join(docsDir, "ARCHITECTURE.md");
if (!existsSync(marker)) {
  console.error("docs/ARCHITECTURE.md missing after publish. Aborting.");
  process.exit(1);
}

console.log("Published site assets to docs/ without wiping markdown docs.");
console.log(
  "Generated entries:",
  readdirSync(docsDir)
    .filter((name) => {
      const p = join(docsDir, name);
      return statSync(p).isFile() || name === "_app";
    })
    .join(", "),
);
