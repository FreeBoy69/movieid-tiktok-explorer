import { describe, expect, it } from "vitest";
import { FILM_FORMATS, formatCount, lyricsFromSegments, musicSceneTimeline, normalizeBeatGrid, normalizeLyrics, sceneBeatGrid, songScenePlan } from "./filmFormats.js";
import { CAMERA_OPTIONS, cameraId, cameraLabel, cameraMenu, cameraPhrase } from "./cameraShots.js";
import { musicScreenplayPrompt, normalizeMusicScreenplay, normalizeScreenplay, screenplaySystemPrompt, seedancePrompt, storyboardPrompt } from "./dramaProduction.js";
import { dramaConceptPrompt, seriesOutlinePrompt } from "./dramaTemplates.js";
import { filmCinemaText, normalizeFilmCinema } from "./cinemaPresets.js";

const lyrics = [
  { start: 12, end: 15.5, text: "I keep your light in the window" },
  { start: 16, end: 19, text: "Every night the city hums" },
  { start: 20, end: 24, text: "Hold on, hold on" },
  { start: 25, end: 28, text: "We were never made for slow" },
  { start: 60, end: 63, text: "Last line before the outro" },
];

describe("film formats", () => {
  it("define each format's unit range and dialogue", () => {
    expect(Object.keys(FILM_FORMATS)).toEqual(["series", "short", "long", "music"]);
    expect(formatCount("short", 9)).toBe(1);
    expect(formatCount("long", 40)).toBe(12);
    expect(FILM_FORMATS.music.dialogue).toBe(false);
  });

  it("splits long Whisper segments into lyric lines on their words", () => {
    const words = Array.from({ length: 10 }, (_, i) => ({ start: i, end: i + 0.8, word: `w${i}` }));
    const lines = lyricsFromSegments([{ start: 0, end: 9.8, text: words.map((w) => w.word).join(" "), words }], { maxSeconds: 4 });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => line.end - line.start <= 4.8)).toBe(true);
  });

  it("cuts a song into scenes that tile it on lyric starts, within one clip each", () => {
    const plan = songScenePlan(lyrics, 75, { target: 7, max: 12, min: 4 });
    expect(plan[0].start).toBe(0);
    expect(plan[plan.length - 1].end).toBe(75);
    for (let i = 1; i < plan.length; i++) expect(plan[i].start).toBe(plan[i - 1].end);
    expect(plan.every((scene) => scene.end - scene.start <= 12 && scene.end - scene.start >= 4)).toBe(true);
    // A lyric line lives in exactly one scene.
    const placed = plan.flatMap((scene) => scene.lyrics.map((line) => line.text));
    expect(new Set(placed).size).toBe(placed.length);
    expect(placed).toContain("Hold on, hold on");
  });

  // 120 BPM from 0.5s: a beat every 0.5s, a bar every 2s, bars at 0.5, 2.5, 4.5, ...
  const grid = normalizeBeatGrid({ bpm: 120, beats: Array.from({ length: 150 }, (_, i) => 0.5 + i * 0.5), bars: Array.from({ length: 38 }, (_, i) => 0.5 + i * 2) }, 75);

  it("cuts a song with a beat grid on bar lines, favouring lyric bars", () => {
    const plan = songScenePlan(lyrics, 75, { target: 7, max: 12, min: 4, grid });
    expect(plan[0].start).toBe(0);
    expect(plan[plan.length - 1].end).toBe(75);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].start).toBe(plan[i - 1].end);
      expect(((plan[i].start - 0.5) / 2) % 1).toBe(0);
    }
    expect(plan.every((scene) => scene.end - scene.start <= 12 && scene.end - scene.start >= 4 && scene.bars! >= 1)).toBe(true);
    // The first lyric starts at 12s, on the bar at 12.5: a cut lands there.
    expect(plan.some((scene) => scene.start === 12.5)).toBe(true);
    expect(normalizeBeatGrid({ bpm: 10, beats: [1, 2, 3, 4] })).toBeNull();
  });

  it("snaps shot changes inside a scene to the beat", () => {
    const scene = { start: 0.5, end: 8.5, lyrics: [], beats: [{ id: "a", line: "", speaker: "", emotion: "" }, { id: "b", line: "", speaker: "", emotion: "" }, { id: "c", line: "", speaker: "", emotion: "" }] };
    const local = sceneBeatGrid(scene, grid);
    expect(local?.bars).toEqual([0, 2, 4, 6]);
    const timeline = musicSceneTimeline(scene, local);
    for (const item of timeline.slice(1)) expect((item.start * 2) % 1).toBe(0);
    expect(timeline[0].start).toBe(0);
  });

  it("places sung beats on their lyric times and spreads the rest", () => {
    const scene = {
      start: 12,
      end: 24,
      lyrics: normalizeLyrics(lyrics.slice(0, 3)),
      beats: [
        { id: "a", line: "", speaker: "", emotion: "" },
        { id: "b", line: "Every night the city hums", speaker: "NOVA", emotion: "" },
        { id: "c", line: "", speaker: "", emotion: "" },
      ],
    };
    const timeline = musicSceneTimeline(scene);
    expect(timeline.find((item) => item.beatId === "b")).toMatchObject({ start: 4, end: 7, silent: false });
    expect(timeline.find((item) => item.beatId === "a")).toMatchObject({ start: 0, end: 4 });
    expect(timeline.find((item) => item.beatId === "c")?.start).toBe(7);
  });

  it("keeps every planned scene and drops sung lines that are not the scene's lyrics", () => {
    const plan = songScenePlan(lyrics, 30, { target: 7, max: 12, min: 4 });
    const written = { scenes: [{ title: "Open", beats: [{ shot: "wide", angle: "nonsense", move: "City at night", speaker: "NOVA", line: "A line we never sang" }] }] };
    const { scenes } = normalizeMusicScreenplay(written, plan, { speakers: ["NOVA"], locations: [{ id: "roof" }] });
    expect(scenes).toHaveLength(plan.length);
    expect(scenes[0].beats[0]).toMatchObject({ shot: "wide", line: "", speaker: "" });
    expect(scenes[0].beats[0].angle).toBeUndefined();
    expect(scenes.every((scene, i) => scene.start === plan[i].start && scene.end === plan[i].end && scene.beats.length > 0)).toBe(true);
  });

  it("writes a music prompt over the planned scenes", () => {
    const plan = songScenePlan(lyrics, 30);
    const prompt = musicScreenplayPrompt({ aspect: "16:9", plan });
    expect(prompt.system).toContain(`exactly ${plan.length} scenes`);
    expect(JSON.parse(prompt.user).scenes).toHaveLength(plan.length);
  });

  it("tells the writer and the video model the tempo", () => {
    const plan = songScenePlan(lyrics, 30, { grid });
    const prompt = musicScreenplayPrompt({ aspect: "16:9", plan, bpm: 120 });
    expect(prompt.system).toContain("120 BPM");
    expect(JSON.parse(prompt.user).scenes[0].bars).toBeGreaterThan(0);
    const scene = { id: "s1", title: "Hook", summary: "", beats: [{ id: "b1", cam: "", move: "Dances", speaker: "", line: "", emotion: "" }] };
    const clip = seedancePrompt(scene, { cast: [], location: null, style: "film", refs: { characters: {}, location: 0, grid: 0, audio: 1 }, seconds: 8, timeline: [{ beatId: "b1", start: 0, end: 8, silent: true }], audioMode: "music", rhythm: { bpm: 120, beats: [0, 0.5], bars: [0, 2, 4, 6] } });
    expect(clip).toContain("RHYTHM: the song is 120 BPM, with bar lines at 0.0s, 2.0s, 4.0s, 6.0s");
  });
});

