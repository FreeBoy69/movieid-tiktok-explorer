// Create Drama production pipeline: its own steps, not Create Video's.
//
// Series level (locked once, reused by every episode):
//   character sheets (GPT Image 2, 8-panel), location sheets, and one voice per
//   character (a Voicebox clone, a preset, or a voice designed from a prompt).
// Episode level:
//   screenplay (scenes of beats) -> per scene: storyboard grid (GPT Image 2),
//   voiced dialogue track (each line in its character's voice), Seedance clip
//   driven by the sheets + grid + the dialogue audio -> final cut (clips, the
//   original voice track, burned subtitles).
//
// Work runs in-process, one runner per step, with status kept on the project
// so the editor can poll it and a restart shows as "interrupted" instead of
// spinning forever. Seedance jobs keep their remote id and resume polling.
import crypto from "node:crypto";
import { guardUsage, meterUsage } from "../src/utils/usageMeter.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DRAMA_MODELS,
  MIN_CLIP_SECONDS,
  characterSheetPrompt,
  clipCostEstimate,
  designVoiceCandidates,
  dramaStyleBlock,
  isPhotorealStyle,
  locationSheetPrompt,
  modelReferencePrompt,
  normalizeScreenplay,
  refusedForFaces,
  sceneCharacters,
  sceneReferences,
  sceneTrackTimeline,
  screenplaySystemPrompt,
  seedancePrompt,
  storyboardPrompt,
  voiceDesignSystemPrompt,
} from "../src/utils/dramaProduction.js";
import { DRAMA_SERIES_SOURCE, episodeContext, speakerName } from "../src/utils/dramaTemplates.js";
import { ART_STYLE_PRESETS } from "../src/utils/creatorPipeline.js";
import { openRouterRequest } from "../src/utils/openRouterClient.js";
import { buildSubtitleCues, subtitlesAss, subtitlesSrt } from "../src/utils/voiceoverSubtitles.js";

export const DRAMA_EPISODE_SOURCE = "drama_episode";
const STALE_MS = 15 * 60 * 1000;
const runs = new Map();
const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
// What each scene output was made from, so edits mark it out of date.
export const boardBasis = (scene, cast, location) => fingerprint({ beats: scene.beats, summary: scene.summary, locationId: scene.locationId, cast: cast.map((c) => [c.id, c.appearance, c.outfit]), location: location?.description });
export const voiceBasis = (scene, voices) => fingerprint({ lines: scene.beats.map((b) => [b.id, b.speaker, b.line, b.emotion]), voices: scene.beats.map((b) => voices[b.speaker] || "") });

// Short-lived public links, so providers can fetch the dialogue audio.
const publicLinks = new Map();
const PUBLIC_TTL = 60 * 60 * 1000;

