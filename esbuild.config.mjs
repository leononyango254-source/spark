import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  logLevel: "info",
  external: ["pg-native", "bufferutil", "utf-8-validate", "encoding"],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
};

await build({
  ...shared,
  entryPoints: ["apps/api/src/index.ts"],
  outfile: "apps/api/dist/index.js",
});

await build({
  ...shared,
  entryPoints: ["apps/bot/src/index.ts"],
  outfile: "apps/bot/dist/index.js",
});
