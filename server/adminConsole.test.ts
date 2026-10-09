// @vitest-environment node
import http from "node:http";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createAdminConsole, DEFAULT_SETTINGS, juelReplyText, telegramChunks, featureFromRequest, normalizeSettings, parseAdminEmails, planEconomics, planPrice, priceUsage, roleCan } from "./adminConsole.js";
import { catalogEntry, matchModel, resolveModelRate } from "./providerPrices.js";
import { guardUsage, installUsageHandlers, meterUsage, runWithUsageContext, UsageBlockedError, withUsageUser } from "../src/utils/usageMeter.js";

describe("pricing", () => {
  const billing = DEFAULT_SETTINGS.billing;
  it("charges exactly the reported provider cost in tokens", () => {
    expect(priceUsage({ costUsd: 0.002, inputTokens: 900, outputTokens: 100 }, billing)).toMatchObject({ tokens: 2000, costUsd: 0.002, estimated: false, source: "provider" });
    expect(priceUsage({ costUsd: 0, inputTokens: 900, outputTokens: 100 }, billing)).toMatchObject({ tokens: 0, costUsd: 0, estimated: false, source: "provider" });
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
  it("prices a plan for net profit after a payment-fee reserve", () => {
    // $8 provider cost + $8 net profit, reserving 5% + $0.50 for payment fees.
    expect(planPrice(8000000, billing)).toMatchObject({ costCents: 800, priceCents: 1799, marginPercent: 100 });
    expect(planPrice(8000000, { ...billing, priceRounding: "whole" }).priceCents).toBe(1800);
    expect(planPrice(8000000, { ...billing, priceRounding: "cents" }).priceCents).toBe(1737);
    expect(planPrice(8000000, billing, 50).priceCents).toBe(1399);
    expect(planPrice(0, billing).priceCents).toBe(0);
  });
  it("never rounds below cost plus margin", () => {
    for (const tokens of [123456, 999999, 7300000, 25000000]) {
      const p = planPrice(tokens, billing);
      expect(p.profitCents).toBeGreaterThanOrEqual(p.costCents);
    }
  });
  it("reports profit and effective margin for a manually priced plan", () => {
    expect(planEconomics({ monthlyTokens: 8000000, priceCents: 1900, marginPercent: null }, billing)).toMatchObject({ costCents: 800, paymentFeeCents: 145, profitCents: 955, suggestedPriceCents: 1799, effectiveMarginPercent: 119.4 });
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
  it("stops a provider call when billing cannot check its balance", async () => {
    installUsageHandlers({ guard: async () => { throw new Error("database unavailable"); } });
    await expect(withUsageUser("usr_1", "studio:video", () => guardUsage("videorouter")))
      .rejects.toMatchObject({ code: "billing_unavailable", status: 503 });
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
  it("serves insights to admins, caches them per window, and refuses everyone else", async () => {
    let calls = 0;
    const base = await start(signedIn("owner@example.com"), async (sql) => {
      calls++;
      if (sql.includes("to_regclass('billing_orders')")) return "t";
      if (sql.includes("'mrrCents'") && sql.includes("'payingAccounts'")) return JSON.stringify({ mrrCents: 4900, payingAccounts: 1, users: 10 });
      return "";
    });
    const first = await fetch(`${base}/api/admin/insights?days=90`, { headers: { "x-user": "1" } });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ days: 90, bucket: "day", revenue: { mrrCents: 4900, arrCents: 58800, arpaCents: 4900 }, series: [], cohorts: [] });
    const afterFirst = calls;
    await fetch(`${base}/api/admin/insights?days=90`, { headers: { "x-user": "1" } });
    expect(calls).toBe(afterFirst + 1); // only the schema probe; the payload came from the cache
    expect((await fetch(`${base}/api/admin/insights`)).status).toBe(401);
  });
  it("lets system work through when there is no signed-in user", async () => {
    const base = await start(() => null);
    expect((await fetch(`${base}/api/generate`, { method: "POST" })).status).toBe(200);
  });
  it("rejects new legacy credit-pack checkouts without charging", async () => {
    const base = await start(signedIn("buyer@example.com"));
    const response = await fetch(`${base}/api/billing/checkout`, {
      method: "POST",
      headers: { "x-user": "1", "x-billing-request": "1", "content-type": "application/json" },
      body: JSON.stringify({ kind: "credits", packId: "pack_25" }),
    });
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("LingBase") });
  });
});

describe("telegram bridge", () => {
  it("splits long replies on line breaks and folds Juel's reports into the text", () => {
    const chunks = telegramChunks(`${"a".repeat(30)}\n${"b".repeat(30)}`, 40);
    expect(chunks).toEqual(["a".repeat(30), "b".repeat(30)]);
    expect(juelReplyText({ content: "Views are up.", attachments: [
      { kind: "report", title: "Weekly", cards: [{ label: "30d views", value: "12K" }] },
      { kind: "generation", id: "g1", tab: "image", prompt: "a cat" },
      { kind: "media", items: [{ type: "image", url: "/x.png", label: "x" }] },
    ] }, ["You're out of credits."]))
      .toBe("Views are up.\n\n📊 Weekly\n• 30d views: 12K\n\n🎨 Started your image generation. I'll send it here when it's ready.\n\n⚠️ You're out of credits.");
  });

  let server: http.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });
  const until = async (check: () => unknown) => {
    for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(check()).toBeTruthy();
  };

  it("links a chat and runs its messages through Juel, with pictures and videos both ways", async () => {
    const settings = new Map<string, string>();
    const runPsql = async (sql: string) => {
      const write = sql.match(/INSERT INTO app_settings \(key, value, updated_by, updated_at\) VALUES \('telegram', '(.*)'::jsonb/s);
      if (write) settings.set("telegram", write[1]);
      if (sql.includes("WHERE key = 'telegram'")) return settings.get("telegram") || "{}";
      return "";
    };
    const sent: Array<{ method: string; body: any }> = [];
    let botMessage = 0;
    const fakeFetch = async (url: string, init: any = {}) => {
      if (!String(url).startsWith("https://api.telegram.org/")) return fetch(url, init);
      if (String(url).startsWith("https://api.telegram.org/file/")) return new Response(Buffer.from("jpegbytes"), { headers: { "content-type": "image/jpeg" } });
      const method = String(url).split("/").pop()!;
      const body = init.body instanceof FormData
        ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : `<file ${(v as File).size}>`]))
        : init.body ? JSON.parse(init.body) : {};
      sent.push({ method, body });
      const result = method === "getMe" ? { username: "autoyt_bot", first_name: "AutoYT" } : method === "sendMessage" ? { message_id: ++botMessage } : method === "getFile" ? { file_path: "photos/p1.jpg" } : true;
      return new Response(JSON.stringify({ ok: true, result }));
    };
    const juelCalls: any[] = [];
    let chatCookie = "";
    let uploadType = "";
    const app = express();
    const admin = createAdminConsole({
      runPsql, sqlString: (v: unknown) => `'${String(v ?? "").replace(/'/g, "''")}'`, jsonbLiteral: (v: unknown) => `'${JSON.stringify(v)}'::jsonb`,
      session: async (req: express.Request) => (req.get("x-user") === "2" ? { id: "ses_2", user: { id: "usr_2", email: "member@example.com", name: "Member" } } : req.get("x-user") ? { id: "ses_1", user: { id: "usr_1", email: "owner@example.com", name: "Owner" } } : null),
      env: { ADMIN_EMAILS: "owner@example.com", APP_URL: "https://autoyt.test" }, priceCatalog: null, fetch: fakeFetch,
      createAuthSession: async () => "ses_tg", signedValue: (v: string) => `signed.${v}`, selfUrl: () => base, generationPollMs: 5,
    });
    app.use(express.json());
    admin.register(app);
    app.post("/api/juel/chat", (req, res) => {
      chatCookie = String(req.headers.cookie || "");
      juelCalls.push(req.body);
      res.setHeader("Content-Type", "application/x-ndjson");
      res.write(`${JSON.stringify({ type: "step", specialist: "studio", text: "Making a picture" })}\n`);
      const assistant = { role: "assistant", content: `You said: ${req.body.message.split("\n")[0]}`, attachments: [
        { kind: "media", items: [{ type: "image", url: "/api/studio/files/gen-1.png", label: "Poster" }] },
        { kind: "generation", id: "gen_9", tab: "image", prompt: "a cat" },
      ] };
      res.end(`${JSON.stringify({ type: "done", thread: { id: "jt_1", messages: [{ role: "user", content: req.body.message }, assistant] } })}\n`);
    });
    app.get("/api/studio/files/:name", (_req, res) => res.type("image/png").send(Buffer.from("pngbytes")));
    app.get("/api/studio/generations", (_req, res) => res.json({ generations: [{ id: "gen_9", tab: "image", status: "done", outputs: [{ url: "/api/studio/files/gen-9.png", type: "image/png" }] }] }));
    app.post("/api/studio/uploads", express.raw({ type: () => true }), (req, res) => {
      uploadType = String(req.headers["content-type"] || "");
      res.json({ file: "up-1.jpg", url: "/api/studio/files/up-1.jpg", type: uploadType });
    });
    server = http.createServer(app).listen(0);
    await new Promise((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;
    const asAdmin = { "x-user": "1", "x-admin-request": "1", "content-type": "application/json" };

    const connected = await fetch(`${base}/api/admin/telegram`, { method: "PUT", headers: asAdmin, body: JSON.stringify({ botToken: `123456:${"A".repeat(35)}` }) });
    expect(await connected.json()).toMatchObject({ connected: true, botUsername: "autoyt_bot", links: [] });
    const webhook = sent.find((call) => call.method === "setWebhook")!.body;
    expect(webhook.url).toBe("https://autoyt.test/api/telegram/webhook");
    const { url } = await (await fetch(`${base}/api/admin/telegram/link`, { method: "POST", headers: asAdmin })).json();
    const code = url.split("start=")[1];
    const post = (update: unknown, secret = webhook.secret_token) => fetch(`${base}/api/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret }, body: JSON.stringify(update) });
    const chat = { id: 42, type: "private" };

    await post({ update_id: 1, message: { chat: { id: 7, type: "private" }, text: "hi" } }, "wrong-secret");
    await post({ update_id: 2, message: { chat: { id: 7, type: "private" }, text: "hi" } });
    await until(() => sent.some((call) => call.method === "sendMessage" && call.body.chat_id === 7));
    expect(sent.find((call) => call.body.chat_id === 7)!.body.text).toContain("linked to an AutoYT account yet");

    await post({ update_id: 3, message: { chat, from: { first_name: "Wei" }, text: `/start ${code}` } });
    await until(() => sent.some((call) => String(call.body.text || "").startsWith("Linked to owner@example.com")));

    await post({ update_id: 4, message: { chat, text: "how are my views" } });
    await until(() => sent.some((call) => String(call.body.text || "").startsWith("You said: how are my views")));
    const reply = sent.find((call) => String(call.body.text || "").startsWith("You said:"))!.body;
    expect(reply.text).toContain("🎨 Started your image generation");
    expect(chatCookie).toBe("movieid_session=signed.ses_tg");
    expect(juelCalls[0]).toMatchObject({ message: "how are my views", context: { surface: "telegram" } });
    expect(juelCalls[0].threadId).toBeUndefined();
    // The picture Juel showed, and the generation once it's done, arrive as photos.
    await until(() => sent.filter((call) => call.method === "sendPhoto").length >= 2);
    expect(sent.filter((call) => call.method === "sendPhoto").map((call) => call.body)).toEqual(expect.arrayContaining([
      expect.objectContaining({ chat_id: "42", caption: "Poster", photo: "<file 8>" }),
      expect.objectContaining({ chat_id: "42", caption: "a cat", photo: "<file 8>" }),
    ]));

    // A photo from the chat is uploaded as the user and handed to Juel in the same thread.
    await post({ update_id: 8, message: { chat, caption: "make this a poster", photo: [{ file_id: "small", file_size: 10 }, { file_id: "p1", file_size: 100 }] } });
    await until(() => juelCalls.length === 2);
    expect(uploadType).toBe("image/jpeg");
    expect(juelCalls[1]).toMatchObject({ threadId: "jt_1", message: "make this a poster\n\n[Attached image: /api/studio/files/up-1.jpg]" });
    await post({ update_id: 9, message: { chat, document: { file_id: "d1", mime_type: "application/pdf", file_size: 100 } } });
    await until(() => sent.some((call) => String(call.body.text || "").startsWith("I can take pictures, videos and audio files")));
    await post({ update_id: 10, message: { chat, text: "/agents" } });
    await until(() => sent.some((call) => String(call.body.text || "").startsWith("No need to pick")));
    await post({ update_id: 11, message: { chat, text: "/new" } });
    await until(() => sent.some((call) => call.body.text === "Started a new chat."));

    // A repeated delivery of the same update is ignored.
    await post({ update_id: 4, message: { chat, text: "how are my views" } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(sent.filter((call) => String(call.body.text || "").startsWith("You said: how are my views"))).toHaveLength(1);

    // Any signed-in user can link their own chat from Account settings; the bot then acts as them.
    const asUser = { "x-user": "2", "content-type": "application/json" };
    expect(await (await fetch(`${base}/api/account/telegram`, { headers: asUser })).json()).toEqual({ available: true, botUsername: "autoyt_bot", linked: null });
    const userLink = await (await fetch(`${base}/api/account/telegram/link`, { method: "POST", headers: asUser })).json();
    await post({ update_id: 5, message: { chat: { id: 77, type: "private" }, from: { username: "member" }, text: `/start ${userLink.url.split("start=")[1]}` } });
    await until(() => sent.some((call) => String(call.body.text || "").startsWith("Linked to member@example.com")));
    expect(await (await fetch(`${base}/api/account/telegram`, { headers: asUser })).json()).toMatchObject({ linked: { telegramName: "member" } });
    await post({ update_id: 6, message: { chat: { id: 77, type: "private" }, text: "status please" } });
    await until(() => sent.some((call) => call.body.chat_id === 77 && String(call.body.text || "").startsWith("You said: status please")));
    expect(await (await fetch(`${base}/api/account/telegram`, { method: "DELETE", headers: asUser })).json()).toMatchObject({ linked: null });
    await post({ update_id: 7, message: { chat: { id: 77, type: "private" }, text: "still there?" } });
    await until(() => sent.some((call) => call.body.chat_id === 77 && String(call.body.text || "").includes("linked to an AutoYT account yet")));

    const status = await (await fetch(`${base}/api/admin/telegram`, { headers: asAdmin })).json();
    expect(status.links).toEqual([expect.objectContaining({ chatId: "42", email: "owner@example.com", telegramName: "Wei", mine: true })]);
    expect(JSON.stringify(status)).not.toContain("ses_tg");
    expect(JSON.stringify(status)).not.toContain("AAAA");
  });
});

describe("account settings API", () => {
  let server: http.Server | null = null;
  afterEach(() => {
    server?.close();
    server = null;
  });
  it("returns the signed-in user's own history and signs out only their other sessions", async () => {
    const queries: string[] = [];
    const runPsql = async (sql: string) => {
      queries.push(sql);
      if (sql.includes("to_regclass('billing_orders')")) return "t";
      if (sql.includes("FROM billing_orders b")) return JSON.stringify([{ reference: "ayt_1", kind: "credits", planName: null, creditsTokens: "500000", amountCents: "900", currency: "USD", status: "paid", createdAt: "2026-10-01", paidAt: "2026-10-01" }]);
      if (sql.includes("FROM ai_usage_events") && sql.includes("GROUP BY 1 ORDER BY 2 DESC")) return JSON.stringify([{ feature: "agent-chat", tokens: "1200", events: "3" }]);
      if (sql.includes("WITH gone AS")) return "4";
      return "";
    };
    const app = express();
    const admin = createAdminConsole({
      runPsql, sqlString: (v: unknown) => `'${String(v ?? "").replace(/'/g, "''")}'`, jsonbLiteral: (v: unknown) => `'${JSON.stringify(v)}'::jsonb`,
      session: async (req: express.Request) => (req.get("x-user") ? { id: "ses_me", user: { id: "usr_9", email: "me@example.com", name: "Me" } } : null),
      env: {}, priceCatalog: null,
    });
    app.use(express.json());
    admin.register(app);
    server = http.createServer(app).listen(0);
    await new Promise((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server!.address() as { port: number }).port}`;

    expect((await fetch(`${base}/api/billing/history`)).status).toBe(401);
    const history = await (await fetch(`${base}/api/billing/history`, { headers: { "x-user": "1" } })).json();
    expect(history.orders[0]).toMatchObject({ reference: "ayt_1", creditsTokens: 500000, amountCents: 900 });
    expect(history.usage.byFeature).toEqual([{ feature: "agent-chat", tokens: 1200, events: 3 }]);
    expect(queries.filter((sql) => /billing_orders b|token_ledger|ai_usage_events/.test(sql)).every((sql) => sql.includes("'usr_9'"))).toBe(true);

    const revoked = await (await fetch(`${base}/api/account/sessions/revoke-others`, { method: "POST", headers: { "x-user": "1" } })).json();
    expect(revoked).toEqual({ signedOut: 4 });
    expect(queries.find((sql) => sql.includes("WITH gone AS"))).toContain("user_id = 'usr_9' AND id <> 'ses_me'");
  });
});
