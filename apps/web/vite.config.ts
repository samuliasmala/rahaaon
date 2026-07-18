import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    // Router plugin must precede the React plugin.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    // Listen on all interfaces so the dev server is reachable when run inside a
    // container (harmless on the host).
    host: true,
    // 5173/3000 belong to the vesi dev stack on the same machine; rahaaon uses 5174/3001.
    port: 5174,
    proxy: {
      // Forward API + auth calls to the Hono server (path preserved), so the
      // browser treats them as same-origin and the session cookie is shared.
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
    // Published through the host Caddy (TLS + reverse proxy to this port).
    allowedHosts: ["rahaaon.asmala.fi"],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
