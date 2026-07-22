import { defineConfig } from "tsdown";

export default defineConfig({
  // server.ts is the app; the db/ scripts are built too so a prod image can
  // run them (`node dist/db/migrate.js` etc.) without tsx/source.
  entry: ["src/server.ts", "src/db/migrate.ts", "src/db/seed.ts", "src/db/set-admin-password.ts"],
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
