import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  animationCapability,
  configureCreatorWorkspace,
  registerCreatorWorkspace,
  similarChannelQuery,
  withMinimalBodyOn400,
} from "./creatorWorkspace.js";

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
    expect(animationCapability({})).toMatchObject({ available: false, reason: expect.stringMatching(/OPENROUTER_API_KEY/) });
    expect(animationCapability({ OPENROUTER_API_KEY: "k" })).toMatchObject({ available: false, reason: expect.stringMatching(/OPENROUTER_VIDEO_MODEL/) });
    expect(animationCapability({ OPENROUTER_API_KEY: "k", OPENROUTER_VIDEO_MODEL: "vendor/model" })).toMatchObject({ available: true, model: "vendor/model" });
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