export function registerDramaProduction(app, ctx) {
  const { route, account, dependencies, fail, files } = ctx;
  const { directory, assetUrl, outputPath, ensureAsset, saveProject, command } = files;
  const ffmpeg = (args, signal) => command(process.env.FFMPEG_PATH || "ffmpeg", args, signal);
  const probeSeconds = async (file, signal) =>
    Number(JSON.parse(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "json", file], signal)).format?.duration) || 0;
  const assetName = (asset) => String(asset || "").split("/").pop();

  // ---------- project helpers ----------
  const load = async (userId, accountId, id, kind) => {
    const project = await dependencies.getProject(userId, id);
    const expected = kind === "series" ? DRAMA_SERIES_SOURCE : DRAMA_EPISODE_SOURCE;
    if (!project || project.status === "deleted" || project.accountId !== accountId || project.sourceType !== expected)
      throw fail(kind === "series" ? "Series not found" : "Episode not found", 404);
    return project;
  };
  const patch = async (userId, id, mutate) => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const current = await dependencies.getProject(userId, id);
      const metadata = structuredClone(current.metadata || {});
      const result = mutate(metadata, current);
      try {
        return await dependencies.updateProject(userId, id, {
          ...(result?.title ? { title: result.title } : {}),
          metadata,
          accountId: current.accountId,
          expectedVersion: current.version || 1,
        });
      } catch (error) {
        if (error.statusCode !== 409) throw error;
        await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1) + Math.random() * 100));
      }
    }
    throw fail("The project kept changing. Try again.", 409);
  };
  const setAt = (metadata, keys, value) => {
    let node = (metadata.production ||= {});
    for (const key of keys.slice(0, -1)) node = node[key] ||= {};
    const last = keys.at(-1);
    node[last] = typeof value === "function" ? value(node[last] || {}) : value;
  };
  const getAt = (metadata, keys) => keys.reduce((node, key) => node?.[key], metadata.production || {}) || {};

  // Runs one step in the background with its status on the project.
  async function startStep(userId, projectId, keys, work, { conflict = "This step is already running" } = {}) {
    const key = `${projectId}:${keys.join(".")}`;
    if (runs.has(key)) throw fail(conflict, 409);
    const controller = new AbortController();
    runs.set(key, controller);
    try {
      await patch(userId, projectId, (metadata) =>
        setAt(metadata, keys, (current) => ({ ...current, status: "running", error: "", progress: "", startedAt: Date.now() })),
      );
    } catch (error) {
      runs.delete(key);
      throw error;
    }
    const report = (progress) =>
      patch(userId, projectId, (metadata) => setAt(metadata, keys, (current) => ({ ...current, progress: String(progress).slice(0, 140) }))).catch(() => {});
    void (async () => {
      try {
        const result = await work({ signal: controller.signal, report });
        await patch(userId, projectId, (metadata) =>
          setAt(metadata, keys, (current) => ({ ...current, ...result, status: "ready", error: "", progress: "", finishedAt: Date.now() })),
        );
      } catch (error) {
        console.warn(`[drama] ${keys.join(".")} failed: ${error?.message}`);
        await patch(userId, projectId, (metadata) =>
          setAt(metadata, keys, (current) => ({ ...current, status: "failed", progress: "", error: String(error?.message || "Something went wrong").slice(0, 400) })),
        ).catch(() => {});
      } finally {
        runs.delete(key);
      }
    })();
  }
  // Steps a restart abandoned read as failed (a Seedance clip resumes instead).
  function settle(node, key) {
    if (!node || node.status !== "running" || runs.has(key)) return node;
    if (Date.now() - Number(node.startedAt || 0) < STALE_MS && node.remoteId) return node;
    if (Date.now() - Number(node.startedAt || 0) < 90 * 1000) return node;
    return node.remoteId ? node : { ...node, status: "failed", error: "This step was interrupted by a server restart. Run it again." };
  }

  // ---------- media helpers ----------
  async function renderImage(project, prompt, name, { references = [], aspect = "16:9", signal } = {}) {
    const refs = [];
    for (const file of references) {
      const jpg = `${file}.ref.jpg`;
      await ffmpeg(["-y", "-i", file, "-vf", "scale='min(1536,iw)':-2", "-q:v", "3", jpg], signal);
      refs.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${(await fs.readFile(jpg)).toString("base64")}` } });
    }
    const response = await openRouterRequest("/images", {
      signal,
      timeoutMs: 420000,
      body: { model: process.env.OPENROUTER_DRAMA_IMAGE_MODEL || DRAMA_MODELS.image, prompt, n: 1, aspect_ratio: aspect, ...(refs.length ? { input_references: refs } : {}) },
    });
    const image = response.data?.[0];
    if (!image?.b64_json) throw fail("The image model returned no image. Try again.");
    await fs.mkdir(directory(project.id), { recursive: true });
    await fs.writeFile(path.join(directory(project.id), name), Buffer.from(image.b64_json, "base64"));
    await saveProject(project.id);
    return assetUrl(project.id, name);
  }
  const localAsset = async (projectId, asset) => {
    const name = assetName(asset);
    const file = outputPath(projectId, name);
    if (!(await ensureAsset(projectId, name, file))) throw fail("A saved file is missing. Regenerate it.");
    return file;
  };
  // 3D-model versions of a sheet or storyboard for the video model, made once
  // per source image and kept under <keys>.model.
  const modelCopies = new Map();
  function modelCopy(userId, project, keys, source, kind, signal) {
    const saved = getAt(project.metadata || {}, [...keys, "model"]);
    if (saved.asset && saved.source === source) return Promise.resolve(saved.asset);
    const key = `${project.id}:${keys.join(".")}:${source}`;
    if (!modelCopies.has(key))
      modelCopies.set(
        key,
        (async () => {
          const file = await localAsset(project.id, source);
          const name = `model-${kind}-${keys[1]}-${crypto.randomUUID().slice(0, 8)}.png`;
          const asset = await renderImage(project, modelReferencePrompt(kind), name, { references: [file], aspect: kind === "storyboard" ? "9:16" : "16:9", signal });
          await patch(userId, project.id, (metadata) => setAt(metadata, [...keys, "model"], { asset, source }));
          return asset;
        })().finally(() => modelCopies.delete(key)),
      );
    return modelCopies.get(key);
  }
  // Live-action scenes send 3D-model references, except when a character came
  // from an uploaded photo: the video model's own rules decide real faces.
  const usesModelRefs = (series, parts, scene) =>
    parts.photoreal && !sceneCharacters(scene, parts.cast).some((id) => series.metadata?.production?.characters?.[id]?.photo);
  // Starts the 3D-model copies a scene will need, so its clip doesn't wait on them.
  function warmModelRefs(userId, episode, series, scene, boardAsset) {
    const parts = seriesParts(series);
    if (!usesModelRefs(series, parts, scene)) return;
    const jobs = sceneCharacters(scene, parts.cast)
      .filter((id) => parts.sheets[id])
      .map((id) => modelCopy(userId, series, ["characters", id], parts.sheets[id], "character"));
    if (boardAsset) jobs.push(modelCopy(userId, episode, ["scenes", scene.id, "board"], boardAsset, "storyboard"));
    for (const job of jobs) job.catch((error) => console.warn(`[drama] 3D reference for ${scene.id} failed: ${error?.message}`));
  }
  const projectOf = (asset) => decodeURIComponent(String(asset).split("/api/maker/projects/")[1]?.split("/")[0] || "");

  function publicUrl(file) {
    const base = String(process.env.APP_URL || process.env.PUBLIC_APP_URL || "");
    let origin;
    try {
      origin = new URL(base);
    } catch {}
    if (origin?.protocol !== "https:") throw fail("The server needs a public HTTPS address (APP_URL) before the video model can read the dialogue audio.", 503);
    const token = crypto.randomBytes(24).toString("hex");
    publicLinks.set(token, { file, expiresAt: Date.now() + PUBLIC_TTL });
    for (const [key, link] of publicLinks) if (link.expiresAt < Date.now()) publicLinks.delete(key);
    return new URL(`/api/drama/public/${token}/${encodeURIComponent(path.basename(file))}`, origin).href;
  }
  app.get("/api/drama/public/:token/:file", async (req, res) => {
    const link = publicLinks.get(String(req.params.token || ""));
    if (!link || link.expiresAt < Date.now() || path.basename(link.file) !== req.params.file) return res.status(404).end();
    res.sendFile(path.resolve(link.file));
  });

  async function voiceLine(project, text, profileId, instruct, file, signal) {
    const work = `${file}.work`;
    await fs.mkdir(work, { recursive: true });
    const result = await dependencies.narrate(text, work, { profileId, language: "en", instruct: String(instruct || "").slice(0, 200), signal });
    await ffmpeg(["-y", "-i", result.path, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", file], signal);
    await fs.rm(work, { recursive: true, force: true }).catch(() => {});
    return probeSeconds(file, signal);
  }

  async function generateVideo({ body, signal, onRemote, remoteId }) {
    let id = remoteId;
    if (!id) {
      const job = await openRouterRequest("/videos", { body, signal, timeoutMs: 180000 });
      id = job.id || job.data?.id;
      if (!id) throw fail("The video model did not start the job. Try again.");
      await onRemote(id);
    }
    const endpoint = `/videos/${encodeURIComponent(id)}`;
    for (let i = 0; i < 180; i++) {
      signal?.throwIfAborted();
      const status = await openRouterRequest(endpoint, { signal, timeoutMs: 60000 }).catch((error) => ({ status: "pending", pollError: error.message }));
      if (status.status === "completed") return { bytes: await openRouterRequest(`${endpoint}/content`, { binary: true, signal, timeoutMs: 300000 }), cost: status.usage?.cost };
      if (["failed", "cancelled", "canceled", "expired"].includes(status.status))
        throw fail(`The video model ${status.status} this scene: ${String(status.error?.message || status.error || "no reason given").slice(0, 300)}`);
      await new Promise((resolve) => setTimeout(resolve, 8000));
    }
    throw fail("The video model took too long. Run the scene again.");
  }

  // ---------- views ----------
  const seriesParts = (series) => {
    const drama = series.metadata?.drama || {};
    const production = series.metadata?.production || {};
    return {
      cast: drama.cast || [],
      locations: drama.locations || [],
      voices: drama.voices || {},
      style: dramaStyleBlock(drama.artStyleId, ART_STYLE_PRESETS),
      photoreal: isPhotorealStyle(drama.artStyleId, ART_STYLE_PRESETS),
      sheets: Object.fromEntries((drama.cast || []).map((c) => [c.id, production.characters?.[c.id]?.locked || ""]).filter(([, asset]) => asset)),
      locationSheets: Object.fromEntries((drama.locations || []).map((l) => [l.id, production.locations?.[l.id]?.locked || ""]).filter(([, asset]) => asset)),
    };
  };
  function seriesProductionView(series) {
    const production = series.metadata?.production || {};
    const settleMap = (map, prefix) =>
      Object.fromEntries(Object.entries(map || {}).map(([id, node]) => [id, settle(node, `${series.id}:${prefix}.${id}`)]));
    return {
      characters: settleMap(production.characters, "characters"),
      locations: settleMap(production.locations, "locations"),
      voices: settleMap(production.voices, "voices"),
    };
  }
  async function episodeView(episode, series, userId) {
    const production = episode.metadata?.production || {};
    const parts = seriesParts(series);
    const scenes = production.script?.scenes || [];
    const sceneState = {};
    for (const scene of scenes) {
      const state = production.scenes?.[scene.id] || {};
      const location = parts.locations.find((item) => item.id === scene.locationId);
      const board = settle(state.board, `${episode.id}:scenes.${scene.id}.board`);
      const voice = settle(state.voice, `${episode.id}:scenes.${scene.id}.voice`);
      const clip = settle(state.clip, `${episode.id}:scenes.${scene.id}.clip`);
      sceneState[scene.id] = {
        board: board ? { ...board, stale: Boolean(board.asset && board.basis !== boardBasis(scene, parts.cast, location)) } : null,
        voice: voice ? { ...voice, stale: Boolean(voice.asset && voice.basis !== voiceBasis(scene, parts.voices)) } : null,
        clip: clip ? { ...clip, stale: Boolean(clip.asset && (clip.boardAsset !== board?.asset || clip.voiceAsset !== voice?.asset)) } : null,
      };
      // A Seedance job a restart left behind picks its polling back up.
      if (clip?.status === "running" && clip.remoteId && !runs.has(`${episode.id}:scenes.${scene.id}.clip`))
        void resumeClip(userId, episode, scene.id).catch(() => {});
    }
    return {
      id: episode.id,
      title: episode.title,
      version: episode.version,
      status: episode.status,
      seriesId: series.id,
      seriesTitle: series.title,
      n: Number(episode.metadata?.drama?.episode) || 0,
      plan: (series.metadata?.drama?.episodes || []).find((item) => item.n === Number(episode.metadata?.drama?.episode)) || null,
      settings: { quality: "final", subtitles: true, ...(production.settings || {}) },
      script: { ...(settle(production.script, `${episode.id}:script`) || {}), scenes },
      scenes: sceneState,
      final: settle(production.final, `${episode.id}:final`) || null,
      cast: parts.cast.map((character) => ({ ...character, speaker: speakerName(character.name), sheet: parts.sheets[character.id] || "", voiceId: parts.voices[speakerName(character.name)] || "" })),
      locations: parts.locations.map((location) => ({ ...location, sheet: parts.locationSheets[location.id] || "" })),
      estimate: scenes.map((scene) => ({ id: scene.id, cost: clipCostEstimate(Math.min(30, Math.max(MIN_CLIP_SECONDS, sceneState[scene.id]?.voice?.seconds || 10)), production.settings?.quality || "final") })),
    };
  }

  // ---------- series: characters, locations, voices ----------
  const findCharacter = (series, id) => {
    const character = (series.metadata?.drama?.cast || []).find((item) => item.id === id);
    if (!character) throw fail("Character not found", 404);
    return character;
  };
  const findLocation = (series, id) => {
    const location = (series.metadata?.drama?.locations || []).find((item) => item.id === id);
    if (!location) throw fail("Location not found", 404);
    return location;
  };

  app.get(
    "/api/drama/series/:id/production",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      res.json({ production: seriesProductionView(series) });
    }),
  );

  app.post(
    "/api/drama/series/:id/characters/:cid/sheet",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const character = findCharacter(series, req.params.cid);
      if (!character.appearance && !series.metadata?.production?.characters?.[character.id]?.photo) throw fail(`Describe ${character.name}'s appearance first`);
      const count = Math.min(2, Math.max(1, Number(req.body?.count) || 2));
      const style = seriesParts(series).style;
      await startStep(session.user.id, series.id, ["characters", character.id], async ({ signal, report }) => {
        const photo = series.metadata?.production?.characters?.[character.id]?.photo;
        const references = photo ? [await localAsset(series.id, photo)] : [];
        const prompt = characterSheetPrompt(character, style, { photo: Boolean(photo) });
        const made = [];
        await Promise.all(
          Array.from({ length: count }, async (_, index) => {
            made.push(await renderImage(series, prompt, `char-${character.id}-${crypto.randomUUID().slice(0, 8)}.png`, { references, signal }));
            await report(`Drew ${made.length} of ${count} sheets`);
          }),
        );
        const current = (await dependencies.getProject(session.user.id, series.id)).metadata?.production?.characters?.[character.id] || {};
        return { candidates: [...made, ...(current.candidates || [])].slice(0, 8) };
      }, { conflict: `${character.name}'s sheets are already generating` });
      res.status(202).json({ ok: true });
    }),
  );
  app.post(
    "/api/drama/series/:id/characters/:cid/lock",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const character = findCharacter(series, req.params.cid);
      const asset = String(req.body?.asset || "");
      const state = series.metadata?.production?.characters?.[character.id] || {};
      if (asset && !(state.candidates || []).includes(asset)) throw fail("Choose one of this character's sheets");
      await patch(session.user.id, series.id, (metadata) => setAt(metadata, ["characters", character.id], (current) => ({ ...current, locked: asset })));
      // A live-action series gets the sheet's 3D-model copy ready before any clip needs it.
      if (asset && !state.photo && seriesParts(series).photoreal)
        modelCopy(session.user.id, series, ["characters", character.id], asset, "character").catch((error) => console.warn(`[drama] 3D reference for ${character.id} failed: ${error?.message}`));
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/drama/series/:id/characters/:cid/photo",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const character = findCharacter(series, req.params.cid);
      const type = String(req.body?.mediaType || "");
      if (!["image/png", "image/jpeg", "image/webp"].includes(type)) throw fail("Choose a PNG, JPEG, or WebP photo");
      const bytes = Buffer.from(String(req.body?.image || ""), "base64");
      if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw fail("Choose a photo smaller than 12 MB");
      const name = `photo-${character.id}-${crypto.randomUUID().slice(0, 8)}.${type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"}`;
      await fs.mkdir(directory(series.id), { recursive: true });
      await fs.writeFile(path.join(directory(series.id), name), bytes);
      await saveProject(series.id);
      await patch(session.user.id, series.id, (metadata) => setAt(metadata, ["characters", character.id], (current) => ({ ...current, photo: assetUrl(series.id, name) })));
      res.json({ ok: true });
    }),
  );
  app.post(
    "/api/drama/series/:id/locations/:lid/sheet",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const location = findLocation(series, req.params.lid);
      const style = seriesParts(series).style;
      await startStep(session.user.id, series.id, ["locations", location.id], async ({ signal }) => {
        const asset = await renderImage(series, locationSheetPrompt(location, style), `loc-${location.id}-${crypto.randomUUID().slice(0, 8)}.png`, { signal });
        const current = (await dependencies.getProject(session.user.id, series.id)).metadata?.production?.locations?.[location.id] || {};
        return { candidates: [asset, ...(current.candidates || [])].slice(0, 8), ...(current.locked ? {} : { locked: asset }) };
      }, { conflict: `${location.name} is already generating` });
      res.status(202).json({ ok: true });
    }),
  );
  app.post(
    "/api/drama/series/:id/locations/:lid/lock",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const location = findLocation(series, req.params.lid);
      const asset = String(req.body?.asset || "");
      if (asset && !(series.metadata?.production?.locations?.[location.id]?.candidates || []).includes(asset)) throw fail("Choose one of this location's sheets");
      await patch(session.user.id, series.id, (metadata) => setAt(metadata, ["locations", location.id], (current) => ({ ...current, locked: asset })));
      res.json({ ok: true });
    }),
  );

  // Voice design: a description becomes three candidate voices to preview.
  const designLine = (character) =>
    character.role
      ? `My name is ${String(character.name).split(" ")[0]}. You think you know who I am, but you have no idea what I'm capable of. Not yet.`
      : "You think you know me. You have no idea what I'm capable of.";
  // GPT Audio streams 24 kHz PCM; the chunks are joined into a WAV file.
  async function speakDesigned(description, voice, text, file, signal) {
    const key = String(process.env.OPENROUTER_API_KEY || "").trim();
    if (!key) throw fail("Voice design isn't set up on this server");
    const model = process.env.OPENROUTER_VOICE_DESIGN_MODEL || DRAMA_MODELS.voiceDesign;
    await guardUsage("openrouter", { operation: "speech", model });
    const timeout = AbortSignal.timeout(120000);
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": process.env.APP_URL || "https://autoyt.cc", "X-OpenRouter-Title": "AutoYT" },
      body: JSON.stringify({
        model,
        modalities: ["text", "audio"],
        audio: { voice, format: "pcm16" },
        stream: true,
        messages: [
          { role: "system", content: voiceDesignSystemPrompt(description) },
          { role: "user", content: text },
        ],
      }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw fail(`Voice design failed (${response.status}). Try again.`);
    const chunks = [];
    let usage = null;
    for (const line of (await response.text()).split("\n")) {
      if (!line.startsWith("data: ") || line.includes("[DONE]")) continue;
      try {
        const payload = JSON.parse(line.slice(6));
        if (payload.usage) usage = payload.usage;
        const audio = payload.choices?.[0]?.delta?.audio;
        if (audio?.data) chunks.push(Buffer.from(audio.data, "base64"));
      } catch {}
    }
    const pcm = Buffer.concat(chunks);
    if (pcm.length < 24000) throw fail("The voice model returned no audio. Try again.");
    meterUsage({ provider: "openrouter", model, operation: "speech", usage, units: usage ? 0 : 1 });
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(24000, 24);
    header.writeUInt32LE(48000, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.length, 40);
    await fs.writeFile(file, Buffer.concat([header, pcm]));
  }
  app.post(
    "/api/drama/series/:id/characters/:cid/voice-design",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const character = findCharacter(series, req.params.cid);
      const description = String(req.body?.description || character.voice || "").trim().slice(0, 600);
      if (description.length < 8) throw fail("Describe the voice first, e.g. age, accent, and manner");
      const text = String(req.body?.sample || designLine(character)).trim().slice(0, 300);
      await startStep(session.user.id, series.id, ["voices", character.id], async ({ signal, report }) => {
        const voices = designVoiceCandidates(`${description} ${character.role} ${character.appearance}`, 3);
        const candidates = [];
        await fs.mkdir(directory(series.id), { recursive: true });
        for (const voice of voices) {
          const name = `voice-${character.id}-${voice}-${crypto.randomUUID().slice(0, 6)}.wav`;
          await speakDesigned(description, voice, text, path.join(directory(series.id), name), signal);
          candidates.push({ asset: assetUrl(series.id, name), voice, text });
          await report(`Designed ${candidates.length} of ${voices.length} voices`);
        }
        await saveProject(series.id);
        return { description, candidates };
      }, { conflict: `${character.name}'s voices are already being designed` });
      res.status(202).json({ ok: true });
    }),
  );
  // Choosing a designed voice clones it in Voicebox so every line matches it.
  app.post(
    "/api/drama/series/:id/characters/:cid/voice-select",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const character = findCharacter(series, req.params.cid);
      const speaker = speakerName(character.name);
      const existing = String(req.body?.voiceId || "");
      if (existing) {
        await patch(session.user.id, series.id, (metadata) => {
          metadata.drama.voices = { ...(metadata.drama.voices || {}), [speaker]: existing };
        });
        return res.json({ ok: true, voiceId: existing });
      }
      const asset = String(req.body?.asset || "");
      const state = series.metadata?.production?.voices?.[character.id] || {};
      const candidate = (state.candidates || []).find((item) => item.asset === asset);
      if (!candidate) throw fail("Choose one of the designed voices");
      if (!dependencies.cloneVoice) throw fail("Voice cloning isn't available on this server");
      const file = await localAsset(series.id, asset);
      const profile = await dependencies.cloneVoice(`${series.title}: ${character.name}`.slice(0, 100), file, candidate.text);
      await patch(session.user.id, series.id, (metadata) => {
        metadata.drama.voices = { ...(metadata.drama.voices || {}), [speaker]: profile.id };
        setAt(metadata, ["voices", character.id], (current) => ({ ...current, selected: asset, profileId: profile.id }));
      });
      res.json({ ok: true, voiceId: profile.id });
    }),
  );
  // Hear any voice say the character's line before choosing it.
  app.post(
    "/api/drama/series/:id/characters/:cid/voice-preview",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await load(session.user.id, a.id, req.params.id, "series");
      const character = findCharacter(series, req.params.cid);
      const voiceId = String(req.body?.voiceId || "");
      if (!voiceId) throw fail("Choose a voice to preview");
      await fs.mkdir(directory(series.id), { recursive: true });
      const name = `preview-${character.id}-${crypto.randomUUID().slice(0, 8)}.wav`;
      await voiceLine(series, String(req.body?.text || designLine(character)).slice(0, 300), voiceId, "", path.join(directory(series.id), name), undefined);
      await saveProject(series.id);
      res.json({ asset: assetUrl(series.id, name) });
    }),
  );

  // ---------- episodes ----------
  const loadEpisode = async (req, session) => {
    const a = await account(req, session);
    const episode = await load(session.user.id, a.id, req.params.id, "episode");
    const series = await load(session.user.id, a.id, episode.metadata?.drama?.seriesId, "series");
    return { account: a, episode, series };
  };
  app.get(
    "/api/drama/episodes/:id",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      res.json({ episode: await episodeView(episode, series, session.user.id) });
    }),
  );
  app.patch(
    "/api/drama/episodes/:id",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      const body = req.body || {};
      if (body.expectedVersion && Number(body.expectedVersion) !== Number(episode.version))
        throw fail("This episode changed in another tab. Reload it and reapply your edits.", 409);
      const parts = seriesParts(series);
      const updated = await patch(session.user.id, episode.id, (metadata) => {
        if (body.scenes !== undefined) {
          const { scenes } = normalizeScreenplay({ scenes: body.scenes }, { speakers: parts.cast.map((c) => speakerName(c.name)), locations: parts.locations });
          setAt(metadata, ["script"], (current) => ({ ...current, scenes, status: current.status === "running" ? "running" : "ready", editedAt: Date.now() }));
        }
        if (body.settings && typeof body.settings === "object")
          setAt(metadata, ["settings"], (current) => ({
            ...current,
            ...(body.settings.quality ? { quality: body.settings.quality === "draft" ? "draft" : "final" } : {}),
            ...(body.settings.subtitles !== undefined ? { subtitles: Boolean(body.settings.subtitles) } : {}),
          }));
        return typeof body.title === "string" && body.title.trim() ? { title: body.title.trim().slice(0, 120) } : undefined;
      });
      res.json({ episode: await episodeView(updated, series, session.user.id) });
    }),
  );

  app.post(
    "/api/drama/episodes/:id/script",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      const parts = seriesParts(series);
      const n = Number(episode.metadata?.drama?.episode);
      const context = episodeContext(series, n);
      if (!context) throw fail("This episode is not in the series outline");
      const quality = episode.metadata?.production?.settings?.quality === "draft" ? "draft" : "final";
      const maxSceneSeconds = DRAMA_MODELS.video[quality].maxSeconds;
      const note = String(req.body?.note || "").slice(0, 1000);
      await startStep(session.user.id, episode.id, ["script"], async ({ signal }) => {
        const raw = await dependencies.text(
          screenplaySystemPrompt({ maxSceneSeconds }),
          JSON.stringify({
            drama: context,
            locations: parts.locations.map((location) => ({ id: location.id, name: location.name, description: location.description })),
            episodeSeconds: series.metadata?.drama?.episodeSeconds,
            creatorNote: note || undefined,
          }),
          { signal, maxTokens: 16000, reasoningEffort: "low", openRouterModel: process.env.OPENROUTER_DRAMA_MODEL || DRAMA_MODELS.text, timeoutMs: 240000 },
        );
        const { scenes } = normalizeScreenplay(JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")), {
          speakers: parts.cast.map((c) => speakerName(c.name)),
          locations: parts.locations,
        });
        if (scenes.length < 2) throw fail("The screenplay came back too short. Try again.");
        return { scenes, generatedAt: Date.now() };
      }, { conflict: "The screenplay is already being written" });
      res.status(202).json({ ok: true });
    }),
  );

  const sceneOf = (episode, sceneId) => {
    const scene = (episode.metadata?.production?.script?.scenes || []).find((item) => item.id === sceneId);
    if (!scene) throw fail("Scene not found", 404);
    return scene;
  };

  async function runBoard(userId, episode, series, sceneId) {
    const scene = sceneOf(episode, sceneId);
    const parts = seriesParts(series);
    const location = parts.locations.find((item) => item.id === scene.locationId);
    const ids = sceneCharacters(scene, parts.cast);
    const missing = parts.cast.filter((c) => ids.includes(c.id) && !parts.sheets[c.id]).map((c) => c.name);
    if (missing.length) throw fail(`Lock a character sheet for ${missing.join(", ")} first (series → Cast)`);
    await startStep(userId, episode.id, ["scenes", scene.id, "board"], async ({ signal }) => {
      const references = [];
      const refs = { characters: {}, location: 0 };
      for (const id of ids) {
        references.push(await localAsset(series.id, parts.sheets[id]));
        refs.characters[id] = references.length;
      }
      if (location && parts.locationSheets[location.id]) {
        references.push(await localAsset(series.id, parts.locationSheets[location.id]));
        refs.location = references.length;
      }
      const prompt = storyboardPrompt(scene, { cast: parts.cast, location, style: parts.style, refs });
      const asset = await renderImage(episode, prompt, `board-${scene.id}-${crypto.randomUUID().slice(0, 8)}.png`, { references, aspect: "9:16", signal });
      warmModelRefs(userId, episode, series, scene, asset);
      return { asset, basis: boardBasis(scene, parts.cast, location) };
    }, { conflict: "This storyboard is already drawing" });
  }

  async function runVoice(userId, episode, series, sceneId) {
    const scene = sceneOf(episode, sceneId);
    const parts = seriesParts(series);
    const missing = [...new Set(scene.beats.filter((b) => b.line && !parts.voices[b.speaker]).map((b) => b.speaker))];
    if (missing.length) throw fail(`Choose a voice for ${missing.join(", ")} first (series → Cast)`);
    await startStep(userId, episode.id, ["scenes", scene.id, "voice"], async ({ signal, report }) => {
      const dir = path.join(directory(episode.id), `voice-${scene.id}-${crypto.randomUUID().slice(0, 6)}`);
      await fs.mkdir(dir, { recursive: true });
      const seconds = {};
      const files = {};
      const spoken = scene.beats.filter((beat) => beat.line);
      let done = 0;
      for (const beat of spoken) {
        const file = path.join(dir, `${beat.id}.wav`);
        seconds[beat.id] = await voiceLine(episode, beat.line, parts.voices[beat.speaker], beat.emotion, file, signal);
        files[beat.id] = file;
        await report(`Voiced ${++done} of ${spoken.length} lines`);
      }
      const { timeline, seconds: total } = sceneTrackTimeline(scene.beats, seconds);
      const max = DRAMA_MODELS.video[episode.metadata?.production?.settings?.quality === "draft" ? "draft" : "final"].maxSeconds;
      if (total > max) throw fail(`This scene's dialogue runs ${total}s; one clip holds ${max}s. Split the scene or trim lines.`);
      // Lines placed at their start times over silence, padded to whole seconds.
      const inputs = timeline.filter((item) => !item.silent);
      if (!inputs.length) throw fail("This scene has no spoken lines. Add a line, or merge it into the next scene.");
      const filter = [
        ...inputs.map((item, index) => `[${index}:a]adelay=${Math.round(item.start * 1000)}|${Math.round(item.start * 1000)}[d${index}]`),
        `${inputs.map((_, index) => `[d${index}]`).join("")}amix=inputs=${inputs.length}:normalize=0,apad=whole_dur=${total}[out]`,
      ].join(";");
      const name = `track-${scene.id}-${crypto.randomUUID().slice(0, 8)}.wav`;
      const track = path.join(directory(episode.id), name);
      await ffmpeg(["-y", ...inputs.flatMap((item) => ["-i", files[item.beatId]]), "-filter_complex", filter, "-map", "[out]", "-t", String(total), "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", track], signal);
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      await saveProject(episode.id);
      return { asset: assetUrl(episode.id, name), seconds: total, timeline, basis: voiceBasis(scene, parts.voices) };
    }, { conflict: "This scene is already being voiced" });
  }

  async function clipWork(userId, episode, series, sceneId, { signal, report }, remoteId) {
    const fresh = await dependencies.getProject(userId, episode.id);
    const freshSeries = (await dependencies.getProject(userId, series.id)) || series;
    const scene = sceneOf(fresh, sceneId);
    const state = fresh.metadata?.production?.scenes?.[scene.id] || {};
    const parts = seriesParts(freshSeries);
    const location = parts.locations.find((item) => item.id === scene.locationId);
    const locationSheet = location && parts.locationSheets[location.id];
    const quality = state.clip?.quality || (fresh.metadata?.production?.settings?.quality === "draft" ? "draft" : "final");
    const tier = DRAMA_MODELS.video[quality];
    const sceneModels = usesModelRefs(freshSeries, parts, scene);
    const encode = async (file) => {
      const jpg = `${file}.seed.jpg`;
      await ffmpeg(["-y", "-i", file, "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", jpg], signal);
      return { type: "image_url", image_url: { url: `data:image/jpeg;base64,${(await fs.readFile(jpg)).toString("base64")}` } };
    };

    const render = async (textOnly, resumeId) => {
      const refs = sceneReferences(scene, { cast: parts.cast, sheets: parts.sheets, locationSheet, textOnly });
      const modelRefs = !textOnly && sceneModels;
      const prompt = seedancePrompt(scene, { cast: parts.cast, location, style: parts.style, refs, modelRefs, seconds: state.voice.seconds, timeline: state.voice.timeline });
      let body;
      if (!resumeId) {
        if (modelRefs) await report("Preparing 3D-model references");
        // Reference order matters (@image numbers); the copies are made in parallel.
        const images = await Promise.all([
          ...Object.keys(refs.characters).map(async (id) =>
            localAsset(freshSeries.id, modelRefs ? await modelCopy(userId, freshSeries, ["characters", id], parts.sheets[id], "character", signal) : parts.sheets[id]),
          ),
          ...(refs.location ? [localAsset(freshSeries.id, locationSheet)] : []),
          ...(refs.grid
            ? [(async () => localAsset(episode.id, modelRefs ? await modelCopy(userId, fresh, ["scenes", scene.id, "board"], state.board.asset, "storyboard", signal) : state.board.asset))()]
            : []),
        ]);
        const encoded = await Promise.all(images.map(encode));
        const track = await localAsset(episode.id, state.voice.asset);
        const mp3 = `${track}.mp3`;
        await ffmpeg(["-y", "-i", track, "-ac", "1", "-ar", "44100", "-b:a", "128k", mp3], signal);
        body = {
          model: process.env[`OPENROUTER_DRAMA_VIDEO_${quality.toUpperCase()}`] || tier.model,
          prompt,
          aspect_ratio: "9:16",
          resolution: tier.resolution,
          duration: state.voice.seconds,
          input_references: [...encoded, { type: "audio_url", audio_url: { url: publicUrl(mp3) } }],
        };
      }
      await report(resumeId ? "Waiting for the video model" : textOnly ? "Sending the scene from descriptions" : "Sending the scene to the video model");
      const video = await generateVideo({
        body,
        signal,
        remoteId: resumeId,
        onRemote: (id) => patch(userId, episode.id, (metadata) => setAt(metadata, ["scenes", scene.id, "clip"], (current) => ({ ...current, remoteId: id, textOnly, progress: "Rendering the scene" }))),
      });
      return { ...video, prompt, references: textOnly ? "text" : modelRefs ? "model" : "sheets" };
    };

    // One retry without faces when the video model refuses the reference images.
    let result;
    try {
      result = await render(Boolean(remoteId && state.clip?.textOnly), remoteId);
    } catch (error) {
      if (state.clip?.textOnly && remoteId) throw error;
      if (signal?.aborted || !refusedForFaces(error?.message)) throw error;
      console.warn(`[drama] clip ${scene.id} refused its reference images, retrying from descriptions: ${error?.message}`);
      await report("The video model refused the reference images. Rendering from descriptions");
      try {
        result = await render(true, "");
      } catch (retry) {
        throw fail(`The video model refused the reference images, and the render from descriptions failed too: ${String(retry?.message || "").slice(0, 250)}`);
      }
    }
    const name = `clip-${scene.id}-${crypto.randomUUID().slice(0, 8)}.mp4`;
    await fs.writeFile(path.join(directory(episode.id), name), result.bytes);
    await saveProject(episode.id);
    return {
      asset: assetUrl(episode.id, name),
      remoteId: "",
      textOnly: false,
      references: result.references,
      quality,
      boardAsset: state.board.asset,
      voiceAsset: state.voice.asset,
      cost: result.cost ?? null,
      prompt: result.prompt,
    };
  }
  async function runClip(userId, episode, series, sceneId, quality) {
    const scene = sceneOf(episode, sceneId);
    const state = episode.metadata?.production?.scenes?.[scene.id] || {};
    if (!state.board?.asset || state.board.status === "running") throw fail("Draw this scene's storyboard first");
    if (!state.voice?.asset || state.voice.status === "running") throw fail("Voice this scene first");
    await patch(userId, episode.id, (metadata) => setAt(metadata, ["scenes", scene.id, "clip"], (current) => ({ ...current, quality: quality === "draft" ? "draft" : "final", remoteId: "", textOnly: false })));
    await startStep(userId, episode.id, ["scenes", scene.id, "clip"], (tools) => clipWork(userId, episode, series, scene.id, tools), { conflict: "This scene is already rendering" });
  }
  async function resumeClip(userId, episode, sceneId) {
    if (!userId) return;
    const key = `${episode.id}:scenes.${sceneId}.clip`;
    if (runs.has(key)) return;
    const series = await dependencies.getProject(userId, episode.metadata?.drama?.seriesId);
    const remoteId = episode.metadata?.production?.scenes?.[sceneId]?.clip?.remoteId;
    const controller = new AbortController();
    runs.set(key, controller);
    try {
      const result = await clipWork(userId, episode, series, sceneId, { signal: controller.signal, report: async () => {} }, remoteId);
      await patch(userId, episode.id, (metadata) => setAt(metadata, ["scenes", sceneId, "clip"], (current) => ({ ...current, ...result, status: "ready", error: "" })));
    } catch (error) {
      await patch(userId, episode.id, (metadata) => setAt(metadata, ["scenes", sceneId, "clip"], (current) => ({ ...current, status: "failed", remoteId: "", error: String(error?.message || "Rendering failed").slice(0, 400) }))).catch(() => {});
    } finally {
      runs.delete(key);
    }
  }

  app.post(
    "/api/drama/episodes/:id/scenes/:sid/:step",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      const step = req.params.step;
      if (step === "board") await runBoard(session.user.id, episode, series, req.params.sid);
      else if (step === "voice") await runVoice(session.user.id, episode, series, req.params.sid);
      else if (step === "clip") {
        if (!req.body?.confirmed) throw fail("Confirm the render first");
        await runClip(session.user.id, episode, series, req.params.sid, String(req.body?.quality || episode.metadata?.production?.settings?.quality || "final"));
      } else throw fail("Unknown step", 404);
      res.status(202).json({ ok: true });
    }),
  );

  // Renders every scene whose clip is missing or out of date, all at once:
  // the video model runs them in parallel, so an episode takes about as long as one clip.
  app.post(
    "/api/drama/episodes/:id/render-all",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      if (!req.body?.confirmed) throw fail("Confirm the render first");
      const production = episode.metadata?.production || {};
      const quality = String(req.body?.quality || production.settings?.quality || "final");
      const view = await episodeView(episode, series, session.user.id);
      const started = [];
      const errors = [];
      for (const scene of production.script?.scenes || []) {
        const clip = view.scenes[scene.id]?.clip;
        if (clip?.status === "running" || (clip?.asset && !clip.stale)) continue;
        try {
          await runClip(session.user.id, episode, series, scene.id, quality);
          started.push(scene.id);
        } catch (error) {
          errors.push(`${scene.title}: ${error.message}`);
        }
      }
      res.status(202).json({ started, errors });
    }),
  );

  // Draws and voices every scene that still needs it (clips are started one by one, since they cost).
  app.post(
    "/api/drama/episodes/:id/prepare",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      const scenes = episode.metadata?.production?.script?.scenes || [];
      const started = [];
      const errors = [];
      for (const scene of scenes) {
        const state = episode.metadata?.production?.scenes?.[scene.id] || {};
        if (state.board?.asset && state.board.status !== "running") warmModelRefs(session.user.id, episode, series, scene, state.board.asset);
        for (const [step, run] of [["board", runBoard], ["voice", runVoice]]) {
          if (state[step]?.asset || state[step]?.status === "running") continue;
          try {
            await run(session.user.id, episode, series, scene.id);
            started.push(`${scene.id}:${step}`);
          } catch (error) {
            errors.push(error.message);
          }
        }
      }
      res.status(202).json({ started, errors: [...new Set(errors)] });
    }),
  );

  app.post(
    "/api/drama/episodes/:id/final",
    route(async (req, res, session) => {
      const { episode, series } = await loadEpisode(req, session);
      const production = episode.metadata?.production || {};
      const scenes = production.script?.scenes || [];
      const notReady = scenes.filter((scene) => !production.scenes?.[scene.id]?.clip?.asset).map((scene) => scene.title);
      if (!scenes.length || notReady.length) throw fail(`Render every scene first${notReady.length ? `: ${notReady.join(", ")}` : ""}`);
      const subtitles = req.body?.subtitles ?? production.settings?.subtitles ?? true;
      await startStep(session.user.id, episode.id, ["final"], async ({ signal, report }) => {
        const work = path.join(directory(episode.id), `final-${crypto.randomUUID().slice(0, 6)}`);
        await fs.mkdir(work, { recursive: true });
        const segments = [];
        const renderScenes = [];
        const tracks = [];
        let clock = 0;
        for (const scene of scenes) {
          const state = production.scenes[scene.id];
          const clipFile = await localAsset(episode.id, state.clip.asset);
          const trackFile = await localAsset(episode.id, state.voice.asset);
          const seconds = Math.max(MIN_CLIP_SECONDS, Number(state.voice.seconds) || (await probeSeconds(clipFile, signal)));
          renderScenes.push({ clipPath: clipFile, start: clock, end: clock + seconds });
          tracks.push({ file: trackFile, seconds });
          for (const item of state.voice.timeline || []) if (!item.silent) segments.push({ start: clock + item.start, end: clock + item.end, text: item.line });
          clock += seconds;
        }
        await report("Joining the dialogue");
        const voice = path.join(work, "dialogue.wav");
        await ffmpeg(
          [
            "-y",
            ...tracks.flatMap((track) => ["-i", track.file]),
            "-filter_complex",
            `${tracks.map((track, index) => `[${index}:a]apad=whole_dur=${track.seconds},atrim=0:${track.seconds}[t${index}]`).join(";")};${tracks.map((_, index) => `[t${index}]`).join("")}concat=n=${tracks.length}:v=0:a=1[out]`,
            "-map",
            "[out]",
            "-ac",
            "1",
            "-ar",
            "48000",
            "-c:a",
            "pcm_s16le",
            voice,
          ],
          signal,
        );
        const cues = buildSubtitleCues(segments, clock, 34);
        const srt = path.join(work, "captions.srt");
        await fs.writeFile(srt, subtitlesSrt(cues));
        const joined = path.join(work, "joined.mp4");
        await report("Cutting the scenes together");
        await files.renderCreatorAssets({ scenes: renderScenes, voice, captions: srt, output: joined, aspect: "9:16", signal, onProgress: (done, total) => report(`Prepared ${done} of ${total} scenes`) });
        let finalFile = joined;
        if (subtitles) {
          await report("Burning in subtitles");
          const ass = path.join(work, "captions.ass");
          const dims = { width: 720, height: 1280 };
          await fs.writeFile(ass, subtitlesAss(cues, dims, { y: 70, height: 12, fontSize: 5.2, outline: 3, bold: true, color: "#ffffff" }));
          finalFile = path.join(work, "subtitled.mp4");
          const escaped = ass.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
          await ffmpeg(["-y", "-i", joined, "-vf", `ass=filename='${escaped}'`, "-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", finalFile], signal);
        }
        const name = `episode-${crypto.randomUUID().slice(0, 8)}.mp4`;
        const captionsName = `episode-${crypto.randomUUID().slice(0, 8)}-captions.srt`;
        await fs.copyFile(finalFile, path.join(directory(episode.id), name));
        await fs.copyFile(srt, path.join(directory(episode.id), captionsName));
        await fs.rm(work, { recursive: true, force: true }).catch(() => {});
        await saveProject(episode.id);
        return { asset: assetUrl(episode.id, name), captions: assetUrl(episode.id, captionsName), seconds: Math.round(clock), subtitles: Boolean(subtitles) };
      }, { conflict: "The final cut is already rendering" });
      res.status(202).json({ ok: true });
    }),
  );
}
