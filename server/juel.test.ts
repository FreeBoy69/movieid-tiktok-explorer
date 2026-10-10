import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callRoute, cleanReport, streamGeminiSpeech, cleanShows, creditShortfall, estimateCredits, JUEL_COSTS, JUEL_EXCLUDED, JUEL_RISKS, JUEL_ROUTES, JUEL_SPECIALISTS, juelTools, juelTurn, JuelRefusal, matchRoute, MAX_RECEIPTS, receiptLines, touchedIds, withReceipts, partialReply, MCP_TOOLS, mcpRespond, openApiSpec, pageActionCredits, pageTools, spendsCredits, tokenRefusal, urlsIn } from "./juel.js";

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
    // Publisher finished in the same round it called the render, and the call's result still reached the board.
    expect(prompts.find((p) => p.includes("Write the reply"))).toContain("Results: CALLED POST /api/recaps/rcp_1/render -> 200");
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

  it("streams the reply while the model writes it", async () => {
    expect(partialReply('{"reply": "Hel')).toBe("Hel");
    expect(partialReply('{"plan":[],"reply":"a\\"b\\nc\\u00e9"}')).toBe("a\"b\ncé");
    expect(partialReply('{"reply":"ends on an escape \\')).toBe("ends on an escape ");
    expect(partialReply('{"plan":[')).toBe("");
    const think = async (prompt: string, options?: { onText?: (t: string) => void }) => {
      if (prompt.includes("Plan the turn")) return { plan: [{ specialist: "research", task: "Look" }] };
      if (prompt.includes("Write the reply")) {
        for (const chunk of ['{"re', '{"reply":"Your rec', '{"reply":"Your recap is ready."']) options?.onText?.(chunk);
        return { reply: "Your recap is ready." };
      }
      return { done: true, note: "Found it." };
    };
    const seen: string[] = [];
    const turn = await juelTurn({ message: "status?", think, call: async () => ({}), onReply: (t) => seen.push(t) });
    expect(seen).toEqual(["Your rec", "Your recap is ready."]);
    expect(turn.reply).toBe("Your recap is ready.");
  });

  it("talks on the quick model in live mode, and keeps his \"on it\" in front of the answer", async () => {
    const options: any[] = [];
    const prompts: string[] = [];
    const think = async (prompt: string, opts: any) => {
      prompts.push(prompt);
      options.push(opts);
      if (prompt.includes("Plan the turn")) {
        opts?.onText?.('{"reply":"On it, checking.","plan":[{"specialist":"research","task":"look"}]}');
        return { reply: "On it, checking.", plan: [{ specialist: "research", task: "look" }] };
      }
      if (prompt.includes("Write the reply")) {
        opts?.onText?.('{"reply":"Rome is trending."}');
        return { reply: "Rome is trending." };
      }
      return { calls: [], done: true, note: "Rome is trending." };
    };
    const seen: string[] = [];
    const turn = await juelTurn({ message: "what's trending", live: true, think, call: async () => ({}), onReply: (t) => seen.push(t) });
    expect(options[0].kind).toBe("text");
    expect(options.at(-1).kind).toBe("text");
    expect(prompts[0]).toContain("LIVE VOICE CHAT");
    expect(turn.reply).toBe("On it, checking. Rome is trending.");
    expect(seen).toEqual(["On it, checking.", "On it, checking. Rome is trending."]);
  });

  it("runs reads planned together at once, and changes in order", async () => {
    let open = 0, most = 0;
    const order: string[] = [];
    const call = async (c: any) => {
      open += 1; most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 5));
      open -= 1; order.push(c.path);
      return { status: 200, data: {} };
    };
    let round = 0;
    const think = async (prompt: string) => {
      if (prompt.includes("Plan the turn")) return { plan: [{ specialist: "recap", task: "Look, then render" }] };
      if (prompt.includes("Write the reply")) return { reply: "Done." };
      round += 1;
      if (round === 1) return { calls: [{ method: "GET", path: "/api/recaps" }, { method: "GET", path: "/api/recaps/rcp_1" }], done: false, note: "" };
      if (round === 2) return { calls: [{ method: "POST", path: "/api/recaps/rcp_1/render", body: {} }, { method: "DELETE", path: "/api/recaps/rcp_2" }], done: true, note: "Rendered." };
      return { done: true };
    };
    await juelTurn({ message: "go", think, call });
    expect(most).toBe(2);
    expect(order.slice(2)).toEqual(["/api/recaps/rcp_1/render", "/api/recaps/rcp_2"]);
  });

  it("answers directly when there's nothing to do in the app", async () => {
    const think = async () => ({ reply: "Hi! I can make recaps, edits, posts and more.", plan: [] });
    const turn = await juelTurn({ message: "hi", think, call: async () => ({}) });
    expect(turn.reply).toContain("Hi!");
  });
});

