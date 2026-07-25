import adapter from "@sveltejs/adapter-static";

/** @type {import("@sveltejs/kit").Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: "../docs",
      assets: "../docs",
      fallback: undefined,
    }),
    paths: {
      base: "/regenerable-software-lab",
    },
  },
};

export default config;
