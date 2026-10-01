import { describe, expect, it, vi } from "vitest";
import { openRouterConfigured, openRouterDecision, openRouterModel, requestOpenRouter, transcribeOpenRouter } from "./openRouterClient.js";

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as Response;
}

describe("OpenRouter client", () => {
  it("selects configured models without exposing the provider key", () => {
    expect(openRouterConfigured({ OPENROUTER_API_KEY: "test" })).toBe(true);
    expect(openRouterConfigured({ OPENROUTER_API_KEY: "" })).toBe(false);
    expect(openRouterModel("avatar", { OPENROUTER_AVATAR_MODEL: "heygen/avatar-iv" })).toBe("heygen/avatar-iv");
    expect(openRouterModel("text", {})).toBe("deepseek/deepseek-v4.1-flash");
  });

  it("returns validated JSON and falls back after a failed model request", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ error: { message: "temporary provider failure" } }, 500))
      .mockResolvedValueOnce(response({ model: "deepseek/deepseek-v4.1-flash", choices: [{ finish_reason: "stop", message: { content: '{"reply":"ready"}' } }] }));
    const result = await requestOpenRouter({
      env: { OPENROUTER_API_KEY: "test" },
      model: "qwen/qwen3.8-max-0902",
      messages: [{ role: "user", content: "reply" }],
      json: true,
      validate: (value) => { if (!(value as { reply?: string }).reply) throw new Error("missing reply"); },
      fetchImpl,
    });
    expect(result.value).toEqual({ reply: "ready" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer test");
  });

  it("sends audio to the transcription endpoint and returns text", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ text: "hello from voice" }));
    await expect(transcribeOpenRouter(Buffer.from("audio"), "wav", {
      env: { OPENROUTER_API_KEY: "test" }, fetchImpl,
    })).resolves.toBe("hello from voice");
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
    expect(body.model).toBe("openai/whisper-1");
    expect(body.input_audio).toEqual({ data: Buffer.from("audio").toString("base64"), format: "wav" });
  });

  it("sends Jev decisions through OpenRouter's dedicated endpoint", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ id: "decision-1", model: "typesafe/jev-1.13-20260917", answers: { fit: { type: "score", score: 3.8, confidence: 0.9 } }, usage: { input_tokens: 30, output_tokens: 10, cost: 0.000002 } }));
    const result = await openRouterDecision({
      env: { OPENROUTER_API_KEY: "test", APP_URL: "https://autoyt.cc" },
      state: { query: "anime" },
      questions: { fit: { type: "score", instructions: "Score it", criteria: ["low", "medium", "high"] } },
      fetchImpl,
    });
    expect(result.answers.fit.score).toBe(3.8);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("Bearer test");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ model: "typesafe/jev-1.13", state: { query: "anime" } });
  });
});