describe("Juel's receipts", () => {
  const think = (plan: Record<string, any>) => async (prompt: string) => {
    if (prompt.includes("Plan the turn")) return { plan: plan.manager };
    if (prompt.includes("Write the reply")) return { reply: "Done." };
    for (const [name, steps] of Object.entries(plan)) if (prompt.includes(`the ${name} specialist`)) return steps.shift() || { done: true, note: "ok" };
    return { done: true, note: "ok" };
  };

  it("records each call with its route, risk, description, touched ids, credits, and nothing of the body or payload", async () => {
    let t = 1000;
    const inner = async (c: any) => {
      t += 25;
      if (c.method === "POST") return { status: 201, data: { recap: { id: "rcp_9", script: "SECRET SCRIPT" }, token: "tok_secret" }, credits: 120 };
      return { status: 200, data: { id: "rcp_1", title: "Private title" }, credits: 0 };
    };
    const recorded = withReceipts({ call: inner, now: () => t });
    await recorded.call({ method: "GET", path: "/api/recaps/rcp_1?x=1", why: "Reading the recap", specialist: "recap" });
    await recorded.call({ method: "POST", path: "/api/recaps", body: { film: "https://secret.example/film.mp4", apiKey: "sk-123" }, why: "Start it", specialist: "recap" });
    const [read, made] = recorded.receipts;
    expect(read).toMatchObject({ specialist: "recap", method: "GET", route: "GET /api/recaps/:id", path: "/api/recaps/rcp_1", risk: "read", ok: true, status: 200, credits: 0, touched: ["rcp_1"], why: "Reading the recap", ms: 25 });
    expect(read.does).toBe(JUEL_ROUTES["GET /api/recaps/:id"][2]);
    expect(made).toMatchObject({ route: "POST /api/recaps", risk: "paid", ok: true, status: 201, credits: 120, touched: ["rcp_9"] });
    const text = JSON.stringify(recorded.receipts);
    for (const leak of ["SECRET SCRIPT", "tok_secret", "secret.example", "sk-123", "Private title"]) expect(text).not.toContain(leak);
    expect(receiptLines(recorded.receipts)).toEqual(["GET /api/recaps/:id → 200 rcp_1", "POST /api/recaps (paid, ≈120 credits) → 201 rcp_9"]);
  });

  it("records refusals with the reason and the quoted credits, and still throws", async () => {
    const recorded = withReceipts({
      call: async (c: any) => {
        if (c.path.startsWith("/api/nope")) throw new JuelRefusal("Juel has no tool for GET /api/nope.", "unknown");
        throw Object.assign(new JuelRefusal("Not enough credits. This needs about 120 credits and you have 5.", "credits"), { credits: 120 });
      },
    });
    await expect(recorded.call({ method: "POST", path: "/api/recaps/rcp_1/render", specialist: "publisher" })).rejects.toThrow("Not enough credits");
    await expect(recorded.call({ method: "GET", path: "/api/nope" })).rejects.toThrow("no tool");
    expect(recorded.receipts[0]).toMatchObject({ route: "POST /api/recaps/:id/render", ok: false, status: 0, credits: 120, touched: ["rcp_1"], refused: expect.stringContaining("Not enough credits") });
    expect(recorded.receipts[1]).toMatchObject({ route: "GET /api/nope", risk: "", does: "", ok: false, refused: expect.stringContaining("no tool") });
    expect(receiptLines(recorded.receipts)[0]).toBe("POST /api/recaps/:id/render (paid, ≈120 credits) → refused: Not enough credits. This needs about 120 credits and you have 5. rcp_1");
  });

  it("keeps a route's own error when it answers 4xx", async () => {
    const recorded = withReceipts({ call: async () => ({ status: 403, data: { error: "Your token can't spend credits." }, credits: 0 }) });
    await recorded.call({ method: "POST", path: "/api/recaps" });
    expect(recorded.receipts[0]).toMatchObject({ ok: false, status: 403, error: "Your token can't spend credits.", touched: [] });
  });

  it("captures nested specialist consults and page actions in one turn", async () => {
    const clientTools = pageTools({ specialist: "editor", actions: { add_text: { args: "{text}", about: "Put a title on screen", risk: "change" } } });
    const inner = async (c: any) => ({ status: 200, data: { id: c.path.split("/").pop() }, credits: 0 });
    const recorded = withReceipts({ call: inner, page: async () => ({ sent: true, credits: 0 }), pageActions: () => clientTools.actions });
    await juelTurn({
      message: "Check and title it",
      context: { surface: "editor", clientTools },
      think: think({
        manager: [{ specialist: "recap", task: "Look" }, { specialist: "editor", task: "Title" }],
        Recap: [{ calls: [{ method: "GET", path: "/api/recaps/rcp_1", why: "Look" }], ask: { specialist: "research", question: "Trending?" }, done: true, note: "seen" }],
        Research: [{ calls: [{ method: "GET", path: "/api/recaps" }], done: true, note: "yes" }],
        Editor: [{ page: [{ type: "add_text", args: { text: "SECRET TITLE" } }], done: true, note: "titled" }],
      }),
      call: recorded.call,
      page: recorded.page,
    });
    expect(recorded.receipts.map((r: any) => r.kind === "page" ? `page ${r.type}` : `${r.specialist} ${r.route}`)).toEqual(["recap GET /api/recaps/:id", "research GET /api/recaps", "page add_text"]);
    expect(recorded.receipts[2]).toMatchObject({ kind: "page", type: "add_text", does: "Put a title on screen", specialist: "editor", ok: true, credits: 0 });
    expect(JSON.stringify(recorded.receipts)).not.toContain("SECRET TITLE");
  });

  it("stops at the cap and clips long strings", async () => {
    const recorded = withReceipts({ call: async () => ({ status: 200, data: {} }) });
    for (let i = 0; i < MAX_RECEIPTS + 5; i++) await recorded.call({ method: "GET", path: "/api/recaps", why: "x".repeat(500) });
    expect(recorded.receipts).toHaveLength(MAX_RECEIPTS);
    expect(recorded.receipts[0].why.length).toBeLessThanOrEqual(140);
  });

  it("takes touched ids from path params and an obvious created id, at most 3, ids only", () => {
    expect(touchedIds({ id: "ep_1", job: "j2" }, { generation: { id: "gen_3" }, recap: { id: "rcp_4" } })).toEqual(["ep_1", "j2", "gen_3"]);
    expect(touchedIds({}, { id: "rcp_1", generation: { id: "rcp_1" } })).toEqual(["rcp_1"]);
    expect(touchedIds({}, { id: "has spaces and <html>", items: [{ id: "x" }] })).toEqual([]);
    expect(touchedIds({}, null)).toEqual([]);
  });
});

