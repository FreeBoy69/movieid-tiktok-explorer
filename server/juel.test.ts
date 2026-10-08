import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callRoute, creditShortfall, estimateCredits, JUEL_COSTS, JUEL_EXCLUDED, JUEL_RISKS, JUEL_ROUTES, JUEL_SPECIALISTS, juelTools, juelTurn, matchRoute, pageActionCredits, pageTools, spendsCredits } from "./juel.js";

/** Every route the server registers, as "METHOD /path". */
function registeredRoutes() {
  const root = path.resolve(__dirname, "..");
  const files = ["server.js", ...fs.readdirSync(path.join(root, "server")).filter((f) => f.endsWith(".js")).map((f) => `server/${f}`)];
  const routes = new Set<string>();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const m of source.matchAll(/\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/g)) {
      if (m[2].startsWith("/api") || m[2].startsWith("/internal")) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
  }
  return routes;
}

describe("Juel's catalogue", () => {
  it("covers every route the server has: catalogued, or excluded with a reason", () => {
    const missing = [...registeredRoutes()].filter((key) => !JUEL_ROUTES[key] && !JUEL_EXCLUDED[key]);
    expect(missing, "Add these routes to JUEL_ROUTES (or JUEL_EXCLUDED with a reason) in server/juel.js").toEqual([]);
  });

  it("lists no route the server no longer has", () => {
    const registered = registeredRoutes();
    const stale = [...Object.keys(JUEL_ROUTES), ...Object.keys(JUEL_EXCLUDED)].filter((key) => !registered.has(key));
    expect(stale).toEqual([]);
  });

  it("gives every route a known specialist, a risk, and a description", () => {
    for (const [key, [specialist, risk, does]] of Object.entries(JUEL_ROUTES)) {
      expect(JUEL_SPECIALISTS[specialist], `${key}: specialist ${specialist}`).toBeTruthy();
      expect(JUEL_RISKS, `${key}: risk ${risk}`).toContain(risk);
      expect(String(does).length, `${key}: description`).toBeGreaterThan(8);
    }
    for (const [key, why] of Object.entries(JUEL_EXCLUDED)) expect(String(why).length, `${key}: exclusion reason`).toBeGreaterThan(3);
  });

  it("prices only catalogued routes, and every paid route has a price (listed or the text-model default)", () => {
    for (const key of Object.keys(JUEL_COSTS)) expect(JUEL_ROUTES[key], `${key} has a cost but no route`).toBeTruthy();
  });
});

describe("Juel's credits", () => {
  const pricing = { tokensPerUsd: 1_000_000, flatTokens: { image: 60000, video: 750000, speech: 3000, music: 150000, transcription: 5000, default: 10000 } };

  it("quotes media at its flat rate and text routes at what they recently cost", async () => {
    // Two images at 60,000 tokens each, 100 tokens a credit.
    expect(await estimateCredits({ method: "POST", path: "/api/studio/generations", body: { tab: "image", prompt: "x", settings: { count: 2 } } }, { pricing })).toMatchObject({ credits: 1200 });
    // A video model with its own per-second price: $0.05 x 8 s.
    const catalog = async () => ({ video: [{ id: "veo", pricePerSecond: 0.05 }] });
    expect((await estimateCredits({ method: "POST", path: "/api/studio/generations", body: { tab: "video", model: "veo", settings: { duration: 8 } } }, { pricing, catalog }))?.credits).toBe(4000);
    // A text route: one model call by default, its recent median once it has history.
    expect((await estimateCredits({ method: "POST", path: "/api/rewrite", body: {} }, { pricing }))?.credits).toBe(40);
    expect((await estimateCredits({ method: "POST", path: "/api/rewrite", body: {} }, { pricing, history: { "POST /api/rewrite": { tokens: 1234 } } }))?.credits).toBe(13);
    // Free routes cost nothing.
    expect(await estimateCredits({ method: "GET", path: "/api/recaps" }, { pricing })).toBeNull();
    expect(pageActionCredits({ risk: "paid", cost: "speech" }, pricing)).toBe(30);
    expect(pageActionCredits({ risk: "change" }, pricing)).toBe(0);
  });

  it("refuses what the balance can't cover, and never blocks unlimited accounts", () => {
    expect(creditShortfall({ balance: 50000, status: "active" }, 400)).toBeNull();
    expect(creditShortfall({ balance: 5000, status: "active" }, 400)).toMatchObject({ balance: 50, needed: 400 });
    expect(creditShortfall({ balance: 0, unlimited: true }, 400)).toBeNull();
    expect(creditShortfall({ balance: 99999, status: "active", planId: "pending" }, 1)?.message).toMatch(/plan/);
  });
});

