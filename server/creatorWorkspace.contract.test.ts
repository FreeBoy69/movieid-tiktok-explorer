import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  animationCapability,
  sceneClipSeconds,
  resetSceneClipSeconds,
  channelBlueprint,
  assembleAudio,
  musicCapability,
  streamOpenRouterAudio,
  youtubeVideoId,
  configureCreatorWorkspace,
  extractStyleFrames,
  registerCreatorWorkspace,
  similarChannelQuery,
  safeStyleVideoUrl,
  withMinimalBodyOn400,
} from "./creatorWorkspace.js";

describe("video style capture utilities", () => {
  it("accepts supported public video hosts and rejects local or disguised URLs", () => {
    expect(safeStyleVideoUrl("https://www.youtube.com/watch?v=abcdefghijk")).toContain("youtube.com");
    expect(safeStyleVideoUrl("http://127.0.0.1/private.mp4")).toBe("");
    expect(safeStyleVideoUrl("https://youtube.com.evil.test/watch?v=x")).toBe("");
  });

  it("extracts four distributed frames from a local synthetic video", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "creator-style-"));
    const video = path.join(dir, "sample.mp4");
    try {
      const made = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", [
        "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12", "-t", "2", "-pix_fmt", "yuv420p", video,
      ], { stdio: "ignore" });
      expect(made.status).toBe(0);
      const frames = await extractStyleFrames(video, path.join(dir, "frames"));
      expect(frames).toHaveLength(4);
      expect(frames.every((frame) => fs.statSync(frame.file).size > 0)).toBe(true);
      expect(frames.map((frame) => frame.timestamp)).toEqual([...frames.map((frame) => frame.timestamp)].sort((a, b) => a - b));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 20_000);
});

type Project = {
  id: string;
  accountId: string;
  title: string;
  status: string;
  stage: string;
  styleId: string;
  metadata: Record<string, any>;
  outputs: Record<string, any>;
  inputVersions: Record<string, string>;
  version: number;
  updatedAt: number;
};

type Job = {
  id: string;
  projectId: string | null;
  styleId: string | null;
  accountId: string | null;
  userId: string;
  stage: string;
  status: string;
  progress: number;
  message: string;
  error: string;
  createdAt: number;
  updatedAt: number;
};

const quote = (value: unknown) =>
  `'${String(value ?? "").replace(/'/g, "''")}'`;

function valueFor(sql: string, field: string) {
  const match = sql.match(new RegExp(`${field}=('(?:[^']|'')*')`));
  return match ? match[1].slice(1, -1).replace(/''/g, "'") : "";
}