describe("camera catalogue", () => {
  it("has unique ids across angle, shot, perspective, and motion", () => {
    expect(new Set(CAMERA_OPTIONS.map((o) => o.id)).size).toBe(CAMERA_OPTIONS.length);
    for (const group of ["angle", "shot", "perspective", "motion"]) expect(CAMERA_OPTIONS.filter((o) => o.group === group).length).toBeGreaterThanOrEqual(12);
    expect(cameraId("angle", "dutch")).toBe("dutch");
    expect(cameraId("angle", "push-in")).toBe("");
  });

  it("spells shots out for prompts and labels, leaving movement out of stills", () => {
    const beat = { shot: "close-up", angle: "low-angle", motion: "push-in" };
    expect(cameraPhrase(beat)).toMatch(/^close-up shot.*low angle shot.*push-in/);
    expect(cameraPhrase(beat, { video: false })).not.toContain("push-in");
    expect(cameraLabel(beat)).toBe("Close-up · Low angle · Push in");
    expect(cameraMenu()).toContain("motion:");
  });

  it("puts camera picks first in storyboard panels and clip timelines", () => {
    const scene = { id: "s1", title: "Roof", summary: "", beats: [{ id: "b1", cam: "", shot: "wide", angle: "birds-eye", motion: "crane-up", move: "She steps to the edge", speaker: "", line: "", emotion: "" }] };
    const refs = { characters: {}, location: 0, grid: 0, audio: 0 };
    const board = storyboardPrompt(scene, { cast: [], location: null, style: "film", refs });
    expect(board).toContain("Panel 1 (top-left): wide shot");
    const clip = seedancePrompt(scene, { cast: [], location: null, style: "film", refs, seconds: 6, timeline: [{ beatId: "b1", start: 0, end: 6, silent: true }], audioMode: "silent", cinema: "shot on a 16mm film camera" });
    expect(clip).toContain("0:00-0:06: wide shot");
    expect(clip).toContain("nobody speaks");
    expect(clip).toContain("CAMERA AND LOOK: shot on a 16mm film camera");
  });

  it("asks for the song as the music track in music mode", () => {
    const scene = { id: "s1", title: "Hook", summary: "", beats: [{ id: "b1", cam: "", move: "Performs", speaker: "NOVA", line: "Hold on", emotion: "" }] };
    const prompt = seedancePrompt(scene, { cast: [], location: null, style: "film", refs: { characters: {}, location: 0, grid: 0, audio: 1 }, seconds: 5, timeline: [{ beatId: "b1", speaker: "NOVA", line: "Hold on", start: 0, end: 5 }], audioMode: "music" });
    expect(prompt).toContain("complete music track");
    expect(prompt).toContain("NOVA sings");
    expect(prompt).not.toContain("NO MUSIC");
  });
});

