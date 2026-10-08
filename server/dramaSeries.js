// Create Drama: short drama series, with their own editor, on the Create Video pipeline.
//
// A series is a creator_projects row (source_type "drama_series") whose
// metadata.drama holds the plan: logline, recurring cast, voices, and the
// episode map. The series also carries a visual bible (metadata.settings), so
// characters are designed and locked once, at series level, with the same
// character-sheet routes Create Video uses; every episode copies those locks.
// Each episode is a project (source_type "maker", source_id "<seriesId>:<n>")
// that runs the same stage jobs (script, voiceover, storyboard, render).
import {
  DRAMA_EPISODE_RANGE,
  DRAMA_SERIES_SOURCE,
  episodeBrief,
  episodeLength,
  findDramaTemplate,
  normalizeDramaCast,
  normalizeDramaConcept,
  normalizeDramaEpisodes,
  normalizeDramaLocations,
  normalizeDramaStoryBible,
  normalizeSeriesPlan,
  seriesOutlinePrompt,
  dramaConceptPrompt,
  speakerName,
} from "../src/utils/dramaTemplates.js";
import { findShortfilmTemplate } from "../src/utils/shortfilmTemplates.js";
import { filmFormat, formatCount, formatLength, isFilmFormat, lyricsFromSegments, normalizeBeatGrid, normalizeLyrics } from "../src/utils/filmFormats.js";
import { analyzeBeats } from "../src/utils/beatTrack.js";
import { claimUnownedVoices } from "./voiceOwners.js";
import { normalizeFilmCinema } from "../src/utils/cinemaPresets.js";
import { studioFilePath } from "./vibeEdit.js";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DRAMA_EPISODE_SOURCE = "drama_episode";
const OUTLINE_STALE_MS = 6 * 60 * 1000;
const outlineRuns = new Map();
const posterRuns = new Map();
// Song analysis jobs (stems, then transcription), polled by the Music Video page.
const songJobs = new Map();
const MAX_SONG_SECONDS = 10 * 60;
const formatOf = (drama) => (isFilmFormat(drama?.format) ? drama.format : "series");
const unitLength = (drama) => {
  const format = formatOf(drama);
  if (format === "series") return episodeLength(drama.episodeSeconds).seconds;
  if (format === "music") return Math.round(Number(drama.song?.duration) || 0);
  return formatLength(format, drama.episodeSeconds).seconds;
};

function seriesView(series) {
  const drama = series.metadata?.drama || {};
  // A server restart abandons an in-flight outline; report it instead of spinning forever.
  const interrupted = drama.outline === "writing" && Date.now() - Number(drama.outlineStartedAt || 0) > OUTLINE_STALE_MS && !outlineRuns.has(series.id);
  const posterInterrupted = drama.posterStatus === "writing" && Date.now() - Number(drama.posterStartedAt || 0) > OUTLINE_STALE_MS && !posterRuns.has(series.id);
  return {
    id: series.id,
    accountId: series.accountId,
    title: series.title,
    status: series.status,
    version: series.version,
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
    templateId: drama.templateId || "",
    genre: drama.genre || "",
    premise: drama.premise || "",
    poster: drama.poster || "",
    posterStatus: posterInterrupted ? "failed" : drama.posterStatus || "pending",
    posterError: posterInterrupted ? "Cover generation was interrupted. Try again." : drama.posterError || "",
    twist: drama.twist || "",
    logline: drama.logline || "",
    tone: drama.tone || "",
    artStyleId: drama.artStyleId || "",
    shotTemplateId: drama.shotTemplateId || "",
    format: formatOf(drama),
    cinema: normalizeFilmCinema(drama.cinema),
    song: drama.song ? { asset: drama.song.asset || "", duration: Number(drama.song.duration) || 0, lyrics: normalizeLyrics(drama.song.lyrics, drama.song.duration), name: drama.song.name || "", grid: normalizeBeatGrid(drama.song.grid, drama.song.duration) } : null,
    episodeSeconds: unitLength(drama),
    episodeCount: Number(drama.episodeCount) || 0,
    cast: seriesCast(series),
    locations: drama.locations || [],
    storyBible: normalizeDramaStoryBible(drama.storyBible),
    voices: drama.voices || {},
    episodes: drama.episodes || [],
    outline: interrupted ? "failed" : drama.outline || "pending",
    outlineError: interrupted ? "Writing the outline was interrupted. Try again." : drama.outlineError || "",
  };
}

