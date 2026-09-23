// Prompt library: curated prompts.chat prompts (CC0, built by
// scripts/build-prompt-library.mjs) plus each account's favorites and own
// prompts, stored as one creator_research_collections row per account.
import crypto from "node:crypto";
import fs from "node:fs";
import { PROMPT_CATEGORIES, PROMPT_CATEGORY_IDS } from "../src/utils/promptCategories.js";

const DATA_FILE = new URL("../data/prompt-library.json", import.meta.url);
const STOP = new Set(
  "a an and are as at be by for from how i in into is it its of on or that the this to was what when why with you your video videos youtube make about".split(" "),
);
let library = null;

export function loadPromptLibrary(file = DATA_FILE) {
  if (library && file === DATA_FILE) return library;
  let data = { source: null, prompts: [] };
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn("Prompt library data is missing:", error.message);
  }
  const prompts = (data.prompts || []).map((prompt) => ({
    ...prompt,
    // Precomputed lowercase fields keep each search a handful of string scans.
    _title: `${prompt.title} ${prompt.act}`.toLowerCase(),
    _tags: (prompt.tags || []).join(" ").toLowerCase(),
    _text: `${prompt.snippet} ${prompt.summary}`.toLowerCase(),
    _prompt: String(prompt.prompt || "").toLowerCase(),
  }));
  const loaded = { source: data.source || null, prompts };
  if (file === DATA_FILE) library = loaded;
  return loaded;
}

export function tokens(text) {
  return [...new Set(String(text || "").toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) || [])].filter((word) => !STOP.has(word)).slice(0, 40);
}

function score(prompt, words) {
  let total = 0;
  for (const word of words) {
    if (prompt._title.includes(word)) total += 4;
    if (prompt._tags.includes(word)) total += 3;
    if (prompt._text.includes(word)) total += 2;
    else if (prompt._prompt.includes(word)) total += 0.5;
  }
  return total;
}

// A prompt's snippet is written for its first category. `primary` keeps only
// snippets that fit the field: its own category, or one written the same way
// (visual art direction serves thumbnails; idea and script are both briefs).
const COMPATIBLE = {
  visualStyle: ["visualStyle", "thumbnail"],
  thumbnail: ["thumbnail", "visualStyle"],
  idea: ["idea", "script"],
  script: ["script", "idea"],
  hook: ["hook"],
  narration: ["narration"],
  music: ["music"],
};
const inCategory = (prompt, category, primary) =>
  Boolean(prompt.categories?.includes(category)) && (!primary || (COMPATIBLE[category] || [category]).includes(prompt.categories[0]));

export function searchPrompts(items, { q = "", category = "", limit = 30, offset = 0, primary = false } = {}) {
  const words = tokens(q);
  const pool = category ? items.filter((prompt) => inCategory(prompt, category, primary)) : items;
  const ranked = words.length
    ? pool.map((prompt) => ({ prompt, score: score(prompt, words) })).filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || b.prompt.relevance - a.prompt.relevance).map((entry) => entry.prompt)
    // Browsing (no query) leads with the user's own prompts, then ones with example media.
    : [...pool].sort(
        (a, b) =>
          Number(Boolean(b.custom)) - Number(Boolean(a.custom)) ||
          Number(Boolean(b.image || b.video)) - Number(Boolean(a.image || a.video)) ||
          (b.relevance || 0) - (a.relevance || 0),
      );
  return { total: ranked.length, items: ranked.slice(offset, offset + limit) };
}

