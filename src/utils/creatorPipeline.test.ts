import { describe, expect, it } from "vitest";
import {
  allocateImageReferences,
  assertStageReady,
  mergeVisualSegment,
  normalizeMusicSegments,
  normalizeVisualSegments,
  normalizeVisualBible,
  rankDiscoveryChannels,
  segmentImageLimit,
  segmentScenes,
  splitCreatorScene,
  splitVisualSegment,
  stageInput,
  transcriptBoundaries,
  validateCreatorScenes,
  semanticScenes,
  DEFAULT_SCENE_SECONDS,
} from "./creatorPipeline.js";

const video = (overrides: Record<string, unknown> = {}) => ({
  id: "video-1",
  title: "A useful sample",
  url: "https://youtube.test/watch?v=video-1",
  channelId: "channel-1",
  channelTitle: "Useful channel",
  channelUrl: "https://youtube.test/@useful",
  publishedAt: "2026-08-01T00:00:00.000Z",
  viewCount: 10_000,
  subscriberCount: 25_000,
  durationSeconds: 720,
  viewsPerHour: 120,
  discoveryScore: 70,
  opportunityScore: 74,
  facelessScore: 81,
  niche: "history",
  ...overrides,
});

describe("creator stage inputs", () => {
  it("scopes settings to the dependencies that can actually stale a stage", () => {
    const project = {
      styleId: "style-1",
      metadata: {
        brief: "A brief",
        styleGuide: "A guide",
        settings: {
          wordCount: 800,
          voiceId: "voice-1",
          aspect: "9:16",
          visualStyle: "paper cutout",
        },
      },
      outputs: {},
    };

    expect(stageInput(project, "voiceover").settings).toEqual({
      voiceId: "voice-1",
      voiceSpeed: undefined,
      pronunciation: undefined,
      language: undefined,
      narrationStyle: undefined,
      voiceEngine: undefined,
    });
    expect(stageInput(project, "voiceover").settings).not.toHaveProperty(
      "aspect",
    );
    expect(stageInput(project, "visualPlan").settings).toMatchObject({
      aspect: "9:16",
      visualStyle: "paper cutout",
    });
  });

  it("fingerprints the visual bible only where visuals depend on it", () => {
    const project = {
      metadata: { settings: { visualBible: { version: 3, cast: [{ id: "lead" }] } } },
      outputs: {},
    };
    expect(stageInput(project, "visualPlan").settings.visualBible.version).toBe(3);
    expect(stageInput(project, "voiceover").settings).not.toHaveProperty("visualBible");
  });
});

describe("visual consistency references", () => {
  it("keeps every required identity and the selected style", () => {
    expect(allocateImageReferences({
      identity: [{ path: "lead.jpg", characterId: "lead" }, { path: "guide.jpg", characterId: "guide" }],
      style: ["style-a.jpg", "style-b.jpg"],
      composition: ["layout.jpg"],
      limit: 4,
    })).toEqual([
      { path: "lead.jpg", characterId: "lead", role: "identity" },
      { path: "guide.jpg", characterId: "guide", role: "identity" },
      { path: "style-a.jpg", role: "style" },
      { path: "layout.jpg", role: "composition" },
    ]);
  });

  it("fails instead of silently dropping identity or style references", () => {
    expect(() => allocateImageReferences({ identity: ["1", "2", "3", "4"], style: ["style"], limit: 4 }))
      .toThrow(/no reference slot/i);
    expect(() => allocateImageReferences({ identity: ["1", "2", "3", "4", "5"], limit: 4 }))
      .toThrow(/needs 5 character references/i);
  });

  it("drops malformed cast IDs before they reach file or prompt lookup", () => {
    const bible = normalizeVisualBible({ cast: [
      { id: "lead", name: "Lead" },
      { id: "../../etc/passwd", name: "Bad" },
    ] });
    expect(bible.cast.map((item) => item.id)).toEqual(["lead"]);
  });
});

