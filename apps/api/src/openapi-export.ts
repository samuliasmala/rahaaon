import { writeFileSync } from "node:fs";
import { createApp } from "./app.js";

/**
 * Writes the OpenAPI document to apps/api/openapi.json (consumed by the web
 * app's orval codegen). Runs without a live DB — only the doc route is exercised.
 */
const app = createApp();
const res = await app.request("/api/openapi.json");
const doc = await res.json();
writeFileSync("openapi.json", JSON.stringify(doc, null, 2) + "\n");
console.log("[openapi] wrote apps/api/openapi.json");
