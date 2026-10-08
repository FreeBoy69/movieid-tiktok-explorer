import { describe, expect, it } from "vitest";
import {
  addAsset,
  addText,
  clipEnd,
  deleteItems,
  emptyProject,
  frameAt,
  freeLane,
  moveItem,
  normalizeProject,
  placeAsset,
  projectDuration,
  retimeCues,
  rippleDelete,
  scriptToLines,
  setCaptions,
  snapTime,
  splitAt,
  updateItem,
  wordsToCues,
  formatTimecode,
  isLocked,
  setTrackState,
  trackState,
  type VibeAsset,
  baseGaps,
  closeGap,
  duplicateItems,
  editPoints,
  moveItems,
  parseTimecode,
  rippleDeleteItems,
  shiftAfter,
  toggleMarker,
  trimToTime,
  updateMarker,
  rippleTrim,
  setLabel,
} from "./vibeEdit";
import { sanitizeActions, summarizeProject } from "./vibeEditActions.js";
import { soundFilters } from "./vibeSound.js";

const video = (id: string, duration = 10): VibeAsset => ({ id, kind: "video", name: id, url: `/api/studio/files/up-${id}.mp4`, file: `up-${id}.mp4`, duration });
const audio = (id: string, duration = 20): VibeAsset => ({ id, kind: "audio", name: id, url: `/a/${id}`, duration });

function twoClips() {
  let p = addAsset(addAsset(emptyProject(), video("v1", 10)), video("v2", 6));
  p = placeAsset(p, "v1").project;
  p = placeAsset(p, "v2").project;
  return p;
}

describe("vibe edit model", () => {
  it("appends pictures to the base track and starts sound at the requested time", () => {
    let p = twoClips();
    expect(p.clips.map((c) => [c.start, c.out])).toEqual([[0, 10], [10, 6]]);
    p = addAsset(p, audio("m"));
    const r = placeAsset(p, "m", { at: 2, duck: 0.4 });
    const a = r.project.audio[0];
    expect(a).toMatchObject({ start: 2, lane: 0, out: 20, duck: 0.4 });
    expect(projectDuration(r.project)).toBe(22);
  });

  it("puts overlapping sound on the next free lane", () => {
    let p = addAsset(addAsset(emptyProject(), audio("a", 10)), audio("b", 10));
    p = placeAsset(p, "a", { at: 0 }).project;
    expect(freeLane(p, 5, 8)).toBe(1);
    expect(freeLane(p, 10, 12)).toBe(0);
  });

  it("clamps trims to the source and never lets a clip vanish", () => {
    const p = twoClips();
    const id = p.clips[0].id;
    expect(updateItem(p, id, { out: 50 }).clips[0].out).toBe(10);
    const tiny = updateItem(p, id, { in: 4, out: 2 }).clips[0];
    expect(tiny.out - tiny.in).toBeCloseTo(0.1);
  });

  it("splits clips at a time, keeping both halves contiguous in the source", () => {
    const p = splitAt(twoClips(), 4);
    const parts = p.clips.filter((c) => c.assetId === "v1");
    expect(parts.map((c) => [c.start, c.in, c.out])).toEqual([[0, 0, 4], [4, 4, 10]]);
    expect(parts[0].id).not.toBe(parts[1].id);
  });

  it("ripple delete closes the gap for everything after the clip", () => {
    let p = twoClips();
    p = addText(p, { text: "Hi" }, 12).project;
    p = rippleDelete(p, p.clips[0].id);
    expect(p.clips[0].start).toBe(0);
    expect(p.texts[0].start).toBe(2);
  });

  it("moves cues together with their word timings", () => {
    let p = setCaptions(emptyProject(), [{ id: "q1", start: 1, end: 2, text: "hello world", words: [{ t0: 1, t1: 1.5, w: "hello" }, { t0: 1.5, t1: 2, w: "world" }] }]);
    p = moveItem(p, "q1", 3);
    expect(p.captions.cues[0]).toMatchObject({ start: 3, end: 4 });
    expect(p.captions.cues[0].words?.[1]).toMatchObject({ t0: 3.5, t1: 4 });
  });

  it("drops word timings when an edit changes the word count", () => {
    let p = setCaptions(emptyProject(), [{ id: "q1", start: 0, end: 1, text: "two words", words: [{ t0: 0, t1: 0.5, w: "two" }, { t0: 0.5, t1: 1, w: "words" }] }]);
    expect(updateItem(p, "q1", { text: "two birds" }).captions.cues[0].words).toHaveLength(2);
    p = updateItem(p, "q1", { text: "now three words" });
    expect(p.captions.cues[0].words).toBeUndefined();
  });

  it("re-times cues to a voiceover without overlaps", () => {
    let p = setCaptions(emptyProject(), [
      { id: "a", start: 0, end: 1, text: "one" },
      { id: "b", start: 1, end: 2, text: "two" },
    ]);
    p = retimeCues(p, [{ id: "a", start: 0, duration: 1.6 }, { id: "b", start: 1.4, duration: 1 }]);
    expect(p.captions.cues.map((c) => [c.start, c.end])).toEqual([[0, 1.4], [1.4, 2.4]]);
  });

  it("groups transcribed words into cues at sentence ends and pauses", () => {
    const words = ["Hi", "there.", "This", "is", "a", "test", "of", "grouping", "words"].map((w, i) => ({ t0: i * 0.3 + (i >= 6 ? 1 : 0), t1: i * 0.3 + 0.25 + (i >= 6 ? 1 : 0), w }));
    expect(wordsToCues(words).map((c) => c.text)).toEqual(["Hi there.", "This is a test", "of grouping words"]);
  });

  it("splits a script into caption-sized lines", () => {
    expect(scriptToLines("First line here. Second one!  Third?")).toEqual(["First line here.", "Second one!", "Third?"]);
    expect(scriptToLines(Array(20).fill("w").join(" "), 14)).toHaveLength(2);
  });

  it("reports the ducking gain while a voiceover plays", () => {
    let p = addAsset(addAsset(emptyProject(), audio("music", 30)), audio("vo", 5));
    p = placeAsset(p, "music", { at: 0 }).project;
    p = placeAsset(p, "vo", { at: 2, duck: 0.4 }).project;
    expect(frameAt(p, 1).duck).toBe(1);
    expect(frameAt(p, 3).duck).toBe(0.4);
  });

  it("snaps to nearby edges and the playhead", () => {
    const p = twoClips();
    expect(snapTime(p, 9.9, 0.2)).toBe(10);
    expect(snapTime(p, 5.05, 0.2, [5])).toBe(5);
    expect(snapTime(p, 5.5, 0.2)).toBe(5.5);
  });

  it("normalizes stored projects, dropping items whose media is gone", () => {
    const p = twoClips();
    const broken = normalizeProject({ ...p, assets: p.assets.slice(0, 1), aspect: "7:3" as never });
    expect(broken.clips).toHaveLength(1);
    expect(broken.aspect).toBe("9:16");
    expect(clipEnd(broken.clips[0])).toBe(10);
  });

  it("deletes across item kinds", () => {
    let p = twoClips();
    p = addText(p, { text: "x" }).project;
    p = deleteItems(p, [p.clips[0].id, p.texts[0].id]);
    expect(p.clips).toHaveLength(1);
    expect(p.texts).toHaveLength(0);
  });
});