describe("discovery channel ranking", () => {
  it("separates best and recent videos instead of labeling the second-best video recent", () => {
    const [channel] = rankDiscoveryChannels([
      video({
        id: "best",
        viewCount: 100_000,
        publishedAt: "2026-07-01T00:00:00.000Z",
      }),
      video({
        id: "recent",
        viewCount: 5_000,
        publishedAt: "2026-09-01T00:00:00.000Z",
      }),
      video({
        id: "middle",
        viewCount: 20_000,
        publishedAt: "2026-08-01T00:00:00.000Z",
      }),
    ]);

    expect(channel.bestVideo.id).toBe("best");
    expect(channel.recentVideo.id).toBe("recent");
    expect(channel.medianViews).toBe(20_000);
    expect(channel.averageViews).toBeCloseTo(41_666.67, 1);
    expect(channel.earliestSampledAt).toBe(
      Date.parse("2026-07-01T00:00:00.000Z"),
    );
    expect(channel.latestSampledAt).toBe(
      Date.parse("2026-09-01T00:00:00.000Z"),
    );
  });

  it("keeps unknown faceless and monetization values unknown", () => {
    const [channel] = rankDiscoveryChannels([
      video({ facelessScore: undefined, subscriberCount: undefined }),
    ]);

    expect(channel.facelessScore).toBeNull();
    expect(channel.facelessConfidence).toBeNull();
    expect(channel.subscribers).toBeNull();
    expect(channel.monetization).toBe("unknown");
    expect(channel.monetizationConfidence).toBeNull();
  });

  it("filters unknown faceless values without pretending they are known", () => {
    const channels = rankDiscoveryChannels(
      [
        video({ id: "known", facelessScore: 90 }),
        video({ id: "unknown", channelId: "channel-2", facelessScore: undefined }),
      ],
      { facelessUnknown: "exclude" },
    );

    expect(channels.map((channel) => channel.id)).toEqual(["channel-1"]);
  });

  it("applies duration, term, and sort filters to the sampled set", () => {
    const channels = rankDiscoveryChannels(
      [
        video({ id: "long", channelId: "long", durationSeconds: 900 }),
        video({ id: "short", channelId: "short", durationSeconds: 45 }),
      ],
      {
        format: "longform",
        includeTerms: "useful",
        sort: "consistency",
      },
    );

    expect(channels.map((channel) => channel.id)).toEqual(["long"]);
  });
});

describe("creator scene editing", () => {
  it("clears the generated asset on the new half after a semantic split", () => {
    const scenes = [
      {
        id: "scene-1",
        start: 0,
        end: 10,
        text: "First sentence. Second sentence.",
        prompt: "A room",
        asset: "/api/maker/projects/p/assets/one.png",
        motion: "still",
      },
    ];
    const split = splitCreatorScene(
      scenes,
      [
        { start: 0, end: 5, text: "First sentence." },
        { start: 5, end: 10, text: "Second sentence." },
      ],
      4.8,
    );

    expect(split).toHaveLength(2);
    expect(split[0].asset).toBe(scenes[0].asset);
    expect(split[1].asset).toBeNull();
  });

  it("does not allow one generated asset to be reused across scenes", () => {
    const asset = "/api/maker/projects/p/assets/one.png";
    expect(() =>
      validateCreatorScenes(
        [
          {
            id: "scene-1",
            start: 0,
            end: 5,
            prompt: "same",
            asset,
          },
          {
            id: "scene-2",
            start: 5,
            end: 10,
            prompt: "same",
            asset,
          },
        ],
        [
          {
            id: "scene-1",
            start: 0,
            end: 10,
            prompt: "same",
            asset,
          },
        ],
        10,
      ),
    ).not.toThrow();
    const validated = validateCreatorScenes(
      [
        { id: "scene-1", start: 0, end: 5, prompt: "same", asset },
        { id: "scene-2", start: 5, end: 10, prompt: "same", asset },
      ],
      [
        {
          id: "scene-1",
          start: 0,
          end: 10,
          prompt: "same",
          asset,
        },
      ],
      10,
    );
    expect(validated[0].asset).toBe(asset);
    expect(validated[1].asset).toBeNull();
  });
  it("keeps scene cast IDs and regenerates the image when the cast changes", () => {
    const asset = "/api/maker/projects/p/assets/scene.png";
    const original = [{ id: "scene-1", start: 0, end: 10, prompt: "same", asset, castIds: ["cast-a"] }];
    const kept = validateCreatorScenes(
      [{ id: "scene-1", start: 0, end: 10, prompt: "same", asset, castIds: ["cast-a", "cast-a", "bad id!"] }],
      original,
      10,
    );
    expect(kept[0].castIds).toEqual(["cast-a"]);
    expect(kept[0].asset).toBe(asset);
    const changed = validateCreatorScenes(
      [{ id: "scene-1", start: 0, end: 10, prompt: "same", asset, castIds: ["cast-a", "cast-b"] }],
      original,
      10,
    );
    expect(changed[0].castIds).toEqual(["cast-a", "cast-b"]);
    expect(changed[0].asset).toBeNull();
  });
});

