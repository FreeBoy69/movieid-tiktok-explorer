import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createAdminConsole, DEFAULT_SETTINGS, featureFromRequest, normalizeSettings, parseAdminEmails, priceUsage, roleCan } from "./adminConsole.js";
import { guardUsage, installUsageHandlers, meterUsage, runWithUsageContext, UsageBlockedError, withUsageUser } from "../src/utils/usageMeter.js";

describe("pricing", () => {
  const billing = DEFAULT_SETTINGS.billing;
  it("charges reported provider cost with the markup", () => {
    expect(priceUsage({ costUsd: 0.002, inputTokens: 900, outputTokens: 100 }, billing)).toEqual({ tokens: 3000, costUsd: 0.002, estimated: false });
  });
  it("estimates cost from token counts when the provider reports none", () => {
    const price = priceUsage({ inputTokens: 1000000, outputTokens: 0 }, billing);
    expect(price).toMatchObject({ costUsd: 0.5, estimated: true, tokens: 750000 });
  });
  it("falls back to the flat per-unit rate for media", () => {
    expect(priceUsage({ operation: "image", units: 2 }, billing).tokens).toBe(120000);
    expect(priceUsage({ operation: "unknown", units: 1 }, billing).tokens).toBe(billing.flatTokens.default);
  });
});

describe("settings and roles", () => {
  it("clamps billing numbers and drops unknown providers", () => {
    expect(normalizeSettings("billing", { markup: 999, tokensPerUsd: "abc" })).toMatchObject({ markup: 20, tokensPerUsd: 1000000 });
    expect(normalizeSettings("governance", { disabledProviders: ["gemini", "evil"] }).disabledProviders).toEqual(["gemini"]);
    expect(() => normalizeSettings("nope", {})).toThrow("Unknown setting");
  });
  it("gives each role only its permissions", () => {
    expect(roleCan("owner", "team.manage")).toBe(true);
    expect(roleCan("admin", "team.manage")).toBe(false);
    expect(roleCan("support", "support.manage")).toBe(true);
    expect(roleCan("support", "billing.manage")).toBe(false);
    expect(roleCan("viewer", "view")).toBe(true);
    expect(roleCan("", "view")).toBe(false);
  });
  it("parses ADMIN_EMAILS case-insensitively", () => {
    expect([...parseAdminEmails(" Boss@Example.com, ops@example.com  nope ")]).toEqual(["boss@example.com", "ops@example.com"]);
  });
  it("collapses ids in feature names", () => {
    expect(featureFromRequest("post", "/api/creator/projects/prj_8f2a91c3d4/stages/script")).toBe("POST /api/creator/projects/:id/stages/script");
    expect(featureFromRequest("GET", "/api/studio/job/3f1f0a6e-9b8c-4a51-8f11-2c0b3d1d7e2a")).toBe("GET /api/studio/job/:id");
  });
});

describe("usage meter", () => {
  afterEach(() => installUsageHandlers({}));
  it("blocks paid calls when the guard says so and attributes usage to the context user", async () => {
    const metered: unknown[] = [];
    installUsageHandlers({
      guard: ({ userId }: { userId: string }) => (userId === "broke" ? { blocked: true, status: 402, code: "insufficient_tokens", message: "Out of tokens" } : null),
      meter: (event: unknown) => void metered.push(event),
    });
    await expect(withUsageUser("broke", "test", () => guardUsage("openrouter"))).rejects.toBeInstanceOf(UsageBlockedError);
    await withUsageUser("rich", "studio:image", async () => {
      await guardUsage("openrouter");
      meterUsage({ provider: "openrouter", model: "m", operation: "chat", usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }, ref: "chat:once" });
      meterUsage({ provider: "openrouter", model: "m", operation: "chat", usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.001 }, ref: "chat:once" });
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(metered).toEqual([expect.objectContaining({ userId: "rich", feature: "studio:image", inputTokens: 10, outputTokens: 5, costUsd: 0.001 })]);
  });
  it("resolves the request user lazily and only once", async () => {
    let lookups = 0;
    const seen: unknown[] = [];
    installUsageHandlers({ guard: ({ userId }: { userId: string }) => void seen.push(userId) });
    await runWithUsageContext({ resolveUser: async () => { lookups += 1; return "usr_1"; } }, async () => {
      await guardUsage("gemini");
      await guardUsage("gemini");
    });
    expect(seen).toEqual(["usr_1", "usr_1"]);
    expect(lookups).toBe(1);
  });
});

describe("admin routes", () => {
  let server: http.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
    installUsageHandlers({});
  });
  async function start(sessionFor: (req: express.Request) => unknown, runPsql = async (_sql: string) => "") {
    const app = express();
    const admin = createAdminConsole({
      runPsql, sqlString: (v: unknown) => `'${String(v ?? "").replace(/'/g, "''")}'`, jsonbLiteral: (v: unknown) => `'${JSON.stringify(v)}'::jsonb`,
      session: async (req: express.Request) => sessionFor(req), env: { ADMIN_EMAILS: "owner@example.com" },
    });
    app.use(admin.usageMiddleware);
    app.use(express.json());
    admin.register(app);
    app.post("/api/generate", async (_req, res) => {
      try {
        await guardUsage("openrouter");
        res.json({ ok: true });
      } catch {
        res.status(500).json({ error: "Generation failed" });
      }
    });
    server = http.createServer(app).listen(0);
    await new Promise((resolve) => server!.once("listening", resolve));
    return `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
  }
  const signedIn = (email: string) => (req: express.Request) => (req.get("x-user") ? { id: "ses_1", user: { id: "usr_1", email, name: "A" } } : null);

  it("asks signed-out visitors to sign in and refuses non-admins", async () => {
    const base = await start(signedIn("someone@example.com"));
    expect((await fetch(`${base}/api/admin/me`)).status).toBe(401);
    const refused = await fetch(`${base}/api/admin/me`, { headers: { "x-user": "1" } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "not_admin" });
  });
  it("lets ADMIN_EMAILS owners in and requires the admin header on writes", async () => {
    const base = await start(signedIn("Owner@Example.com"));
    const me = await fetch(`${base}/api/admin/me`, { headers: { "x-user": "1" } });
    expect(await me.json()).toMatchObject({ admin: { role: "owner", email: "owner@example.com" } });
    const csrf = await fetch(`${base}/api/admin/team`, { method: "POST", headers: { "x-user": "1", "content-type": "application/json" }, body: JSON.stringify({ email: "a@b.co", role: "admin" }) });
    expect(csrf.status).toBe(403);
  });
  it("returns 402 with a code when a user is out of tokens, even if the handler says 500", async () => {
    const snapshot = { userId: "usr_1", balance: 0, unlimited: false, userStatus: "active", periodEnd: "2026-10-25T00:00:00Z" };
    const base = await start(signedIn("someone@example.com"), async (sql) => (sql.includes("SELECT COALESCE((\n  SELECT json_build_object(\n    'userId'") ? JSON.stringify(snapshot) : ""));
    const response = await fetch(`${base}/api/generate`, { method: "POST", headers: { "x-user": "1" } });
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({ code: "insufficient_tokens" });
  });
  it("lets system work through when there is no signed-in user", async () => {
    const base = await start(() => null);
    expect((await fetch(`${base}/api/generate`, { method: "POST" })).status).toBe(200);
  });
});