describe("Juel's routing and approvals", () => {
  const routes = { "GET /api/recaps": ["recap", "read", "Lists your recaps."], "GET /api/recaps/:id": ["recap", "read", "One recap."], "POST /api/recaps/:id/render": ["recap", "paid", "Renders a recap."], "GET /api/admin/users": ["admin", "read", "Lists users."] };
  const excluded = { "GET /api/recaps/:id/sheets/:name": "file stream for the editor" };

  it("matches a concrete call to its route and params", () => {
    expect(matchRoute("POST", "/api/recaps/rcp_1/render", { routes, excluded })).toMatchObject({ key: "POST /api/recaps/:id/render", params: { id: "rcp_1" }, risk: "paid", spends: true });
    expect(matchRoute("GET", "/api/recaps?x=1", { routes, excluded })?.key).toBe("GET /api/recaps");
    expect(matchRoute("GET", "/api/recaps/rcp_1/sheets/s001.jpg", { routes, excluded })?.excluded).toBe("file stream for the editor");
    expect(matchRoute("DELETE", "/api/recaps/rcp_1", { routes, excluded })).toBeNull();
  });

  it("counts only paid routes as spending credits", () => {
    expect(["read", "change", "paid", "publish", "delete"].map(spendsCredits)).toEqual([false, false, true, false, false]);
  });

  it("calls a route as the user, and refuses what it shouldn't call", async () => {
    const calls: any[] = [];
    const fetchImpl: any = async (url: URL, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
    const options = { baseUrl: "http://127.0.0.1:3000", cookie: "sid=abc", fetchImpl, routes, excluded };
    const done = await callRoute({ method: "GET", path: "/api/recaps", query: { limit: 5 } }, options);
    expect(done).toMatchObject({ status: 200, data: { ok: true }, route: "GET /api/recaps" });
    expect(calls[0].url).toBe("http://127.0.0.1:3000/api/recaps?limit=5");
    expect(calls[0].init.headers.cookie).toBe("sid=abc");
    await expect(callRoute({ method: "POST", path: "/api/recaps/rcp_1/render", body: {} }, options)).resolves.toMatchObject({ status: 200 });
    await expect(callRoute({ method: "GET", path: "/api/recaps/rcp_1/sheets/s001.jpg" }, options)).rejects.toMatchObject({ code: "excluded" });
    await expect(callRoute({ method: "GET", path: "/api/admin/users" }, options)).rejects.toMatchObject({ code: "forbidden" });
    await expect(callRoute({ method: "GET", path: "/api/nowhere" }, options)).rejects.toMatchObject({ code: "unknown" });
  });

  it("keeps admin tools out of a non-admin's list", () => {
    expect(juelTools({ routes }).some((t) => t.specialist === "admin")).toBe(false);
    expect(juelTools({ routes, admin: true }).some((t) => t.specialist === "admin")).toBe(true);
  });
});

describe("Juel's turn", () => {
  it("plans, lets specialists work and ask each other, runs paid calls, and reports from the board", async () => {
    // A scripted model: the manager plans recap then publisher; recap reads the recap and asks research a
    // question; publisher starts a paid render; the manager sums up.
    const prompts: string[] = [];
    const think = async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes("Plan the turn")) return { reply: "", plan: [{ specialist: "recap", task: "Check the recap's status" }, { specialist: "publisher", task: "Render it again" }] };
      if (prompt.includes("the Recap specialist")) {
        if (!prompt.includes("CALLED GET /api/recaps/rcp_1")) return { calls: [{ method: "GET", path: "/api/recaps/rcp_1", why: "Reading the recap" }], ask: { specialist: "research", question: "Is the film trending?" }, done: false, note: "" };
        return { calls: [], done: true, note: "Recap rcp_1 is rendered, 14 min." };
      }
      if (prompt.includes("the Research specialist")) return { calls: [], done: true, note: "Mutiny is trending this week." };
      if (prompt.includes("the Publisher specialist")) return { calls: [{ method: "POST", path: "/api/recaps/rcp_1/render", body: {}, why: "Render again" }], done: true, note: "Started a render (about 30 credits)." };
      if (prompt.includes("Write the reply")) return { reply: "Your recap is ready and Mutiny is trending; I started a new render, about 30 credits." };
      return {};
    };
    const calls: any[] = [];
    const call = async (c: any) => {
      calls.push(c);
      return { status: 200, data: { id: "rcp_1", status: "done" }, credits: matchRoute(c.method, c.path)?.spends ? 30 : 0 };
    };
    const steps: any[] = [];
    const turn: any = await juelTurn({ message: "Is my recap done? Render it again.", think, call, onStep: (s: any) => steps.push(s) });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /api/recaps/rcp_1", "POST /api/recaps/rcp_1/render"]);
    // Research answered recap's question on the shared board, and publisher saw it.
    expect(turn.board.map((b: any) => b.specialist)).toEqual(["research", "recap", "publisher"]);
    expect(prompts.find((p) => p.includes("the Publisher specialist"))).toContain("Mutiny is trending");
    expect(steps.some((s) => s.text.startsWith("asks Research"))).toBe(true);
    expect(prompts.find((p) => p.includes("Write the reply"))).toContain("Started a render");
    expect(turn.reply).toContain("30 credits");
  });

  it("lets the specialist the page names edit the open page, and only that one", async () => {
    const clientTools = pageTools({ specialist: "editor", actions: { add_text: { args: "{text, start, end}", about: "Put a title on screen", risk: "change" }, voiceover: { args: "{script}", about: "Speak a script", risk: "nope" }, "bad name!": { about: "x" } } });
    // Unknown risks count as paid (so they're priced and checked); malformed action names are dropped.
    expect(clientTools).toEqual({ specialist: "editor", actions: { add_text: { args: "{text, start, end}", about: "Put a title on screen", risk: "change" }, voiceover: { args: "{script}", about: "Speak a script", risk: "paid" } } });
    const prompts: string[] = [];
    const think = async (prompt: string) => {
      prompts.push(prompt);
      if (prompt.includes("Plan the turn")) return { plan: [{ specialist: "research", task: "Find a hook" }, { specialist: "editor", task: "Add the title" }] };
      if (prompt.includes("the Editor specialist")) return { page: [{ type: "add_text", args: { text: "DAY 1", start: 0, end: 2 }, why: "Title" }], done: true, note: "Added the title." };
      if (prompt.includes("Write the reply")) return { reply: "Added DAY 1 at the start." };
      return { done: true, note: "Hook: day one." };
    };
    const sent: any[] = [];
    const turn: any = await juelTurn({ message: "Add a DAY 1 title", context: { surface: "editor", clientTools }, think, call: async () => ({}), page: async (a: any) => { sent.push(a); return { sent: true }; } });
    expect(sent).toEqual([{ type: "add_text", args: { text: "DAY 1", start: 0, end: 2 }, why: "Title", specialist: "editor" }]);
    expect(prompts.find((p) => p.includes("the Editor specialist"))).toContain("ACTIONS ON THE OPEN PAGE");
    expect(prompts.find((p) => p.includes("the Research specialist"))).not.toContain("ACTIONS ON THE OPEN PAGE");
    expect(turn.reply).toContain("DAY 1");
  });

  it("answers directly when there's nothing to do in the app", async () => {
    const think = async () => ({ reply: "Hi! I can make recaps, edits, posts and more.", plan: [] });
    const turn = await juelTurn({ message: "hi", think, call: async () => ({}) });
    expect(turn.reply).toContain("Hi!");
  });
});
