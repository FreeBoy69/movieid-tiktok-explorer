export const CREATOR_STAGES = [
  "brief",
  "title",
  "script",
  "seo",
  "voiceover",
  "soundtrack",
  "visualPlan",
  "thumbnail",
  "review",
];
export const STAGE_DEPENDENCIES = {
  title: [],
  script: ["title"],
  seo: ["script"],
  voiceover: ["script"],
  soundtrack: ["script"],
  visualPlan: ["script", "voiceover"],
  thumbnail: ["title"],
  review: ["voiceover", "visualPlan"],
};
export const CREATOR_STAGE_SETTING_KEYS = {
  title: ["wordCount", "language", "targetDuration", "tone"],
  script: [
    "wordCount",
    "language",
    "targetDuration",
    "tone",
    "research",
    "additionalContext",
    "outline",
  ],
  seo: ["language", "targetDuration", "platform", "disclosure", "links"],
  voiceover: [
    "voiceId",
    "voiceSpeed",
    "pronunciation",
    "language",
    "narrationStyle",
    "voiceEngine",
  ],
  soundtrack: [
    "soundtrackMood",
    "soundtrackTiming",
    "soundtrackVolume",
    "preserveDialogue",
    "musicPolicy",
  ],
  visualPlan: [
    "aspect",
    "quality",
    "visualStyle",
    "sceneSeconds",
    "motion",
    "imageCount",
    "sourcePolicy",
    "safePrompts",
    "artStyleId",
    "visualSegments",
  ],
  thumbnail: [
    "thumbnailPrompt",
    "thumbnailMode",
    "thumbnailStyleRefs",
    "thumbnailReference",
    "thumbnailVariants",
    "visualStyle",
    "artStyleId",
    "aspect",
  ],
  review: [
    "aspect",
    "subtitleSettings",
    "soundtrackVolume",
    "preserveDialogue",
    "rightsConfirmed",
    "publishDestination",
  ],
};
export function descendants(stage) {
  const found = new Set();
  function visit(key) {
    for (const [candidate, parents] of Object.entries(STAGE_DEPENDENCIES)) {
      if (parents.includes(key) && !found.has(candidate)) {
        found.add(candidate);
        visit(candidate);
      }
    }
  }
  visit(stage);
  return [...found];
}
export function invalidateOutputs(outputs, stage) {
  const next = { ...outputs };
  for (const key of descendants(stage))
    if (next[key]) next[key] = { ...next[key], stale: true };
  return next;
}
export function stageInput(project, stage) {
  const settings = project.metadata?.settings || {};
  const relevantSettings = Object.fromEntries(
    (CREATOR_STAGE_SETTING_KEYS[stage] || []).map((key) => [key, settings[key]]),
  );
  return {
    brief: project.metadata?.brief || "",
    styleId: project.styleId || "",
    style: project.metadata?.styleGuide || "",
    settings: relevantSettings,
    ...(stage === "title"
      ? {
          reference: project.outputs?.title?.reference || {},
          researchCollectionId: project.metadata?.researchCollectionId || "",
        }
      : {}),
    dependencies: Object.fromEntries(
      (STAGE_DEPENDENCIES[stage] || []).map((key) => [
        key,
        project.outputs?.[key] || null,
      ]),
    ),
    ...(stage === "review"
      ? { soundtrack: project.outputs?.soundtrack || null }
      : {}),
    ...(stage === "soundtrack"
      ? {
          timing: project.metadata?.soundtrackSource?.duration
            ? {
                source: "upload",
                asset: project.metadata.soundtrackSource.asset,
                duration: project.metadata.soundtrackSource.duration,
              }
            : project.outputs?.voiceover?.duration
              ? {
                  source: "voiceover",
                  asset: project.outputs.voiceover.asset,
                  duration: project.outputs.voiceover.duration,
                }
              : null,
        }
      : {}),
    ...(stage === "visualPlan"
      ? {
          scenes: project.metadata?.scenes || [],
          referenceAssets: project.metadata?.referenceAssets || [],
          voiceover: project.outputs?.voiceover
            ? {
                duration: project.outputs.voiceover.duration,
                segments: project.outputs.voiceover.segments || [],
              }
            : null,
        }
      : {}),
  };
}
export function assertStageReady(project, stage) {
  if (!Object.hasOwn(STAGE_DEPENDENCIES, stage))
    throw new Error("Unknown project stage");
  if (project.status !== "active")
    throw new Error("Restore this project before generating");
  if (["script", "thumbnail"].includes(stage) && !project.outputs?.title?.current?.trim()) throw new Error("Save a selected title first");
  // Scoring an uploaded video needs only its audio, not a script.
  const scoringUpload = stage === "soundtrack" && project.metadata?.soundtrackSource?.asset;
  for (const dependency of scoringUpload ? [] : STAGE_DEPENDENCIES[stage]) {
    if (!project.outputs?.[dependency] || project.outputs[dependency].stale)
      throw new Error(`Finish ${dependency} first`);
  }
  if (stage === "voiceover" && !project.outputs?.script?.draft?.trim())
    throw new Error("Save a narration script first");
  if (
    stage === "review" &&
    !project.outputs?.visualPlan?.scenes?.every((s) => s.asset)
  )
    throw new Error("Generate every scene image before rendering");
  if (
    stage === "review" &&
    !project.outputs?.soundtrack?.asset &&
    project.metadata?.settings?.musicPolicy !== "none"
  )
    throw new Error(
      "Import a licensed soundtrack or choose export without music",
    );
}

