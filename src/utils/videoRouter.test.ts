import { describe, expect, it, vi } from "vitest";
import { openRouterRequest, videoRouterModel } from "./openRouterClient.js";

const env = { OPENROUTER_API_KEY: "or-key", VIDEOROUTER_API_KEY: "vr-key" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const catalog = {
  "https://videorouter.sh/api/v1/images/models": { data: [{ id: "gpt-image-2" }, { id: "pika/seedream-4.5" }, { id: "openrouter/seedream-4.5" }] },
  "https://videorouter.sh/api/v1/videos/models": { data: [{ id: "fal/seedance-2.5" }, { id: "opensand/seedance-2-0-unrestricted" }, { id: "toapis/seedance-2-0" }] },
};
// Routes each request by URL; VideoRouter calls are recorded for assertions.
function fakeFetch(handlers: Record<string, (init: any) => Response>) {
  const calls: Array<{ url: string; body?: any; auth?: string }> = [];
  const impl = vi.fn(async (url: string, init: any = {}) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : undefined, auth: init.headers?.Authorization });
    if (catalog[url as keyof typeof catalog]) return json(catalog[url as keyof typeof catalog]);
    for (const [prefix, handler] of Object.entries(handlers)) if (url.startsWith(prefix)) return handler(init);
    return json({ error: { message: `unexpected ${url}` } }, 404);
  });
  return { impl, calls };
}

describe("VideoRouter first, OpenRouter as backup", () => {
  it("maps OpenRouter model ids to VideoRouter routes, never unrestricted or pass-through ones", () => {
    const available = new Set(["gpt-image-2", "fal/seedance-2.5", "openrouter/hailuo-3", "opensand/seedance-2-0-unrestricted", "toapis/seedance-2-0"]);
    expect(videoRouterModel("openai/gpt-image-2", available)).toBe("gpt-image-2");
    expect(videoRouterModel("bytedance/seedance-2.5", available)).toBe("fal/seedance-2.5");
    expect(videoRouterModel("minimax/hailuo-3", available)).toBe("");
    expect(videoRouterModel("bytedance/seedance-2-0", available)).toBe("");
  });

  it("sends images to VideoRouter first", async () => {
    const { impl, calls } = fakeFetch({ "https://videorouter.sh/api/v1/images": () => json({ data: [{ b64_json: "aW1n" }], usage: { cost: 0.04 } }) });
    const result = await openRouterRequest("/images", { env, fetchImpl: impl as any, body: { model: "openai/gpt-image-2", prompt: "an apple" } });
    expect(result.data[0].b64_json).toBe("aW1n");
    const sent = calls.find((call) => call.url.endsWith("/api/v1/images"))!;
    expect(sent.body.model).toBe("gpt-image-2");
    expect(sent.auth).toBe("Bearer vr-key");
    expect(calls.some((call) => call.url.includes("openrouter.ai"))).toBe(false);
  });

  it("falls back to OpenRouter when VideoRouter fails", async () => {
    const { impl, calls } = fakeFetch({
      "https://videorouter.sh/api/v1/images": () => new Response("Internal Server Error", { status: 500 }),
      "https://openrouter.ai/api/v1/images": () => json({ data: [{ b64_json: "b3I=" }] }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await openRouterRequest("/images", { env, fetchImpl: impl as any, body: { model: "openai/gpt-image-2", prompt: "an apple" } });
    warn.mockRestore();
    expect(result.data[0].b64_json).toBe("b3I=");
    const backup = calls.find((call) => call.url === "https://openrouter.ai/api/v1/images")!;
    expect(backup.body.model).toBe("openai/gpt-image-2");
    expect(backup.auth).toBe("Bearer or-key");
  });

  it("keeps clips with an audio reference on OpenRouter", async () => {
    const { impl, calls } = fakeFetch({ "https://openrouter.ai/api/v1/videos": () => json({ id: "or-job" }) });
    const body = { model: "bytedance/seedance-2.5", prompt: "scene", input_references: [{ type: "image_url", image_url: { url: "data:x" } }, { type: "audio_url", audio_url: { url: "https://x/a.mp3" } }] };
    const job = await openRouterRequest("/videos", { env, fetchImpl: impl as any, body });
    expect(job.id).toBe("or-job");
    expect(calls.some((call) => call.url === "https://videorouter.sh/api/v1/videos")).toBe(false);
  });

  it("tags VideoRouter video jobs and routes their polls and downloads back to it", async () => {
    const { impl, calls } = fakeFetch({
      "https://videorouter.sh/api/v1/videos/abc": () => json({ id: "abc", status: "succeeded", url: "https://cdn.example/clip.mp4" }),
      "https://videorouter.sh/api/v1/videos": () => json({ id: "abc", status: "pending" }),
      "https://cdn.example/clip.mp4": () => new Response(new Uint8Array([1, 2, 3])),
    });
    const created = await openRouterRequest("/videos", { env, fetchImpl: impl as any, body: { model: "bytedance/seedance-2.5", prompt: "scene", duration: 6 } });
    expect(created.id).toBe("vr:abc");
    expect(calls.find((call) => call.url === "https://videorouter.sh/api/v1/videos")!.body).toMatchObject({ model: "fal/seedance-2.5", duration_secs: 6 });
    const endpoint = `/videos/${encodeURIComponent(created.id)}`;
    expect((await openRouterRequest(endpoint, { env, fetchImpl: impl as any })).status).toBe("completed");
    const bytes = await openRouterRequest(`${endpoint}/content`, { env, fetchImpl: impl as any, binary: true });
    expect([...bytes]).toEqual([1, 2, 3]);
    // The presigned download link gets no credentials.
    expect(calls.find((call) => call.url === "https://cdn.example/clip.mp4")!.auth).toBeUndefined();
  });

  it("uses OpenRouter only when no VideoRouter key is set", async () => {
    const { impl, calls } = fakeFetch({ "https://openrouter.ai/api/v1/images": () => json({ data: [{ b64_json: "b3I=" }] }) });
    await openRouterRequest("/images", { env: { OPENROUTER_API_KEY: "or-key" }, fetchImpl: impl as any, body: { model: "openai/gpt-image-2", prompt: "x" } });
    expect(calls.every((call) => call.url.startsWith("https://openrouter.ai"))).toBe(true);
  });
});
