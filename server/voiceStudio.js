// VoiceStudio: routes under /api/automation/voice, moved out of server.js along with the
// helpers only they use. Everything else they need comes in through `deps`.
import { inferMusicMood, normalizeOpenverseTrack, pixabayMusicSearchUrl } from "../src/utils/royaltyFreeMusic.js";
import { avatarProviderStatus } from "../src/utils/avatarRemake.js";
import { openRouterConfigured } from "../src/utils/openRouterClient.js";
import { resolveAvatarMedia } from "../src/utils/avatarMedia.js";
import path from "path";
import fs from "fs";

export function registerVoiceStudio(app, deps) {
  const {
    captionCleanupRuntime,
    cleanupVoiceStudioFiles,
    getSessionRecord,
    listAllVoiceProfiles,
    listNarrationStyles,
    loadVoiceStudioJob,
    publicVoiceStudioJob,
    reconcileVoiceStudioJob,
    stopVoiceStudioJob,
    voiceMusicUrlAllowed,
    voiceStudioRootDir,
  } = deps;

  function captionCleanupStatus() {
      const runtime = captionCleanupRuntime();
      return {
          available: runtime.available,
          engine: runtime.engine,
          external: true,
          requiresCredits: true,
          reason: runtime.reason,
      };
  }

  function voiceMusicMoodFromRequest(query, transcript) {
      const requested = String(query || "").trim();
      const inferred = inferMusicMood(transcript || requested);
      return requested ? { ...inferred, query: requested } : inferred;
  }

      app.get("/api/automation/voice/status", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              try {
                  const { profiles, voiceboxOnline } = await listAllVoiceProfiles();
                  res.json({ online: true, voiceboxOnline, profiles, stemEngine: process.env.DEMUCS_PATH ? "AI stem separation" : "Center-channel extraction", captionCleanup: captionCleanupStatus(), avatarProviders: avatarProviderStatus(), openRouter: { configured: openRouterConfigured() } });
              }
              catch (error) {
                  res.json({ online: false, profiles: [], stemEngine: process.env.DEMUCS_PATH ? "AI stem separation" : "Center-channel extraction", captionCleanup: captionCleanupStatus(), avatarProviders: avatarProviderStatus(), openRouter: { configured: openRouterConfigured() }, error: error instanceof Error ? error.message : "Voicebox is unavailable" });
              }
          }
          catch (error) {
              res.status(500).json({ error: error instanceof Error ? error.message : "Could not load Voice Studio status" });
          }
      });
      app.get("/api/automation/voice/music/search", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const mood = voiceMusicMoodFromRequest(req.query.mood, req.query.transcript);
              let query = String(req.query.q || mood.query).trim().slice(0, 100) || "cinematic instrumental";
              // Openverse category=music often returns 0 for long mood phrases like "… background music".
              query = query.replace(/\s+background\s+music\s*$/i, "").trim() || "cinematic instrumental";
              const page = Math.max(1, Math.min(10, Number(req.query.page) || 1));
              async function searchOpenverse(searchQuery, useCategory) {
                  const url = new URL("https://api.openverse.org/v1/audio/");
                  url.searchParams.set("q", searchQuery);
                  if (useCategory) url.searchParams.set("category", "music");
                  url.searchParams.set("license", "cc0,by");
                  url.searchParams.set("page", String(page));
                  url.searchParams.set("page_size", "12");
                  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "Autoyt Voice Studio/1.0" } });
                  if (!response.ok)
                      throw new Error(`Openverse returned HTTP ${response.status}.`);
                  return response.json();
              }
              let payload = await searchOpenverse(query, true);
              if (!(Array.isArray(payload?.results) ? payload.results : []).length) {
                  const shortened = query.replace(/\s+instrumental\s*$/i, "").trim() || query;
                  if (shortened !== query) payload = await searchOpenverse(shortened, true);
              }
              if (!(Array.isArray(payload?.results) ? payload.results : []).length) {
                  payload = await searchOpenverse(query, false);
              }
              const tracks = (Array.isArray(payload?.results) ? payload.results : []).map(normalizeOpenverseTrack).filter(Boolean).filter((track) => voiceMusicUrlAllowed(track.url));
              res.json({ query, mood, page, pageCount: Number(payload?.page_count || 1), resultCount: Number(payload?.result_count || tracks.length), tracks, providers: [{ id: "openverse", label: "Openverse", kind: "in-app", license: "CC0 or CC BY", url: "https://openverse.org/audio" }, { id: "pixabay", label: "Pixabay Music", kind: "external", url: pixabayMusicSearchUrl(query), note: "Pixabay has no public music API; download a track there, then import it below." }] });
          }
          catch (error) {
              res.status(502).json({ error: error instanceof Error ? error.message : "Could not search royalty-free music" });
          }
      });
      app.get("/api/automation/voice/narration-styles", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user) return res.status(401).json({ error: "Sign in required" });
              res.json({ styles: listNarrationStyles(session.user.id) });
          } catch (error) { res.status(500).json({ error: error instanceof Error ? error.message : "Could not load narration styles" }); }
      });
      app.get("/api/automation/voice/jobs/:id", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              cleanupVoiceStudioFiles();
              const job = loadVoiceStudioJob(req.params.id);
              if (!job || job.userId !== session.user.id)
                  return res.status(404).json({ error: "Voice Studio job not found" });
              res.json({ job: publicVoiceStudioJob(reconcileVoiceStudioJob(job)) });
          }
          catch (error) {
              res.status(500).json({ error: error instanceof Error ? error.message : "Could not load Voice Studio job" });
          }
      });
      app.post("/api/automation/voice/jobs/:id/stop", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const job = loadVoiceStudioJob(req.params.id);
              if (!job || job.userId !== session.user.id)
                  return res.status(404).json({ error: "Voice Studio job not found" });
              res.json({ job: publicVoiceStudioJob(stopVoiceStudioJob(job)) });
          }
          catch (error) {
              res.status(500).json({ error: error instanceof Error ? error.message : "Could not stop Voice Studio job" });
          }
      });
      app.get("/api/automation/voice/avatar-input/:token", (req, res) => {
          const filePath = resolveAvatarMedia(req.params.token, path.join(voiceStudioRootDir(), "provider-inputs"));
          res.setHeader("Cache-Control", "private, no-store");
          res.setHeader("X-Robots-Tag", "noindex, nofollow");
          if (!filePath) return res.status(404).end();
          res.type("audio/mpeg").sendFile(filePath);
      });
      app.get("/api/automation/voice/files/:name", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const filename = path.basename(String(req.params.name || ""));
              if (!/^voice_[a-zA-Z0-9-]+\.(mp4|wav|mp3|m4a|srt)$/i.test(filename))
                  return res.status(400).json({ error: "Invalid media file" });
              const filePath = path.join(voiceStudioRootDir(), filename);
              if (!fs.existsSync(filePath))
                  return res.status(404).json({ error: "Media file expired or was not found" });
              res.setHeader("Cache-Control", "private, max-age=3600");
              res.sendFile(filePath);
          }
          catch (error) {
              res.status(500).json({ error: error instanceof Error ? error.message : "Could not load media file" });
          }
      });
}
