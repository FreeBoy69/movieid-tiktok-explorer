import { describe, expect, it } from "vitest";
import { hostedVoiceProfiles, isHostedVoice, pcmToWav, synthesizeHostedVoice } from "./hostedVoices.js";

describe("hosted voices", () => {
  it("lists ready preset voices only when OpenRouter is configured", () => {
    expect(hostedVoiceProfiles({})).toEqual([]);
    const voices = hostedVoiceProfiles({ OPENROUTER_API_KEY: "k" });
    expect(voices.length).toBeGreaterThan(5);
    expect(voices.every((voice) => voice.voiceType === "preset" && voice.sampleCount > 0 && isHostedVoice(voice.id))).toBe(true);
    expect(isHostedVoice("voicebox-profile-1")).toBe(false);
  });

  it("wraps PCM in a valid WAV header", () => {
    const wav = pcmToWav(Buffer.alloc(4800), 24000, 1);
    expect(wav.subarray(0, 4).toString()).toBe("RIFF");
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(40)).toBe(4800);
    expect(wav.length).toBe(44 + 4800);
  });

  it("asks Gemini voices for PCM and returns WAV at the reported rate", async () => {
    let sent: any = null;
    const result = await synthesizeHostedVoice({
      profileId: "openrouter:google/gemini-3.1-flash-tts-preview:Charon",
      text: "Hello there",
      env: { OPENROUTER_API_KEY: "k" },
      fetchImpl: (async (_url: string, init: any) => {
        sent = JSON.parse(init.body);
        return new Response(Buffer.alloc(2000), { status: 200, headers: { "content-type": "audio/pcm;rate=22050;channels=1" } });
      }) as any,
    });
    expect(sent).toMatchObject({ model: "google/gemini-3.1-flash-tts-preview", voice: "Charon", response_format: "pcm" });
    expect(result.extension).toBe("wav");
    expect(result.audio.readUInt32LE(24)).toBe(22050);
  });

  it("steers Gemini delivery with a leading direction and other models with instructions", async () => {
    const sent: any[] = [];
    const fetchImpl = (async (_url: string, init: any) => {
      sent.push(JSON.parse(init.body));
      return new Response(Buffer.alloc(2000), { status: 200, headers: { "content-type": "audio/mpeg" } });
    }) as any;
    await synthesizeHostedVoice({ profileId: "openrouter:google/gemini-3.1-flash-tts-preview:Kore", text: "Welcome back.", direction: "Say warmly", env: { OPENROUTER_API_KEY: "k" }, fetchImpl });
    await synthesizeHostedVoice({ profileId: "openrouter:openai/gpt-4o-mini-tts:alloy", text: "Welcome back.", direction: "Say warmly", env: { OPENROUTER_API_KEY: "k" }, fetchImpl });
    expect(sent[0].input).toBe("Say warmly: Welcome back.");
    expect(sent[0].instructions).toBeUndefined();
    expect(sent[1]).toMatchObject({ input: "Welcome back.", instructions: "Say warmly" });
  });

  it("offers all thirty Gemini voices with a gender for grouping", () => {
    const voices = hostedVoiceProfiles({ OPENROUTER_API_KEY: "k" });
    expect(voices).toHaveLength(30);
    expect(voices.every((voice) => voice.gender === "f" || voice.gender === "m")).toBe(true);
  });
});
