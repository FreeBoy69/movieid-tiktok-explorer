import { describe, expect, it } from "vitest";
import { reusableVoiceGeneration } from "./voiceboxHistory.js";

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
