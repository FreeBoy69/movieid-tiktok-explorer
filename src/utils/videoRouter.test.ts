// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { openRouterRequest, videoRouterModel } from "./openRouterClient.js";

const env = { OPENROUTER_API_KEY: "or-key", VIDEOROUTER_API_KEY: "vr-key" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const catalog = {
  "https://videorouter.sh/api/v1/images/models": { data: [{ id: "gpt-image-2" }, { id: "pika/seedream-4.5" }, { id: "openrouter/seedream-4.5" }] },
  "https://videorouter.sh/api/v1/videos/models": { data: [
    { id: "fal/seedance-2.5" }, { id: "fal/seedance-2.5-reference" }, { id: "fal/seedance-2.0-fast-reference" },
    { id: "opensand/seedance-2-5" }, { id: "opensand/seedance-2-0-unrestricted" },
    { id: "atlascloud/seedance-2.0-fast" }, { id: "toapis/seedance-2-0" },
  ] },
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

  it("prefers the cheapest provider over the first id that matches", () => {
    const available = new Set(["fal/seedance-2.5", "opensand/seedance-2-5", "atlascloud/seedance-2.0-fast", "fal/seedance-2.0-fast"]);
    // Seedance 2.5: OpenSand ($0.0525/s) undercuts fal ($0.2205/s) by 4.2x.
    expect(videoRouterModel("bytedance/seedance-2.5", available)).toBe("opensand/seedance-2-5");
    // Seedance 2.0 Fast: Atlas Cloud ($0.027/s) undercuts fal ($0.2419/s) by 9x.
    expect(videoRouterModel("bytedance/seedance-2.0-fast", available)).toBe("atlascloud/seedance-2.0-fast");
  });

  it("falls through to the next cheapest provider when the cheapest is unavailable", () => {
    expect(videoRouterModel("bytedance/seedance-2.5", new Set(["fal/seedance-2.5"]))).toBe("fal/seedance-2.5");
    expect(videoRouterModel("bytedance/seedance-2.0-fast", new Set(["machgen/seedance-2.0-fast", "fal/seedance-2.0-fast"]))).toBe("machgen/seedance-2.0-fast");
  });

  it("still refuses OpenSand's filter-free unrestricted routes", () => {
    expect(videoRouterModel("bytedance/seedance-2.5", new Set(["opensand/seedance-2-5-unrestricted"]))).toBe("");
  });

  it("sends images to VideoRouter first", async () => {
    const { impl, calls } = fakeFetch({ "https://videorouter.sh/api/v1/images": () => json({ data: [{ b64_json: "aW1n" }], usage: { cost: 0.04 } }) });
    const result = await openRouterRequest("/images", { env, fetchImpl: impl as any, body: { model: "openai/gpt-image-2", prompt: "an apple" } });
    expect(result.data[0].b64_json).toBe("aW1n");
    const sent = calls.find((call) => call.url.endsWith("/api/v1/images"))!;
    expect(sent.body.model).toBe("openai/gpt-image-2");
    expect(sent.body.provider).toEqual({ sort: "price", ignore: ["toapis", "openrouter"] });
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

  it("sends Seedance dialogue tracks to VideoRouter's reference model", async () => {
    const { impl, calls } = fakeFetch({ "https://videorouter.sh/api/v1/videos": () => json({ id: "vr-job" }) });
    const body = { model: "bytedance/seedance-2.5", prompt: "scene", input_references: [{ type: "image_url", image_url: { url: "data:x" } }, { type: "audio_url", audio_url: { url: "https://x/a.mp3" } }] };
    const job = await openRouterRequest("/videos", { env, fetchImpl: impl as any, body });
    expect(job.id).toBe("vr:vr-job");
    const sent = calls.find((call) => call.url === "https://videorouter.sh/api/v1/videos")!.body;
    expect(sent.model).toBe("fal/seedance-2.5-reference");
    expect(sent.input_references).toEqual([body.input_references[0]]);
    expect(sent.input_audio_references).toEqual([body.input_references[1]]);
    expect(calls.some((call) => call.url.includes("openrouter.ai"))).toBe(false);
  });

  it("routes draft Seedance dialogue through its Fast reference variant", async () => {
    const { impl, calls } = fakeFetch({ "https://videorouter.sh/api/v1/videos": () => json({ id: "draft" }) });
    await openRouterRequest("/videos", { env, fetchImpl: impl as any, body: {
      model: "bytedance/seedance-2.0-fast", prompt: "scene", duration: 7,
      input_references: [{ type: "audio_url", audio_url: { url: "https://x/a.mp3" } }],
    } });
    expect(calls.find((call) => call.url === "https://videorouter.sh/api/v1/videos")!.body).toMatchObject({
      model: "fal/seedance-2.0-fast-reference", duration_secs: 7,
      input_audio_references: [{ type: "audio_url", audio_url: { url: "https://x/a.mp3" } }],
    });
  });

  it("falls back to OpenRouter with the original dialogue references when VideoRouter rejects a scene", async () => {
    const { impl, calls } = fakeFetch({
      "https://videorouter.sh/api/v1/videos": () => json({ error: { message: "unsupported duration" } }, 400),
      "https://openrouter.ai/api/v1/videos": () => json({ id: "or-job" }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const body = { model: "bytedance/seedance-2.5", prompt: "scene", input_references: [{ type: "audio_url", audio_url: { url: "https://x/a.mp3" } }] };
    const job = await openRouterRequest("/videos", { env, fetchImpl: impl as any, body });
    warn.mockRestore();
    expect(job.id).toBe("or-job");
    expect(calls.find((call) => call.url === "https://openrouter.ai/api/v1/videos")!.body).toEqual(body);
  });

  it("keeps other audio-reference models on OpenRouter", async () => {
    const { impl, calls } = fakeFetch({ "https://openrouter.ai/api/v1/videos": () => json({ id: "or-job" }) });
    const body = { model: "other/video-model", prompt: "scene", input_references: [{ type: "audio_url", audio_url: { url: "https://x/a.mp3" } }] };
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
    const job = await openRouterRequest("/videos", { env, fetchImpl: impl as any, body: {
      model: "bytedance/seedance-2.5", prompt: "scene", duration: 6,
    } });
    expect(job.id).toBe("vr:abc");
    // The canonical id lets VideoRouter rank live host prices itself.
    expect(calls.find((call) => call.url === "https://videorouter.sh/api/v1/videos")!.body).toMatchObject({
      model: "bytedance/seedance-2.5", duration_secs: 6, provider: { sort: "price", ignore: ["toapis", "openrouter"] },
    });
    const endpoint = `/videos/${encodeURIComponent(job.id)}`;
    expect((await openRouterRequest(endpoint, { env, fetchImpl: impl as any })).status).toBe("completed");
    const bytes = await openRouterRequest(`${endpoint}/content`, { env, fetchImpl: impl as any, binary: true });
    expect([...bytes]).toEqual([1, 2, 3]);
    // The presigned download link gets no credentials.
    expect(calls.find((call) => call.url === "https://cdn.example/clip.mp4")!.auth).toBeUndefined();
  });

  it("drops a caller's OpenRouter provider order so it cannot override price ranking", async () => {
    const { impl, calls } = fakeFetch({ "https://videorouter.sh/api/v1/videos": () => json({ id: "p" }) });
    await openRouterRequest("/videos", { env, fetchImpl: impl as any, body: { model: "alibaba/wan-3.0", prompt: "s", provider: { order: ["fal"] } } });
    expect(calls.find((call) => call.url === "https://videorouter.sh/api/v1/videos")!.body.provider).toEqual({ sort: "price", ignore: ["toapis", "openrouter"] });
  });

  it("sends OpenRouter-only spellings under VideoRouter's canonical name", async () => {
    const { impl, calls } = fakeFetch({ "https://videorouter.sh/api/v1/videos": () => json({ id: "h3" }) });
    await openRouterRequest("/videos", { env, fetchImpl: impl as any, body: { model: "minimax/hailuo-3", prompt: "s" } });
    expect(calls.find((call) => call.url === "https://videorouter.sh/api/v1/videos")!.body.model).toBe("minimax/h3");
  });

  it("retries an unknown canonical id with the cheapest host id, and remembers the miss", async () => {
    const sentModels: string[] = [];
    const { impl } = fakeFetch({ "https://videorouter.sh/api/v1/images": (init) => {
      const model = JSON.parse(init.body).model;
      sentModels.push(model);
      return model === "bytedance-seed/seedream-4.5"
        ? json({ error: { message: "unknown image model 'bytedance-seed/seedream-4.5'" } }, 400)
        : json({ data: [{ b64_json: "c2Q=" }] });
    } });
    const body = { model: "bytedance-seed/seedream-4.5", prompt: "x" };
    expect((await openRouterRequest("/images", { env, fetchImpl: impl as any, body })).data[0].b64_json).toBe("c2Q=");
    await openRouterRequest("/images", { env, fetchImpl: impl as any, body });
    expect(sentModels).toEqual(["bytedance-seed/seedream-4.5", "pika/seedream-4.5", "pika/seedream-4.5"]);
  });

  it("uses OpenRouter only when no VideoRouter key is set", async () => {
    const { impl, calls } = fakeFetch({ "https://openrouter.ai/api/v1/images": () => json({ data: [{ b64_json: "b3I=" }] }) });
    await openRouterRequest("/images", { env: { OPENROUTER_API_KEY: "or-key" }, fetchImpl: impl as any, body: { model: "openai/gpt-image-2", prompt: "x" } });
    expect(calls.every((call) => call.url.startsWith("https://openrouter.ai"))).toBe(true);
  });
});