describe("The public API and MCP", () => {
  it("lets a token call only catalogued routes in its scope", () => {
    const read = matchRoute("GET", "/api/recaps");
    const render = matchRoute("POST", "/api/recaps/rcp_1/render");
    const remove = matchRoute("DELETE", "/api/recaps/rcp_1");
    expect(tokenRefusal(read, "read")).toBeNull();
    expect(tokenRefusal(render, "read")).toMatch(/spend credits/);
    expect(tokenRefusal(render, "create")).toBeNull();
    expect(tokenRefusal(remove, "create")).toMatch(/delete/);
    expect(tokenRefusal(remove, "full")).toBeNull();
    // Unknown, excluded (Juel's own chat, token management), and admin routes are refused.
    expect(tokenRefusal(matchRoute("GET", "/api/nowhere"), "full")).toMatch(/isn't part/);
    expect(tokenRefusal(matchRoute("POST", "/api/juel/chat"), "full")).toMatch(/isn't available/);
    expect(tokenRefusal(matchRoute("POST", "/api/account/tokens"), "full")).toMatch(/isn't available/);
    const admin = matchRoute("GET", "/api/admin/users");
    if (admin && !admin.excluded) {
      expect(tokenRefusal(admin, "full", false)).toMatch(/admin/);
      expect(tokenRefusal(admin, "full", true)).toBeNull();
    }
  });

  it("describes every callable route in OpenAPI with its risk and scope", () => {
    const spec: any = openApiSpec("https://autoyt.cc");
    const operations = Object.values(spec.paths).flatMap((p: any) => Object.values(p));
    expect(operations.length).toBe(Object.keys(JUEL_ROUTES).length);
    const render = spec.paths["/api/recaps/{id}/render"].post;
    expect(render).toMatchObject({ "x-risk": "paid", "x-scope": "create", "x-spends-credits": true });
    expect(render.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
  });

  it("speaks MCP: initialize, list tools, call one, and report errors", async () => {
    const calls: any[] = [];
    const call = async (name: string, args: any) => {
      calls.push([name, args]);
      if (name === "credit_balance") return { balance_credits: 1200 };
      throw new Error("Not enough credits.");
    };
    const init: any = await mcpRespond({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, { call });
    expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "autoyt" }, capabilities: { tools: {} } });
    expect(await mcpRespond({ jsonrpc: "2.0", method: "notifications/initialized" }, { call })).toBeNull();
    const list: any = await mcpRespond({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { call });
    expect(list.result.tools.map((t: any) => t.name)).toEqual(MCP_TOOLS.map((t) => t.name));
    const ok: any = await mcpRespond({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "credit_balance", arguments: {} } }, { call });
    expect(ok.result).toMatchObject({ isError: false, structuredContent: { balance_credits: 1200 } });
    const bad: any = await mcpRespond({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "call_api", arguments: { method: "POST", path: "/api/recaps" } } }, { call });
    expect(bad.result).toMatchObject({ isError: true, content: [{ type: "text", text: "Not enough credits." }] });
    expect(((await mcpRespond({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "rm" } }, { call })) as any).error.code).toBe(-32602);
    expect(((await mcpRespond({ jsonrpc: "2.0", id: 6, method: "resources/list" }, { call })) as any).error.code).toBe(-32601);
  });
});

