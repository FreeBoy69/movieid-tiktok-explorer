import { describe, expect, it } from "vitest";
import {
  rankDiscoveryChannels,
  splitCreatorScene,
  stageInput,
  validateCreatorScenes,
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
