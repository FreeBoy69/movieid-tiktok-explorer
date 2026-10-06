import { describe, expect, it } from "vitest";
import { judgeVideo, parseMeasurements } from "./videoQa.js";

const STDERR = `[blackdetect @ 0x1] black_start:0 black_end:0.1 black_duration:0.1
[blackdetect @ 0x1] black_start:20 black_end:21.2 black_duration:1.2
[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 30
[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 37.5
[silencedetect @ 0x3] silence_start: 40
[silencedetect @ 0x3] silence_end: 43.5 | silence_duration: 3.5
[Parsed_ebur128_0 @ 0x4] Summary:

  Integrated loudness:
    I:         -18.2 LUFS
    Threshold: -28.4 LUFS

  Loudness range:
    LRA:         6.1 LU

  True peak:
    Peak:        -0.3 dBFS
RMS level dB: -12.0`;
const info = { duration: 60, width: 1080, height: 1920, fps: 30, video: "h264", pixFmt: "yuv420p", audio: "aac" };

describe("video quality gate", () => {
  it("reads loudness, peaks, and black, frozen, and silent runs from ffmpeg", () => {
    const m = parseMeasurements(STDERR);
    expect(m).toMatchObject({ lufs: -18.2, lra: 6.1, truePeak: -0.3, tailRms: -12 });
    expect(m.black).toEqual([{ start: 0, end: 0.1 }, { start: 20, end: 21.2 }]);
    expect(m.frozen).toEqual([{ start: 30, end: 37.5 }]);
    expect(m.silence).toEqual([{ start: 40, end: 43.5 }]);
  });

  it("fails a long freeze or a too-long Short, warns on loudness, peaks, black, dead air, and a cut-off end", () => {
    const { verdict, findings } = judgeVideo({ measurements: parseMeasurements(STDERR), info: { ...info, duration: 200 }, platform: "youtube-shorts" });
    expect(verdict).toBe("FAIL");
    const rules = findings.map((f) => `${f.level}:${f.rule}`);
    expect(rules).toEqual(expect.arrayContaining(["FAIL:too_long", "FAIL:frozen", "FAIL:loudness", "WARN:true_peak", "WARN:black", "WARN:quiet_stretch", "WARN:abrupt_end"]));
    expect(findings.find((f: any) => f.rule === "black" && f.at === 0)!.message).toContain("thumbnail");
  });

  it("passes a clean master and checks caption cues", () => {
    const clean = { lufs: -14.2, truePeak: -1.4, lra: 3, black: [], frozen: [{ start: 57, end: 60 }], silence: [{ start: 59.7, end: null }], tailRms: -70 };
    expect(judgeVideo({ measurements: clean, info }).verdict).toBe("PASS");
    const cues = [
      { start: 1, end: 1.2, text: "Hi" },
      { start: 2, end: 3, text: "this caption line is far too long for a vertical video frame" },
      { start: 4, end: 4.5, text: "far too many words here to read" },
    ];
    const rules = judgeVideo({ measurements: clean, info, cues }).findings.map((f) => f.rule);
    expect(rules).toEqual(expect.arrayContaining(["caption_long", "caption_fast", "caption_flash"]));
  });
});