// The series cast with each character's locked sheet(s) from the series' visual bible.
function seriesCast(series) {
  const allowed = new Set(series.metadata?.referenceAssets || []);
  const bible = new Map((series.metadata?.settings?.visualBible?.cast || []).map((character) => [character.id, character]));
  return (series.metadata?.drama?.cast || []).map((character) => ({
    ...character,
    approvedReferences: (bible.get(character.id)?.approvedReferences || []).filter((asset) => allowed.has(asset)),
  }));
}
// Keeps the series' visual bible in step with the drama cast, preserving locks by id.
function syncedSettings(metadata, drama) {
  const settings = metadata.settings || {};
  const shotTemplate = findShortfilmTemplate(drama.shotTemplateId);
  const previous = new Map((settings.visualBible?.cast || []).map((character) => [character.id, character]));
  return {
    ...settings,
    aspect: shotTemplate?.aspect || settings.aspect || "9:16",
    artStyleId: drama.artStyleId || settings.artStyleId || "",
    shotTemplateId: drama.shotTemplateId || settings.shotTemplateId || "",
    visualBible: {
      ...(settings.visualBible || {}),
      version: (Number(settings.visualBible?.version) || 0) + 1,
      locked: true,
      consistency: true,
      cast: (drama.cast || []).map((character) => ({ ...character, approvedReferences: previous.get(character.id)?.approvedReferences || [] })),
    },
  };
}

// Progress through the drama steps: screenplay, storyboards, voices, clips, final cut.
function episodeView(project) {
  const legacy = project.sourceType !== DRAMA_EPISODE_SOURCE;
  const production = project.metadata?.production || {};
  const scenes = production.script?.scenes || [];
  const every = (step) => scenes.length > 0 && scenes.every((scene) => production.scenes?.[scene.id]?.[step]?.asset);
  const steps = [scenes.length > 0, every("board"), every("voice"), every("clip"), Boolean(production.final?.asset)];
  const firstBoard = scenes.map((scene) => production.scenes?.[scene.id]?.board?.asset).find(Boolean) || "";
  return {
    id: project.id,
    n: Number(project.metadata?.drama?.episode) || 0,
    title: project.title,
    status: project.status,
    updatedAt: project.updatedAt,
    legacy,
    done: legacy ? 0 : steps.filter(Boolean).length,
    stages: steps.length,
    video: legacy ? project.outputs?.review?.asset || "" : production.final?.asset || "",
    thumbnail: legacy ? project.outputs?.thumbnail?.asset || "" : firstBoard,
    firstScene: "",
  };
}


