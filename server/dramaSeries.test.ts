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
    generatePosterImage: async (project: any) => `/api/maker/projects/${project.id}/assets/series-cover.png`,
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
const originalConcept = {
  title: "The Ember Road",
  genre: "Prehistoric survival",
  premise: "A young firekeeper must carry her tribe's final ember across a flooded gorge while a rival hunter tries to take control of the group.",
  logline: "One ember stands between a tribe and a freezing night.",
  tone: "Grounded and urgent",
  visualPrompt: "A firekeeper protects a glowing ember in a rain-soaked cave",
  artStyleId: "preset:documentary",
  cast: outline.cast,
  locations: [{ id: "cave", name: "Shelter cave", description: "Dark stone cave above a flooded gorge" }],
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

  it("creates an original series without a template and generates its own cover", async () => {
    const created = await h.call("POST", "/api/drama/series", { concept: originalConcept, episodeCount: 5, episodeSeconds: 60 });
    expect(created.status).toBe(201);
    expect(created.body.series).toMatchObject({ title: originalConcept.title, templateId: "", posterStatus: "writing" });
    await settle();
    const read = await h.call("GET", "/api/drama/series/:id", {}, { id: created.body.series.id });
    expect(read.body.series).toMatchObject({ outline: "ready", posterStatus: "ready", genre: originalConcept.genre, poster: `/api/maker/projects/${created.body.series.id}/assets/series-cover.png` });
    expect(read.body.series.cast).toHaveLength(2);
    expect(read.body.series.locations).toHaveLength(1);
    expect(h.projects.get(created.body.series.id).createdFrom).not.toBe("drama-template");
  });

  it("accepts a landscape scene format and carries it into the series settings", async () => {
    const created = await h.call("POST", "/api/drama/series", {
      templateId: "contract-bride",
      shotTemplateId: "movie-trailer",
      episodeCount: 3,
      episodeSeconds: 60,
    });
    expect(created.status).toBe(201);
    const project = h.projects.get(created.body.series.id);
    expect(project.metadata.drama.shotTemplateId).toBe("movie-trailer");
    expect(project.metadata.settings.aspect).toBe("16:9");
  });

  it("develops an idea in chat before any series is created", async () => {
    h = harness(originalConcept);
    const result = await h.call("POST", "/api/drama/idea", { messages: [{ role: "user", content: "A prehistoric firekeeper story" }] });
    expect(result.status).toBe(200);
    expect(result.body.concept).toMatchObject({ title: originalConcept.title, genre: originalConcept.genre });
    expect(h.projects.size).toBe(0);
  });

  it("rejects an incomplete original concept", async () => {
    const created = await h.call("POST", "/api/drama/series", { concept: { ...originalConcept, cast: [] } });
    expect(created.status).toBe(400);
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

  it("starts episodes as drama episodes that point back to their series", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    await settle();
    const seriesId = created.body.series.id;
    await h.call("PATCH", "/api/drama/series/:id", { voices: { Lily: "voice-lily" } }, { id: seriesId });
    expect(h.projects.get(seriesId).metadata.drama.voices).toEqual({ LILY: "voice-lily" });

    const first = await h.call("POST", "/api/drama/series/:id/episodes", { episode: 2 }, { id: seriesId });
    expect(first.status).toBe(201);
    const episode = h.projects.get(first.body.project.id);
    expect(episode.sourceType).toBe("drama_episode");
    expect(episode.sourceId).toBe(`${seriesId}:2`);
    expect(episode.metadata.drama).toMatchObject({ seriesId, episode: 2 });
    expect(episode.metadata.production.settings).toEqual({ quality: "final", subtitles: true });
    expect(episode.metadata.brief).toContain("Previously: cliff 1");

    // Starting the same episode again opens it instead of duplicating it.
    const again = await h.call("POST", "/api/drama/series/:id/episodes", { episode: 2 }, { id: seriesId });
    expect(again.body.project.id).toBe(episode.id);

    const read = await h.call("GET", "/api/drama/series/:id", {}, { id: seriesId });
    expect(read.body.episodes).toMatchObject([{ n: 2, legacy: false, done: 0, stages: 5 }]);
    expect(read.body.series.locations).toEqual([]);
  });

  it("asks before rewriting an outline that already has episodes", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    await settle();
    const seriesId = created.body.series.id;
    await h.call("POST", "/api/drama/series/:id/episodes", { episode: 1 }, { id: seriesId });
    expect((await h.call("POST", "/api/drama/series/:id/outline", {}, { id: seriesId })).status).toBe(409);
    expect((await h.call("POST", "/api/drama/series/:id/outline", { confirmed: true }, { id: seriesId })).status).toBe(202);
  });

  it("keeps series available when the active channel changes", async () => {
    const created = await h.call("POST", "/api/drama/series", { templateId: "contract-bride", episodeCount: 5 });
    h.projects.get(created.body.series.id).accountId = "someone-else";
    expect((await h.call("GET", "/api/drama/series/:id", {}, { id: created.body.series.id })).status).toBe(200);
  });
});