describe("What Juel shows inline", () => {
  it("shows only media URLs a route really returned, typed by what they are", () => {
    const seen = urlsIn({ recap: { video: "/api/recaps/rcp_1/video.mp4", poster: "https://cdn.example.com/p.jpg", note: "not a url" }, list: [{ audio: "/api/voicebox/a.wav" }] });
    const shown = cleanShows([
      { url: "/api/recaps/rcp_1/video.mp4", label: "Your recap" },
      { url: "https://cdn.example.com/p.jpg", type: "image" },
      { url: "/api/voicebox/a.wav" },
      { url: "https://evil.example.com/made-up.mp4" },
    ], seen);
    expect(shown).toEqual([
      { type: "video", url: "/api/recaps/rcp_1/video.mp4", label: "Your recap" },
      { type: "image", url: "https://cdn.example.com/p.jpg", label: "" },
      { type: "audio", url: "/api/voicebox/a.wav", label: "" },
    ]);
  });

  it("keeps a report to plain, capped text and drops empty ones", () => {
    expect(cleanReport({ title: "Week", cards: [{ label: "Views", value: 1200, tone: "good" }], table: { columns: ["Video", "Views"], rows: [["A", 10, "extra"], "bad"] } })).toEqual({
      kind: "report", title: "Week", cards: [{ label: "Views", value: "1200", tone: "good" }], table: { columns: ["Video", "Views"], rows: [["A", "10"]] },
    });
    expect(cleanReport({ title: "Nothing" })).toBeNull();
  });
});