export function splitCreatorScene(scenes, segments, time) {
  const index = scenes.findIndex(scene => time > scene.start + 0.5 && time < scene.end - 0.5);
  if (index < 0) throw new Error("Choose a point inside a scene");
  const scene = scenes[index];
  const boundaries = segments.map(segment => Number(segment.end)).filter(end => end > scene.start + 0.5 && end < scene.end - 0.5);
  if (!boundaries.length) throw new Error("No transcript boundary inside this scene");
  const split = boundaries.sort((a,b) => Math.abs(a-time)-Math.abs(b-time))[0];
  const excerpt = (start,end) => segments.filter(segment => segment.start >= start && segment.start < end).map(segment => segment.text).join(" ").trim();
  return [
    ...scenes.slice(0, index),
    { ...scene, end: split, text: excerpt(scene.start, split) },
    {
      ...scene,
      id: `${scene.id}-split-${Math.round(split * 100)}`,
      start: split,
      text: excerpt(split, scene.end),
      asset: null,
    },
    ...scenes.slice(index + 1),
  ];
}

export function validateCreatorScenes(scenes, original, duration, allowedAssets = []) {
  if (!Array.isArray(scenes) || !scenes.length || scenes.length>300) throw new Error("Use 1 to 300 scenes");
  const assets = new Set([
    ...original.map((scene) => scene.asset).filter(Boolean),
    ...allowedAssets,
  ]);
  const usedAssets = new Set();
  const ids = new Set();
  const result = scenes.map(scene => {
    if (!/^scene-[a-zA-Z0-9-]{1,100}$/.test(scene.id) || ids.has(scene.id)) throw new Error("Invalid or duplicate scene ID");
    ids.add(scene.id);
    if (!Number.isFinite(scene.start) || !Number.isFinite(scene.end) || scene.end-scene.start < 0.1) throw new Error("Invalid scene timing");
    const prior = original.find(s=>s.id===scene.id);
    const keepAsset =
      assets.has(scene.asset) &&
      !usedAssets.has(scene.asset) &&
      (!prior || prior.prompt === scene.prompt);
    if (keepAsset) usedAssets.add(scene.asset);
    const keepClip =
      keepAsset &&
      Boolean(prior?.clip) &&
      scene.clip === prior.clip &&
      (prior.animationPrompt || "") === String(scene.animationPrompt || "");
    return {
      id: scene.id,
      start: scene.start,
      end: scene.end,
      text: String(scene.text || "").slice(0, 10000),
      prompt: String(scene.prompt || "").slice(0, 4000),
      motion: ["still", "push", "provider"].includes(scene.motion)
        ? scene.motion
        : "still",
      sourcePolicy:
        scene.sourcePolicy === "reference" || scene.sourcePolicy === "upload"
          ? scene.sourcePolicy
          : "generated",
      referenceAsset: assets.has(scene.referenceAsset)
        ? scene.referenceAsset
        : null,
      asset: keepAsset ? scene.asset : null,
      animate: Boolean(scene.animate),
      animationPrompt: String(scene.animationPrompt || "").slice(0, 600),
      quality: IMAGE_QUALITIES.includes(scene.quality) ? scene.quality : undefined,
      segmentId: /^seg-[a-zA-Z0-9-]{1,60}$/.test(String(scene.segmentId || ""))
        ? scene.segmentId
        : undefined,
      clip: keepClip ? prior.clip : null,
    };
  });
  if (Math.abs(result[0].start)>0.01 || Math.abs(result.at(-1).end-duration)>0.1 || result.some((s,i)=>i>0&&Math.abs(s.start-result[i-1].end)>0.01)) throw new Error("Scenes must cover the narration without gaps or overlaps");
  return result;
}
export const IMAGE_QUALITIES = ["standard", "high", "ultra"];
export const IMAGE_RESOLUTION = { standard: "1K", high: "2K", ultra: "4K" };

