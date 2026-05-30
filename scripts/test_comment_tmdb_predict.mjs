import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findMovieTitleFromCommentThreads } from "../src/utils/movieCommentHints.js";
import { buildCommentCorpus, buildTmdbSearchQueries, extractDistinctivePhrases, inferTitleFromCommentCorpus } from "../src/utils/commentTmdbInference.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const url = process.argv[2] || "";

if (!url) {
  console.error("Usage: node scripts/test_comment_tmdb_predict.mjs <tiktok-video-url>");
  process.exit(1);
}

function loadEnvFile(name) {
  const filePath = path.join(root, name);
  if (!fs.existsSync(filePath))
    return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#"))
      continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0)
      continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    if (!(key in process.env))
      process.env[key] = value;
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

function resolvePythonCommand() {
  const configured = (process.env.PYTHON_PATH || "").trim();
  if (configured) {
    const parts = configured.split(/\s+/).filter(Boolean);
    const exe = parts[0];
    if (fs.existsSync(exe) || (!exe.includes("/") && !exe.includes("\\")))
      return { cmd: parts[0], prefixArgs: parts.slice(1) };
  }
  if (process.platform === "win32")
    return { cmd: "py", prefixArgs: ["-3"] };
  return { cmd: "python3", prefixArgs: [] };
}

async function runLocalCommentFetcher(targetUrl, attempts = 2) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt)
      await new Promise((resolve) => setTimeout(resolve, 2500));
    try {
      return await runLocalCommentFetcherOnce(targetUrl);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function runLocalCommentFetcherOnce(targetUrl) {
  const { cmd, prefixArgs } = resolvePythonCommand();
  const args = [...prefixArgs, "scripts/local_comment_fetcher.py", targetUrl];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      env: { ...process.env, MODE_A_HEADLESS: process.env.MODE_A_HEADLESS || "true" },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() || "{}";
      try {
        const data = JSON.parse(line);
        if (data.error)
          reject(new Error(data.error));
        else if (!data.threadCount && !data.threads?.length)
          reject(new Error(stderr || stdout || `fetch returned 0 threads (exit ${code})`));
        else
          resolve(data);
      } catch (error) {
        reject(new Error(stderr || stdout || String(error)));
      }
    });
  });
}

async function searchTmdbMulti(query, pathName = "search/multi") {
  const apiKey = (process.env.TMDB_API_KEY || "").replace(/^["']|["']$/g, "").trim();
  const bearer = (process.env.TMDB_READ_ACCESS_TOKEN || process.env.TMDB_ACCESS_TOKEN || "").replace(/^["']|["']$/g, "").trim();
  if (!apiKey && !bearer)
    throw new Error("TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN required in .env.local");
  const endpoint = new URL(`https://api.themoviedb.org/3/${pathName.replace(/^\/+/, "")}`);
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("include_adult", "false");
  if (apiKey)
    endpoint.searchParams.set("api_key", apiKey);
  const headers = bearer ? { Authorization: `Bearer ${bearer}` } : {};
  const response = await fetch(endpoint, { headers });
  if (!response.ok)
    throw new Error(`TMDB search failed (${response.status})`);
  return response.json();
}

const payload = await runLocalCommentFetcher(url);
const threads = payload.threads || [];
const directHint = findMovieTitleFromCommentThreads(threads, {
  videoAuthorUniqueId: payload.authorUniqueId || "",
  minConfidence: 0.85,
});

const corpus = buildCommentCorpus(threads, payload.title || "");
const phrases = extractDistinctivePhrases(corpus.combined, corpus.title);
const queries = buildTmdbSearchQueries(corpus, phrases);
const tmdbHint = await inferTitleFromCommentCorpus(threads, {
  videoTitle: payload.title || "",
  searchMulti: searchTmdbMulti,
});

console.log(JSON.stringify({
  url,
  videoId: payload.videoId,
  videoTitle: payload.title,
  threadCount: payload.threadCount || threads.length,
  directCommentHint: directHint,
  distinctivePhrases: phrases.slice(0, 8),
  tmdbQueries: queries,
  tmdbPrediction: tmdbHint,
  prediction: directHint?.title
    ? { source: "comment_reply", ...directHint }
    : tmdbHint?.title
      ? { source: "comment_corpus_tmdb", ...tmdbHint }
      : null,
}, null, 2));
