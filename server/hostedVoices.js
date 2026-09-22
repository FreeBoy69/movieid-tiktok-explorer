// Hosted narration voices.
//
// Voicebox (the local TTS server with cloning) ran next to the app on the old
// VPS. The LingCode hosted app has no Voicebox, so these voices come from
// OpenRouter's speech API instead. They behave like Voicebox preset voices:
// same profile shape, same generate() result, and audio saved as WAV so the
// existing trim, concat, and alignment steps keep working. Voice cloning still
// needs Voicebox.
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MODEL = () => String(process.env.OPENROUTER_TTS_MODEL || "google/gemini-3.1-flash-tts-preview").trim();
const PREFIX = "openrouter:";
// Gemini TTS prebuilt voices that suit narration, with their published character.
const VOICES = [
  ["Charon", "Informative, steady documentary narrator"],
  ["Kore", "Firm and confident"],
  ["Orus", "Firm, lower register"],
  ["Iapetus", "Clear and even"],
  ["Algieba", "Smooth and warm"],
  ["Gacrux", "Mature and measured"],
  ["Rasalgethi", "Informative, explainer tone"],
  ["Puck", "Upbeat and lively"],
  ["Fenrir", "Excitable, high energy"],
  ["Aoede", "Breezy and relaxed"],
  ["Zephyr", "Bright and friendly"],
  ["Enceladus", "Breathy, intimate storytelling"],
];

export function hostedVoicesAvailable(env = process.env) {
  return Boolean(String(env.OPENROUTER_API_KEY || "").trim());
}
export function isHostedVoice(id) {
  return String(id || "").startsWith(PREFIX);
}
export function hostedVoiceProfiles(env = process.env) {
  if (!hostedVoicesAvailable(env)) return [];
  const model = MODEL();
  return VOICES.map(([voice, description]) => ({
    id: `${PREFIX}${model}:${voice}`,
    name: voice,
    description,
    sourceUploadId: "",
    language: "en",
    voiceType: "preset",
    presetEngine: "hosted",
    presetVoiceId: voice,
    defaultEngine: "hosted",
    sampleCount: 1,
    createdAt: null,
    updatedAt: null,
    hosted: true,
    raw: {},
  }));
}
export function hostedVoiceProfile(id) {
  return hostedVoiceProfiles().find((profile) => profile.id === id) || null;
}

// Wraps 16-bit little-endian PCM in a WAV header.
export function pcmToWav(pcm, sampleRate = 24000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Synthesizes one chunk of narration. Returns WAV bytes.
export async function synthesizeHostedVoice({ profileId, text, signal, fetchImpl = fetch, env = process.env }) {
  const key = String(env.OPENROUTER_API_KEY || "").trim();
  if (!key) throw new Error("Hosted voices aren't set up on this server.");
  const rest = String(profileId).slice(PREFIX.length);
  const split = rest.lastIndexOf(":");
  const model = split > 0 ? rest.slice(0, split) : MODEL();
  const voice = split > 0 ? rest.slice(split + 1) : rest;
  // Gemini voices return raw PCM only; other providers can return MP3.
  const format = /gemini/i.test(model) ? "pcm" : "mp3";
  const timeout = AbortSignal.timeout(3 * 60 * 1000);
  const response = await fetchImpl("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.APP_URL || "https://autoyt.cc",
      "X-OpenRouter-Title": "AutoYT",
    },
    body: JSON.stringify({ model, input: String(text).slice(0, 5000), voice, response_format: format }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replaceAll(key, "[redacted]");
    let message = detail;
    try {
      message = JSON.parse(detail)?.error?.message || detail;
    } catch {}
    throw new Error(`Voice generation failed (${response.status}): ${String(message).replace(/\s+/g, " ").slice(0, 240)}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 200) throw new Error("The voice model returned no audio. Try again.");
  if (format === "mp3") return { audio: bytes, extension: "mp3", contentType: "audio/mpeg" };
  const type = response.headers.get("content-type") || "";
  const rate = Number(type.match(/rate=(\d+)/)?.[1]) || 24000;
  const channels = Number(type.match(/channels=(\d+)/)?.[1]) || 1;
  return { audio: pcmToWav(bytes, rate, channels), extension: "wav", contentType: "audio/wav" };
}

// Text to Speech plays generations from a URL, so hosted audio is kept on disk.
const storeDir = () => path.join(os.tmpdir(), "autoyt", "hosted-tts");
export async function storeHostedAudio(result) {
  await fsp.mkdir(storeDir(), { recursive: true });
  const id = `hosted-${crypto.randomUUID()}`;
  await fsp.writeFile(path.join(storeDir(), `${id}.${result.extension}`), result.audio);
  return id;
}
export function hostedAudioFile(id) {
  if (!/^hosted-[a-f0-9-]{36}$/.test(String(id || ""))) return null;
  for (const extension of ["wav", "mp3"]) {
    const file = path.join(storeDir(), `${id}.${extension}`);
    if (fs.existsSync(file)) return { file, contentType: extension === "wav" ? "audio/wav" : "audio/mpeg" };
  }
  return null;
}
