export default {
  "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc,css}": [
    "biome check --write --unsafe --no-errors-on-unmatched",
  ],
  "*.{md,mdx}": ["prettier --write"],
};
