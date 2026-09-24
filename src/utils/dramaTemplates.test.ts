import { describe, expect, it } from "vitest";
import {
  DRAMA_TEMPLATES,
  episodeBrief,
  episodeContext,
  episodeSettings,
  normalizeDramaCast,
  normalizeSeriesPlan,
  seriesOutlinePrompt,
  speakerName,
} from "./dramaTemplates.js";
import { ART_STYLE_PRESETS } from "./creatorPipeline.js";
import { findShortfilmTemplate } from "./shortfilmTemplates.js";
import { readDeepLinkFromLocation, buildDeepLinkHref } from "./tiktokRoute";

const series = {
  id: "prj_series",
  title: "Contract Bride",
  metadata: {
    drama: {
      templateId: "contract-bride",
      episodeSeconds: 90,
      artStyleId: "preset:documentary",
      tone: "Slow burn",
      logline: "A nurse marries a CEO on paper.",
      voices: { LILY: "voice-lily" },
      cast: [
        { id: "lily", name: "Lily Hart", role: "Nurse" },
        { id: "adrian", name: "Adrian Cole", role: "CEO" },
      ],
      episodes: [1, 2, 3].map((n) => ({ n, title: `Ep ${n}`, hook: `hook ${n}`, goal: "", turn: "", payoff: `payoff ${n}`, cliffhanger: `cliff ${n}` })),
    },
  },
};

describe("drama templates", () => {
  it("every template has a unique id, a valid art style and shot template, and distinct speakers", () => {
    const presets = new Set(ART_STYLE_PRESETS.map((style: { id: string }) => style.id));
    expect(new Set(DRAMA_TEMPLATES.map((template) => template.id)).size).toBe(DRAMA_TEMPLATES.length);
    for (const template of DRAMA_TEMPLATES) {
      expect(presets.has(template.artStyleId)).toBe(true);
      expect(findShortfilmTemplate(template.shotTemplateId)).toBeTruthy();
      expect(normalizeDramaCast(template.cast)).toHaveLength(template.cast.length);
    }
  });

  it("uses the capitalized first name as the speaker label", () => {
    expect(speakerName("Mr. Chen")).toBe("MR");
    expect(speakerName("Lily Hart")).toBe("LILY");
  });

  it("drops cast members whose speaker label collides or is NARRATOR", () => {
    const cast = normalizeDramaCast([
      { name: "Lily Hart" },
      { name: "Lily Stone" },
      { name: "Narrator Bob" },
      { name: "Adrian Cole", id: "Bad ID!" },
    ]);
    expect(cast.map((item) => item.id)).toEqual(["lily-hart", "adrian-cole"]);
  });
});

describe("series plans", () => {
  const plan = {
    title: "T",
    logline: "L",
    cast: [{ name: "Ava Moon" }, { name: "Kane Blackwood" }],
    episodes: Array.from({ length: 12 }, (_, index) => ({ title: `E${index + 1}`, hook: "h", cliffhanger: "c" })),
  };
  it("keeps exactly the requested episode count and numbers them", () => {
    const result = normalizeSeriesPlan(plan, { episodeCount: 10 });
    expect(result.episodes).toHaveLength(10);
    expect(result.episodes.map((episode) => episode.n)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
  it("rejects a plan with too few episodes", () => {
    expect(() => normalizeSeriesPlan(plan, { episodeCount: 20 })).toThrow(/12 of 20/);
  });
  it("falls back to the template cast when the plan's cast is unusable", () => {
    const result = normalizeSeriesPlan({ ...plan, cast: [] }, { episodeCount: 3, fallbackCast: DRAMA_TEMPLATES[0].cast });
    expect(result.cast.map((item) => item.id)).toEqual(DRAMA_TEMPLATES[0].cast.map((item) => item.id));
  });
  it("asks for the exact episode count and treats the twist as data", () => {
    const prompt = seriesOutlinePrompt({ template: DRAMA_TEMPLATES[1], twist: "Set it in Lagos", episodeCount: 12, episodeSeconds: 60 });
    expect(prompt.system).toContain("exactly 12 episodes");
    expect(JSON.parse(prompt.user).creatorTwist).toBe("Set it in Lagos");
  });
});

describe("episodes", () => {
  it("gives the script writer the episode, its neighbours, and speaker labels", () => {
    const context = episodeContext(series, 2)!;
    expect(context.episode.title).toBe("Ep 2");
    expect(context.previousEpisode).toEqual({ title: "Ep 1", cliffhanger: "cliff 1" });
    expect(context.nextEpisode).toEqual({ title: "Ep 3", hook: "hook 3" });
    expect(context.cast.map((item) => item.speaker)).toEqual(["LILY", "ADRIAN"]);
    expect(episodeContext(series, 3)!.finale).toBe(true);
    expect(episodeContext(series, 9)).toBeNull();
  });
  it("writes a brief that carries the previous cliffhanger", () => {
    expect(episodeBrief(series, 2)).toContain("Previously: cliff 1");
    expect(episodeBrief(series, 1)).not.toContain("Previously");
  });
  it("presets a 9:16 dialogue episode and lets series voices win", () => {
    const settings = episodeSettings(series, { voiceCast: { LILY: "old", ADRIAN: "voice-adrian" }, voiceId: "main" });
    expect(settings).toMatchObject({ scriptFormat: "dialogue", aspect: "9:16", wordCount: 210, artStyleId: "preset:documentary", shotTemplateId: "micro-drama", voiceId: "main" });
    expect(settings.voiceCast).toEqual({ LILY: "voice-lily", ADRIAN: "voice-adrian" });
  });
});

describe("drama routes", () => {
  it("round-trips the drama home and a series page", () => {
    expect(readDeepLinkFromLocation("/drama")).toEqual({ view: "drama", seriesId: undefined });
    expect(readDeepLinkFromLocation("/drama/prj_1")).toEqual({ view: "drama", seriesId: "prj_1" });
    expect(buildDeepLinkHref({ view: "drama" })).toBe("/drama");
    expect(buildDeepLinkHref({ view: "drama", seriesId: "prj_1" })).toBe("/drama/prj_1");
    expect(readDeepLinkFromLocation("/drama/prj_1/ep/prj_2")).toEqual({ view: "drama", seriesId: "prj_1", episodeId: "prj_2" });
    expect(buildDeepLinkHref({ view: "drama", seriesId: "prj_1", episodeId: "prj_2" })).toBe("/drama/prj_1/ep/prj_2");
  });
});
