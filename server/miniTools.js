// The Tools suite's own API: text tasks (titles, descriptions, hashtags) on
// the metered text model, and a thumbnail downloader that saves the cover
// image yt-dlp reports for a link. Image and video tools run on /api/studio.
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const clip = (value, max) => String(value ?? "").trim().slice(0, max);
const bounded = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

export const TITLE_STYLES = ["mixed", "curiosity", "listicle", "how-to", "bold"];
export const PLATFORMS = ["youtube", "tiktok", "instagram", "shorts"];

/** Builds the model prompt for a text task and says which fields a useful answer must carry. */
export function buildTextPrompt(task, rawInput = {}) {
  const input = rawInput && typeof rawInput === "object" ? rawInput : {};
  if (task === "titles") {
    const topic = clip(input.topic, 400);
    const transcript = clip(input.transcript, 6000);
    if (!topic && !transcript) throw fail("Tell it what the video is about, or paste the transcript");
    const count = bounded(input.count, 5, 20, 10);
    const style = oneOf(input.style, TITLE_STYLES, "mixed");
    const styleLine = {
      mixed: "Vary the angle across the set: curiosity gap, listicle, how-to, bold claim, story, and contrast.",
      curiosity: "Every title opens a curiosity gap the video resolves.",
      listicle: "Every title is a numbered list that promises a concrete count.",
      "how-to": "Every title promises a clear outcome the viewer learns to do.",
      bold: "Every title makes one bold, specific claim the content can back up.",
    }[style];
    return {
      maxTokens: 1800,
      requiredAnyKeys: ["titles"],
      prompt: [
        "You write YouTube titles for a creator. Titles must be honest to the content, specific, and at most 60 characters. No quotation marks around titles, no emojis, no ALL CAPS words except acronyms.",
        topic ? `Video topic or working title: ${topic}` : "",
        transcript ? `Transcript excerpt:\n${transcript}` : "",
        styleLine,
        `Return JSON: {"titles":[{"title":"...","angle":"curiosity|listicle|how-to|bold-claim|story|contrast"}]} with exactly ${count} titles.`,
      ].filter(Boolean).join("\n\n"),
    };
  }
  if (task === "description") {
    const title = clip(input.title, 200);
    const notes = clip(input.notes, 8000);
    const links = clip(input.links, 1500);
    if (!title && !notes) throw fail("Give it the title, or paste the script or transcript");
    const platform = oneOf(input.platform, PLATFORMS, "youtube");
    return {
      maxTokens: 2200,
      requiredAnyKeys: ["description"],
      prompt: [
        `You write ${platform === "youtube" ? "YouTube" : platform === "shorts" ? "YouTube Shorts" : platform === "tiktok" ? "TikTok" : "Instagram"} descriptions for a creator.`,
        title ? `Video title: ${title}` : "",
        notes ? `Script, transcript, or notes:\n${notes}` : "",
        links ? `Links to include, one per line, exactly as given:\n${links}` : "",
        platform === "youtube"
          ? "Write a description of 120 to 220 words: the first two lines carry the hook and the main keyword, then what the viewer gets, then the links (if any) each on its own line. Add chapters only when the notes include timestamps or clear sections; otherwise return an empty chapters array. Tags are 12 to 20 search phrases without the # sign. Hashtags are 3 to 5 that fit the topic."
          : "Write a caption of 40 to 90 words with a hook in the first line, then the links (if any) each on its own line. Chapters stay an empty array. Tags are 8 to 15 search phrases without the # sign. Hashtags are 5 to 10 that fit the topic.",
        'Return JSON: {"description":"...","tags":["..."],"hashtags":["#..."],"chapters":[{"time":"0:00","title":"..."}]}',
      ].filter(Boolean).join("\n\n"),
    };
  }
  if (task === "hashtags") {
    const topic = clip(input.topic, 600);
    if (!topic) throw fail("Describe the post first");
    const platform = oneOf(input.platform, PLATFORMS, "tiktok");
    const count = bounded(input.count, 10, 30, 20);
    return {
      maxTokens: 1200,
      requiredAnyKeys: ["hashtags"],
      prompt: [
        `You pick hashtags for a ${platform === "youtube" ? "YouTube" : platform === "shorts" ? "YouTube Shorts" : platform === "tiktok" ? "TikTok" : "Instagram"} post. Mix reach sizes so the post can rank in small pools and still ride large ones: about a third broad (tens of millions of posts), a third medium (hundreds of thousands to a few million), a third niche (specific to this exact topic).`,
        `Post: ${topic}`,
        `Return JSON: {"hashtags":[{"tag":"#lowercase","reach":"broad|medium|niche"}]} with exactly ${count} unique hashtags, no spaces or punctuation inside a tag.`,
      ].join("\n\n"),
    };
  }
  throw fail("Unknown text tool");
}