describe("vibe edit tracks", () => {
  it("stores only switched-on track states and finds locks by item", () => {
    let p = twoClips();
    p = setTrackState(p, "v0", { locked: true });
    expect(trackState(p, "v0")).toEqual({ locked: true });
    expect(isLocked(p, p.clips[0].id)).toBe(true);
    p = setTrackState(p, "v0", { locked: false });
    expect(p.tracks).toEqual({});
    expect(isLocked(p, p.clips[0].id)).toBe(false);
  });

  it("formats frame-accurate timecode", () => {
    expect(formatTimecode(0)).toBe("00:00:00:00");
    expect(formatTimecode(61.5)).toBe("00:01:01:15");
    expect(formatTimecode(3600 + 1 / 30)).toBe("01:00:00:01");
  });
});

describe("vibe edit assistant actions", () => {
  it("keeps only known actions and bounded args", () => {
    const out = sanitizeActions([{ type: "add_text", args: { text: "Hi", start: 1 } }, { type: "rm_rf", args: {} }, { type: "seek", args: "nope" }, null]);
    expect(out).toEqual([{ type: "add_text", args: { text: "Hi", start: 1 } }, { type: "seek", args: {} }]);
  });

  it("summarizes the project without media URLs", () => {
    const summary = summarizeProject(twoClips(), { playhead: 3 });
    expect(JSON.stringify(summary)).not.toContain("/api/studio/files");
    expect(summary.clips).toHaveLength(2);
    expect(summary.duration).toBe(16);
  });
});

describe("voice treatments", () => {
  it("builds an ffmpeg chain for presets and nothing for flat", () => {
    expect(soundFilters("flat")).toBe("");
    expect(soundFilters("missing")).toBe("");
    const chain = soundFilters("broadcast");
    expect(chain).toContain("bass=g=1.5:f=100");
    expect(chain).toContain("acompressor=");
    expect(chain).toContain("alimiter=");
    expect(soundFilters("phone")).not.toContain("acompressor");
  });
});