// Transcript sentence ends are the only places a scene or segment may split,
// so every image boundary lands on a natural pause in the narration.
export function transcriptBoundaries(segments = [], duration = 0) {
  return [
    ...new Set(
      (segments || [])
        .map((segment) => Math.round(Number(segment.end) * 100) / 100)
        .filter((end) => end > 0.5 && end < Number(duration) - 0.5),
    ),
  ].sort((a, b) => a - b);
}

// Visual segments group scenes that share settings (animation, quality, image
// count). They always cover the narration from 0 to its duration without gaps.
export function normalizeVisualSegments(input, duration) {
  const total = Number(duration) || 0;
  const list = (Array.isArray(input) ? input : [])
    .map((segment, index) => ({
      id: /^seg-[a-zA-Z0-9-]{1,60}$/.test(String(segment?.id || ""))
        ? segment.id
        : `seg-${index + 1}`,
      start: Number(segment?.start),
      end: Number(segment?.end),
      animate: Boolean(segment?.animate),
      quality: IMAGE_QUALITIES.includes(segment?.quality)
        ? segment.quality
        : undefined,
      imageCount:
        Number.isFinite(Number(segment?.imageCount)) &&
        Number(segment.imageCount) > 0
          ? Math.min(300, Math.round(Number(segment.imageCount)))
          : undefined,
    }))
    .filter(
      (segment) =>
        Number.isFinite(segment.start) &&
        Number.isFinite(segment.end) &&
        segment.end - segment.start >= 0.5,
    )
    .sort((a, b) => a.start - b.start);
  if (!total) return [];
  if (!list.length) return [{ id: "seg-1", start: 0, end: total, animate: false }];
  list[0].start = 0;
  list[list.length - 1].end = total;
  for (let i = 1; i < list.length; i++) list[i].start = list[i - 1].end;
  const ids = new Set();
  return list
    .filter((segment) => segment.end - segment.start >= 0.5)
    .map((segment, index) => {
      const id = ids.has(segment.id) ? `seg-${index + 1}-${Date.now() % 1000}` : segment.id;
      ids.add(id);
      return { ...segment, id };
    });
}

export function splitVisualSegment(segments, boundaries, time) {
  const index = segments.findIndex(
    (segment) => time > segment.start + 0.5 && time < segment.end - 0.5,
  );
  if (index < 0) throw new Error("Move the playhead inside a segment first");
  const segment = segments[index];
  const inside = boundaries.filter(
    (value) => value > segment.start + 0.5 && value < segment.end - 0.5,
  );
  if (!inside.length)
    throw new Error("There's no sentence break inside this segment to split at");
  const split = [...inside].sort(
    (a, b) => Math.abs(a - time) - Math.abs(b - time),
  )[0];
  return [
    ...segments.slice(0, index),
    { ...segment, end: split },
    {
      ...segment,
      id: `seg-${Math.round(split * 100)}`,
      start: split,
      imageCount: undefined,
    },
    ...segments.slice(index + 1),
  ];
}