const HASHTAG = /^#?[\p{L}\p{N}_]{2,60}$/u;
const cleanTag = (value) => {
  const raw = String(value ?? "").trim().replace(/\s+/g, "");
  if (!HASHTAG.test(raw)) return "";
  return `#${raw.replace(/^#/, "")}`;
};
const unique = (list) => [...new Set(list)];

/** Trims the model's answer to the shape each tool renders. */
export function normalizeTextResult(task, value = {}) {
  const v = value && typeof value === "object" ? value : {};
  if (task === "titles") {
    const titles = (Array.isArray(v.titles) ? v.titles : [])
      .map((item) => (typeof item === "string" ? { title: item, angle: "" } : item))
      .map((item) => ({ title: clip(item?.title, 120).replace(/^["'“”]+|["'“”]+$/g, ""), angle: clip(item?.angle, 30).toLowerCase() }))
      .filter((item) => item.title);
    if (!titles.length) throw fail("The model returned no titles. Try again.", 502);
    return { titles: titles.slice(0, 20) };
  }
  if (task === "description") {
    const description = clip(v.description, 5000);
    if (!description) throw fail("The model returned no description. Try again.", 502);
    return {
      description,
      tags: unique((Array.isArray(v.tags) ? v.tags : []).map((tag) => clip(tag, 60).replace(/^#/, "")).filter(Boolean)).slice(0, 30),
      hashtags: unique((Array.isArray(v.hashtags) ? v.hashtags : []).map(cleanTag).filter(Boolean)).slice(0, 15),
      chapters: (Array.isArray(v.chapters) ? v.chapters : [])
        .map((chapter) => ({ time: clip(chapter?.time, 12), title: clip(chapter?.title, 120) }))
        .filter((chapter) => /^\d{1,2}(:\d{2}){1,2}$/.test(chapter.time) && chapter.title)
        .slice(0, 30),
    };
  }
  if (task === "hashtags") {
    const seen = new Set();
    const hashtags = (Array.isArray(v.hashtags) ? v.hashtags : [])
      .map((item) => (typeof item === "string" ? { tag: item, reach: "medium" } : item))
      .map((item) => ({ tag: cleanTag(item?.tag), reach: oneOf(String(item?.reach || "").toLowerCase(), ["broad", "medium", "niche"], "medium") }))
      .filter((item) => item.tag && !seen.has(item.tag.toLowerCase()) && seen.add(item.tag.toLowerCase()));
    if (!hashtags.length) throw fail("The model returned no hashtags. Try again.", 502);
    return { hashtags: hashtags.slice(0, 30) };
  }
  throw fail("Unknown text tool");
}

/** A download filename from a video title: ASCII, no path characters, never empty. */
export function thumbnailFilename(title, type = "") {
  const ext = /png/i.test(type) ? "png" : /webp/i.test(type) ? "webp" : "jpg";
  const base = String(title || "").normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim().slice(0, 80) || "thumbnail";
  return `${base}.${ext}`;
}

export function registerMiniTools(app, { session, generateJson, inspectVideo, fetchPublic }) {
  const send = (res, error) => res.status(error.statusCode || 500).json({ error: error.message || "Something went wrong" });

  // Text tasks spend model credits, so they need an account like the studios do.
  app.post("/api/tools/text", async (req, res) => {
    try {
      const record = await session(req).catch(() => null);
      if (!record?.user) throw fail("Sign in required", 401);
      const task = String(req.body?.task || "");
      const spec = buildTextPrompt(task, req.body?.input);
      const value = await generateJson(spec.prompt, { maxTokens: spec.maxTokens, requiredAnyKeys: spec.requiredAnyKeys, timeoutMs: 90000 });
      res.json({ task, result: normalizeTextResult(task, value) });
    } catch (error) {
      if (!error.statusCode) console.error("Text tool failed:", error);
      send(res, error);
    }
  });

  // Streams the link's cover image back as a file so the browser saves it instead of opening it.
  app.post("/api/tools/thumbnail", async (req, res) => {
    try {
      const info = await inspectVideo(String(req.body?.url || ""));
      if (!info?.thumbnail) throw fail("This video has no cover image to download.", 404);
      const image = await fetchPublic(info.thumbnail, { accept: "image/*", maxBytes: 12 * 1024 * 1024, timeoutMs: 20000 });
      if (!/^image\//i.test(image.type)) throw fail("The cover image could not be read.", 502);
      res.setHeader("Content-Type", image.type.split(";")[0]);
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `attachment; filename="${thumbnailFilename(info.title, image.type)}"`);
      res.end(image.body);
    } catch (error) {
      if (!error.statusCode) console.error("Thumbnail download failed:", error);
      send(res, error);
    }
  });
}
