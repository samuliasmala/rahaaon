import { createOpenAI } from "@ai-sdk/openai";
import { env } from "../config/env.js";
import type { LanguageModel } from "ai";

/**
 * The single provider swap point for LLM usage. Call sites use the Vercel AI
 * SDK (`generateText`/`generateObject`) against the model returned here and
 * stay provider-agnostic — moving off OpenAI means swapping the provider
 * package in this file (e.g. `@ai-sdk/anthropic`) and the env config, nothing
 * else changes.
 */

/** False when no API key is configured — callers decide how to degrade. */
export const llmConfigured = Boolean(env.OPENAI_API_KEY);

let model: LanguageModel | undefined;

export function languageModel(): LanguageModel {
  if (!env.OPENAI_API_KEY) {
    throw new Error("languageModel() called without OPENAI_API_KEY configured");
  }
  model ??= createOpenAI({ apiKey: env.OPENAI_API_KEY })(env.LLM_MODEL);
  return model;
}
