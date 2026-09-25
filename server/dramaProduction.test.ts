import { describe, expect, it, vi } from "vitest";
import { registerDramaProduction } from "./dramaProduction.js";

type Handler = (req: any, res: any) => Promise<void>;

function harness(overrides: Record<string, any> = {}) {
  const projects = new Map<string, any>();
  const routes = new Map<string, Handler>();
  const app = Object.fromEntries(["get", "post", "patch"].map((method) => [method, (path: string, handler: Handler) => routes.set(`${method.toUpperCase()} ${path}`, handler)]));
  projects.set("prj_s", {
    id: "prj_s",
    accountId: "acct",
    sourceType: "drama_series",
    title: "Paper Vows",
    status: "active",
    version: 1,
    metadata: {
      drama: {
        artStyleId: "preset:documentary",
        episodeSeconds: 60,
        cast: [
          { id: "lily", name: "Lily Hart", role: "Nurse", appearance: "freckles", outfit: "sweater" },
          { id: "adrian", name: "Adrian Cole", role: "CEO", appearance: "grey eyes", outfit: "suit" },
        ],
        locations: [{ id: "office", name: "Office", description: "glass walls" }],
        voices: {},
        episodes: [{ n: 1, title: "The Contract", hook: "h", goal: "g", turn: "t", payoff: "p", cliffhanger: "c" }],
      },
      production: { characters: { lily: { candidates: ["/api/maker/projects/prj_s/assets/char-lily-a.png"] } } },
    },
  });
  projects.set("prj_e", {
    id: "prj_e",
    accountId: "acct",
    sourceType: "drama_episode",
    title: "The Contract",
    status: "active",
    version: 1,
    metadata: { drama: { seriesId: "prj_s", episode: 1 }, production: { settings: { quality: "final", subtitles: true } } },
  });
  const dependencies = {
    getProject: async (_user: string, id: string) => structuredClone(projects.get(id) || null),
    updateProject: async (_user: string, id: string, input: any) => {
      const current = projects.get(id);
      if (input.expectedVersion && input.expectedVersion !== current.version) throw Object.assign(new Error("conflict"), { statusCode: 409 });
      const next = { ...current, title: input.title || current.title, metadata: input.metadata || current.metadata, version: current.version + 1 };
      projects.set(id, next);
      return structuredClone(next);
    },
    ...overrides,
  };
  registerDramaProduction(app, {
    route: (handler: any) => async (req: any, res: any) => {
      try {
        await handler(req, res, { user: { id: "user" } });
      } catch (error: any) {
        res.status(error.statusCode || 400).json({ error: error.message });
      }
    },
    account: async () => ({ id: "acct" }),
    dependencies,
    fail: (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode }),
    files: { directory: () => "/tmp", assetUrl: (p: string, f: string) => `/api/maker/projects/${p}/assets/${f}`, outputPath: () => "/tmp/x", ensureAsset: async () => true, saveProject: async () => {}, command: async () => "", renderCreatorAssets: async () => ({}) },
  });
  async function call(method: string, path: string, body: any = {}, params: any = {}) {
    let status = 200,
      payload: any;
    const res = { status: (code: number) => ((status = code), res), json: (data: any) => ((payload = data), res) };
    await routes.get(`${method} ${path}`)!({ body, query: {}, params }, res);
    return { status, body: payload };
  }
  return { call, projects };
}

