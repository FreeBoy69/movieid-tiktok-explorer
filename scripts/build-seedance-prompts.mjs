// Builds data/seedance-prompts.json from YouMind-OpenLab/awesome-seedance-2-prompts
// (CC BY 4.0): Seedance 2.0 text-to-video prompts as prompt library entries in
// the "video" category. The README only shows the newest ~100 of the gallery's
// prompts, so each run merges into the existing file by YouMind id: rerunning
// over time grows the set instead of replacing it.
//
//   node scripts/build-seedance-prompts.mjs [path/to/README.md]
import fs from "node:fs";
import path from "node:path";

const REPO = "https://github.com/YouMind-OpenLab/awesome-seedance-2-prompts";
const OUT = path.resolve("data/seedance-prompts.json");
const GALLERY = "https://youmind.com/en-US/seedance-2-0-prompts";

const source = process.argv[2];
const readme = source
  ? fs.readFileSync(source, "utf8")
  : await (await fetch("https://raw.githubusercontent.com/YouMind-OpenLab/awesome-seedance-2-prompts/main/README.md")).text();

const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
const cjkShare = (text) => (String(text).match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length / Math.max(1, String(text).length);
const title = (text) =>
  clean(text)
    .replace(/^No\. \d+:\s*/, "")
    .replace(/^Seedance 2(\.0)?(\s+Mini)?\s*[:：-]?\s*/i, "")
    .replace(/\s+(Video\s+)?(Generation\s+)?Prompt(\s+for Seedance 2(\.0)?)?$/i, "")
    .trim();
const WORDS = "a an and the of for in on with to at by from as is are this that into its video prompt prompts seedance cinematic detailed highly extremely generating generate creating create creates designed featuring features dynamic second seconds style scene scenes short".split(" ");
const tagsFor = (text) => {
  const counts = new Map();
  for (const word of clean(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
    if (!WORDS.includes(word)) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([word]) => word);
};

function parse(block) {
  const heading = block.match(/^### (.+)$/m)?.[1];
  const prompt = block.match(/#### 📝 Prompt\s*\n+```[a-z]*\n([\s\S]*?)\n```/)?.[1]?.trim();
  const id = block.match(/seedance-2-0-prompts\?id=(\d+)/)?.[1];
  if (!heading || !prompt || !id) return null;
  const summary = block.match(/#### 📖 Description\s*\n+([\s\S]*?)\n\s*\n/)?.[1] || block.match(/^> (.+)$/m)?.[1] || "";
  const author = block.match(/\*\*Author:\*\* \[([^\]]+)\]\(([^)]+)\)/);
  const post = block.match(/\*\*Source:\*\* \[[^\]]*\]\(([^)]+)\)/)?.[1];
  const published = block.match(/\*\*Published:\*\* ([^|\n]+)/)?.[1];
  const image = block.match(/<img src="([^"]+)"/)?.[1];
  const video = block.match(/href="(https:\/\/github\.com\/YouMind-OpenLab\/[^"]+\.mp4)"/)?.[1];
  return {
    id: `seedance-${id}`,
    title: title(heading).slice(0, 90),
    act: clean(heading),
    contributor: author ? clean(author[1]) : undefined,
    contributorUrl: author?.[2],
    type: "TEXT",
    categories: ["video"],
    relevance: /Featured-gold/.test(block) ? 5 : 3,
    summary: clean(summary).slice(0, 280),
    snippet: prompt,
    tags: [...tagsFor(`${heading} ${summary}`), "seedance"],
    image,
    video,
    url: `${GALLERY}?id=${id}`,
    sourceUrl: post,
    publishedAt: published ? clean(published) : undefined,
    license: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    sourceName: "awesome-seedance-2-prompts",
  };
}

const found = readme
  .split(/\n(?=### )/)
  .map(parse)
  .filter(Boolean)
  // The library is searched in English; skip the rare prompt that was not translated.
  .filter((item) => cjkShare(item.snippet) < 0.05 && cjkShare(item.title) < 0.05);

let existing = [];
try {
  existing = JSON.parse(fs.readFileSync(OUT, "utf8")).prompts || [];
} catch {}
const byId = new Map(existing.map((item) => [item.id, item]));
let added = 0;
for (const item of found) {
  if (!byId.has(item.id)) added += 1;
  byId.set(item.id, { ...byId.get(item.id), ...item });
}
const prompts = [...byId.values()].sort((a, b) => Number(b.id.split("-")[1]) - Number(a.id.split("-")[1]));

fs.writeFileSync(
  OUT,
  `${JSON.stringify({ source: { repo: REPO, license: "CC BY 4.0", builtAt: new Date().toISOString() }, prompts }, null, 1)}\n`,
);
console.log(`parsed ${found.length}, added ${added}, total ${prompts.length} Seedance prompts in ${path.relative(process.cwd(), OUT)}`);
