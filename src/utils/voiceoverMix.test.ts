import { describe, expect, it } from "vitest";
import { voiceoverMixInputs } from "./voiceoverMix.js";

describe("voiceover mix", () => {
  it("uses separated accompaniment instead of the original narration", () => {
    const args = voiceoverMixInputs("source.mp4", "new-voice.wav", "music.wav", { duration: 42, backgroundVolume: 0.25 });
    expect(args).toContain("music.wav");
    expect(args.join(" ")).not.toContain("sidechaincompress");
    expect(args.join(" ")).toContain("amix=inputs=2:normalize=0");
  });

  it("can render a clean replacement voice without a background input", () => {
    const args = voiceoverMixInputs("source.mp4", "new-voice.wav", null, { duration: 42 });
    expect(args).not.toContain(null);
    expect(args.join(" ")).toContain("[1:a]aresample=48000");
    expect(args.join(" ")).not.toContain("source.mp4,volume");
  });
});
