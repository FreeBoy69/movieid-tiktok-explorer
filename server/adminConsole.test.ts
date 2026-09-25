import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createAdminConsole, DEFAULT_SETTINGS, featureFromRequest, normalizeSettings, parseAdminEmails, planEconomics, planPrice, priceUsage, roleCan } from "./adminConsole.js";
import { catalogEntry, matchModel, resolveModelRate } from "./providerPrices.js";
import { guardUsage, installUsageHandlers, meterUsage, runWithUsageContext, UsageBlockedError, withUsageUser } from "../src/utils/usageMeter.js";

describe("pricing", () => {
  const billing = DEFAULT_SETTINGS.billing;
  it("charges exactly the reported provider cost in tokens", () => {
    expect(priceUsage({ costUsd: 0.002, inputTokens: 900, outputTokens: 100 }, billing)).toMatchObject({ tokens: 2000, costUsd: 0.002, estimated: false, source: "provider" });
  });
  it("prices unreported calls from the model's own rate before the fallback", () => {
    const rate = resolveModelRate("google/gemini-3.7-flash", {}, { id: "google/gemini-3.7-flash", inputPer1M: 0.3, outputPer1M: 2.5, perCall: null });
    expect(priceUsage({ model: "google/gemini-3.7-flash", inputTokens: 1000000, outputTokens: 100000 }, billing, rate)).toMatchObject({ tokens: 550000, source: "openrouter" });
    expect(priceUsage({ inputTokens: 1000000, outputTokens: 0 }, billing).tokens).toBe(500000);
  });
  it("lets admin overrides beat the price list", () => {
    const rate = resolveModelRate("m", { m: { inputPer1M: 1, outputPer1M: 1, perCall: null } }, { id: "m", inputPer1M: 9, outputPer1M: 9, perCall: null });
    expect(rate).toMatchObject({ source: "override", inputPer1M: 1 });
    expect(resolveModelRate("m", { m: { inputPer1M: 1, outputPer1M: null, perCall: null } }, { id: "m", inputPer1M: 9, outputPer1M: 4, perCall: null }))
      .toMatchObject({ inputPer1M: 1, outputPer1M: 4 });
  });
  it("uses per-call prices for media, else the flat rate", () => {
    expect(priceUsage({ operation: "image", units: 2 }, billing, { source: "openrouter", inputPer1M: null, outputPer1M: null, perCall: 0.04 }).tokens).toBe(80000);
    expect(priceUsage({ operation: "image", units: 2 }, billing).tokens).toBe(120000);
    expect(priceUsage({ operation: "unknown", units: 1 }, billing).tokens).toBe(billing.flatTokens.default);
  });
  it("applies per-model extra charges", () => {
    const pricier = { ...billing, modelMultipliers: { "minimax/hailuo-3": 2 } };
    expect(priceUsage({ model: "minimax/hailuo-3", costUsd: 0.002 }, pricier).tokens).toBe(4000);
    expect(priceUsage({ model: "other", costUsd: 0.002 }, pricier).tokens).toBe(2000);
  });
});

describe("plan prices", () => {
  const billing = DEFAULT_SETTINGS.billing;
  it("prices a plan at provider cost of its tokens plus the margin, rounded up", () => {
    // 8M tokens = $8 of provider cost; +50% = $12.00; next .99 = $12.99.
    expect(planPrice(8000000, billing)).toMatchObject({ costCents: 800, priceCents: 1299, marginPercent: 50 });
    expect(planPrice(8000000, { ...billing, priceRounding: "whole" }).priceCents).toBe(1200);
    expect(planPrice(8000000, { ...billing, priceRounding: "cents" }).priceCents).toBe(1200);
    expect(planPrice(8000000, billing, 100).priceCents).toBe(1699);
    expect(planPrice(0, billing).priceCents).toBe(0);
  });
  it("never rounds below cost plus margin", () => {
    for (const tokens of [123456, 999999, 7300000, 25000000]) {
      const p = planPrice(tokens, billing);
      expect(p.priceCents).toBeGreaterThanOrEqual((tokens / 1e6) * 150);
    }
  });
  it("reports profit and effective margin for a manually priced plan", () => {
    expect(planEconomics({ monthlyTokens: 8000000, priceCents: 1900, marginPercent: null }, billing)).toMatchObject({ costCents: 800, profitCents: 1100, suggestedPriceCents: 1299, effectiveMarginPercent: 137.5 });
  });
});

describe("provider price list", () => {
  const entries = new Map([
    ["deepseek/deepseek-v4.1-flash", { id: "deepseek/deepseek-v4.1-flash", inputPer1M: 0.1, outputPer1M: 0.4, perCall: null }],
    ["google/gemini-3.7-flash", { id: "google/gemini-3.7-flash", inputPer1M: 0.3, outputPer1M: 2.5, perCall: null }],
    ["google/gemini-3.7-flash:batch", { id: "google/gemini-3.7-flash:batch", inputPer1M: 0.15, outputPer1M: 1.25, perCall: null }],
    ["qwen/qwen3.8-flash", { id: "qwen/qwen3.8-flash", inputPer1M: 0.05, outputPer1M: 0.4, perCall: null }],
  ]);
  it("matches exact ids, variants and direct-provider names", () => {
    expect(matchModel("deepseek/deepseek-v4.1-flash", entries)?.id).toBe("deepseek/deepseek-v4.1-flash");
    expect(matchModel("deepseek/deepseek-v4.1-flash:batch", entries)?.id).toBe("deepseek/deepseek-v4.1-flash");
    expect(matchModel("gemini-3.7-flash", entries)?.id).toBe("google/gemini-3.7-flash");
    expect(matchModel("no-such-model", entries)).toBeNull();
  });
  it("reads OpenRouter's per-token strings as per-million prices", () => {
    expect(catalogEntry({ id: "x/y", pricing: { prompt: "0.0000003", completion: "0.0000025" } })).toMatchObject({ inputPer1M: 0.3, outputPer1M: 2.5 });
  });
});

describe("settings and roles", () => {
  it("clamps billing numbers and drops unknown providers", () => {
    expect(normalizeSettings("billing", { profitMarginPercent: 99999, tokensPerUsd: "abc", priceRounding: "weird" })).toMatchObject({ profitMarginPercent: 1000, tokensPerUsd: 1000000, priceRounding: "ninety_nine" });
    expect(normalizeSettings("billing", { modelPrices: { "a/b": { inputPer1M: "0.2", outputPer1M: "", perCall: null }, "c/d": {} } }).modelPrices).toEqual({ "a/b": { inputPer1M: 0.2, outputPer1M: null, perCall: null } });
    expect(normalizeSettings("governance", { disabledProviders: ["gemini", "evil"] }).disabledProviders).toEqual(["gemini"]);
    expect(() => normalizeSettings("nope", {})).toThrow("Unknown setting");
    expect(normalizeSettings("governance", { blockedModels: [" a/b ", "a/b", ""] }).blockedModels).toEqual(["a/b"]);
    expect(normalizeSettings("billing", { modelMultipliers: { "a/b": 3, "c/d": 1, "e/f": 999 } }).modelMultipliers).toEqual({ "a/b": 3, "e/f": 50 });
    expect(normalizeSettings("support", { cannedReplies: [{ title: "Refund", body: "Done." }, { title: "", body: "x" }] }).cannedReplies).toEqual([{ id: "reply_0", title: "Refund", body: "Done." }]);
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
      session: async (req: express.Request) => sessionFor(req), env: { ADMIN_EMAILS: "owner@example.com" }, priceCatalog: null,
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