describe("format writing", () => {
  it("briefs each format differently and keeps the series brief", () => {
    expect(seriesOutlinePrompt({ episodeCount: 10, episodeSeconds: 60 }).system).toMatch(/^You are the head writer of an original vertical short drama series/);
    expect(seriesOutlinePrompt({ episodeCount: 1, episodeSeconds: 180, format: "short" }).system).toContain("Plan exactly 1 film");
    expect(seriesOutlinePrompt({ episodeCount: 5, episodeSeconds: 360, format: "long" }).system).toContain("5 consecutive parts");
    const music = dramaConceptPrompt([{ role: "user", content: "neon" }], { format: "music", song: { duration: 75, lyrics } });
    expect(music.system).toContain("music video director");
    expect(JSON.parse(music.user).song.lyrics).toContain("Hold on, hold on");
    expect(screenplaySystemPrompt({ maxSceneSeconds: 30, aspect: "16:9", format: "short", minScenes: 6, maxScenes: 14, seconds: 180 })).toContain("6 to 14 scenes that together run about 180 seconds");
  });

  it("maps multi-word speaker labels onto the cast", () => {
    const { scenes } = normalizeScreenplay({ scenes: [{ beats: [{ move: "x", speaker: "Lin Mei", line: "Hello" }] }] }, { speakers: ["LIN"] });
    expect(scenes[0].beats[0].speaker).toBe("LIN");
  });

  it("builds the film cinema look only from what was picked", () => {
    expect(filmCinemaText({})).toBe("");
    expect(filmCinemaText({ lens: "Classic Anamorphic", focalLength: 35 })).toBe("classic anamorphic lens at 35mm (natural cinematic perspective)");
    expect(normalizeFilmCinema({ camera: "Nope", palette: "teal-orange", focalLength: "50" })).toEqual({ palette: "teal-orange", focalLength: 50 });
  });
});
