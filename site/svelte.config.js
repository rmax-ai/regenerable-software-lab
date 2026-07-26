import adapter from "@sveltejs/adapter-static";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  kit: {
    // Build into site/build, then a script copies only website assets into ../docs.
    // Writing directly to ../docs wipes markdown docs and CNAME.
    adapter: adapter({
      pages: "build",
      assets: "build",
      fallback: undefined,
      strict: true,
    }),
    paths: {
      // Custom domain (docs/CNAME): regenerable-software-lab.rmax.tech
      base: "",
    },
  },
};

export default config;