describe("creator workspace API contracts", () => {
  let projects: Map<string, Project>;
  let jobs: Job[];
  let baseUrl = "";
  let server: ReturnType<typeof createServer> | null = null;
  let radarInput: any = null;
  let radarVideos: any[] = [];

  beforeEach(async () => {
    projects = new Map([
      [
        "p1",
        {
          id: "p1",
          accountId: "a1",
          title: "Project one",
          status: "active",
          stage: "title",
          styleId: "",
          metadata: { brief: "Brief", settings: {} },
          outputs: {},
          inputVersions: { title: "fp-title" },
          version: 1,
          updatedAt: Date.now(),
        },
      ],
    ]);
    jobs = [];

    const runPsql = async (sql: string) => {
      if (/INSERT INTO creator_stage_jobs/i.test(sql)) {
        const values = sql.match(
          /VALUES\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']*)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/i,
        );
        if (!values) throw new Error(`Could not parse job insert: ${sql}`);
        const [, id, projectId, userId, accountId, stage] = values;
        if (
          jobs.some(
            (job) =>
              job.projectId === projectId &&
              job.stage === stage &&
              ["queued", "running"].includes(job.status),
          )
        )
          return "INSERT 0 0";
        jobs.push({
          id,
          projectId: projectId || null,
          styleId: valueFor(sql, "style_id") || null,
          accountId: accountId || null,
          userId,
          stage,
          status: "queued",
          progress: 0,
          message: "Queued",
          error: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        return "INSERT 0 1";
      }
      if (
        /FROM creator_stage_jobs/i.test(sql) &&
        /json_agg/i.test(sql)
      ) {
        return JSON.stringify(jobs);
      }
      if (
        /UPDATE creator_stage_jobs SET status='cancelled'/i.test(sql) &&
        /project_id=/i.test(sql)
      ) {
        const projectId = valueFor(sql, "project_id");
        for (const job of jobs)
          if (job.projectId === projectId) {
            job.status = "cancelled";
            job.message = "Stopped because the project changed";
          }
        return "";
      }
      if (
        /UPDATE creator_stage_jobs SET status='cancelled'/i.test(sql) &&
        /WHERE id=/i.test(sql)
      ) {
        const id = valueFor(sql, "id");
        const job = jobs.find((item) => item.id === id);
        if (job) {
          job.status = "cancelled";
          job.message = "Stopped";
        }
        return "";
      }
      throw new Error(`Unexpected SQL in creator contract test: ${sql}`);
    };

    configureCreatorWorkspace({
      runPsql,
      sqlString: quote,
      jsonbLiteral: quote,
      session: async (req: any) => {
        const userId = String(req.headers["x-test-user"] || "");
        return userId ? { user: { id: userId } } : null;
      },
      account: async (_userId: string, accountId: string) => ({
        id: accountId,
      }),
      getProject: async (userId: string, projectId: string) => {
        if (userId !== "u1") return null;
        return projects.get(projectId) || null;
      },
      updateProject: async (
        userId: string,
        projectId: string,
        input: any,
      ) => {
        const project = projects.get(projectId);
        if (!project || userId !== "u1") throw new Error("Project not found");
        if (input.accountId && input.accountId !== project.accountId)
          throw new Error("Project not found");
        if (
          input.expectedVersion &&
          Number(input.expectedVersion) !== project.version
        ) {
          const error = new Error(
            "This project changed in another tab. Reload it and reapply your edits.",
          ) as Error & { statusCode?: number };
          error.statusCode = 409;
          throw error;
        }
        const updated = {
          ...project,
          ...input,
          metadata: input.metadata || project.metadata,
          outputs: input.outputs || project.outputs,
          version: project.version + 1,
          updatedAt: Date.now(),
        };
        projects.set(projectId, updated);
        return updated;
      },
      createProject: async () => null,
      styles: async () => [],
      radar: async (input: any) => {
        radarInput = input;
        return { videos: radarVideos };
      },
      text: async () => "{}",
      narrate: async () => null,
      transcribe: async () => null,
      learnStyle: async () => null,
      buildStyle: async () => null,
      projectAccount: async () => ({ id: "a1" }),
    });

    const app = express();
    app.use(express.json());
    registerCreatorWorkspace(app);
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) =>
        server!.close((error) => (error ? reject(error) : resolve())),
      );
      server = null;
    }
  });

  async function request(path: string, init: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-test-user": "u1",
        ...(init.headers || {}),
      },
    });
  }

  it("rejects unauthenticated and cross-channel project access", async () => {
    const unauthenticated = await fetch(`${baseUrl}/api/maker/projects/p1`);
    expect(unauthenticated.status).toBe(401);

    const crossChannel = await request(
      "/api/maker/projects/p1?accountId=a2",
    );
    expect(crossChannel.status).toBe(404);
  });

  it("requires project ownership and explicit rights for video style capture", async () => {
    const noRights = await request("/api/maker/art-styles/from-video", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1", projectId: "p1", sourceUrl: "https://youtu.be/abcdefghijk" }),
    });
    expect(noRights.status).toBe(400);
    expect((await noRights.json()).error).toMatch(/permission/i);

    const wrongChannel = await request("/api/maker/art-styles/from-video", {
      method: "POST",
      body: JSON.stringify({ accountId: "a2", projectId: "p1", sourceUrl: "https://youtu.be/abcdefghijk", rightsConfirmed: true }),
    });
    expect(wrongChannel.status).toBe(404);
  });

  it("makes an active stage request idempotent", async () => {
    const first = await request("/api/maker/projects/p1/jobs/title", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1" }),
    });
    const second = await request("/api/maker/projects/p1/jobs/title", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1" }),
    });
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    if (!firstBody.job || !secondBody.job)
      throw new Error(
        `Missing job: ${JSON.stringify({ firstBody, secondBody, jobs })}`,
      );
    expect(secondBody.job.id).toBe(firstBody.job.id);
    expect(jobs).toHaveLength(1);
  });

  it("cancels queued work and reports it as stopped", async () => {
    const queued = await request("/api/maker/projects/p1/jobs/title", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1" }),
    });
    const { job } = await queued.json();
    const stopped = await request(`/api/maker/jobs/${job.id}/stop`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toEqual({ stopped: true });
    expect(jobs[0].status).toBe("cancelled");
  });

  it("cancels active jobs before archiving a project", async () => {
    await request("/api/maker/projects/p1/jobs/title", {
      method: "POST",
      body: JSON.stringify({ accountId: "a1" }),
    });
    const archived = await request("/api/maker/projects/p1", {
      method: "PATCH",
      body: JSON.stringify({
        accountId: "a1",
        status: "archived",
        expectedVersion: 1,
      }),
    });
    expect(archived.status).toBe(200);
    expect(jobs[0].status).toBe("cancelled");
    expect(projects.get("p1")?.status).toBe("archived");
  });

  it("returns a conflict instead of overwriting a stale editor draft", async () => {
    projects.get("p1")!.version = 2;
    const response = await request("/api/maker/projects/p1", {
      method: "PATCH",
      body: JSON.stringify({
        accountId: "a1",
        title: "Stale title",
        expectedVersion: 1,
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/changed in another tab/i),
    });
  });

  it("finds similar channels without returning the source channel", async () => {
    radarVideos = [
      { id: "v1", channelId: "source", channelTitle: "Source", viewCount: 900 },
      { id: "v2", channelId: "other", channelTitle: "Other", viewCount: 500 },
    ];
    const response = await request("/api/maker/similar", {
      method: "POST",
      body: JSON.stringify({
        accountId: "a1",
        channel: {
          id: "source",
          niche: "true crime",
          titles: ["The heist that fooled the FBI", "How the FBI solved the heist"],
        },
      }),
    });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(radarInput.query).toMatch(/^true crime/);
    expect(radarInput.query).toMatch(/heist|fbi/);
    expect(body.videos.map((video: any) => video.channelId)).toEqual(["other"]);
  });

  describe("TubeGen parity routes", () => {
    let root = "";
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]);
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-parity-"));
      process.env.CREATOR_ASSETS_DIR = root;
    });
    afterEach(() => {
      delete process.env.CREATOR_ASSETS_DIR;
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("stores an uploaded thumbnail reference and selects it", async () => {
      const response = await request("/api/maker/projects/p1/thumbnail-reference", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", image: png.toString("base64"), mediaType: "image/png", expectedVersion: 1 }),
      });
      expect(response.status).toBe(200);
      const project = projects.get("p1")!;
      const reference = project.metadata.settings.thumbnailReference;
      expect(reference).toMatch(/^\/api\/maker\/projects\/p1\/assets\/[a-f0-9-]+-reference\.png$/);
      expect(project.metadata.referenceAssets).toContain(reference);
      expect(fs.readdirSync(path.join(root, "p1")).some((name) => name.endsWith("-reference.png"))).toBe(true);
    });

    it("rejects a thumbnail reference that is not an image or not a YouTube link", async () => {
      const fake = await request("/api/maker/projects/p1/thumbnail-reference", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", image: Buffer.from("not an image at all").toString("base64"), mediaType: "image/png" }),
      });
      expect(fake.status).toBe(400);
      const link = await request("/api/maker/projects/p1/thumbnail-reference", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", youtubeUrl: "https://example.com/watch?v=abc" }),
      });
      expect(link.status).toBe(400);
      expect(projects.get("p1")!.metadata.settings.thumbnailReference).toBeUndefined();
    });

    it("drops a thumbnail reference that does not belong to the project", async () => {
      const response = await request("/api/maker/projects/p1", {
        method: "PATCH",
        body: JSON.stringify({ accountId: "a1", settings: { thumbnailReference: "/api/maker/projects/p2/assets/x-reference.png" }, expectedVersion: 1 }),
      });
      expect(response.status).toBe(200);
      expect(projects.get("p1")!.metadata.settings.thumbnailReference).toBe("");
    });

    it("refuses to switch a project to a style that does not exist", async () => {
      const response = await request("/api/maker/projects/p1", {
        method: "PATCH",
        body: JSON.stringify({ accountId: "a1", styleId: "missing-style", expectedVersion: 1 }),
      });
      expect(response.status).toBe(404);
      expect(projects.get("p1")!.styleId).toBe("");
    });

    it("requires confirmation before composing paid music", async () => {
      const project = projects.get("p1")!;
      project.outputs = { title: { current: "A title" }, script: { draft: "Narration." } };
      const response = await request("/api/maker/projects/p1/jobs/soundtrack", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", action: "music" }),
      });
      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/Confirm/);
      expect(jobs).toHaveLength(0);
    });

    it("keeps art styles out of research collections", async () => {
      const response = await request("/api/maker/collections", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", name: "x", data: { kind: "artStyle", images: ["../../etc.png"] } }),
      });
      expect(response.status).toBe(400);
    });
  });

  describe("storage and pruning", () => {
    let root = "";
    beforeEach(() => {
      root = fs.mkdtempSync(path.join(os.tmpdir(), "creator-assets-"));
      process.env.CREATOR_ASSETS_DIR = root;
      const dir = path.join(root, "p1");
      fs.mkdirSync(path.join(dir, "job_render"), { recursive: true });
      fs.writeFileSync(path.join(dir, "job_render", "clip-0.mp4"), Buffer.alloc(4000));
      fs.writeFileSync(path.join(dir, "job_a-scene-1.png"), Buffer.alloc(2000));
      fs.writeFileSync(path.join(dir, "job_b-voice.wav"), Buffer.alloc(3000));
      fs.writeFileSync(path.join(dir, "job_c-video.mp4"), Buffer.alloc(5000));
      const project = projects.get("p1")!;
      project.outputs = {
        voiceover: { asset: "/api/maker/projects/p1/assets/job_b-voice.wav" },
        visualPlan: { scenes: [{ id: "scene-1", prompt: "desk", asset: "/api/maker/projects/p1/assets/job_a-scene-1.png" }] },
        review: { asset: "/api/maker/projects/p1/assets/job_c-video.mp4" },
      };
    });
    afterEach(() => {
      delete process.env.CREATOR_ASSETS_DIR;
      fs.rmSync(root, { recursive: true, force: true });
    });

    it("reports storage by category", async () => {
      const response = await request("/api/maker/projects/p1/storage?accountId=a1");
      const { storage } = await response.json();
      const bytes = Object.fromEntries(storage.map((group: any) => [group.key, group.bytes]));
      expect(bytes).toMatchObject({ workspace: 4000, images: 2000, voiceover: 3000, renders: 5000 });
      expect(storage.find((group: any) => group.key === "voiceover").prunable).toBe(false);
    });

    it("requires confirmation and never removes kept categories", async () => {
      const unconfirmed = await request("/api/maker/projects/p1/prune", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", categories: ["images"] }),
      });
      expect(unconfirmed.status).toBe(400);
      const keptOnly = await request("/api/maker/projects/p1/prune", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", categories: ["voiceover"], confirmed: true }),
      });
      expect(keptOnly.status).toBe(400);
      expect(fs.existsSync(path.join(root, "p1", "job_b-voice.wav"))).toBe(true);
    });

    it("removes chosen files and records a manifest", async () => {
      const response = await request("/api/maker/projects/p1/prune", {
        method: "POST",
        body: JSON.stringify({ accountId: "a1", categories: ["images", "workspace", "renders"], confirmed: true, expectedVersion: 1 }),
      });
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body.removedBytes).toBe(11000);
      expect(fs.existsSync(path.join(root, "p1", "job_a-scene-1.png"))).toBe(false);
      expect(fs.existsSync(path.join(root, "p1", "job_render"))).toBe(false);
      expect(fs.existsSync(path.join(root, "p1", "job_b-voice.wav"))).toBe(true);
      const project = projects.get("p1")!;
      expect(project.outputs.visualPlan.scenes[0].asset).toBeUndefined();
      expect(project.outputs.visualPlan.scenes[0].prompt).toBe("desk");
      expect(project.outputs.review).toBeNull();
      expect(project.metadata.removedAssets.at(-1).files).toHaveLength(3);
    });
  });
});

