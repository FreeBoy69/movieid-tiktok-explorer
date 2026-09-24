import { beforeEach, describe, expect, it } from "vitest";
import { registerDramaSeries } from "./dramaSeries.js";

type Handler = (req: any, res: any) => Promise<void>;

// An in-memory creator_projects table and Express stand-in.
function harness(outline: unknown) {
  const projects = new Map<string, any>();
  let nextId = 1;
  const routes = new Map<string, Handler>();
  const app = Object.fromEntries(
    ["get", "post", "patch"].map((method) => [method, (path: string, handler: Handler) => routes.set(`${method.toUpperCase()} ${path}`, handler)]),
  );
  const copied: string[][] = [];
  const dependencies = {
    getProject: async (_user: string, id: string) => structuredClone(projects.get(id) || null),
    listProjects: async () => [...projects.values()].map((project) => structuredClone(project)),
    createProject: async (_user: string, accountId: string, input: any) => {
      const existing = [...projects.values()].find((project) => input.sourceId && project.sourceId === input.sourceId && project.status !== "archived");
      if (existing) return structuredClone(existing);
      const project = {
        id: `prj_${nextId++}`,
        accountId,
        sourceType: input.sourceType,
        sourceId: input.sourceId || "",
        title: input.title,
        status: "active",
        version: 1,
        updatedAt: Date.now(),
        metadata: { brief: input.brief || "", settings: { wordCount: 600, aspect: "16:9", ...(input.settings || {}) } },
        outputs: {},
      };
      projects.set(project.id, project);
      return structuredClone(project);
    },
    updateProject: async (_user: string, id: string, input: any) => {
      const current = projects.get(id);
      if (input.expectedVersion && input.expectedVersion !== current.version) throw Object.assign(new Error("conflict"), { statusCode: 409 });
      const next = {
        ...current,
        title: input.title || current.title,
        status: input.status || current.status,
        metadata: { ...current.metadata, ...(input.metadata || {}) },
        outputs: { ...current.outputs, ...(input.outputs || {}) },
        version: current.version + 1,
        updatedAt: Date.now() + current.version,
      };
      projects.set(id, next);
      return structuredClone(next);
    },
    text: async () => JSON.stringify(outline),
  };
  const fail = (message: string, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  registerDramaSeries(app, {
    route: (handler: any) => async (req: any, res: any) => {
      try {
        await handler(req, res, { user: { id: "user" } });
      } catch (error: any) {
        res.status(error.statusCode || 400).json({ error: error.message });
      }
    },
    account: async () => ({ id: "acct" }),
    dependencies,
    fail,
    customArtStyle: async () => null,
    copyAssets: async (from: any, toId: string, assets: string[]) => {
      copied.push(assets);
      return new Map(assets.map((asset) => [asset, asset.replace(from.id, toId)]));
    },
  });
  async function call(method: string, path: string, body: any = {}, params: any = {}) {
    const handler = routes.get(`${method} ${path}`);
    if (!handler) throw new Error(`No route ${method} ${path}`);
    let status = 200,
      payload: any;
    const res = { status: (code: number) => ((status = code), res), json: (data: any) => ((payload = data), res) };
    await handler({ body, query: {}, params }, res);
    return { status, body: payload };
  }
  return { call, projects, copied };
}

const outline = {
  title: "Paper Vows",
  logline: "A nurse and a CEO sign a one-year marriage.",
  tone: "Slow burn",
  cast: [
    { id: "lily", name: "Lily Hart", role: "Nurse", appearance: "freckles", outfit: "cream sweater" },
    { id: "adrian", name: "Adrian Cole", role: "CEO", appearance: "grey eyes", outfit: "charcoal suit" },
  ],
  episodes: Array.from({ length: 5 }, (_, index) => ({ title: `Episode title ${index + 1}`, hook: `hook ${index + 1}`, payoff: "p", cliffhanger: `cliff ${index + 1}` })),
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("drama series routes", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness(outline);
  });

  it("creates a series, writes its outline in the background, and keeps the user's title", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5, episodeSeconds: 60, title: "My Contract" });
    expect(created.status).toBe(201);
    expect(created.body.series.outline).toBe("writing");
    await settle();
    const read = await h.call("GET", "/api/drama/series/:id", {}, { id: created.body.series.id });
    expect(read.body.series).toMatchObject({ outline: "ready", title: "My Contract", logline: outline.logline, episodeCount: 5 });
    expect(read.body.series.episodes.map((episode: any) => episode.n)).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects unknown templates and out-of-range episode counts", async () => {
    expect((await h.call("POST", "/api/drama/series", { templateId: "nope" })).status).toBe(400);
    expect((await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 99 })).status).toBe(400);
  });

  it("marks the outline failed when the AI returns too few episodes", async () => {
    h = harness({ ...outline, episodes: outline.episodes.slice(0, 2) });
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    await settle();
    const read = await h.call("GET", "/api/drama/series/:id", {}, { id: created.body.series.id });
    expect(read.body.series.outline).toBe("failed");
    expect(read.body.series.outlineError).toMatch(/2 of 5/);
  });

  it("starts episodes as dialogue projects that inherit voices and locked character sheets", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    await settle();
    const seriesId = created.body.series.id;
    await h.call("PATCH", "/api/drama/series/:id", { voices: { Lily: "voice-lily" } }, { id: seriesId });

    const first = await h.call("POST", "/api/drama/series/:id/episodes", { episode: 1 }, { id: seriesId });
    expect(first.status).toBe(201);
    const episode1 = first.body.project;
    expect(episode1.sourceId).toBe(`${seriesId}:1`);
    expect(episode1.metadata.drama).toMatchObject({ seriesId, episode: 1 });
    expect(episode1.metadata.settings).toMatchObject({ scriptFormat: "dialogue", aspect: "9:16", shotTemplateId: "micro-drama", voiceCast: { LILY: "voice-lily" } });
    expect(episode1.outputs.title.current).toBe("Episode title 1");
    expect(episode1.metadata.brief).toContain("Hook: hook 1");

    // Lock Lily's sheet in episode 1, as Visuals → Characters would.
    const sheet = `/api/maker/projects/${episode1.id}/assets/lily-sheet-abc.png`;
    const stored = h.projects.get(episode1.id);
    stored.metadata.referenceAssets = [sheet];
    stored.metadata.settings.visualBible.cast[0].approvedReferences = [sheet];

    const second = await h.call("POST", "/api/drama/series/:id/episodes", { episode: 2 }, { id: seriesId });
    const episode2 = second.body.project;
    const moved = sheet.replace(episode1.id, episode2.id);
    expect(h.copied).toEqual([[sheet]]);
    expect(episode2.metadata.referenceAssets).toEqual([moved]);
    expect(episode2.metadata.settings.visualBible.cast.find((c: any) => c.id === "lily").approvedReferences).toEqual([moved]);
    expect(episode2.metadata.brief).toContain("Previously: cliff 1");

    // Starting the same episode again opens it instead of duplicating it.
    const again = await h.call("POST", "/api/drama/series/:id/episodes", { episode: 2 }, { id: seriesId });
    expect(again.body.project.id).toBe(episode2.id);

    const read = await h.call("GET", "/api/drama/series/:id", {}, { id: seriesId });
    expect(read.body.episodes.map((episode: any) => episode.n)).toEqual([1, 2]);
    expect(read.body.portraits.lily.asset).toMatch(/lily-sheet-abc\.png$/);
  });

  it("asks before rewriting an outline that already has episodes", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    await settle();
    const seriesId = created.body.series.id;
    await h.call("POST", "/api/drama/series/:id/episodes", { episode: 1 }, { id: seriesId });
    expect((await h.call("POST", "/api/drama/series/:id/outline", {}, { id: seriesId })).status).toBe(409);
    expect((await h.call("POST", "/api/drama/series/:id/outline", { confirmed: true }, { id: seriesId })).status).toBe(202);
  });

  it("keeps series out of other accounts", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    h.projects.get(created.body.series.id).accountId = "someone-else";
    expect((await h.call("GET", "/api/drama/series/:id", {}, { id: created.body.series.id })).status).toBe(404);
  });
});
