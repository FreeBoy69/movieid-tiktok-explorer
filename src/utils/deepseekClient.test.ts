import { describe, expect, it, vi } from "vitest";
import { requestDeepSeek } from "./deepseekClient.js";

function response(body: unknown, headers: Record<string, string> = {}) {
  return { ok: true, status: 200, headers: { get: (name: string) => headers[name] || null }, json: async () => body } as Response;
}

describe("DeepSeek request client", () => {
  it("retries truncated JSON with more room and returns the complete object", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ choices: [{ finish_reason: "length", message: { content: '{"title":"partial' } }] }))
      .mockResolvedValueOnce(response({ choices: [{ finish_reason: "stop", message: { content: '{"title":"complete"}' } }] }));
    const value = await requestDeepSeek({ apiKey: "test", baseUrl: "https://deepseek.test", model: "deepseek-v4-flash", messages: [], json: true, maxTokens: 512, fetchImpl, sleep: async () => undefined, logger: { info: vi.fn(), warn: vi.fn() } });
    expect(value).toEqual({ title: "complete" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = JSON.parse(fetchImpl.mock.calls[0][1].body);
    const second = JSON.parse(fetchImpl.mock.calls[1][1].body);
    expect(first.thinking).toEqual({ type: "disabled" });
    expect(second.max_tokens).toBeGreaterThan(first.max_tokens);
    expect(second.messages.at(-1).content).toMatch(/complete/i);
  });

  it("retries invalid JSON and validates the required shape", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }))
      .mockResolvedValueOnce(response({ choices: [{ finish_reason: "stop", message: { content: '{"reply":"Thanks"}' } }] }));
    const validate = vi.fn((value: unknown) => {
      if (!(value as { reply?: string })?.reply) throw new Error("missing reply");
    });
    await expect(requestDeepSeek({ apiKey: "test", model: "deepseek-v4-flash", messages: [], json: true, fetchImpl, sleep: async () => undefined, validate, logger: { info: vi.fn(), warn: vi.fn() } })).resolves.toEqual({ reply: "Thanks" });
    expect(validate).toHaveBeenCalledWith({ reply: "Thanks" });
  });
});
