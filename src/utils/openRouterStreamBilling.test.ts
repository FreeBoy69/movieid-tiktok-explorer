import { describe, expect, it } from "vitest";
import { openRouterStream, requestOpenRouter } from "./openRouterClient.js";

function stream(chunks: object[]) {
  return {
    ok: true,
    status: 200,
    body: (async function* () {
      for (const chunk of chunks) yield Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`);
      yield Buffer.from("data: [DONE]\n\n");
    })(),
  };
}

describe("stream billing", () => {
  it("requests OpenRouter usage and preserves its reported cost", async () => {
    let sent: any;
    const data = await openRouterStream("/chat/completions", {
      env: { OPENROUTER_API_KEY: "test" },
      body: { model: "anthropic/claude-opus-5.5", messages: [{ role: "user", content: "hello" }] },
      fetchImpl: async (_url: string, options: any) => {
        sent = JSON.parse(options.body);
        return stream([
          { id: "gen-one", choices: [{ delta: { content: "answer" } }] },
          { usage: { prompt_tokens: 100, completion_tokens: 200, cost: 0.02 } },
        ]);
      },
    });
    expect(sent.usage).toEqual({ include: true });
    expect(sent.stream_options).toEqual({ include_usage: true });
    expect(data.usage).toEqual({ prompt_tokens: 100, completion_tokens: 200, cost: 0.02 });
  });

  it("uses text-size token estimates if a stream omits usage", async () => {
    const data = await openRouterStream("/chat/completions", {
      env: { OPENROUTER_API_KEY: "test" },
      body: { model: "anthropic/claude-opus-5.5", messages: [{ role: "user", content: "hello" }] },
      fetchImpl: async () => stream([{ choices: [{ delta: { content: "answer" }, finish_reason: "stop" }] }]),
    });
    expect(data.usage.prompt_tokens).toBeGreaterThan(0);
    expect(data.usage.completion_tokens).toBeGreaterThan(0);
    expect(data.usage.cost).toBeUndefined();
  });

  it("streams a JSON request's text to onText and still returns the parsed value", async () => {
    const seen: string[] = [];
    let sent: any;
    const result = await requestOpenRouter({
      env: { OPENROUTER_API_KEY: "test" },
      messages: [{ role: "user", content: "hi" }], json: true, reasoningEffort: "low",
      onText: (text: string) => seen.push(text),
      fetchImpl: async (_url: string, options: any) => {
        sent = JSON.parse(options.body);
        return stream([{ choices: [{ delta: { content: "{\"reply\":" } }] }, { choices: [{ delta: { content: "\"hi\"}" }, finish_reason: "stop" }] }]);
      },
    } as any);
    expect(sent.stream).toBe(true);
    expect(sent.reasoning).toEqual({ exclude: true, effort: "low" });
    expect(seen).toEqual(["{\"reply\":", "{\"reply\":\"hi\"}"]);
    expect(result.value).toEqual({ reply: "hi" });
  });
});