describe("Tokens and MCP over HTTP", () => {
  it("creates a token in the browser, then calls routes and MCP with it, inside its scope only", async () => {
    const express = (await import("express")).default;
    const { juelApiAuth, registerJuel } = await import("./juel.js");
    const docs = new Map<string, any[]>();
    const app = express();
    app.use(express.json());
    app.use(juelApiAuth);
    const server = await new Promise<any>((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const port = server.address().port;
    const session = async (req: any) => (req.apiToken ? { user: { id: req.apiToken.userId, email: "me@x.com" } } : req.headers.cookie === "sid=u1" ? { user: { id: "u1", email: "me@x.com" } } : null);
    registerJuel(app, {
      session, isAdmin: async () => false, port, withUsage: (_u: string, _f: string, run: () => any) => run(),
      generateJson: async () => ({ reply: "hi", plan: [] }),
      docs: { read: async (owner: string, name: string) => { const key = `${owner}/${name}`; if (!docs.has(key)) docs.set(key, []); return docs.get(key)!; }, save: async () => undefined },
      credits: { snapshot: async () => ({ balance: 100000, status: "active", planId: "pro" }), pricing: async () => ({ tokensPerUsd: 1_000_000, flatTokens: { speech: 3000 } }), history: async () => ({}) },
    });
    // Two real routes from the catalogue, as the app's would answer.
    app.get("/api/recaps", async (req, res) => ((await session(req)) ? res.json({ recaps: [{ id: "rcp_1", video: "/api/recaps/rcp_1/video.mp4" }] }) : res.status(401).json({ error: "Sign in required" })));
    app.post("/api/recaps/:id/render", (_req, res) => res.json({ started: true }));
    const base = `http://127.0.0.1:${port}`;
    try {
      // A token is made only from a signed-in browser, and shown once.
      expect((await fetch(`${base}/api/account/tokens`, { method: "POST" })).status).toBe(401);
      const made = await (await fetch(`${base}/api/account/tokens`, { method: "POST", headers: { cookie: "sid=u1", "content-type": "application/json" }, body: JSON.stringify({ name: "Claude", scope: "read" }) })).json();
      expect(made.token).toMatch(/^ayt_/);
      expect(JSON.stringify(docs.get("_system/api-tokens.json"))).not.toContain(made.token);
      const auth = { authorization: `Bearer ${made.token}` };
      // Reads work; a paid route is outside a read token's scope; a wrong token is turned away.
      expect((await fetch(`${base}/api/recaps`, { headers: auth })).status).toBe(200);
      expect((await fetch(`${base}/api/recaps/rcp_1/render`, { method: "POST", headers: auth })).status).toBe(403);
      expect((await fetch(`${base}/api/recaps`, { headers: { authorization: "Bearer ayt_nope" } })).status).toBe(401);
      expect((await fetch(`${base}/api/account/tokens`, { headers: auth })).status).toBe(403);
      // MCP: initialize, then call the API through it.
      const rpc = async (body: any) => (await fetch(`${base}/mcp`, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) })).json();
      expect((await fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
      expect((await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).result.serverInfo.name).toBe("autoyt");
      const listed = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "call_api", arguments: { method: "GET", path: "/api/recaps" } } });
      expect(listed.result.structuredContent).toMatchObject({ status: 200, data: { recaps: [{ id: "rcp_1" }] } });
      const refused = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "call_api", arguments: { method: "POST", path: "/api/recaps/rcp_1/render" } } });
      expect(refused.result.structuredContent).toMatchObject({ status: 403 });
      const found = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "find_capabilities", arguments: { query: "recap render" } } });
      expect(found.result.structuredContent.routes.find((r: any) => r.route === "POST /api/recaps/:id/render")).toMatchObject({ your_token_can_call: false });
      const asked = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "ask_juel", arguments: { message: "hi" } } });
      expect(asked.result.structuredContent).toMatchObject({ reply: "hi" });
      expect((await fetch(`${base}/api/openapi.json`)).status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("Juel's streamed voice", () => {
  const sse = (events: any[]) => new Response(new ReadableStream({
    start(c) {
      const enc = new TextEncoder();
      // Split mid-event, the way the network delivers it.
      const text = events.map((e) => `data: ${JSON.stringify(e)}\r\n\r\n`).join("");
      c.enqueue(enc.encode(text.slice(0, 30)));
      c.enqueue(enc.encode(text.slice(30)));
      c.close();
    },
  }));
  const audio = (bytes: number[]) => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from(bytes).toString("base64") } }] } }] });

  it("hands over the audio as it arrives, on the lite model first", async () => {
    const urls: string[] = [];
    const got: number[] = [];
    const result = await streamGeminiSpeech({
      text: "Hi", voice: "Puck", env: { GEMINI_API_KEY: "k1" } as any,
      fetchImpl: (async (url: string) => { urls.push(url); return sse([audio([1, 2]), audio([3, 4])]); }) as any,
      onAudio: (pcm: Buffer) => got.push(...pcm),
    });
    expect(urls[0]).toContain("gemini-3.8-flash-lite-tts:streamGenerateContent?alt=sse");
    expect(got).toEqual([1, 2, 3, 4]);
    expect(result.bytes).toBe(4);
  });

  it("tries the backup key, then the full model, when one can't speak", async () => {
    const tried: string[] = [];
    const result = await streamGeminiSpeech({
      text: "Hi", voice: "Puck", env: { GEMINI_API_KEY: "k1", GEMINI_API_KEY_BACKUP: "k2" } as any,
      fetchImpl: (async (url: string, init: any) => {
        tried.push(`${url.includes("lite") ? "lite" : "full"}/${init.headers["x-goog-api-key"]}`);
        return url.includes("lite") ? new Response("busy", { status: 429 }) : sse([audio([9])]);
      }) as any,
      onAudio: () => undefined,
    });
    expect(tried).toEqual(["lite/k1", "lite/k2", "full/k1"]);
    expect(result.model).toBe("gemini-3.8-flash-tts");
  });

  it("says so when there's no key", async () => {
    await expect(streamGeminiSpeech({ text: "Hi", voice: "Puck", env: {} as any, onAudio: () => undefined })).rejects.toThrow("isn't set up");
  });

  it("skips a model and key that ran out of quota until Gemini says to retry", async () => {
    const tried: string[] = [];
    const quota = { error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "27774s" }] } };
    const speak = () => streamGeminiSpeech({
      text: "Hi", voice: "Puck", env: { GEMINI_API_KEY: "quota-a", GEMINI_API_KEY_BACKUP: "quota-b" } as any,
      fetchImpl: (async (url: string, init: any) => {
        tried.push(`${url.includes("lite") ? "lite" : "full"}/${init.headers["x-goog-api-key"]}`);
        return url.includes("lite") ? Response.json(quota, { status: 429 }) : sse([audio([9])]);
      }) as any,
      onAudio: () => undefined,
    });
    await speak();
    await speak();
    // The second sentence goes straight to the model that can still speak.
    expect(tried).toEqual(["lite/quota-a", "lite/quota-b", "full/quota-a", "full/quota-a"]);
    const { quotaBlocked } = await import("./juel.js");
    expect(quotaBlocked("gemini-3.8-flash-lite-tts", "quota-a")).toBe(true);
    expect(quotaBlocked("gemini-3.8-flash-lite-tts", "quota-a", Date.now() + 27775 * 1000)).toBe(false);
  });
});