describe("creator helpers", () => {
  it("builds a similar-channel query from niche and repeated title words", () => {
    expect(
      similarChannelQuery({
        niche: "space",
        titles: ["The Mars mission nobody saw", "Why Mars killed the mission", "Venus explained"],
      }),
    ).toBe("space mars mission nobody");
    expect(similarChannelQuery({})).toBe("");
  });

  it("reports animation as unavailable with an actionable reason", () => {
    expect(animationCapability({})).toMatchObject({ available: false, reason: expect.stringMatching(/isn't set up/) });
    // MiniMax Hailuo 3 is the default; a configured model is offered as an alternative.
    expect(animationCapability({ OPENROUTER_API_KEY: "k" })).toMatchObject({ available: true, model: "minimax/hailuo-3" });
    const withConfigured = animationCapability({ OPENROUTER_API_KEY: "k", OPENROUTER_VIDEO_MODEL: "vendor/model" });
    expect(withConfigured).toMatchObject({ available: true, model: "minimax/hailuo-3" });
    expect(withConfigured.models).toContain("vendor/model");
  });

  it("lists every configured animation model and reports music setup", () => {
    expect(
      animationCapability({ OPENROUTER_API_KEY: "k", OPENROUTER_VIDEO_MODEL: "a/one", OPENROUTER_VIDEO_MODELS: "b/two, a/one ,c/three" }).models,
    ).toEqual(["minimax/hailuo-3", "a/one", "b/two", "c/three", "x-ai/grok-imagine-video-1.5", "x-ai/grok-imagine-video"]);
    expect(musicCapability({})).toMatchObject({ available: false, reason: expect.stringMatching(/royalty-free/) });
    expect(musicCapability({ OPENROUTER_API_KEY: "k" })).toMatchObject({ available: true, model: "google/lyria-3-pro-preview" });
    expect(JSON.stringify([musicCapability({}), animationCapability({}), animationCapability({ OPENROUTER_API_KEY: "k" })])).not.toMatch(/openrouter/i);
  });

  it("animates each scene at the shortest clip length its model accepts", async () => {
    resetSceneClipSeconds();
    const catalog = async () => ({ data: [{ id: "x-ai/grok-imagine-video-1.5", supported_durations: [1, 2, 3, 4, 5, 6, 8, 10, 15] }, { id: "google/veo-3.1", supported_durations: [8, 4, 6] }] });
    expect(await sceneClipSeconds("x-ai/grok-imagine-video-1.5", 3.2, catalog)).toBe(4);
    expect(await sceneClipSeconds("google/veo-3.1", 4.6, catalog)).toBe(6);
    expect(await sceneClipSeconds("google/veo-3.1", 30, catalog)).toBe(8);
    expect(await sceneClipSeconds("unknown/model", 2, catalog)).toBe(4);
    resetSceneClipSeconds();
  });

  it("collects streamed audio chunks that split base64 groups mid-way", async () => {
    const wav = Buffer.alloc(4044);
    wav.write("RIFF", 0, "ascii");
    wav.writeUInt32LE(4036, 4);
    wav.write("WAVEfmt ", 8, "ascii");
    wav.write("data", 36, "ascii");
    wav.writeUInt32LE(4000, 40);
    for (let i = 44; i < wav.length; i++) wav[i] = i % 251;
    const pieces = [wav.subarray(0, 1001), wav.subarray(1001, 2999), wav.subarray(2999)].map((b) => b.toString("base64"));
    const events = [
      ...pieces.map((data) => `data: ${JSON.stringify({ choices: [{ delta: { audio: { data } } }] })}\n\n`),
      ": keep-alive\n\n",
      "data: [DONE]\n\n",
    ].join("");
    let sent: any = null;
    const fakeFetch = async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      const bytes = Buffer.from(events);
      return {
        ok: true,
        body: (async function* () {
          for (let i = 0; i < bytes.length; i += 97) yield bytes.subarray(i, i + 97);
        })(),
      } as any;
    };
    const result = await streamOpenRouterAudio(
      { model: "google/lyria-3-pro-preview", modalities: ["text", "audio"], stream: true },
      undefined,
      { fetchImpl: fakeFetch as any, env: { OPENROUTER_API_KEY: "k" } },
    );
    expect(sent.modalities).toEqual(["text", "audio"]);
    expect(result.extension).toBe("wav");
    expect(result.bytes.equals(wav)).toBe(true);
  });

  it("joins WAV pieces that each carry a header and detects bare PCM", () => {
    const piece = (samples: number) => {
      const b = Buffer.alloc(44 + samples);
      b.write("RIFF", 0, "ascii");
      b.write("WAVEfmt ", 8, "ascii");
      b.write("data", 36, "ascii");
      b.writeUInt32LE(samples, 40);
      b.fill(7, 44);
      return b;
    };
    const joined = assembleAudio([piece(100), piece(60)]);
    expect(joined.bytes.length).toBe(44 + 160);
    expect(joined.bytes.readUInt32LE(40)).toBe(160);
    expect(joined.bytes.readUInt32LE(4)).toBe(joined.bytes.length - 8);
    expect(assembleAudio([Buffer.alloc(2000, 3)])).toMatchObject({ extension: "pcm", input: ["-f", "s16le", "-ar", "48000", "-ac", "2"] });
  });

  it("builds a channel format once and reuses it until the source changes", async () => {
    let built = 0, analyzed = 0;
    configureCreatorWorkspace({
      buildStyle: async () => {
        built++;
        return {
          profile: {
            sourceChannel: { title: "Fern", url: "https://www.youtube.com/@fern-tv", subscriberCount: 4560000 },
            topVideos: [
              { title: "How an FBI Agent Infiltrated the KKK", url: "https://www.youtube.com/watch?v=wLFY_Zu_O08", viewCount: 9000000, descriptionExcerpt: "Sources below." },
              { title: "Camp 14: The Most Horrible Place in North Korea", url: "https://www.youtube.com/watch?v=abcdefghijk", viewCount: 5000000 },
            ],
          },
        };
      },
      text: async () => {
        analyzed++;
        return JSON.stringify({
          summary: "Documentary deep dives",
          topics: ["espionage"],
          titleFormats: [{ name: "How X did Y", template: "How [actor] [action]", example: "How an FBI Agent Infiltrated the KKK", why: "reveal" }],
          thumbnailFormat: { composition: "portrait left" },
        });
      },
      projectAccount: async () => ({ id: "a1" }),
      styles: async () => [],
    });
    const project: any = { id: "p1", accountId: "a1", styleId: "", metadata: {}, outputs: { title: { reference: { mode: "channel", url: "https://www.youtube.com/@fern-tv" } } } };
    const job = { user_id: "u1", payload: {} };
    const report = async () => {};
    const first = await channelBlueprint(project, job, undefined, report, { vision: false });
    expect(first).toMatchObject({ source: "channel", summary: "Documentary deep dives", channel: { title: "Fern" } });
    expect(first.titleFormats[0].template).toBe("How [actor] [action]");
    expect(first.videos.map((video: any) => video.title)).toEqual(["How an FBI Agent Infiltrated the KKK", "Camp 14: The Most Horrible Place in North Korea"]);
    project.outputs.title.blueprint = first;
    expect(await channelBlueprint(project, job, undefined, report, { vision: false })).toBe(first);
    expect([built, analyzed]).toEqual([1, 1]);
    await channelBlueprint(project, { ...job, payload: { action: "analyze" } }, undefined, report, { vision: false });
    expect([built, analyzed]).toEqual([2, 2]);
    project.outputs.title.reference = { mode: "samples", samples: "Title one\nTitle two" };
    const samples = await channelBlueprint(project, job, undefined, report, { vision: false });
    expect(samples.source).toBe("samples");
    expect(built).toBe(2);
  });

  it("reads video IDs from every common YouTube link shape", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://m.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://evil.com/watch?v=dQw4w9WgXcQ")).toBe("");
    expect(youtubeVideoId("not a url")).toBe("");
  });

  it("retries a rejected media request once with only core fields", async () => {
    const sent: any[] = [];
    const result = await withMinimalBodyOn400(
      async (body: any) => {
        sent.push(body);
        if ("resolution" in body) throw Object.assign(new Error("bad resolution"), { status: 400 });
        return { id: "job-1" };
      },
      { model: "m", prompt: "p", resolution: "720p", duration: 6 },
      ["model", "prompt"],
    );
    expect(result).toEqual({ id: "job-1" });
    expect(sent).toEqual([{ model: "m", prompt: "p", resolution: "720p", duration: 6 }, { model: "m", prompt: "p" }]);
    await expect(
      withMinimalBodyOn400(async () => { throw Object.assign(new Error("server"), { status: 502 }); }, { model: "m", extra: 1 }, ["model"]),
    ).rejects.toThrow("server");
  });
});
