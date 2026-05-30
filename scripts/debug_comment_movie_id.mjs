/**
 * Debug comment -> Movie ID path using VPS comment cache + MAL lookup.
 * Run on VPS: node scripts/debug_comment_movie_id.mjs <videoId>
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { findMovieTitleFromCommentThreads } from "../src/utils/movieCommentHints.js";
import { databaseSummaryCandidate } from "../src/utils/movieIdVerification.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

for (const file of [".env", ".env.local"]) {
  const filePath = path.join(root, file);
  if (!fs.existsSync(filePath)) continue;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

const videoId = String(process.argv[2] || "7453046798265928990").trim();

function titleMatchQuality(candidateTitle, wantedTitle) {
  const candidate = String(candidateTitle || "").trim().toLowerCase();
  const wanted = String(wantedTitle || "").trim().toLowerCase();
  if (!candidate || !wanted) return 0;
  if (candidate === wanted) return 1;
  if (candidate.includes(wanted) || wanted.includes(candidate)) return 0.86;
  const normalize = (value) => String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidateWords = new Set(normalize(candidate).split(" ").filter(Boolean));
  const wantedWords = new Set(normalize(wanted).split(" ").filter(Boolean));
  if (!candidateWords.size || !wantedWords.size) return 0;
  const overlap = [...wantedWords].filter((word) => candidateWords.has(word)).length;
  const precision = overlap / candidateWords.size;
  const recall = overlap / wantedWords.size;
  return precision && recall ? (2 * precision * recall) / (precision + recall) : 0;
}

async function fetchMal(type, query) {
  const clientId = (process.env.MAL_CLIENT_ID || "").trim();
  if (!clientId) return null;
  const url = new URL(`https://api.myanimelist.net/v2/${type}`);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "5");
  url.searchParams.set("fields", "id,title,main_picture,alternative_titles,start_date,synopsis,genres,mean,media_type,status,num_episodes");
  const response = await fetch(url, { headers: { "X-MAL-CLIENT-ID": clientId } });
  if (!response.ok) return null;
  return response.json();
}

async function main() {
  const { spawnSync } = await import("child_process");
  const dbUrl = process.env.DATABASE_URL || "";
  const psql = spawnSync("psql", [dbUrl, "-tAc", `SELECT payload::text FROM tiktok_comment_cache WHERE tiktok_video_id='${videoId}' LIMIT 1`], {
    encoding: "utf8",
  });
  if (psql.status !== 0) {
    console.error(psql.stderr || psql.stdout);
    process.exit(1);
  }
  const payload = JSON.parse(psql.stdout.trim());
  const hint = findMovieTitleFromCommentThreads(payload.threads || [], { minConfidence: 0.85 });
  console.log("hint", hint);

  if (!hint?.title) return;

  const malData = await fetchMal("anime", hint.title);
  const top = malData?.data?.[0]?.node;
  console.log("mal_top", top ? { id: top.id, title: top.title, en: top.alternative_titles?.en, synopsis_len: (top.synopsis || "").length } : null);

  const enriched = {
    title: top?.alternative_titles?.en || top?.title || hint.title,
    year: String(top?.start_date || "").slice(0, 4),
    mal: top ? {
      id: top.id,
      type: "anime",
      title: top.title,
      englishTitle: top.alternative_titles?.en || "",
      synopsis: top.synopsis || "",
      genres: (top.genres || []).map((g) => g.name),
      startDate: top.start_date || "",
    } : undefined,
  };

  const candidate = databaseSummaryCandidate(enriched);
  const quality = titleMatchQuality(enriched.title, hint.title);
  console.log("candidate", candidate ? { provider: candidate.provider, title: candidate.title } : null);
  console.log("titleMatchQuality", quality, "passes", quality >= 0.82 && Boolean(candidate));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