export function registerDramaSeries(app, ctx) {
  const { route, account, dependencies, fail } = ctx;

  const loadSeries = async (userId, id) => {
    const series = await dependencies.getProject(userId, id);
    if (!series || series.status === "deleted" || series.sourceType !== DRAMA_SERIES_SOURCE)
      throw fail("Series not found", 404);
    return series;
  };
  const seriesEpisodes = async (userId, seriesId) =>
    (await dependencies.listProjects(userId, ""))
      .filter((project) => project.metadata?.drama?.seriesId === seriesId && project.status !== "deleted")
      .sort((a, b) => Number(a.metadata.drama.episode) - Number(b.metadata.drama.episode));
  const patchDrama = async (userId, series, mutate) => {
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = attempt ? await dependencies.getProject(userId, series.id) : series;
      const drama = mutate(structuredClone(current.metadata?.drama || {}));
      try {
        const next = { ...drama, title: undefined };
        return await dependencies.updateProject(userId, series.id, {
          title: drama.title || current.title,
          metadata: { ...current.metadata, drama: next, settings: syncedSettings(current.metadata || {}, next) },
          accountId: current.accountId,
          expectedVersion: current.version || 1,
        });
      } catch (error) {
        if (error.statusCode !== 409) throw error;
        await new Promise((resolve) => setTimeout(resolve, 120 * (attempt + 1)));
      }
    }
    throw fail("The series kept changing. Try again.", 409);
  };

  async function writeOutline(userId, series, note = "") {
    const drama = series.metadata.drama;
    const template = findDramaTemplate(drama.templateId);
    const prompt = seriesOutlinePrompt({
      template,
      concept: template ? null : { genre: drama.genre, premise: drama.premise, logline: drama.logline, tone: drama.tone, storyBible: drama.storyBible, cast: drama.cast, locations: drama.locations },
      twist: [drama.twist, note].filter(Boolean).join("\n"),
      title: series.title,
      episodeCount: drama.episodeCount,
      episodeSeconds: drama.episodeSeconds,
      format: formatOf(drama),
      song: drama.song || null,
    });
    const controller = new AbortController();
    outlineRuns.set(series.id, controller);
    try {
      const raw = await dependencies.text(prompt.system, prompt.user, {
        signal: controller.signal,
        // A long JSON outline: hidden reasoning otherwise eats the whole budget (finish_reason=length).
        // Measured on a 10-episode outline: gemini-3.8-flash 19s, the default deepseek text model 111s.
        openRouterModel: process.env.OPENROUTER_DRAMA_MODEL || "google/gemini-3.8-flash",
        reasoningEffort: "low",
        maxTokens: 32000,
        timeoutMs: 240000,
      });
      const plan = normalizeSeriesPlan(
        JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")),
        { episodeCount: drama.episodeCount, fallbackCast: template?.cast || drama.cast || [], minCast: formatOf(drama) === "music" ? 1 : 2 },
      );
      await patchDrama(userId, series, (next) => ({
        ...next,
        title: next.userTitle ? "" : plan.title,
        logline: plan.logline,
        tone: plan.tone || next.tone || template?.tone || "",
        cast: plan.cast,
        locations: plan.locations.length ? plan.locations : next.locations || [],
        storyBible: Object.values(plan.storyBible || {}).some((value) => Array.isArray(value) ? value.length : Boolean(value))
          ? plan.storyBible
          : normalizeDramaStoryBible(next.storyBible),
        episodes: plan.episodes,
        outline: "ready",
        outlineError: "",
      }));
    } catch (error) {
      await patchDrama(userId, series, (next) => ({
        ...next,
        outline: "failed",
        outlineError: error instanceof SyntaxError ? "The outline came back malformed. Try again." : String(error?.message || "Could not write the outline").slice(0, 300),
      })).catch(() => {});
    } finally {
      outlineRuns.delete(series.id);
    }
  }
  const startOutline = async (userId, series, note) => {
    const started = await patchDrama(userId, series, (drama) => ({ ...drama, outline: "writing", outlineError: "", outlineStartedAt: Date.now() }));
    void writeOutline(userId, started, note);
    return started;
  };

  const startPoster = async (userId, series) => {
    if (!ctx.generatePosterImage) return series;
    if (posterRuns.has(series.id)) throw fail("The cover is already generating", 409);
    const started = await patchDrama(userId, series, (drama) => ({ ...drama, posterStatus: "writing", posterError: "", posterStartedAt: Date.now() }));
    const controller = new AbortController();
    posterRuns.set(series.id, controller);
    void (async () => {
      try {
        const drama = started.metadata.drama;
        const cast = (drama.cast || []).slice(0, 2).map((person) => `${person.name}: ${person.appearance}; ${person.outfit}`).join(". ");
        const prompt = [
          `${filmFormat(formatOf(drama)).poster}, portrait 2:3. One decisive emotional moment with the lead characters. No typography, captions, logos, borders, or watermarks.`,
          drama.visualPrompt || `${drama.premise}. ${cast}`,
          `Visual style: ${drama.artStyleId === "preset:3d-film" ? "expressive high-end 3D animation" : drama.artStyleId === "preset:anime" ? "cinematic 2D anime" : "cinematic live action"}. Keep recurring faces, wardrobe and the setting consistent with the series bible.`,
        ].join(" ").slice(0, 2400);
        const poster = await ctx.generatePosterImage(started, prompt, "series-cover.png", controller.signal, "2:3", { model: process.env.OPENROUTER_DRAMA_IMAGE_MODEL || "openai/gpt-image-2" });
        await patchDrama(userId, started, (next) => ({ ...next, poster, posterStatus: "ready", posterError: "" }));
      } catch (error) {
        await patchDrama(userId, started, (next) => ({ ...next, posterStatus: "failed", posterError: String(error?.message || "Could not make the cover").slice(0, 300) })).catch(() => {});
      } finally {
        posterRuns.delete(series.id);
      }
    })();
    return started;
  };

  app.post(
    "/api/drama/idea",
    route(async (req, res) => {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-8) : [];
      if (!messages.some((message) => message?.role === "user" && String(message?.content || "").trim()))
        throw fail("Describe your drama idea first");
      const format = isFilmFormat(req.body?.format) ? req.body.format : "series";
      const song = format === "music" && req.body?.song ? { duration: Number(req.body.song.duration) || 0, lyrics: normalizeLyrics(req.body.song.lyrics, req.body.song.duration) } : null;
      const prompt = dramaConceptPrompt(messages, { format, song });
      const raw = await dependencies.text(prompt.system, prompt.user, {
        openRouterModel: process.env.OPENROUTER_DRAMA_MODEL || "google/gemini-3.8-flash",
        reasoningEffort: "low", maxTokens: 4500, timeoutMs: 120000,
      });
      let parsed;
      try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
      catch { throw fail("The concept came back malformed. Try again.", 502); }
      let concept;
      try { concept = normalizeDramaConcept(parsed, { minCast: format === "music" ? 1 : 2 }); }
      catch { throw fail("The concept needs a clearer premise and cast. Try adding a little detail.", 502); }
      res.json({ concept });
    }),
  );

  app.get(
    "/api/drama/series",
    route(async (req, res, session) => {
      const projects = (await dependencies.listProjects(session.user.id, "")).filter((project) => project.status !== "deleted");
      const counts = new Map();
      for (const project of projects) {
        const seriesId = project.metadata?.drama?.seriesId;
        if (!seriesId) continue;
        const entry = counts.get(seriesId) || { made: 0, rendered: 0 };
        entry.made += 1;
        if (project.outputs?.review?.asset || project.metadata?.production?.final?.asset) entry.rendered += 1;
        counts.set(seriesId, entry);
      }
      res.json({
        series: projects
          .filter((project) => project.sourceType === DRAMA_SERIES_SOURCE)
          .map((project) => ({ ...seriesView(project), ...(counts.get(project.id) || { made: 0, rendered: 0 }) })),
      });
    }),
  );

  app.post(
    "/api/drama/series",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const body = req.body || {};
      const format = isFilmFormat(body.format) ? body.format : "series";
      const kind = filmFormat(format);
      const template = format === "series" ? findDramaTemplate(body.templateId) : null;
      let concept = null;
      if (!template && body.concept) {
        try { concept = normalizeDramaConcept(body.concept, { minCast: format === "music" ? 1 : 2 }); }
        catch (error) { throw fail(error.message); }
      }
      if (!template && !concept) throw fail(format === "series" ? "Choose a template or develop an original idea" : "Develop the idea first");
      let episodeCount = Math.round(Number(body.episodeCount) || kind.count.default);
      if (format === "series") {
        if (episodeCount < DRAMA_EPISODE_RANGE.min || episodeCount > DRAMA_EPISODE_RANGE.max)
          throw fail(`Choose ${DRAMA_EPISODE_RANGE.min} to ${DRAMA_EPISODE_RANGE.max} episodes`);
      } else episodeCount = formatCount(format, episodeCount);
      let songFile = "";
      let song = null;
      if (format === "music") {
        const duration = Number(body.song?.duration) || 0;
        if (!body.song?.file || !(duration > 3)) throw fail("Add the song first");
        if (duration > MAX_SONG_SECONDS) throw fail("Songs can be up to 10 minutes long");
        songFile = await studioFilePath(session.user.id, String(body.song.file));
        song = { name: String(body.song.name || "").slice(0, 120), duration: Math.round(duration * 100) / 100, lyrics: normalizeLyrics(body.song.lyrics, duration), grid: normalizeBeatGrid(body.song.grid, duration) };
      }
      const userTitle = String(body.title || "").trim().slice(0, 120);
      const artStyleId = String(body.artStyleId || template?.artStyleId || concept.artStyleId);
      if (!artStyleId.startsWith("preset:") && !(await ctx.customArtStyle(session.user.id, a.id, artStyleId)))
        throw fail("That art style no longer exists");
      const shotTemplateId = String(body.shotTemplateId || template?.shotTemplateId || kind.shotTemplateId);
      const shotTemplate = findShortfilmTemplate(shotTemplateId);
      if (!shotTemplate) throw fail("Choose a valid scene format");
      const created = await dependencies.createProject(session.user.id, a.id, {
        sourceType: DRAMA_SERIES_SOURCE,
        title: userTitle || template?.name || concept.title,
        createdFrom: template ? "drama-template" : format === "series" ? "drama-idea" : `film-${format}`,
      });
      // The song lives with the project, so every scene can cut from it.
      if (songFile) {
        const name = `song${path.extname(songFile).toLowerCase() || ".mp3"}`;
        await fs.mkdir(ctx.files.directory(created.id), { recursive: true });
        await fs.copyFile(songFile, path.join(ctx.files.directory(created.id), name));
        await ctx.files.saveProject(created.id);
        song.asset = ctx.files.assetUrl(created.id, name);
        song.file = name;
      }
      const series = await dependencies.updateProject(session.user.id, created.id, {
        metadata: {
          ...created.metadata,
          drama: {
            kind: "series",
            format,
            ...(song ? { song } : {}),
            cinema: normalizeFilmCinema(body.cinema),
            templateId: template?.id || "",
            userTitle: Boolean(userTitle || concept),
            genre: concept?.genre || template?.genre || "",
            premise: concept?.premise || template?.premise || "",
            logline: concept?.logline || "",
            visualPrompt: concept?.visualPrompt || "",
            twist: String(body.twist || "").trim().slice(0, 2000),
            episodeCount,
            episodeSeconds: format === "series" ? episodeLength(body.episodeSeconds).seconds : format === "music" ? 0 : formatLength(format, body.episodeSeconds).seconds,
            artStyleId,
            shotTemplateId,
            shotTemplateValues: body.shotTemplateValues && typeof body.shotTemplateValues === "object" ? body.shotTemplateValues : {},
            tone: template?.tone || concept?.tone || "",
            cast: normalizeDramaCast(template?.cast || concept.cast),
            locations: concept?.locations || [],
            storyBible: normalizeDramaStoryBible(concept?.storyBible),
            voices: {},
            episodes: [],
            outline: "pending",
          },
        },
        accountId: a.id,
        expectedVersion: created.version || 1,
      });
      const outlined = await startOutline(session.user.id, series);
      res.status(201).json({ series: seriesView(concept ? await startPoster(session.user.id, outlined) : outlined) });
    }),
  );

  // ---------- Music video: hear the song, write down its lyrics ----------
  const probeSeconds = async (file) => {
    const out = await ctx.files.command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]);
    return Number(String(out?.stdout ?? out ?? "").trim()) || 0;
  };
  // The beat grid, read from the full mix (the drums live there): ffmpeg
  // decodes to 11 kHz mono PCM and the tracker runs here, in Node.
  async function songBeatGrid(file, work, duration) {
    const wav = path.join(work, `beats-${crypto.randomUUID().slice(0, 8)}.wav`);
    await ctx.files.command(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-v", "error", "-i", file, "-vn", "-ac", "1", "-ar", "11025", "-c:a", "pcm_s16le", wav]);
    const data = await fs.readFile(wav);
    for (let offset = 12; offset + 8 <= data.length; ) {
      const size = data.readUInt32LE(offset + 4);
      if (data.toString("ascii", offset, offset + 4) === "data") {
        const end = Math.min(data.length, offset + 8 + size);
        const samples = new Float32Array((end - offset - 8) >> 1);
        for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(offset + 8 + i * 2) / 32768;
        return normalizeBeatGrid(analyzeBeats(samples, 11025), duration);
      }
      offset += 8 + size + (size & 1);
    }
    return null;
  }
  async function analyzeSong(job, file) {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), "film-song-"));
    try {
      job.progress = "Reading the song";
      const duration = await probeSeconds(file);
      if (!(duration > 3)) throw fail("That file has no audio we can use");
      if (duration > MAX_SONG_SECONDS) throw fail("Songs can be up to 10 minutes long");
      job.progress = "Finding the beat";
      const grid = await songBeatGrid(file, work, duration).catch((error) => {
        console.warn(`[film] beat tracking failed: ${String(error?.message || error).slice(0, 200)}`);
        return null;
      });
      let source = file;
      let engine = "Full mix";
      // Lyrics read far better from the voice alone; the mix is the fallback.
      if (dependencies.separateStems) {
        job.progress = "Separating the vocals";
        const stems = await dependencies.separateStems(file, work).catch(() => null);
        if (stems?.vocals) {
          source = stems.vocals;
          engine = stems.engine || "Vocal stem";
        }
      }
      job.progress = "Transcribing the lyrics";
      let result = await dependencies.transcribe(source, { maxDurationSeconds: MAX_SONG_SECONDS });
      if (source !== file && !(result?.segments || []).length) {
        engine = "Full mix";
        result = await dependencies.transcribe(file, { maxDurationSeconds: MAX_SONG_SECONDS });
      }
      job.result = { duration: Math.round(duration * 100) / 100, lyrics: lyricsFromSegments(result?.segments || []), engine, grid };
      job.status = "done";
    } catch (error) {
      job.status = "failed";
      job.error = String(error?.message || "Could not read the song").slice(0, 300);
    } finally {
      await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      setTimeout(() => songJobs.delete(job.id), 60 * 60 * 1000).unref?.();
    }
  }
  app.post(
    "/api/film/song/analyze",
    route(async (req, res, session) => {
      if (!dependencies.transcribe) throw fail("Transcription isn't available on this server", 503);
      const file = await studioFilePath(session.user.id, String(req.body?.file || ""));
      const job = { id: crypto.randomUUID(), userId: String(session.user.id), status: "running", progress: "Starting", result: null, error: "" };
      songJobs.set(job.id, job);
      void analyzeSong(job, file);
      res.status(202).json({ job: { id: job.id, status: job.status, progress: job.progress } });
    }),
  );
  app.get(
    "/api/film/song/analyze/:id",
    route(async (req, res, session) => {
      const job = songJobs.get(req.params.id);
      if (!job || job.userId !== String(session.user.id)) throw fail("That song analysis is gone. Start again.", 404);
      res.json({ job: { id: job.id, status: job.status, progress: job.progress, result: job.result, error: job.error } });
    }),
  );

  // Music videos made before beat tracking, or a re-read after a song swap.
  app.post(
    "/api/drama/series/:id/song/beats",
    route(async (req, res, session) => {
      const series = await loadSeries(session.user.id, req.params.id);
      const song = series.metadata?.drama?.song;
      if (!song?.asset) throw fail("This film has no song");
      const name = String(song.asset).split("/").pop();
      const file = ctx.files.outputPath(series.id, name);
      if (!(await ctx.files.ensureAsset(series.id, name, file))) throw fail("The song file is missing. Start a new music video from it.", 404);
      const work = await fs.mkdtemp(path.join(os.tmpdir(), "film-beats-"));
      try {
        const grid = await songBeatGrid(file, work, Number(song.duration) || Infinity);
        if (!grid) throw fail("No steady beat was found in this song", 422);
        const updated = await patchDrama(session.user.id, series, (drama) => ({ ...drama, song: { ...drama.song, grid } }));
        res.json({ series: seriesView(updated) });
      } finally {
        await fs.rm(work, { recursive: true, force: true }).catch(() => {});
      }
    }),
  );

  app.post(
    "/api/drama/series/:id/poster",
    route(async (req, res, session) => {
      const series = await loadSeries(session.user.id, req.params.id);
      if (series.metadata?.drama?.templateId) throw fail("Template covers are already provided");
      res.status(202).json({ series: seriesView(await startPoster(session.user.id, series)) });
    }),
  );

  app.get(
    "/api/drama/series/:id",
    route(async (req, res, session) => {
      const series = await loadSeries(session.user.id, req.params.id);
      const episodes = await seriesEpisodes(session.user.id, series.id);
      // Cast voices designed before they were owned move into their maker's library.
      const designed = Object.values(series.metadata?.production?.voices || {}).map((voice) => voice?.profileId);
      await claimUnownedVoices(designed, session.user.id).catch(() => 0);
      res.json({ series: seriesView(series), episodes: episodes.map(episodeView) });
    }),
  );

  app.patch(
    "/api/drama/series/:id",
    route(async (req, res, session) => {
      const series = await loadSeries(session.user.id, req.params.id);
      const body = req.body || {};
      if (body.expectedVersion && Number(body.expectedVersion) !== Number(series.version))
        throw fail("This series changed in another tab. Reload it and reapply your edits.", 409);
      if (body.status !== undefined) {
        if (!["active", "archived"].includes(body.status)) throw fail("Invalid series status");
        const updated = await dependencies.updateProject(session.user.id, series.id, {
          status: body.status,
          accountId: series.accountId,
          expectedVersion: series.version || 1,
        });
        return res.json({ series: seriesView(updated) });
      }
      const updated = await patchDrama(session.user.id, series, (drama) => {
        const next = { ...drama };
        if (typeof body.title === "string" && body.title.trim()) {
          next.title = body.title.trim().slice(0, 120);
          next.userTitle = true;
        }
        if (typeof body.logline === "string") next.logline = body.logline.trim().slice(0, 400);
        if (typeof body.tone === "string") next.tone = body.tone.trim().slice(0, 300);
        if (body.cast !== undefined) {
          const cast = normalizeDramaCast(body.cast);
          if (cast.length < 1) throw fail("Keep at least one character");
          next.cast = cast;
        }
        if (body.episodes !== undefined) next.episodes = normalizeDramaEpisodes(body.episodes, drama.episodeCount);
        if (body.locations !== undefined) next.locations = normalizeDramaLocations(body.locations);
        if (body.storyBible !== undefined) next.storyBible = normalizeDramaStoryBible(body.storyBible);
        if (body.cinema !== undefined) next.cinema = normalizeFilmCinema(body.cinema);
        if (body.song?.lyrics !== undefined && drama.song) next.song = { ...drama.song, lyrics: normalizeLyrics(body.song.lyrics, drama.song.duration) };
        if (body.song?.grid !== undefined && drama.song) next.song = { ...(next.song || drama.song), grid: normalizeBeatGrid(body.song.grid, drama.song.duration) };
        if (body.voices && typeof body.voices === "object")
          next.voices = Object.fromEntries(
            Object.entries(body.voices)
              .map(([speaker, voiceId]) => [speakerName(speaker), String(voiceId || "").slice(0, 200)])
              .filter(([speaker, voiceId]) => speaker && voiceId),
          );
        return next;
      });
      res.json({ series: seriesView(updated) });
    }),
  );

  app.post(
    "/api/drama/series/:id/outline",
    route(async (req, res, session) => {
      const series = await loadSeries(session.user.id, req.params.id);
      if (outlineRuns.has(series.id)) throw fail("The outline is already being written", 409);
      if ((await seriesEpisodes(session.user.id, series.id)).length && !req.body?.confirmed)
        throw fail("Episodes you already started keep their scripts. Confirm to rewrite the rest of the outline.", 409);
      res.status(202).json({ series: seriesView(await startOutline(session.user.id, series, String(req.body?.note || "").slice(0, 1000))) });
    }),
  );

  app.post(
    "/api/drama/series/:id/episodes",
    route(async (req, res, session) => {
      const series = await loadSeries(session.user.id, req.params.id);
      const drama = series.metadata.drama || {};
      if (drama.outline !== "ready") throw fail("Wait for the series outline first");
      const n = Math.round(Number(req.body?.episode));
      const plan = (drama.episodes || []).find((item) => item.n === n);
      if (!plan) throw fail("That episode is not in the outline");
      const existing = await seriesEpisodes(session.user.id, series.id);
      const a = { id: series.accountId };
      const found = existing.find((project) => project.sourceType === DRAMA_EPISODE_SOURCE && Number(project.metadata.drama.episode) === n && project.status !== "archived");
      if (found) return res.json({ project: found });
      // Voices, sheets, and locations live on the series, so an episode needs only its plan.
      const shotTemplate = findShortfilmTemplate(drama.shotTemplateId);
      const project = await dependencies.createProject(session.user.id, a.id, {
        sourceType: DRAMA_EPISODE_SOURCE,
        sourceId: `${series.id}:${n}`,
        title: plan.title,
        brief: episodeBrief(series, n),
        createdFrom: "drama-series",
        settings: { aspect: shotTemplate?.aspect || "9:16" },
      });
      if (!project.metadata?.drama?.seriesId)
        await dependencies.updateProject(session.user.id, project.id, {
          metadata: {
            ...project.metadata,
            drama: { seriesId: series.id, episode: n, templateId: drama.templateId },
            production: {
              settings: {
                quality: "final",
                // A music video reads cleaner without burned-in lyrics; the creator can turn them on.
                subtitles: formatOf(drama) !== "music",
              },
            },
          },
          outputs: {},
          accountId: a.id,
          expectedVersion: project.version || 1,
        });
      res.status(201).json({ project: { id: project.id } });
    }),
  );
}
