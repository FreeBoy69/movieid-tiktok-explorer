import { describe, expect, it } from "vitest";
import { inFlightVoiceGeneration, reusableVoiceGeneration } from "./voiceboxHistory.js";

describe("completed Voicebox line reuse", () => {
  const query = { profileId: "voice-a", text: "Hello.", language: "en", instruct: "calm", engine: "qwen", modelSize: "0.6B" };
  const completed = { id: "old", profile_id: "voice-a", text: "Hello.", language: "en", instruct: "calm", engine: "qwen", model_size: "0.6B", status: "completed", audio_path: "generations/old.wav" };

  it("reuses only a completed line with the same voice, text, delivery and model", () => {
    expect(reusableVoiceGeneration([completed], query)).toEqual(completed);
    for (const patch of [
      { profile_id: "voice-b" }, { text: "Hello!" }, { instruct: "angry" },
      { engine: "chatterbox" }, { model_size: "1.7B" }, { status: "generating" }, { audio_path: "" },
    ]) expect(reusableVoiceGeneration([{ ...completed, ...patch }], query)).toBeNull();
  });
});

describe("in-flight Voicebox line reuse", () => {
  const wanted = { profileId: "voice-a", text: "Hello.", language: "en", instruct: "calm", engine: "qwen", modelSize: "0.6B" };
  const now = Date.parse("2026-10-06T23:30:00Z");
  const item = { id: "g1", status: "generating", profile_id: "voice-a", text: "Hello.", language: "en", instruct: "calm", engine: "qwen", model_size: "0.6B", created_at: "2026-10-06T23:28:41.297685" };
  it("waits on the same line still recording", () => {
    expect(inFlightVoiceGeneration([item], wanted, now)?.id).toBe("g1");
  });
  it("ignores stale or different lines", () => {
    expect(inFlightVoiceGeneration([{ ...item, created_at: "2026-10-06T22:00:00" }], wanted, now)).toBeNull();
    expect(inFlightVoiceGeneration([{ ...item, text: "Bye." }], wanted, now)).toBeNull();
    expect(inFlightVoiceGeneration([{ ...item, status: "completed" }], wanted, now)).toBeNull();
  });
});
