import { defineConfig } from "orval";

/**
 * Generates the typed API client (TanStack Query hooks) and Zod schemas from the
 * API's OpenAPI document. Regenerate with `pnpm --filter @rahaaon/api openapi:export`
 * then `pnpm --filter @rahaaon/web api:generate`. Output under src/api is committed
 * (like routeTree.gen.ts) so typecheck/build need no codegen step.
 */
export default defineConfig({
  rahaaon: {
    input: "../api/openapi.json",
    output: {
      target: "./src/api/endpoints.ts",
      schemas: "./src/api/model",
      client: "react-query",
      mode: "tags-split",
      clean: true,
      prettier: false,
      override: {
        mutator: { path: "./src/lib/api-fetch.ts", name: "apiFetch" },
        query: { useQuery: true, useMutation: true },
      },
    },
  },
  rahaaonZod: {
    input: "../api/openapi.json",
    output: {
      target: "./src/api/zod.ts",
      client: "zod",
      mode: "single",
      clean: false,
      prettier: false,
      fileExtension: ".zod.ts",
    },
  },
});
