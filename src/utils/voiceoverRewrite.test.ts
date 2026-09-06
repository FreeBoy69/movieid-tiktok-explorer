import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import * as timing from "./voiceoverTimingPolicy.js";

// Exercise the server functions without starting HTTP listeners or schedulers.
const source = ts.createSourceFile("server.js", readFileSync("server.js", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const names = new Set([
  "generateDeepSeekText", "generateRewriteText", "rewriteTokens", "rewriteNgrams",
  "sharedRewriteNgramRatio", "normalizeRewriteSentence", "copiedRewriteSentenceRatio",
  "rewriteSimilarityReport", "rewriteIsTooClose", "rewriteLengthIsOff",
  "buildRewriteSystemPrompt", "rewriteSegmentWithQuality", "rewriteScriptText", "splitRewriteChunks",
]);
const functions = source.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text || "")).map((node) => node.getText(source)).join("\n");
function runtime(overrides: Record<string, unknown> = {}) {
  const context = vm.createContext({ ...timing, process: { env: {} }, console: { warn: vi.fn() },
    REWRITE_MAX_RETRIES_PER_SEGMENT: 1, REWRITE_CHUNKING_THRESHOLD: 2400, REWRITE_CHUNK_WORD_LIMIT: 600,
    deepSeekApiKey: () => "test-key", deepSeekBaseUrl: () => "https://provider.invalid",
    deepSeekTextModel: () => "deepseek-v4-flash", dashScopeApiKey: () => "",
  });
  vm.runInContext(functions, context);
  Object.assign(context, overrides);
  return context;
}

describe("voiceover rewrite integrity", () => {
  const original = "A woman woke up to find herself standing on the edge of a bottomless abyss.";
  it("disables thinking for rewriting and returns the completed answer", async () => {
    const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "New narration" } }] }) }));
    const context = runtime({ fetch });
    expect(await context.generateRewriteText("Rewrite", original)).toBe("New narration");
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, { body: string }])[1].body).thinking).toEqual({ type: "disabled" });
  });
  it("rejects truncated provider output", async () => {
    const context = runtime({ fetch: async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "length", message: { content: "A partial sentence" } }] }) }) });
    await expect(context.generateRewriteText("Rewrite", original)).rejects.toThrow("output limit");
  });
  it("rejects unchanged text even when its word count matches perfectly", async () => {
    const context = runtime({ generateRewriteText: async () => original });
    await expect(context.rewriteSegmentWithQuality(original, original, "scene", { requireWordMatch: true, strictWordTiming: true })).rejects.toThrow("wording and length");
  });
  it("does not replace provider errors with the original scene or full script", async () => {
    const context = runtime({ generateRewriteText: async () => { throw new Error("Provider unavailable"); } });
    await expect(context.rewriteSegmentWithQuality(original, original, "scene", { requireWordMatch: true })).rejects.toThrow("original text was not substituted");
    await expect(context.rewriteScriptText(original)).rejects.toThrow("original text was not substituted");
  });
  it("rejects empty and different but badly shortened candidates", async () => {
    for (const candidate of ["", "She awoke."]) {
      const context = runtime({ generateRewriteText: async () => candidate });
      await expect(context.rewriteSegmentWithQuality(original, original, "scene", { requireWordMatch: true, strictWordTiming: true })).rejects.toThrow("wording and length");
    }
  });
  it("accepts a changed narration that preserves the spoken word budget", async () => {
    const candidate = "When she regained consciousness, a woman discovered herself poised beside the brink of an endless chasm.";
    const context = runtime({ generateRewriteText: async () => candidate });
    expect(await context.rewriteSegmentWithQuality(original, original, "scene", { requireWordMatch: true, strictWordTiming: true })).toBe(candidate);
  });
});
