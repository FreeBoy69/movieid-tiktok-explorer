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
  normalizeSeriesPlan,
  seriesOutlinePrompt,
  dramaConceptPrompt,
  speakerName,
} from "../src/utils/dramaTemplates.js";

const DRAMA_EPISODE_SOURCE = "drama_episode";
const OUTLINE_STALE_MS = 6 * 60 * 1000;
const outlineRuns = new Map();
const posterRuns = new Map();

function seriesView(series) {
  const drama = series.metadata?.drama || {};
  // A server restart abandons an in-flight outline; report it instead of spinning forever.
  const interrupted = drama.outline === "writing" && Date.now() - Number(drama.outlineStartedAt || 0) > OUTLINE_STALE_MS && !outlineRuns.has(series.id);
  const posterInterrupted = drama.posterStatus === "writing" && Date.now() - Number(drama.posterStartedAt || 0) > OUTLINE_STALE_MS && !posterRuns.has(series.id);
  return {
    id: series.id,
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
    episodeSeconds: episodeLength(drama.episodeSeconds).seconds,
    episodeCount: Number(drama.episodeCount) || 0,
    cast: seriesCast(series),
    locations: drama.locations || [],
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
  const previous = new Map((settings.visualBible?.cast || []).map((character) => [character.id, character]));
  return {
    ...settings,
    aspect: "9:16",
    artStyleId: drama.artStyleId || settings.artStyleId || "",
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
  const { route, account, dependencies, fail, copyAssets } = ctx;

  const loadSeries = async (userId, accountId, id) => {
    const series = await dependencies.getProject(userId, id);
    if (!series || series.status === "deleted" || series.accountId !== accountId || series.sourceType !== DRAMA_SERIES_SOURCE)
      throw fail("Series not found", 404);
    return series;
  };
  const seriesEpisodes = async (userId, accountId, seriesId) =>
    (await dependencies.listProjects(userId, accountId))
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
      concept: template ? null : { genre: drama.genre, premise: drama.premise, logline: drama.logline, tone: drama.tone, cast: drama.cast, locations: drama.locations },
      twist: [drama.twist, note].filter(Boolean).join("\n"),
      title: series.title,
      episodeCount: drama.episodeCount,
      episodeSeconds: drama.episodeSeconds,
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
        { episodeCount: drama.episodeCount, fallbackCast: template?.cast || drama.cast || [] },
      );
      await patchDrama(userId, series, (next) => ({
        ...next,
        title: next.userTitle ? "" : plan.title,
        logline: plan.logline,
        tone: plan.tone || next.tone || template?.tone || "",
        cast: plan.cast,
        locations: plan.locations.length ? plan.locations : next.locations || [],
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
          "Original premium short-drama series cover, portrait 2:3. One decisive emotional moment with the recurring lead characters. No typography, captions, logos, borders, or watermarks.",
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
      const prompt = dramaConceptPrompt(messages);
      const raw = await dependencies.text(prompt.system, prompt.user, {
        openRouterModel: process.env.OPENROUTER_DRAMA_MODEL || "google/gemini-3.8-flash",
        reasoningEffort: "low", maxTokens: 4500, timeoutMs: 120000,
      });
      let parsed;
      try { parsed = JSON.parse(String(raw).replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); }
      catch { throw fail("The concept came back malformed. Try again.", 502); }
      let concept;
      try { concept = normalizeDramaConcept(parsed); }
      catch { throw fail("The concept needs a clearer premise and cast. Try adding a little detail.", 502); }
      res.json({ concept });
    }),
  );

  app.get(
    "/api/drama/series",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const projects = (await dependencies.listProjects(session.user.id, a.id)).filter((project) => project.status !== "deleted");
      const counts = new Map();
      for (const project of projects) {
        const seriesId = project.metadata?.drama?.seriesId;
        if (!seriesId) continue;
        const entry = counts.get(seriesId) || { made: 0, rendered: 0 };
        entry.made += 1;
        if (project.outputs?.review?.asset) entry.rendered += 1;
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
      const template = findDramaTemplate(body.templateId);
      let concept = null;
      if (!template && body.concept) {
        try { concept = normalizeDramaConcept(body.concept); }
        catch (error) { throw fail(error.message); }
      }
      if (!template && !concept) throw fail("Choose a template or develop an original idea");
      const episodeCount = Math.round(Number(body.episodeCount) || DRAMA_EPISODE_RANGE.default);
      if (episodeCount < DRAMA_EPISODE_RANGE.min || episodeCount > DRAMA_EPISODE_RANGE.max)
        throw fail(`Choose ${DRAMA_EPISODE_RANGE.min} to ${DRAMA_EPISODE_RANGE.max} episodes`);
      const userTitle = String(body.title || "").trim().slice(0, 120);
      const artStyleId = String(body.artStyleId || template?.artStyleId || concept.artStyleId);
      if (!artStyleId.startsWith("preset:") && !(await ctx.customArtStyle(session.user.id, a.id, artStyleId)))
        throw fail("That art style no longer exists");
      const created = await dependencies.createProject(session.user.id, a.id, {
        sourceType: DRAMA_SERIES_SOURCE,
        title: userTitle || template?.name || concept.title,
        createdFrom: template ? "drama-template" : "drama-idea",
      });
      const series = await dependencies.updateProject(session.user.id, created.id, {
        metadata: {
          ...created.metadata,
          drama: {
            kind: "series",
            templateId: template?.id || "",
            userTitle: Boolean(userTitle || concept),
            genre: concept?.genre || template?.genre || "",
            premise: concept?.premise || template?.premise || "",
            logline: concept?.logline || "",
            visualPrompt: concept?.visualPrompt || "",
            twist: String(body.twist || "").trim().slice(0, 2000),
            episodeCount,
            episodeSeconds: episodeLength(body.episodeSeconds).seconds,
            artStyleId,
            tone: template?.tone || concept?.tone || "",
            cast: normalizeDramaCast(template?.cast || concept.cast),
            locations: concept?.locations || [],
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

  app.post(
    "/api/drama/series/:id/poster",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await loadSeries(session.user.id, a.id, req.params.id);
      if (series.metadata?.drama?.templateId) throw fail("Template covers are already provided");
      res.status(202).json({ series: seriesView(await startPoster(session.user.id, series)) });
    }),
  );

  app.get(
    "/api/drama/series/:id",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await loadSeries(session.user.id, a.id, req.params.id);
      const episodes = await seriesEpisodes(session.user.id, a.id, series.id);
      res.json({ series: seriesView(series), episodes: episodes.map(episodeView) });
    }),
  );

  app.patch(
    "/api/drama/series/:id",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await loadSeries(session.user.id, a.id, req.params.id);
      const body = req.body || {};
      if (body.expectedVersion && Number(body.expectedVersion) !== Number(series.version))
        throw fail("This series changed in another tab. Reload it and reapply your edits.", 409);
      if (body.status !== undefined) {
        if (!["active", "archived"].includes(body.status)) throw fail("Invalid series status");
        const updated = await dependencies.updateProject(session.user.id, series.id, {
          status: body.status,
          accountId: a.id,
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
      const a = await account(req, session);
      const series = await loadSeries(session.user.id, a.id, req.params.id);
      if (outlineRuns.has(series.id)) throw fail("The outline is already being written", 409);
      if ((await seriesEpisodes(session.user.id, a.id, series.id)).length && !req.body?.confirmed)
        throw fail("Episodes you already started keep their scripts. Confirm to rewrite the rest of the outline.", 409);
      res.status(202).json({ series: seriesView(await startOutline(session.user.id, series, String(req.body?.note || "").slice(0, 1000))) });
    }),
  );

  app.post(
    "/api/drama/series/:id/episodes",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await loadSeries(session.user.id, a.id, req.params.id);
      const drama = series.metadata.drama || {};
      if (drama.outline !== "ready") throw fail("Wait for the series outline first");
      const n = Math.round(Number(req.body?.episode));
      const plan = (drama.episodes || []).find((item) => item.n === n);
      if (!plan) throw fail("That episode is not in the outline");
      const existing = await seriesEpisodes(session.user.id, a.id, series.id);
      const found = existing.find((project) => project.sourceType === DRAMA_EPISODE_SOURCE && Number(project.metadata.drama.episode) === n && project.status !== "archived");
      if (found) return res.json({ project: found });
      // Voices, sheets, and locations live on the series, so an episode needs only its plan.
      const project = await dependencies.createProject(session.user.id, a.id, {
        sourceType: DRAMA_EPISODE_SOURCE,
        sourceId: `${series.id}:${n}`,
        title: plan.title,
        brief: episodeBrief(series, n),
        createdFrom: "drama-series",
        settings: { aspect: "9:16" },
      });
      if (!project.metadata?.drama?.seriesId)
        await dependencies.updateProject(session.user.id, project.id, {
          metadata: { ...project.metadata, drama: { seriesId: series.id, episode: n, templateId: drama.templateId }, production: { settings: { quality: "final", subtitles: true } } },
          outputs: {},
          accountId: a.id,
          expectedVersion: project.version || 1,
        });
      res.status(201).json({ project: { id: project.id } });
    }),
  );
}