export function mergeVisualSegment(segments, index) {
  if (segments.length < 2) return segments;
  const target = index >= segments.length - 1 ? index - 1 : index;
  const merged = {
    ...segments[target],
    end: segments[target + 1].end,
    imageCount: undefined,
  };
  return [...segments.slice(0, target), merged, ...segments.slice(target + 2)];
}

// The most images a segment can hold: one per transcript sentence inside it.
export function segmentImageLimit(segment, boundaries) {
  return (
    1 +
    boundaries.filter(
      (value) => value > segment.start + 0.5 && value < segment.end - 0.5,
    ).length
  );
}

export function segmentScenes(voiceSegments, duration, visualSegments, fallbackSeconds = 12) {
  const segments = normalizeVisualSegments(visualSegments, duration);
  const scenes = [];
  for (const segment of segments) {
    const inside = (voiceSegments || [])
      .filter(
        (item) =>
          Number(item.start) >= segment.start - 0.05 &&
          Number(item.start) < segment.end - 0.05,
      )
      .map((item) => ({
        ...item,
        start: Number(item.start) - segment.start,
        end: Math.min(Number(item.end), segment.end) - segment.start,
      }));
    const length = segment.end - segment.start;
    const local = !inside.length
      ? [{ start: 0, end: length, text: "", prompt: "" }]
      : segment.imageCount
        ? evenScenes(inside, length, segment.imageCount)
        : semanticScenes(inside, length, fallbackSeconds);
    for (const scene of local)
      scenes.push({
        ...scene,
        start: Math.round((scene.start + segment.start) * 100) / 100,
        end: Math.round((scene.end + segment.start) * 100) / 100,
        segmentId: segment.id,
        animate: segment.animate,
        ...(segment.quality ? { quality: segment.quality } : {}),
      });
  }
  if (scenes.length) {
    scenes[0].start = 0;
    scenes[scenes.length - 1].end = Number(duration);
    for (let i = 1; i < scenes.length; i++) scenes[i].start = scenes[i - 1].end;
  }
  return scenes.map((scene, index) => ({
    ...scene,
    id: `scene-${index + 1}`,
    motion: "still",
    prompt: scene.prompt || scene.text,
  }));
}

// Picks the transcript pauses closest to an even spacing, so a segment gets
// the requested image count whenever it has enough sentences.
function evenScenes(inside, length, count) {
  const breaks = transcriptBoundaries(inside, length);
  const chosen = new Set();
  for (let k = 1; k < count; k++) {
    const ideal = (k * length) / count;
    const pick = breaks
      .filter((value) => !chosen.has(value))
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];
    if (pick !== undefined) chosen.add(pick);
  }
  const edges = [0, ...[...chosen].sort((a, b) => a - b), length];
  return edges.slice(0, -1).map((start, index) => {
    const end = edges[index + 1];
    const text = inside
      .filter((item) => item.start >= start - 0.05 && item.start < end - 0.05)
      .map((item) => item.text || "")
      .join(" ")
      .trim();
    return { start, end, text, prompt: text };
  });
}