describe("discovery ratio filter", () => {
  it("keeps channels with unknown subscribers when no minimum ratio is set", () => {
    const channels = rankDiscoveryChannels(
      [video({ subscriberCount: undefined })],
      { minRatio: 0 },
    );
    expect(channels).toHaveLength(1);
    expect(channels[0].ratio).toBeNull();
  });
  it("excludes unknown subscribers once a minimum ratio is required", () => {
    expect(
      rankDiscoveryChannels([video({ subscriberCount: undefined })], { minRatio: 0.5 }),
    ).toHaveLength(0);
  });
});

describe("TubeGen parity helpers", () => {
  const voice = [
    { start: 0, end: 4, text: "One." },
    { start: 4, end: 9, text: "Two." },
    { start: 9, end: 15, text: "Three." },
    { start: 15, end: 22, text: "Four." },
    { start: 22, end: 30, text: "Five." },
  ];

  it("keeps animation choices and a clip only while its image and direction are unchanged", () => {
    const original = [
      { id: "scene-1", start: 0, end: 10, prompt: "a", asset: "/a.png", clip: "/a-clip.mp4", animationPrompt: "pan" },
      { id: "scene-2", start: 10, end: 20, prompt: "b", asset: "/b.png", clip: "/b-clip.mp4", animationPrompt: "" },
    ];
    const [kept, changed] = validateCreatorScenes(
      [
        { ...original[0], animate: true, quality: "ultra" },
        { ...original[1], animate: true, animationPrompt: "zoom in" },
      ],
      original,
      20,
    );
    expect(kept).toMatchObject({ animate: true, quality: "ultra", clip: "/a-clip.mp4", animationPrompt: "pan" });
    expect(changed).toMatchObject({ animate: true, clip: null, animationPrompt: "zoom in", asset: "/b.png" });
  });

  it("plans scenes per segment with that segment's count, animation, and quality", () => {
    const scenes = segmentScenes(voice, 30, [
      { id: "seg-1", start: 0, end: 15, animate: true, quality: "high", imageCount: 3 },
      { id: "seg-2", start: 15, end: 30, imageCount: 1 },
    ]);
    expect(scenes.map((s) => [s.start, s.end, s.segmentId, s.animate])).toEqual([
      [0, 4, "seg-1", true],
      [4, 9, "seg-1", true],
      [9, 15, "seg-1", true],
      [15, 30, "seg-2", false],
    ]);
    expect(scenes[0].quality).toBe("high");
    expect(scenes[3]).not.toHaveProperty("quality");
    expect(scenes.map((s) => s.id)).toEqual(["scene-1", "scene-2", "scene-3", "scene-4"]);
  });

  it("splits segments only at sentence breaks and caps images at one per sentence", () => {
    const boundaries = transcriptBoundaries(voice, 30);
    expect(boundaries).toEqual([4, 9, 15, 22]);
    const split = splitVisualSegment(normalizeVisualSegments([], 30), boundaries, 13);
    expect(split.map((s) => [s.start, s.end])).toEqual([[0, 15], [15, 30]]);
    expect(segmentImageLimit(split[0], boundaries)).toBe(3);
    expect(() => splitVisualSegment(split, boundaries, 0.2)).toThrow();
    expect(mergeVisualSegment(split, 0).map((s) => [s.start, s.end])).toEqual([[0, 30]]);
  });

  it("snaps music segments to cover the whole soundtrack in order", () => {
    const segments = normalizeMusicSegments(
      [
        { start: 5, end: 12, mood: "build" },
        { start: 0.4, end: 5, mood: "open", muted: 1 },
        { start: 12, end: 20, mood: "sting", prompt: "brass" },
      ],
      21,
    );
    expect(segments.map((s) => [s.start, s.end, s.mood, s.muted])).toEqual([
      [0, 5, "open", true],
      [5, 12, "build", false],
      [12, 21, "sting", false],
    ]);
  });

  it("filters channels by creation date, channel video count, and average views", () => {
    const channels = rankDiscoveryChannels(
      [
        video({ channelId: "new", channelPublishedAt: "2026-07-01T00:00:00Z", channelVideoCount: 12, viewCount: 9000 }),
        video({ id: "v2", channelId: "old", channelPublishedAt: "2019-01-01T00:00:00Z", channelVideoCount: 800, viewCount: 90000 }),
        video({ id: "v3", channelId: "unknown", viewCount: 9000 }),
      ],
      { createdAfter: "2026-01-01", maxVideos: 50, maxAvgViews: 50000 },
    );
    expect(channels.map((c: any) => c.id)).toEqual(["new"]);
    expect(channels[0]).toMatchObject({ videoCount: 12, createdAt: Date.parse("2026-07-01T00:00:00Z") });
  });

  it("treats a missing faceless score as unknown, not zero", () => {
    const [channel] = rankDiscoveryChannels([video({ facelessScore: null })]);
    expect(channel.facelessScore).toBeNull();
  });

  it("lets an uploaded source be scored without a script", () => {
    const project = { status: "active", metadata: { soundtrackSource: { asset: "/s.wav", duration: 30 } }, outputs: {} };
    expect(() => assertStageReady(project, "soundtrack")).not.toThrow();
    expect(() => assertStageReady({ ...project, metadata: {} }, "soundtrack")).toThrow(/script/);
  });
});

describe("fast-paced scene cuts", () => {
  it("defaults to about four seconds a scene and splits long sentences evenly", () => {
    expect(DEFAULT_SCENE_SECONDS).toBe(4);
    const segments = [
      { start: 0, end: 4.2, text: "A short opening line." },
      { start: 4.2, end: 16.2, text: "Then one very long sentence that keeps going for twelve whole seconds without a break." },
      { start: 16.2, end: 20, text: "The end." },
    ];
    const scenes = semanticScenes(segments, 20);
    expect(scenes.map((s) => [+s.start.toFixed(1), +s.end.toFixed(1)])).toEqual([[0, 4.2], [4.2, 8.2], [8.2, 12.2], [12.2, 16.2], [16.2, 20]]);
    expect(scenes.slice(1, 4).map((s) => s.text).join(" ")).toBe(segments[1].text);
    expect(new Set(scenes.map((s) => s.id)).size).toBe(scenes.length);
  });

  it("keeps the old pacing when a longer scene length is chosen", () => {
    const segments = [{ start: 0, end: 6, text: "One." }, { start: 6, end: 12, text: "Two." }];
    expect(semanticScenes(segments, 12, 12)).toHaveLength(1);
  });
});
