// Voicebox: routes under /api/voicebox, moved out of server.js along with the
// helpers only they use. Everything else they need comes in through `deps`.
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { isHostedVoice, synthesizeHostedVoice, hostedAudioFile } from "./hostedVoices.js";
import { visibleVoices, claimVoice, releaseVoice } from "./voiceOwners.js";
import { generateVoiceName } from "../src/utils/voiceNames.js";
import { spawn } from "child_process";

export function registerVoicebox(app, deps) {
  const {
    extractAudioForTranscription,
    findVoiceboxProfile,
    generateVoiceboxSpeech,
    listAllVoiceProfiles,
    normalizeVoiceboxEngine,
    normalizeVoiceboxProfile,
    runLocalWhisperTranscription,
    runtimeTmpRoot,
    takenVoiceNames,
    voiceOwnerUser,
    voiceUser,
    voiceboxFetch,
    voiceboxJson,
    voiceboxProfileIsReady,
  } = deps;

  // Voice previews. A cloned voice plays its own reference clip (instant, free);
  // preset and hosted voices speak one short line, generated once and cached.
  const VOICE_PREVIEW_LINE = "Here's how I sound narrating your next video. Clear, steady, and ready when you are.";

  const voicePreviewJobs = new Map();

  function voicePreviewDir() {
      return path.join(runtimeTmpRoot, "voice-previews");
  }

  async function voicePreviewFile(profile) {
      const key = crypto.createHash("sha256").update(`${profile.id}|${profile.sampleCount || 0}|${VOICE_PREVIEW_LINE}`).digest("hex").slice(0, 32);
      for (const extension of ["wav", "mp3"]) {
          const file = path.join(voicePreviewDir(), `${key}.${extension}`);
          if (fs.existsSync(file) && fs.statSync(file).size > 0)
              return file;
      }
      if (voicePreviewJobs.has(key))
          return voicePreviewJobs.get(key);
      const job = (async () => {
          fs.mkdirSync(voicePreviewDir(), { recursive: true });
          const write = (bytes, contentType) => {
              if (!bytes?.length)
                  throw new Error("The voice preview came back empty.");
              const file = path.join(voicePreviewDir(), `${key}.${/mpeg|mp3/i.test(contentType || "") ? "mp3" : "wav"}`);
              fs.writeFileSync(file, bytes);
              return file;
          };
          if (isHostedVoice(profile.id)) {
              const hosted = await synthesizeHostedVoice({ profileId: profile.id, text: VOICE_PREVIEW_LINE });
              return write(hosted.audio, hosted.extension === "mp3" ? "audio/mpeg" : "audio/wav");
          }
          if (String(profile.voiceType || "").toLowerCase() === "cloned") {
              const { data } = await voiceboxJson(`/profiles/${encodeURIComponent(profile.id)}/samples`, { method: "GET" });
              const sample = Array.isArray(data) ? data.find((item) => item?.id) : null;
              if (sample) {
                  const { response } = await voiceboxFetch(`/samples/${encodeURIComponent(sample.id)}`, { method: "GET" });
                  if (response.ok)
                      return write(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type"));
              }
          }
          const generated = await generateVoiceboxSpeech({ profileId: profile.id, profile, text: VOICE_PREVIEW_LINE, timeoutMs: 180000 });
          const id = String(generated.generation?.id || "");
          const { response } = await voiceboxFetch(`/audio/${encodeURIComponent(id)}`, { method: "GET" });
          if (!response.ok)
              throw new Error("The voice preview could not be downloaded.");
          return write(Buffer.from(await response.arrayBuffer()), response.headers.get("content-type"));
      })();
      voicePreviewJobs.set(key, job);
      try {
          return await job;
      }
      finally {
          voicePreviewJobs.delete(key);
      }
  }

      // Public on purpose (health checks): it says only whether the service is up, never where it is.
      app.get("/api/voicebox/status", async (_req, res) => {
          try {
              await voiceboxJson("/profiles", { method: "GET" });
              res.json({ online: true });
          }
          catch (error) {
              res.status(503).json({ online: false, error: "The voice cloning service is offline right now." });
          }
      });
      app.get("/api/voicebox/profiles", async (req, res) => {
          const userId = await voiceUser(req, res);
          if (!userId)
              return;
          try {
              const { profiles: all, voiceboxOnline } = await listAllVoiceProfiles();
              const profiles = await visibleVoices(all, userId);
              res.json({ success: true, baseUrl: voiceboxOnline ? "voicebox" : "hosted", voiceboxOnline, profiles });
          }
          catch (error) {
              res.status(503).json({ success: false, profiles: [], error: error instanceof Error ? error.message : "Voices are unavailable" });
          }
      });
      app.get("/api/voicebox/profiles/:id/preview", async (req, res) => {
          if (!(await voiceOwnerUser(req, res, String(req.params.id || "").trim())))
              return;
          try {
              const id = String(req.params.id || "").trim();
              // Only known voices, so previews can't be used as a free TTS endpoint.
              const profile = id ? await findVoiceboxProfile(id) : null;
              if (!profile)
                  return res.status(404).json({ error: "That voice is no longer available." });
              if (!voiceboxProfileIsReady(profile))
                  return res.status(409).json({ error: "Add a voice sample before previewing this cloned voice." });
              const file = await voicePreviewFile(profile);
              res.setHeader("Cache-Control", "private, max-age=86400");
              res.type(file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav");
              res.sendFile(file);
          }
          catch (error) {
              console.error("Voice preview failed:", error instanceof Error ? error.message : error);
              res.status(503).json({ error: error instanceof Error ? error.message : "Voice preview is unavailable right now." });
          }
      });
      app.post("/api/voicebox/profiles", async (req, res) => {
          const userId = await voiceUser(req, res);
          if (!userId)
              return;
          try {
              const name = String(req.body?.name || "").trim() || generateVoiceName(await takenVoiceNames());
              const voiceType = String(req.body?.voiceType || req.body?.voice_type || "cloned").trim() || "cloned";
              const presetEngine = normalizeVoiceboxEngine(req.body?.presetEngine || req.body?.preset_engine || "");
              const defaultEngine = normalizeVoiceboxEngine(req.body?.defaultEngine || req.body?.default_engine || presetEngine || "");
              const payload = {
                  name: name.slice(0, 100),
                  description: String(req.body?.description || "").trim() || null,
                  language: String(req.body?.language || "en").trim() || "en",
                  voice_type: voiceType,
              };
              if (presetEngine)
                  payload.preset_engine = presetEngine;
              if (req.body?.presetVoiceId || req.body?.preset_voice_id)
                  payload.preset_voice_id = String(req.body?.presetVoiceId || req.body?.preset_voice_id || "").trim();
              if (defaultEngine)
                  payload.default_engine = defaultEngine;
              if (req.body?.personality)
                  payload.personality = String(req.body.personality).trim();
              const { data, base } = await voiceboxJson("/profiles", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(payload),
              });
              const profile = normalizeVoiceboxProfile(data);
              if (profile.id)
                  await claimVoice(profile.id, userId);
              res.json({ success: true, baseUrl: base, profile: { ...profile, owned: true } });
          }
          catch (error) {
              res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice profile creation failed" });
          }
      });
      app.patch("/api/voicebox/profiles/:id", async (req, res) => {
          if (!(await voiceOwnerUser(req, res, String(req.params.id || "").trim())))
              return;
          try {
              const profileId = String(req.params.id || "").trim();
              const name = String(req.body?.name || "").trim();
              if (!profileId)
                  return res.status(400).json({ success: false, error: "Voice profile ID is required." });
              if (!name)
                  return res.status(400).json({ success: false, error: "Voice name is required." });
              const payload = {
                  name: name.slice(0, 100),
              };
              if (req.body?.description !== undefined)
                  payload.description = String(req.body.description || "").trim() || null;
              let updated = null;
              let baseUrl = "";
              try {
                  const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                  });
                  updated = data;
                  baseUrl = base;
              }
              catch (patchError) {
                  const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify(payload),
                  });
                  updated = data;
                  baseUrl = base;
              }
              res.json({ success: true, baseUrl, profile: normalizeVoiceboxProfile(updated || { id: profileId, ...payload }) });
          }
          catch (error) {
              res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice profile rename failed" });
          }
      });
      app.delete("/api/voicebox/profiles/:id", async (req, res) => {
          if (!(await voiceOwnerUser(req, res, String(req.params.id || "").trim())))
              return;
          try {
              const profileId = String(req.params.id || "").trim();
              if (!profileId)
                  return res.status(400).json({ success: false, error: "Voice profile ID is required." });
              const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}`, { method: "DELETE" });
              await releaseVoice(profileId);
              res.json({ success: true, baseUrl: base, deleted: true, profile: data || { id: profileId } });
          }
          catch (error) {
              res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice profile deletion failed" });
          }
      });
      app.post("/api/voicebox/profiles/:id/samples", async (req, res) => {
          if (!(await voiceOwnerUser(req, res, String(req.params.id || "").trim())))
              return;
          const tempFiles = [];
          try {
              const profileId = String(req.params.id || "").trim();
              let referenceText = String(req.body?.referenceText || req.body?.reference_text || "").trim();
              const audioBase64 = String(req.body?.audioBase64 || "").trim();
              const filename = String(req.body?.filename || "voice-sample.wav").replace(/[^\w.\-]+/g, "-").slice(0, 120);
              const mimeType = String(req.body?.mimeType || "audio/wav").trim();
              if (!profileId)
                  return res.status(400).json({ success: false, error: "Voice profile ID is required." });
              if (!audioBase64)
                  return res.status(400).json({ success: false, error: "Audio sample is required." });
              let audioBuffer = Buffer.from(audioBase64, "base64");
              if (!audioBuffer.length)
                  return res.status(400).json({ success: false, error: "Audio sample is empty." });
              let uploadName = filename;
              let uploadType = mimeType;
              if (req.body?.removeNoise) {
                  // Cuts rumble and hiss, then applies FFT denoising before the sample is cloned.
                  const tmpDir = runtimeTmpRoot;
                  if (!fs.existsSync(tmpDir))
                      fs.mkdirSync(tmpDir, { recursive: true });
                  const noisyId = crypto.randomBytes(16).toString("hex");
                  const noisyPath = path.join(tmpDir, `${noisyId}${path.extname(filename) || ".audio"}`);
                  const cleanPath = path.join(tmpDir, `${noisyId}-clean.wav`);
                  fs.writeFileSync(noisyPath, audioBuffer);
                  tempFiles.push(noisyPath, cleanPath);
                  await new Promise((resolve, reject) => {
                      const child = spawn(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-i", noisyPath, "-vn", "-af", "highpass=f=70,lowpass=f=12000,afftdn=nr=12:nf=-30,loudnorm=I=-18:TP=-2", "-ac", "1", "-ar", "44100", cleanPath], { stdio: ["ignore", "ignore", "pipe"] });
                      let stderr = "";
                      child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-1500); });
                      child.on("error", reject);
                      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Noise removal failed: ${stderr.slice(-300)}`)));
                  });
                  audioBuffer = fs.readFileSync(cleanPath);
                  uploadName = filename.replace(/\.[^.]+$/, "") + "-clean.wav";
                  uploadType = "audio/wav";
              }
              if (!referenceText) {
                  const tmpDir = runtimeTmpRoot;
                  if (!fs.existsSync(tmpDir))
                      fs.mkdirSync(tmpDir, { recursive: true });
                  const sampleId = crypto.randomBytes(16).toString("hex");
                  const ext = path.extname(uploadName) || (uploadType.includes("mpeg") ? ".mp3" : uploadType.includes("mp4") ? ".m4a" : ".wav");
                  const samplePath = path.join(tmpDir, `${sampleId}${ext}`);
                  const normalizedAudioPath = path.join(tmpDir, `${sampleId}.wav`);
                  fs.writeFileSync(samplePath, audioBuffer);
                  tempFiles.push(samplePath, normalizedAudioPath);
                  await extractAudioForTranscription(samplePath, normalizedAudioPath);
                  const transcript = await runLocalWhisperTranscription(normalizedAudioPath);
                  if (!transcript?.success || !String(transcript.text || "").trim()) {
                      throw new Error(transcript?.error || "Could not detect speech in this voice sample.");
                  }
                  referenceText = String(transcript.text || "").trim();
              }
              const form = new globalThis.FormData();
              form.append("reference_text", referenceText);
              form.append("file", new Blob([audioBuffer], { type: uploadType }), uploadName);
              const { data, base } = await voiceboxJson(`/profiles/${encodeURIComponent(profileId)}/samples`, {
                  method: "POST",
                  body: form,
              });
              res.json({ success: true, baseUrl: base, sample: data, referenceText });
          }
          catch (error) {
              res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice sample upload failed" });
          }
          finally {
              for (const file of tempFiles) {
                  if (file && fs.existsSync(file)) {
                      try { fs.unlinkSync(file); } catch (_error) {}
                  }
              }
          }
      });
      app.post("/api/voicebox/generate", async (req, res) => {
          if (!(await voiceOwnerUser(req, res, String(req.body?.profileId || req.body?.profile_id || "").trim())))
              return;
          try {
              const profileId = String(req.body?.profileId || req.body?.profile_id || "").trim();
              const text = String(req.body?.text || "").trim();
              if (!profileId)
                  return res.status(400).json({ success: false, error: "Select a voice before generating audio." });
              if (!text)
                  return res.status(400).json({ success: false, error: "Text is required." });
              const generated = await generateVoiceboxSpeech({ ...req.body, profileId, text });
              res.json({
                  success: true,
                  pending: generated.pending,
                  baseUrl: generated.baseUrl,
                  generation: generated.generation,
                  audioUrl: generated.audioUrl,
              });
          }
          catch (error) {
              res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Speech generation failed" });
          }
      });
      app.get("/api/voicebox/history/:id", async (req, res) => {
          if (!(await voiceUser(req, res)))
              return;
          try {
              const id = String(req.params.id || "").trim();
              if (!id)
                  return res.status(400).json({ success: false, error: "Generation ID is required." });
              const { data, base } = await voiceboxJson(`/history/${encodeURIComponent(id)}`, { method: "GET" });
              res.json({ success: true, baseUrl: base, generation: data, audioUrl: `/api/voicebox/audio/${encodeURIComponent(id)}` });
          }
          catch (error) {
              res.status(503).json({ success: false, error: error instanceof Error ? error.message : "Voice generation status unavailable" });
          }
      });
      app.get("/api/voicebox/audio/:id", async (req, res) => {
          if (!(await voiceUser(req, res)))
              return;
          try {
              const id = String(req.params.id || "").trim();
              if (!id)
                  return res.status(400).json({ error: "Generation ID is required." });
              if (id.startsWith("hosted-")) {
                  const hosted = hostedAudioFile(id);
                  if (!hosted)
                      return res.status(404).json({ error: "Generated audio is no longer available" });
                  res.setHeader("Content-Type", hosted.contentType);
                  res.setHeader("Cache-Control", "private, max-age=3600");
                  return res.sendFile(hosted.file);
              }
              const { response } = await voiceboxFetch(`/audio/${encodeURIComponent(id)}`, { method: "GET" });
              if (!response.ok)
                  return res.status(response.status).json({ error: "Generated audio unavailable" });
              const audioBuffer = Buffer.from(await response.arrayBuffer());
              const size = audioBuffer.length;
              if (!size)
                  return res.status(404).json({ error: "Generated audio is empty" });
              const contentType = response.headers.get("content-type") || "audio/wav";
              const disposition = response.headers.get("content-disposition") || `inline; filename="generation_${id}.wav"`;
              res.setHeader("Accept-Ranges", "bytes");
              res.setHeader("Content-Type", contentType);
              res.setHeader("Content-Disposition", disposition.replace(/^attachment/i, "inline"));
              res.setHeader("Cache-Control", "public, max-age=3600");
              const range = String(req.headers.range || "").trim();
              if (range) {
                  const match = range.match(/^bytes=(\d*)-(\d*)$/);
                  if (!match)
                      return res.status(416).setHeader("Content-Range", `bytes */${size}`).end();
                  let start = match[1] ? Number(match[1]) : NaN;
                  let end = match[2] ? Number(match[2]) : NaN;
                  if (!Number.isFinite(start) && Number.isFinite(end)) {
                      start = Math.max(0, size - end);
                      end = size - 1;
                  }
                  if (Number.isFinite(start) && !Number.isFinite(end))
                      end = size - 1;
                  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
                      res.setHeader("Content-Range", `bytes */${size}`);
                      return res.status(416).end();
                  }
                  end = Math.min(end, size - 1);
                  const chunk = audioBuffer.subarray(start, end + 1);
                  res.status(206);
                  res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
                  res.setHeader("Content-Length", String(chunk.length));
                  return res.end(chunk);
              }
              res.status(200);
              res.setHeader("Content-Length", String(size));
              res.end(audioBuffer);
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Generated audio unavailable" });
          }
      });
}
