import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { callRoute, JUEL_EXCLUDED, JUEL_RISKS, JUEL_ROUTES, JUEL_SPECIALISTS, juelTools, matchRoute, needsApproval } from "./juel.js";

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
});

describe("Juel's routing and approvals", () => {
  const routes = { "GET /api/recaps": ["recap", "read", "Lists your recaps."], "GET /api/recaps/:id": ["recap", "read", "One recap."], "POST /api/recaps/:id/render": ["recap", "paid", "Renders a recap."], "GET /api/admin/users": ["admin", "read", "Lists users."] };
  const excluded = { "GET /api/recaps/:id/sheets/:name": "file stream for the editor" };

  it("matches a concrete call to its route and params", () => {
    expect(matchRoute("POST", "/api/recaps/rcp_1/render", { routes, excluded })).toMatchObject({ key: "POST /api/recaps/:id/render", params: { id: "rcp_1" }, risk: "paid", approval: true });
    expect(matchRoute("GET", "/api/recaps?x=1", { routes, excluded })?.key).toBe("GET /api/recaps");
    expect(matchRoute("GET", "/api/recaps/rcp_1/sheets/s001.jpg", { routes, excluded })?.excluded).toBe("file stream for the editor");
    expect(matchRoute("DELETE", "/api/recaps/rcp_1", { routes, excluded })).toBeNull();
  });

  it("asks before paid, publish, and delete, never before read or change", () => {
    expect(["read", "change", "paid", "publish", "delete"].map(needsApproval)).toEqual([false, false, true, true, true]);
  });

  it("calls a route as the user, and refuses what it shouldn't call", async () => {
    const calls: any[] = [];
    const fetchImpl: any = async (url: URL, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); };
    const options = { baseUrl: "http://127.0.0.1:3000", cookie: "sid=abc", fetchImpl, routes, excluded };
    const done = await callRoute({ method: "GET", path: "/api/recaps", query: { limit: 5 } }, options);
    expect(done).toMatchObject({ status: 200, data: { ok: true }, route: "GET /api/recaps" });
    expect(calls[0].url).toBe("http://127.0.0.1:3000/api/recaps?limit=5");
    expect(calls[0].init.headers.cookie).toBe("sid=abc");
    await expect(callRoute({ method: "POST", path: "/api/recaps/rcp_1/render" }, options)).rejects.toMatchObject({ code: "approval" });
    await expect(callRoute({ method: "POST", path: "/api/recaps/rcp_1/render", body: {} }, { ...options, approved: true })).resolves.toMatchObject({ status: 200 });
    await expect(callRoute({ method: "GET", path: "/api/recaps/rcp_1/sheets/s001.jpg" }, options)).rejects.toMatchObject({ code: "excluded" });
    await expect(callRoute({ method: "GET", path: "/api/admin/users" }, options)).rejects.toMatchObject({ code: "forbidden" });
    await expect(callRoute({ method: "GET", path: "/api/nowhere" }, options)).rejects.toMatchObject({ code: "unknown" });
  });

  it("keeps admin tools out of a non-admin's list", () => {
    expect(juelTools({ routes }).some((t) => t.specialist === "admin")).toBe(false);
    expect(juelTools({ routes, admin: true }).some((t) => t.specialist === "admin")).toBe(true);
  });
});
