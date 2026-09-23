import express from "express";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { registerPromptLibrary, searchPrompts, suggestPrompts, tokens } from "./promptLibrary.js";

const prompt = (id: string, title: string, categories: string[], snippet: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  act: title,
  categories,
  snippet,
  summary: "",
  tags: [],
  relevance: 2,
  prompt: snippet,
  _title: title.toLowerCase(),
  _tags: "",
  _text: snippet.toLowerCase(),
  _prompt: snippet.toLowerCase(),
  ...extra,
});
const items = [
  prompt("noir", "Noir documentary look", ["visualStyle"], "High-contrast black and white, hard side light, film grain"),
  prompt("pastel", "Pastel storybook", ["visualStyle"], "Soft pastel watercolor washes, gentle daylight", { relevance: 3 }),
  prompt("lofi", "Lo-fi study beat", ["music"], "Mellow lo-fi hip hop, vinyl crackle, 80 bpm"),
  prompt("calm", "Calm narrator", ["narration"], "Measured, warm, unhurried delivery"),
];

describe("prompt search", () => {
  it("drops stop words and short tokens", () => {
    expect(tokens("How to make a NOIR video about crime")).toEqual(["noir", "crime"]);
  });
  it("filters by category and ranks title matches first", () => {
    const result = searchPrompts(items, { q: "noir", category: "visualStyle" });
    expect(result.items.map((item) => item.id)).toEqual(["noir"]);
    expect(searchPrompts(items, { q: "noir", category: "music" }).total).toBe(0);
  });
  it("orders by relevance when there is no query", () => {
    expect(searchPrompts(items, { category: "visualStyle" }).items[0].id).toBe("pastel");
  });
});

describe("prompt suggestions", () => {
  it("prefers prompts that match the project's words", () => {
    const [first] = suggestPrompts(items, { category: "visualStyle", context: "A true crime story told in black and white film grain" });
    expect(first.id).toBe("noir");
  });
  it("only suggests prompts whose snippet was written for that category", () => {
    const mixed = [...items, prompt("essay", "Video essay director", ["script", "narration"], "Architect a high-retention video essay")];
    expect(suggestPrompts(mixed, { category: "narration" }).map((item) => item.id)).toEqual(["calm"]);
  });
  it("puts saved prompts first and stays within the category", () => {
    const picked = suggestPrompts(items, { category: "visualStyle", context: "", favorites: new Set(["noir"]) });
    expect(picked[0].id).toBe("noir");
    expect(picked.every((item) => item.categories.includes("visualStyle"))).toBe(true);
  });
});

describe("prompt library routes", () => {
  let server: ReturnType<typeof createServer> | null = null;
  afterEach(() => server?.close());

  async function start(accountOk = true) {
    const rows = new Map<string, string>();
    const app = express();
    app.use(express.json());
    registerPromptLibrary(app, {
      session: async (req: any) => (req.get("x-user") ? { user: { id: req.get("x-user") } } : null),
      account: async (_userId: string, accountId: string) => {
        if (!accountOk) throw new Error("Publish channel not found");
        return { id: accountId || "acct-1" };
      },
      sqlString: (value: string) => `'${String(value).replace(/'/g, "''")}'`,
      jsonbLiteral: (value: unknown) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`,
      // Tiny stand-in for the one row the module reads and writes.
      runPsql: async (sql: string) => {
        const id = sql.match(/'(prompts_[a-f0-9]+)'/)?.[1] || "";
        if (sql.startsWith("SELECT")) return rows.get(id) || "{}";
        const data = sql.match(/'(\{.*\})'::jsonb/)?.[1]?.replace(/''/g, "'");
        if (data) rows.set(id, data);
        return "";
      },
    });
    server = createServer(app);
    await new Promise<void>((resolve) => server!.listen(0, resolve));
    const base = `http://127.0.0.1:${(server!.address() as any).port}`;
    return (path: string, init: RequestInit & { user?: string } = {}) =>
      fetch(`${base}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.user === "" ? {} : { "x-user": init.user || "user-1" }) },
      });
  }

  it("requires sign-in", async () => {
    const call = await start();
    expect((await call("/api/prompts", { user: "" })).status).toBe(401);
  });
  it("rejects unknown suggestion categories", async () => {
    const call = await start();
    expect((await call("/api/prompts/suggest?category=nope")).status).toBe(400);
  });
  it("saves a custom prompt per account and suggests it", async () => {
    const call = await start();
    const created = await call("/api/prompts/custom", {
      method: "POST",
      body: JSON.stringify({ title: "My neon look", categories: ["visualStyle"], snippet: "Neon rim light, wet streets, teal and magenta" }),
    });
    expect(created.status).toBe(201);
    const { item } = await created.json();
    const suggest = await (await call("/api/prompts/suggest?category=visualStyle&context=neon")).json();
    expect(suggest.items[0].id).toBe(item.id);
    const otherUser = await (await call("/api/prompts?saved=1", { user: "user-2" })).json();
    expect(otherUser.items).toHaveLength(0);
    expect((await call(`/api/prompts/custom/${item.id}`, { method: "DELETE" })).status).toBe(200);
    expect((await (await call("/api/prompts?saved=1")).json()).items).toHaveLength(0);
  });
  it("validates custom prompts and needs an account to save", async () => {
    const call = await start();
    expect((await call("/api/prompts/custom", { method: "POST", body: JSON.stringify({ title: "x", snippet: "y", categories: ["bogus"] }) })).status).toBe(400);
    const noAccount = await start(false);
    const response = await noAccount("/api/prompts/custom", { method: "POST", body: JSON.stringify({ title: "x", snippet: "y", categories: ["music"] }) });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Connect a YouTube account/);
  });
  it("refuses to favorite prompts that don't exist", async () => {
    const call = await start();
    expect((await call("/api/prompts/favorites", { method: "POST", body: JSON.stringify({ id: "no-such-prompt" }) })).status).toBe(404);
  });
});