describe("Juel's hearing", () => {
  it("reads the browser's recording formats inline and refuses others", async () => {
    const { hearingMime } = await import("./juel.js");
    expect(hearingMime("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(hearingMime("video/webm")).toBe("audio/webm");
    expect(hearingMime("audio/mp4")).toBe("audio/mp4");
    expect(hearingMime("audio/x-wav")).toBe("audio/wav");
    expect(hearingMime("application/pdf")).toBe("");
  });

  it("keeps only the spoken words when a transcript comes back with time codes", async () => {
    const { spokenWords } = await import("./juel.js");
    expect(spokenWords("[00:01] When does the next video go out?")).toBe("When does the next video go out?");
    expect(spokenWords("00:00 - 00:03 Make a thumbnail 00:03 - 00:05 for the heist recap")).toBe("Make a thumbnail for the heist recap");
    expect(spokenWords("(0:02.5) Post it at six [music]")).toBe("Post it at six");
    expect(spokenWords("Speaker 1: hello there")).toBe("hello there");
    // A time you actually say stays.
    expect(spokenWords("Meet me at 6:30 tonight")).toBe("Meet me at 6:30 tonight");
    expect(spokenWords("00:00:01.200 Post it now")).toBe("Post it now");
  });

  it("takes the first provider with words, and waits past a quick empty answer", async () => {
    const { firstWords } = await import("./juel.js");
    const later = <T,>(ms: number, value: T) => (signal: AbortSignal) => new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => resolve(value), ms);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    });
    expect(await firstWords([later(30, { text: "Hi", model: "a" }), later(5, { text: "", model: "b" })])).toEqual({ text: "Hi", model: "a" });
    expect(await firstWords([later(5, { text: "Hi", model: "a" }), later(60, { text: "Later", model: "b" })])).toEqual({ text: "Hi", model: "a" });
    expect(await firstWords([later(5, { text: "", model: "a" }), later(10, { text: "", model: "b" })])).toEqual({ text: "", model: "a" });
    // One failing is fine while another answers; all failing is an error.
    expect(await firstWords([() => Promise.reject(new Error("down")), later(5, { text: "Hi", model: "b" })])).toEqual({ text: "Hi", model: "b" });
    await expect(firstWords([() => Promise.reject(new Error("down")), () => Promise.reject(new Error("also down"))])).rejects.toThrow("also down");
  });

  it("drops words that can't fit in the recording (made up from noise)", async () => {
    const { plausibleWords } = await import("./juel.js");
    const stock = "I'm not sure if I'm going to be able to make it to the meeting today";
    expect(plausibleWords(stock, 1100)).toBe("");
    expect(plausibleWords("Hi.", 900)).toBe("Hi.");
    expect(plausibleWords(stock, 4000)).toBe(stock);
    // No length sent (an older page): kept as heard.
    expect(plausibleWords(stock, undefined)).toBe(stock);
  });

  it("sends the recording to Gemini as recorded and returns only the words", async () => {
    const { hearWithGemini } = await import("./juel.js");
    const sent: any[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      sent.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text: "  [00:00] When does the next video   go out? " }) }] } }] }), { status: 200 });
    }) as any;
    const heard = await hearWithGemini({ audio: Buffer.from("opus-bytes"), mimeType: "audio/webm", fetchImpl, env: { GEMINI_API_KEY: "k" } as any });
    expect(heard.text).toBe("When does the next video go out?");
    expect(sent[0].url).toContain("gemini-3.1-flash-lite:generateContent");
    expect(sent[0].body.contents[0].parts[0].inlineData).toEqual({ mimeType: "audio/webm", data: Buffer.from("opus-bytes").toString("base64") });
  });
});