describe("timeline editing", () => {
  it("moves a group together and stops it at zero", () => {
    const p = twoClips();
    const [a, b] = p.clips;
    const moved = moveItems(p, [a.id, b.id], 2);
    expect(moved.clips.map((c) => c.start)).toEqual([2, 12]);
    const back = moveItems(moved, [a.id, b.id], -5);
    expect(back.clips.map((c) => c.start)).toEqual([0, 10]);
    const locked = setTrackState(p, "v0", { locked: true });
    expect(moveItems(locked, [a.id], 3)).toBe(locked);
  });

  it("duplicates after the selection and climbs a track when the row is taken", () => {
    const p = twoClips();
    const [a] = p.clips;
    const { project, ids } = duplicateItems(p, [a.id]);
    expect(ids).toHaveLength(1);
    const copy = project.clips.find((c) => c.id === ids[0])!;
    // v2 already sits at 10-16 on track 0, so the copy goes up a track.
    expect(copy).toMatchObject({ start: 10, track: 1, in: a.in, out: a.out });
  });

  it("ripple deletes several base clips and closes up", () => {
    let p = twoClips();
    p = placeAsset(addAsset(p, video("v3", 4)), "v3").project;
    const [a, , c] = p.clips;
    const next = rippleDeleteItems(p, [a.id, c.id]);
    expect(next.clips).toHaveLength(1);
    expect(next.clips[0].start).toBe(0);
  });

  it("finds and closes gaps on the base track", () => {
    const p = twoClips();
    const gappy = moveItem(p, p.clips[1].id, 13);
    expect(baseGaps(gappy)).toEqual([{ start: 10, end: 13 }]);
    const closed = closeGap(gappy, 11);
    expect(closed.clips[1].start).toBe(10);
    expect(closeGap(p, 5)).toBe(p);
  });

  it("trims to the playhead and ripples base clips", () => {
    const p = twoClips();
    const [a, b] = p.clips;
    const startCut = trimToTime(p, [a.id], 4, "start");
    expect(startCut.clips[0]).toMatchObject({ start: 0, in: 4, out: 10 });
    expect(startCut.clips[1].start).toBe(6);
    const endCut = trimToTime(p, [a.id], 7, "end");
    expect(endCut.clips[0]).toMatchObject({ start: 0, out: 7 });
    expect(endCut.clips[1].start).toBe(7);
    expect(trimToTime(p, [b.id], 4, "end")).toBe(p);
  });

  it("toggles, renames, and snaps to markers, and ripples them", () => {
    let p = toggleMarker(twoClips(), 3.2);
    expect(p.markers).toHaveLength(1);
    expect(snapTime(p, 3.25, 0.1)).toBe(3.2);
    p = updateMarker(p, p.markers![0].id, { label: "Drop" });
    expect(p.markers![0].label).toBe("Drop");
    expect(editPoints(p)).toEqual([0, 3.2, 10, 16]);
    expect(shiftAfter(p, 2, -1).markers![0].time).toBe(2.2);
    expect(toggleMarker(p, 3.21).markers).toHaveLength(0);
    expect(normalizeProject({ ...p, markers: [{ id: "x", time: -1 }, { id: "y", time: 2 }] as never }).markers).toEqual([{ id: "y", time: 2 }]);
  });

  it("ripple-trims a base clip so the edit stays closed up", () => {
    const p = twoClips();
    const [a] = p.clips;
    const shorter = rippleTrim(p, a.id, "end", -3);
    expect(shorter.clips[0]).toMatchObject({ start: 0, out: 7 });
    expect(shorter.clips[1].start).toBe(7);
    const headCut = rippleTrim(p, a.id, "start", 2);
    expect(headCut.clips[0]).toMatchObject({ start: 0, in: 2, out: 10 });
    expect(headCut.clips[1].start).toBe(8);
    // Never past the source: v1 is 10 s long.
    expect(rippleTrim(p, a.id, "end", 5).clips[0].out).toBe(10);
  });

  it("labels and unlabels items", () => {
    const p = twoClips();
    const id = p.clips[0].id;
    const red = setLabel(p, [id], "rose");
    expect(red.clips[0].label).toBe("rose");
    expect(setLabel(red, [id], null).clips[0].label).toBeUndefined();
    expect(setLabel(p, [id], "plaid").clips[0].label).toBeUndefined();
  });

  it("reads typed timecodes", () => {
    expect(parseTimecode("83.5")).toBe(83.5);
    expect(parseTimecode("1:23")).toBe(83);
    expect(parseTimecode("1:01:23")).toBe(3683);
    expect(parseTimecode("00:00:01:15")).toBe(1.5);
    expect(parseTimecode("abc")).toBeNull();
    expect(parseTimecode("")).toBeNull();
  });
});