// Suggestions: rank a category against the project's own words, then keep
// the list varied so it isn't six near-identical prompts.
export function suggestPrompts(items, { category = "", context = "", limit = 6, favorites = new Set() } = {}) {
  const words = tokens(context);
  const pool = items.filter((prompt) => inCategory(prompt, category, true));
  const ranked = pool
    .map((prompt) => ({
      prompt,
      score: score(prompt, words) + (prompt.relevance || 0) * 1.5 + (favorites.has(prompt.id) ? 6 : 0) + (prompt.custom ? 4 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.prompt.title.localeCompare(b.prompt.title));
  const picked = [];
  const seenTags = new Set();
  for (const { prompt } of ranked) {
    const tag = prompt.tags?.[0];
    if (tag && seenTags.has(tag) && ranked.length > limit * 2) continue;
    if (tag) seenTags.add(tag);
    picked.push(prompt);
    if (picked.length >= limit) break;
  }
  return picked;
}

const publicPrompt = ({ _title, _tags, _text, _prompt, ...prompt }, favorites) => ({ ...prompt, favorite: favorites.has(prompt.id) });

export function registerPromptLibrary(app, deps) {
  const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
  const q = (value) => deps.sqlString(value);
  const route = (handler) => async (req, res) => {
    try {
      const session = await deps.session(req);
      if (!session?.user) throw fail("Sign in required", 401);
      await handler(req, res, session);
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message || "Prompt library request failed" });
    }
  };
  const accountFor = async (req, session, required) => {
    try {
      return await deps.account(session.user.id, String(req.body?.accountId || req.query.accountId || session.activeYoutubeAccountId || ""));
    } catch (error) {
      if (required) throw fail("Connect a YouTube account to save prompts");
      return null;
    }
  };
  const rowId = (userId, accountId) => `prompts_${crypto.createHash("sha256").update(`${userId}|${accountId}`).digest("hex").slice(0, 24)}`;
  async function readSaved(userId, account) {
    if (!account) return { favorites: [], custom: [] };
    const raw = await deps.runPsql(
      `SELECT COALESCE((SELECT data FROM creator_research_collections WHERE id=${q(rowId(userId, account.id))} AND user_id=${q(userId)} AND youtube_account_id=${q(account.id)}), '{}'::jsonb);`,
    );
    const data = JSON.parse(String(raw || "{}").trim() || "{}");
    return { favorites: Array.isArray(data.favorites) ? data.favorites : [], custom: Array.isArray(data.custom) ? data.custom : [] };
  }
  async function writeSaved(userId, account, saved) {
    const data = { kind: "promptLibrary", favorites: saved.favorites.slice(0, 500), custom: saved.custom.slice(0, 200) };
    await deps.runPsql(
      `INSERT INTO creator_research_collections(id,user_id,youtube_account_id,name,data) VALUES(${q(rowId(userId, account.id))},${q(userId)},${q(account.id)},'Prompt library',${deps.jsonbLiteral(data)})
       ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=now() WHERE creator_research_collections.user_id=${q(userId)};`,
    );
  }
  const customItems = (saved) =>
    saved.custom.map((prompt) => ({
      ...prompt,
      custom: true,
      relevance: 3,
      _title: String(prompt.title || "").toLowerCase(),
      _tags: "",
      _text: `${prompt.snippet || ""}`.toLowerCase(),
      _prompt: String(prompt.prompt || "").toLowerCase(),
    }));

  app.get(
    "/api/prompts",
    route(async (req, res, session) => {
      const { prompts, source } = loadPromptLibrary();
      const saved = await readSaved(session.user.id, await accountFor(req, session, false));
      const favorites = new Set(saved.favorites);
      const everything = [...customItems(saved), ...prompts];
      const category = PROMPT_CATEGORY_IDS.includes(String(req.query.category)) ? String(req.query.category) : "";
      const pool = req.query.saved === "1" ? everything.filter((prompt) => prompt.custom || favorites.has(prompt.id)) : everything;
      const result = searchPrompts(pool, {
        q: String(req.query.q || "").slice(0, 200),
        category,
        limit: Math.min(60, Math.max(1, Number(req.query.limit) || 30)),
        offset: Math.max(0, Number(req.query.offset) || 0),
        primary: req.query.primary === "1",
      });
      res.json({
        total: result.total,
        items: result.items.map((prompt) => publicPrompt(prompt, favorites)),
        categories: PROMPT_CATEGORIES.map(({ id, label, hint }) => ({ id, label, hint, count: everything.filter((prompt) => prompt.categories?.includes(id)).length })),
        savedCount: saved.custom.length + saved.favorites.length,
        source,
      });
    }),
  );
  app.get(
    "/api/prompts/suggest",
    route(async (req, res, session) => {
      const category = String(req.query.category || "");
      if (!PROMPT_CATEGORY_IDS.includes(category)) throw fail("Unknown prompt category");
      const saved = await readSaved(session.user.id, await accountFor(req, session, false));
      const favorites = new Set(saved.favorites);
      const items = suggestPrompts([...customItems(saved), ...loadPromptLibrary().prompts], {
        category,
        context: String(req.query.context || "").slice(0, 2000),
        limit: Math.min(12, Math.max(1, Number(req.query.limit) || 6)),
        favorites,
      });
      res.json({ items: items.map((prompt) => publicPrompt(prompt, favorites)) });
    }),
  );
  app.post(
    "/api/prompts/favorites",
    route(async (req, res, session) => {
      const account = await accountFor(req, session, true);
      const id = String(req.body?.id || "");
      const saved = await readSaved(session.user.id, account);
      const exists = loadPromptLibrary().prompts.some((prompt) => prompt.id === id) || saved.custom.some((prompt) => prompt.id === id);
      if (!exists) throw fail("That prompt no longer exists", 404);
      const favorites = new Set(saved.favorites);
      if (req.body?.favorite === false) favorites.delete(id);
      else favorites.add(id);
      await writeSaved(session.user.id, account, { ...saved, favorites: [...favorites] });
      res.json({ id, favorite: favorites.has(id) });
    }),
  );
  app.post(
    "/api/prompts/custom",
    route(async (req, res, session) => {
      const account = await accountFor(req, session, true);
      const title = String(req.body?.title || "").trim().slice(0, 80);
      const snippet = String(req.body?.snippet || "").trim().slice(0, 1200);
      const categories = (Array.isArray(req.body?.categories) ? req.body.categories : [req.body?.category]).map(String).filter((c) => PROMPT_CATEGORY_IDS.includes(c));
      if (!title || !snippet) throw fail("Give the prompt a name and the text to use");
      if (!categories.length) throw fail("Choose where this prompt should be suggested");
      const saved = await readSaved(session.user.id, account);
      if (saved.custom.length >= 200) throw fail("You have 200 saved prompts. Delete one to add another.");
      const prompt = {
        id: `custom-${crypto.randomUUID()}`,
        title,
        categories: [...new Set(categories)],
        snippet,
        summary: String(req.body?.summary || "").trim().slice(0, 200),
        prompt: String(req.body?.prompt || snippet).slice(0, 8000),
        tags: [],
        createdAt: Date.now(),
      };
      await writeSaved(session.user.id, account, { ...saved, custom: [prompt, ...saved.custom] });
      res.status(201).json({ item: { ...prompt, custom: true, relevance: 3, favorite: false } });
    }),
  );
  app.delete(
    "/api/prompts/custom/:id",
    route(async (req, res, session) => {
      const account = await accountFor(req, session, true);
      const saved = await readSaved(session.user.id, account);
      const id = String(req.params.id || "");
      if (!saved.custom.some((prompt) => prompt.id === id)) throw fail("That prompt no longer exists", 404);
      await writeSaved(session.user.id, account, {
        custom: saved.custom.filter((prompt) => prompt.id !== id),
        favorites: saved.favorites.filter((favorite) => favorite !== id),
      });
      res.json({ ok: true });
    }),
  );
}
