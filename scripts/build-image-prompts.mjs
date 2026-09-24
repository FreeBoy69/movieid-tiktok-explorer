#!/usr/bin/env node
// Builds data/image-prompts.json from devanshug2307/Awesome-AI-Image-Prompts
// (MIT): image-generation prompts with example images, as prompt library
// entries in the visual style and thumbnail categories. Prompts built around a
// real, named person are left out so the library never hands out likenesses.
//
//   node scripts/build-image-prompts.mjs [path/to/README.md]
import fs from "node:fs";
import path from "node:path";

const REPO = "https://github.com/devanshug2307/Awesome-AI-Image-Prompts";
const OUT = path.resolve("data/image-prompts.json");

const source = process.argv[2];
const readme = source
  ? fs.readFileSync(source, "utf8")
  : await (await fetch("https://raw.githubusercontent.com/devanshug2307/Awesome-AI-Image-Prompts/main/README.md")).text();
const commit = source
  ? ""
  : (await (await fetch("https://api.github.com/repos/devanshug2307/Awesome-AI-Image-Prompts/commits/main", { headers: { Accept: "application/vnd.github+json" } })).json()).sha || "";

// Real people, and prompts made to depict them (by title).
const REAL_PERSON = new RegExp(
  [
    "trump", "elon musk", "ronaldo", "messi", "ana de armas", "kendrick lamar", "sadie sink", "alisa fortin",
    "celebrity", "famous faces", "vtuber", "woodrow wilson",
  ].join("|"),
  "i",
);
// Posters and logos are thumbnail work first; everything else is art direction.
const THUMBNAIL_FIRST = /poster|logo|branding|icon/i;

const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "prompt";
const WORDS = "a an and the of for in on with to at by from as is are this that into its photo image render prompt prompts google nano banana pro gemini".split(" ");
const tagsFor = (section, text) => {
  const counts = new Map();
  for (const word of clean(text).toLowerCase().match(/[a-z][a-z-]{3,}/g) || [])
    if (!WORDS.includes(word)) counts.set(word, (counts.get(word) || 0) + 1);
  return [...new Set([section.toLowerCase(), ...[...counts].sort((a, b) => b[1] - a[1]).map(([word]) => word)])].slice(0, 5);
};

const prompts = [];
let skipped = 0;
for (const part of readme.split(/^## (?=\d+\. )/m).slice(1)) {
  const section = clean(part.match(/^\d+\.\s*(.+)$/m)?.[1]).replace(/^[^\p{L}\d]+/u, "").replace(/\s*&.*$/, "");
  for (const block of part.split(/^### (?=\d+\.\d+\. )/m).slice(1)) {
    const heading = clean(block.match(/^\d+\.\d+\.\s*(.+)$/m)?.[1]);
    const prompt = block.match(/\*\*Prompt:\*\*\s*\n+```[a-z]*\n([\s\S]*?)\n```/)?.[1]?.trim();
    if (!heading || !prompt) continue;
    if (REAL_PERSON.test(heading)) {
      skipped++;
      continue;
    }
    const number = block.match(/^(\d+\.\d+)\./)[1];
    const image = block.match(/^!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/m)?.[1];
    const summary = block.match(/^!\[.*\n+([^\n*`#][^\n]+)/m)?.[1] || "";
    const credit = block.match(/\*\*Source:\*\* \[([^\]]+)\]\(([^)]+)\)/);
    prompts.push({
      id: `aip-${number.replace(".", "-")}-${slug(heading)}`,
      title: heading.replace(/\s+[|–-]\s+.*$/, "").slice(0, 80),
      act: heading,
      contributor: credit ? clean(credit[1]) : undefined,
      contributorUrl: credit?.[2],
      type: "IMAGE",
      categories: THUMBNAIL_FIRST.test(section) ? ["thumbnail", "visualStyle"] : ["visualStyle", "thumbnail"],
      // Full scene prompts, not style-only snippets: rank below the curated set.
      relevance: 2,
      summary: clean(summary).slice(0, 280),
      snippet: prompt.slice(0, 4000),
      tags: tagsFor(section, `${heading} ${summary}`),
      prompt,
      url: REPO,
      sourceName: "Awesome AI Image Prompts",
      license: "MIT",
      licenseUrl: `${REPO}/blob/main/LICENSE`,
      ...(image ? { image } : {}),
    });
  }
}
fs.writeFileSync(
  OUT,
  JSON.stringify({ source: { repo: REPO, commit, license: "MIT", builtAt: new Date().toISOString() }, prompts }, null, 1),
);
console.log(`wrote ${prompts.length} prompts to ${path.relative(process.cwd(), OUT)} (${skipped} depicting real people left out)`);