// Music segments are timed against the soundtrack's audio source.
export function normalizeMusicSegments(input, duration) {
  const total = Number(duration) || 0;
  const list = (Array.isArray(input) ? input : [])
    .map((segment, index) => ({
      id: /^mus-[a-zA-Z0-9-]{1,60}$/.test(String(segment?.id || ""))
        ? segment.id
        : `mus-${index + 1}`,
      start: Number(segment?.start),
      end: Number(segment?.end),
      mood: String(segment?.mood || "").slice(0, 80),
      prompt: String(segment?.prompt || segment?.text || "").slice(0, 1000),
      muted: Boolean(segment?.muted),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);
  if (!total || !list.length) return [];
  list[0].start = 0;
  list[list.length - 1].end = total;
  for (let i = 1; i < list.length; i++) list[i].start = list[i - 1].end;
  return list.filter((s) => s.end - s.start > 0.05);
}

export function semanticScenes(segments, duration, targetSeconds = 12) {
  const groups = [];
  let current = null;
  for (const segment of segments || []) {
    if (!current)
      current = { start: Number(segment.start) || 0, end: 0, text: "" };
    current.end = Math.min(duration, Number(segment.end) || duration);
    current.text = `${current.text} ${segment.text || ""}`.trim();
    if (
      current.end - current.start >= targetSeconds &&
      /[.!?]["']?$/.test(current.text)
    ) {
      groups.push(current);
      current = null;
    }
  }
  if (current) groups.push(current);
  if (groups.length) {
    groups[0].start = 0;
    groups[groups.length - 1].end = duration;
  }
  return groups.map((scene, index) => ({
    ...scene,
    end: groups[index + 1]?.start ?? duration,
    id: `scene-${index + 1}`,
    motion: "still",
    prompt: scene.text,
  }));
}
export function rankDiscoveryChannels(videos, filters = {}) {
  const groups = new Map();
  for (const video of videos || []) {
    if (!video.channelId) continue;
    if (!groups.has(video.channelId)) groups.set(video.channelId, []);
    groups.get(video.channelId).push(video);
  }
  const finite = (value) =>
    value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
  const numeric = (value, fallback = 0) =>
    finite(value) ? Number(value) : fallback;
  const timestamp = (value) => {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const includesTerm = (value, terms) =>
    !terms.length ||
    terms.some((term) =>
      String(value || "")
        .toLowerCase()
        .includes(String(term).trim().toLowerCase()),
    );
  const excludeTerms = String(filters.excludeTerms || "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  const includeTerms = String(filters.includeTerms || "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean);
  const unknownPolicy = String(filters.unknown || "include");

  return [...groups.entries()]
    .map(([id, items]) => {
      const sortedByDate = [...items].sort(
        (a, b) => timestamp(b.publishedAt) - timestamp(a.publishedAt),
      );
      const views = items.map((v) => numeric(v.viewCount)).sort((a, b) => a - b);
      const mid = Math.floor(views.length / 2);
      const median =
        views.length % 2 ? views[mid] : (views[mid - 1] + views[mid]) / 2;
      const average =
        views.reduce((sum, value) => sum + value, 0) / Math.max(1, views.length);
      const best = [...items].sort(
        (a, b) => numeric(b.viewCount) - numeric(a.viewCount),
      )[0];
      const recent = sortedByDate[0];
      const channelInfo =
        items.find((item) => item.channelPublishedAt || finite(item.channelVideoCount)) || {};
      const createdAt = timestamp(channelInfo.channelPublishedAt) || null;
      const videoCount = finite(channelInfo.channelVideoCount) && Number(channelInfo.channelVideoCount) > 0
        ? Number(channelInfo.channelVideoCount)
        : null;
      const bestWithSubscribers =
        items.find((item) => finite(item.subscriberCount)) || best;
      const subscribers = finite(bestWithSubscribers?.subscriberCount)
        ? Number(bestWithSubscribers.subscriberCount)
        : null;
      const durations = items
        .map((item) => numeric(item.durationSeconds, NaN))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      const durationMid = Math.floor(durations.length / 2);
      const medianDurationSeconds = durations.length
        ? durations.length % 2
          ? durations[durationMid]
          : (durations[durationMid - 1] + durations[durationMid]) / 2
        : null;
      const longformShare = durations.length
        ? durations.filter((value) => value >= 240).length / durations.length
        : null;
      const facelessValues = items
        .map((item) => item.facelessScore)
        .filter((value) => finite(value))
        .map(Number);
      const facelessScore = facelessValues.length
        ? Math.round(
            facelessValues.reduce((sum, value) => sum + value, 0) /
              facelessValues.length,
          )
        : null;
      const opportunityScore =
        items.reduce(
          (sum, item) =>
            sum +
            numeric(
              item.opportunityScore ??
                item.discoveryScore ??
                item.outlierScore,
            ),
          0,
        ) / items.length;
      const score =
        items.reduce((sum, item) => sum + numeric(item.discoveryScore), 0) /
        items.length;
      const recentViewsPerHour =
        items.reduce((sum, item) => sum + numeric(item.viewsPerHour), 0) /
        items.length;
      const dated = sortedByDate.map((item) => timestamp(item.publishedAt));
      const gaps = dated
        .slice(1)
        .map((value, index) => Math.abs(dated[index] - value))
        .filter((value) => value > 0)
        .sort((a, b) => a - b);
      const gapMid = Math.floor(gaps.length / 2);
      const cadenceMs = gaps.length
        ? gaps.length % 2
          ? gaps[gapMid]
          : (gaps[gapMid - 1] + gaps[gapMid]) / 2
        : null;
      const niche =
        items.map((item) => String(item.niche || "").trim()).find(Boolean) || "";
      const language =
        items.map((item) => String(item.language || "").trim()).find(Boolean) ||
        "";
      const region =
        items
          .map((item) => String(item.region || item.regionCode || "").trim())
          .find(Boolean) || "";
      return {
        id,
        title: best.channelTitle,
        url: best.channelUrl || `https://www.youtube.com/channel/${id}`,
        handle: best.channelHandle || "",
        thumbnailUrl: best.channelThumbnailUrl,
        medianViews: median,
        averageViews: average,
        sampleCount: items.length,
        createdAt,
        videoCount,
        subscribers,
        ratio: subscribers ? median / subscribers : null,
        score,
        opportunityScore,
        facelessScore,
        facelessConfidence: facelessScore,
        monetizationConfidence: null,
        medianDurationSeconds,
        longformShare,
        recentViewsPerHour,
        earliestSampledAt: Math.min(...dated.filter(Boolean)),
        latestSampledAt: Math.max(...dated),
        newest: Math.max(...dated),
        uploadCadenceDays: cadenceMs ? cadenceMs / 86400000 : null,
        videos: [...items].sort(
          (a, b) => numeric(b.viewCount) - numeric(a.viewCount),
        ),
        bestVideo: best,
        recentVideo: recent,
        niche,
        language,
        region,
        monetization: "unknown",
      };
    })
    .filter(
      (c) =>
        c.medianViews >= numeric(filters.minViews) &&
        (!numeric(filters.minAvgViews) || c.averageViews >= numeric(filters.minAvgViews)) &&
        (!numeric(filters.maxAvgViews) || c.averageViews <= numeric(filters.maxAvgViews)) &&
        (!filters.createdAfter ||
          (c.createdAt !== null && c.createdAt >= timestamp(filters.createdAfter))) &&
        (!filters.createdBefore ||
          (c.createdAt !== null &&
            c.createdAt <= timestamp(filters.createdBefore) + 86400000 - 1)) &&
        (!numeric(filters.minVideos) ||
          (c.videoCount !== null && c.videoCount >= numeric(filters.minVideos))) &&
        (!numeric(filters.maxVideos) ||
          (c.videoCount !== null && c.videoCount <= numeric(filters.maxVideos))) &&
        (!numeric(filters.maxViews) || c.medianViews <= numeric(filters.maxViews)) &&
        (!filters.faceless ||
          (c.facelessScore !== null && c.facelessScore >= 50)) &&
        (!filters.minSubs ||
          (c.subscribers !== null &&
            c.subscribers >= Number(filters.minSubs))) &&
        (!filters.maxSubs ||
          (c.subscribers !== null &&
            c.subscribers <= Number(filters.maxSubs))) &&
        (!numeric(filters.minRatio) ||
          (c.ratio !== null && c.ratio >= numeric(filters.minRatio))) &&
        (!numeric(filters.minDurationMinutes) ||
          (c.medianDurationSeconds !== null &&
            c.medianDurationSeconds >=
              numeric(filters.minDurationMinutes) * 60)) &&
        (!numeric(filters.maxDurationMinutes) ||
          (c.medianDurationSeconds !== null &&
            c.medianDurationSeconds <=
              numeric(filters.maxDurationMinutes) * 60)) &&
        (filters.format === "longform"
          ? c.longformShare !== null && c.longformShare >= 0.5
          : filters.format === "shorts"
            ? c.longformShare !== null && c.longformShare < 0.5
            : true) &&
        (!filters.language ||
          c.language.toLowerCase() === String(filters.language).toLowerCase()) &&
        includesTerm(`${c.title} ${c.niche} ${c.handle}`, includeTerms) &&
        !excludeTerms.some((term) =>
          `${c.title} ${c.niche} ${c.handle}`
            .toLowerCase()
            .includes(term.toLowerCase()),
        ) &&
        (filters.facelessUnknown === "exclude"
          ? c.facelessScore !== null
          : filters.facelessUnknown === "only"
            ? c.facelessScore === null
            : unknownPolicy !== "exclude" || c.facelessScore !== null),
    )
    .sort((a, b) => {
      switch (filters.sort) {
        case "consistency":
          return (
            (a.uploadCadenceDays ?? Number.POSITIVE_INFINITY) -
            (b.uploadCadenceDays ?? Number.POSITIVE_INFINITY)
          );
        case "created":
          return (b.createdAt ?? 0) - (a.createdAt ?? 0);
        case "recentVph":
          return b.recentViewsPerHour - a.recentViewsPerHour;
        case "opportunity":
          return b.opportunityScore - a.opportunityScore;
        default:
          return (
            numeric(b[filters.sort || "score"]) -
            numeric(a[filters.sort || "score"])
          );
      }
    });
}

// Built-in art styles. The prompt text is what image generation receives.
export const ART_STYLE_PRESETS = [
  { id: "preset:documentary", name: "Cinematic documentary", prompt: "Cinematic documentary photograph, natural light, shallow depth of field, realistic textures, muted film color grade" },
  { id: "preset:oil", name: "Oil painting", prompt: "Realistic oil painting, visible brush strokes, rich layered pigment, classical chiaroscuro lighting" },
  { id: "preset:3d-film", name: "3D animated film", prompt: "Stylized 3D animated feature-film look, soft global illumination, expressive characters, clean subsurface-scattered materials" },
  { id: "preset:clay", name: "Clay 3D", prompt: "Soft clay 3D render, rounded forms, matte plasticine materials, studio softbox lighting, toy-like miniature scale" },
  { id: "preset:low-poly", name: "Low poly", prompt: "Low-poly 3D illustration, faceted geometric surfaces, flat-shaded polygons, clean gradient sky" },
  { id: "preset:watercolor", name: "Watercolor", prompt: "Loose watercolor illustration, soft pigment blooms, visible paper grain, gentle washes with ink accents" },
  { id: "preset:halftone", name: "Halftone print", prompt: "Retro halftone print, coarse dot screens, limited two-tone ink palette, slight misregistration, newsprint texture" },
  { id: "preset:pop-art", name: "Pop art", prompt: "Bold pop art, thick black outlines, flat saturated primaries, Ben-Day dots, graphic comic composition" },
  { id: "preset:mono", name: "Black and white", prompt: "High-contrast black and white photograph, deep blacks, fine grain, dramatic directional light" },
  { id: "preset:rubber-hose", name: "Old cartoons", prompt: "1930s rubber-hose cartoon, black and white ink, bouncy limbs, pie-cut eyes, aged film grain" },
  { id: "preset:anime", name: "Anime", prompt: "Hand-drawn anime key frame, cel shading, painted backgrounds, crisp linework, cinematic framing" },
  { id: "preset:ink-wash", name: "Ink wash", prompt: "East Asian ink wash painting, expressive brush strokes, generous negative space, subtle grey gradations" },
];
