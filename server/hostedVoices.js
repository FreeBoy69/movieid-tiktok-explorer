// Hosted narration voices.
//
// Voicebox (the local TTS server with cloning) ran next to the app on the old
// VPS. The LingCode hosted app has no Voicebox, so these voices come from
// OpenRouter's speech API instead. They behave like Voicebox preset voices:
// same profile shape, same generate() result, and audio saved as WAV so the
// existing trim, concat, and alignment steps keep working. Voice cloning still
// needs Voicebox.
import crypto from "node:crypto";
import { aiProviderChain } from "../src/utils/openRouterClient.js";
import { guardUsage, meterUsage } from "../src/utils/usageMeter.js";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MODEL = () => String(process.env.OPENROUTER_TTS_MODEL || "google/gemini-3.1-flash-tts-preview").trim();
const PREFIX = "openrouter:";
// Gemini TTS prebuilt voices with their published character, apparent gender, and the
// person's name users see. The Gemini voice name stays the engine ID.
const VOICES = [
  ["Charon", "Informative, steady documentary narrator", "m", "Graham Whitley"],
  ["Kore", "Firm and confident", "f", "Elena Marsh"],
  ["Orus", "Firm, lower register", "m", "Victor Langford"],
  ["Iapetus", "Clear and even", "m", "Owen Ellison"],
  ["Algieba", "Smooth and warm", "m", "Julian Ashford"],
  ["Gacrux", "Mature and measured", "f", "Margot Hensley"],
  ["Rasalgethi", "Informative, explainer tone", "m", "Simon Prescott"],
  ["Puck", "Upbeat and lively", "m", "Theo Calloway"],
  ["Fenrir", "Excitable, high energy", "m", "Miles Donovan"],
  ["Aoede", "Breezy and relaxed", "f", "June Harlow"],
  ["Zephyr", "Bright and friendly", "f", "Ruby Sinclair"],
  ["Enceladus", "Breathy, intimate storytelling", "m", "Silas Thornton"],
  ["Leda", "Youthful", "f", "Mila Fairchild"],
  ["Callirrhoe", "Easy-going", "f", "Hazel Monroe"],
  ["Autonoe", "Bright", "f", "Iris Delaney"],
  ["Despina", "Smooth", "f", "Clara Whitaker"],
  ["Erinome", "Clear", "f", "Naomi Bennett"],
  ["Laomedeia", "Upbeat", "f", "Zara Oakley"],
  ["Achernar", "Soft", "f", "Lena Holloway"],
  ["Pulcherrima", "Forward", "f", "Vera Kingsley"],
  ["Vindemiatrix", "Gentle", "f", "Rosa Abbott"],
  ["Sadachbia", "Lively", "f", "Freya Lockhart"],
  ["Sulafat", "Warm", "f", "Amara Reyes"],
  ["Umbriel", "Easy-going", "m", "Rowan Everett"],
  ["Algenib", "Gravelly", "m", "Declan Maddox"],
  ["Alnilam", "Firm", "m", "Marcus Hale"],
  ["Schedar", "Even", "m", "Elliot Vaughn"],
  ["Achird", "Friendly", "m", "Caleb Winslow"],
  ["Zubenelgenubi", "Casual", "m", "Hugo Navarro"],
  ["Sadaltager", "Knowledgeable", "m", "Arthur Pembroke"],
];

export function hostedVoicesAvailable(env = process.env) {
  return Boolean(String(env.OPENROUTER_API_KEY || "").trim() || String(env.OPENROUTER_API_KEY_BACKUP || "").trim());
}
export function isHostedVoice(id) {
  return String(id || "").startsWith(PREFIX);
}
export function hostedVoiceProfiles(env = process.env) {
  if (!hostedVoicesAvailable(env)) return [];
  const model = MODEL();
  return VOICES.map(([voice, description, gender, displayName]) => ({
    id: `${PREFIX}${model}:${voice}`,
    name: displayName,
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
    gender,
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
export async function synthesizeHostedVoice({ profileId, text, direction = "", signal = undefined, fetchImpl = fetch, env = process.env }) {
  const chain = aiProviderChain(env);
  if (!chain.length) throw new Error("Hosted voices aren't set up on this server.");
  const rest = String(profileId).slice(PREFIX.length);
  const split = rest.lastIndexOf(":");
  const model = split > 0 ? rest.slice(0, split) : MODEL();
  const voice = split > 0 ? rest.slice(split + 1) : rest;
  // Gemini voices return raw PCM only; other providers can return MP3.
  const format = /gemini/i.test(model) ? "pcm" : "mp3";
  // Gemini TTS reads a leading natural-language direction ("Say warmly: …") as
  // delivery, not as words to speak; other models take OpenAI-style instructions.
  const style = String(direction || "").trim().slice(0, 300);
  const spoken = String(text).slice(0, 5000);
  const payload = { model, input: style && /gemini/i.test(model) ? `${style}: ${spoken}` : spoken, voice, response_format: format };
  if (style && !/gemini/i.test(model)) payload.instructions = style;
  let response;
  let providerName = "openrouter";
  for (const provider of chain) {
    await guardUsage(provider.provider, { operation: "speech", model });
    const timeout = AbortSignal.timeout(3 * 60 * 1000);
    const attempt = await fetchImpl(`${provider.base}/audio/speech`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${provider.key}`,
        "Content-Type": "application/json",
        ...provider.headers,
      },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (attempt.ok) {
      response = attempt;
      providerName = provider.provider;
      break;
    }
    const detail = (await attempt.text().catch(() => "")).replaceAll(provider.key, "[redacted]");
    let message = detail;
    try {
      message = JSON.parse(detail)?.error?.message || detail;
    } catch {}
    const error = new Error(`Voice generation failed (${attempt.status}): ${String(message).replace(/\s+/g, " ").slice(0, 240)}`);
    if (provider === chain.at(-1)) throw error;
    console.warn(`[videorouter] speech fell back to OpenRouter: ${error.message}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 200) throw new Error("The voice model returned no audio. Try again.");
  meterUsage({ provider: providerName, model, operation: "speech", units: Math.max(1, Math.ceil(String(text).length / 1000)) });
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
