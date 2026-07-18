import { defineConfig } from "tsdown";

export default defineConfig({
  // server.ts is the app; migrate.ts is built too so a prod image can run
  // migrations (`node dist/db/migrate.js`) without tsx/source.
  entry: ["src/server.ts", "src/db/migrate.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // App bundle — no type declarations needed.
  dts: false,
  // Emit .js (not tsdown's default .mjs); the package is "type": "module", so
  // .js is ESM. Keeps `node dist/server.js` / `dist/db/migrate.js` unchanged.
  outExtensions: () => ({ js: ".js" }),
});