describe("drama production routes", () => {
  it("queues scene voicing and passes bounded, reusable cloned-voice settings", async () => {
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const calls: any[] = [];
    const h = harness({ narrate: async (_text: string, _work: string, options: any) => {
      calls.push(options);
      if (calls.length === 1) await first;
      throw new Error("test voice stop");
    } });
    h.projects.get("prj_s").metadata.drama.voices = { LILY: "voice-1" };
    h.projects.get("prj_e").metadata.production.script = { status: "ready", scenes: ["s1", "s2"].map((id) => ({
      id, title: id, locationId: "office", summary: "", beats: [{ id: `${id}-b1`, speaker: "LILY", line: "Hello.", emotion: "calm" }],
    })) };
    const route = "/api/drama/episodes/:id/scenes/:sid/:step";
    expect((await h.call("POST", route, {}, { id: "prj_e", sid: "s1", step: "voice" })).status).toBe(202);
    expect((await h.call("POST", route, {}, { id: "prj_e", sid: "s2", step: "voice" })).status).toBe(202);
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(h.projects.get("prj_e").metadata.production.scenes.s2.voice.progress).toBe("Waiting for the voice service");
    expect(calls[0]).toMatchObject({ reuseCompleted: true, generationTimeoutMs: 300000, profileId: "voice-1" });
    releaseFirst();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
  });

  it("saves an edited screenplay, normalized against the series cast and locations", async () => {
    const h = harness();
    const saved = await h.call(
      "PATCH",
      "/api/drama/episodes/:id",
      { scenes: [{ title: "One", locationId: "moon", beats: [{ cam: "CU", move: "Looks", speaker: "lily", line: "Hi." }, { cam: "Wide", move: "Leaves", speaker: "", line: "stray" }] }] },
      { id: "prj_e" },
    );
    expect(saved.status).toBe(200);
    const [scene] = saved.body.episode.script.scenes;
    expect(scene.locationId).toBe("office");
    expect(scene.beats.map((beat: any) => [beat.speaker, beat.line])).toEqual([["LILY", "Hi."], ["", ""]]);
    expect(saved.body.episode.cast.map((character: any) => character.speaker)).toEqual(["LILY", "ADRIAN"]);
  });

  it("only locks a sheet that was generated for that character", async () => {
    const h = harness();
    expect((await h.call("POST", "/api/drama/series/:id/characters/:cid/lock", { asset: "/api/maker/projects/prj_s/assets/other.png" }, { id: "prj_s", cid: "lily" })).status).toBe(400);
    expect((await h.call("POST", "/api/drama/series/:id/characters/:cid/lock", { asset: "/api/maker/projects/prj_s/assets/char-lily-a.png" }, { id: "prj_s", cid: "lily" })).status).toBe(200);
    expect(h.projects.get("prj_s").metadata.production.characters.lily.locked).toBe("/api/maker/projects/prj_s/assets/char-lily-a.png");
  });

  it("sets a character's voice from an existing voice for the whole series", async () => {
    const h = harness();
    await h.call("POST", "/api/drama/series/:id/characters/:cid/voice-select", { voiceId: "voicebox-123" }, { id: "prj_s", cid: "adrian" });
    expect(h.projects.get("prj_s").metadata.drama.voices).toEqual({ ADRIAN: "voicebox-123" });
  });

  it("refuses to storyboard a scene whose characters have no locked sheet, and to cut before every clip exists", async () => {
    const h = harness();
    await h.call("PATCH", "/api/drama/episodes/:id", { scenes: [{ id: "s1", title: "One", beats: [{ cam: "CU", move: "Adrian stares", speaker: "LILY", line: "Hi." }] }] }, { id: "prj_e" });
    const board = await h.call("POST", "/api/drama/episodes/:id/scenes/:sid/:step", {}, { id: "prj_e", sid: "s1", step: "board" });
    expect(board.status).toBe(400);
    expect(board.body.error).toMatch(/Lily Hart, Adrian Cole/);
    const voice = await h.call("POST", "/api/drama/episodes/:id/scenes/:sid/:step", {}, { id: "prj_e", sid: "s1", step: "voice" });
    expect(voice.body.error).toMatch(/Choose a voice for LILY/);
    const clip = await h.call("POST", "/api/drama/episodes/:id/scenes/:sid/:step", {}, { id: "prj_e", sid: "s1", step: "clip" });
    expect(clip.body.error).toMatch(/Confirm/);
    const final = await h.call("POST", "/api/drama/episodes/:id/final", {}, { id: "prj_e" });
    expect(final.body.error).toMatch(/Render every scene first: One/);
  });

  it("keeps episodes available when the active channel changes", async () => {
    const h = harness();
    h.projects.get("prj_e").accountId = "someone-else";
    expect((await h.call("GET", "/api/drama/episodes/:id", {}, { id: "prj_e" })).status).toBe(200);
  });

  it("blocks a final cut when scenes use mixed visual reference modes", async () => {
    const h = harness();
    h.projects.get("prj_e").metadata.production.script = {
      status: "ready",
      scenes: ["s1", "s2"].map((id, index) => ({
        id,
        title: index ? "Second" : "First",
        locationId: "office",
        summary: "",
        beats: [{ id: `${id}-b1`, speaker: "LILY", line: "Hello." }],
      })),
    };
    h.projects.get("prj_e").metadata.production.scenes = {
      s1: { clip: { asset: "/clip-s1.mp4", references: "text", boardAsset: "/board-s1.png", voiceAsset: "/voice-s1.wav" } },
      s2: { clip: { asset: "/clip-s2.mp4", references: "model", boardAsset: "/board-s2.png", voiceAsset: "/voice-s2.wav" } },
    };
    const final = await h.call("POST", "/api/drama/episodes/:id/final", {}, { id: "prj_e" });
    expect(final.status).toBe(400);
    expect(final.body.error).toMatch(/Render every scene first: Second/);
  });
});
