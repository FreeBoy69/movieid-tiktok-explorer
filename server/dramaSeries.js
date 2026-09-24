// Create Drama: short drama series built on Create Video projects.
//
// A series is a creator_projects row (source_type "drama_series") whose
// metadata.drama holds the plan: logline, recurring cast, voices, and the
// episode map. Each episode is an ordinary Create Video project (source_type
// "maker", source_id "<seriesId>:<n>") that runs the usual pipeline with
// dialogue, 9:16, and the series' cast, art style, and voices preset.
import {
  DRAMA_EPISODE_RANGE,
  DRAMA_SERIES_SOURCE,
  episodeBrief,
  episodeLength,
  episodeSettings,
  findDramaTemplate,
  normalizeDramaCast,
  normalizeDramaEpisodes,
  normalizeSeriesPlan,
  seriesOutlinePrompt,
  speakerName,
} from "../src/utils/dramaTemplates.js";

const OUTLINE_STALE_MS = 6 * 60 * 1000;
const outlineRuns = new Map();

function seriesView(series) {
  const drama = series.metadata?.drama || {};
  // A server restart abandons an in-flight outline; report it instead of spinning forever.
  const interrupted = drama.outline === "writing" && Date.now() - Number(drama.outlineStartedAt || 0) > OUTLINE_STALE_MS && !outlineRuns.has(series.id);
  return {
    id: series.id,
    title: series.title,
    status: series.status,
    version: series.version,
    createdAt: series.createdAt,
    updatedAt: series.updatedAt,
    templateId: drama.templateId || "",
    twist: drama.twist || "",
    logline: drama.logline || "",
    tone: drama.tone || "",
    artStyleId: drama.artStyleId || "",
    episodeSeconds: episodeLength(drama.episodeSeconds).seconds,
    episodeCount: Number(drama.episodeCount) || 0,
    cast: drama.cast || [],
    voices: drama.voices || {},
    episodes: drama.episodes || [],
    outline: interrupted ? "failed" : drama.outline || "pending",
    outlineError: interrupted ? "Writing the outline was interrupted. Try again." : drama.outlineError || "",
  };
}

const STAGES = ["title", "script", "voiceover", "visualPlan", "thumbnail", "review"];
function episodeView(project) {
  const outputs = project.outputs || {};
  return {
    id: project.id,
    n: Number(project.metadata?.drama?.episode) || 0,
    title: project.title,
    status: project.status,
    updatedAt: project.updatedAt,
    done: STAGES.filter((stage) => outputs[stage] && !outputs[stage].stale).length,
    stages: STAGES.length,
    video: outputs.review?.asset || "",
    thumbnail: outputs.thumbnail?.asset || "",
    firstScene: outputs.visualPlan?.scenes?.find((scene) => scene.asset)?.asset || "",
  };
}

// The newest locked character sheet per cast member, across the series' episodes.
function castPortraits(episodes) {
  const portraits = {};
  for (const project of [...episodes].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))) {
    const allowed = new Set(project.metadata?.referenceAssets || []);
    for (const character of project.metadata?.settings?.visualBible?.cast || []) {
      const asset = (character.approvedReferences || []).find((item) => allowed.has(item));
      if (asset && !portraits[character.id]) portraits[character.id] = { asset, projectId: project.id };
    }
  }
  return portraits;
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
        return await dependencies.updateProject(userId, series.id, {
          title: drama.title || current.title,
          metadata: { ...current.metadata, drama: { ...drama, title: undefined } },
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
        { episodeCount: drama.episodeCount, fallbackCast: template?.cast || [] },
      );
      await patchDrama(userId, series, (next) => ({
        ...next,
        title: next.userTitle ? "" : plan.title,
        logline: plan.logline,
        tone: plan.tone || template?.tone || "",
        cast: plan.cast,
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
      if (!template) throw fail("Choose a drama template");
      const episodeCount = Math.round(Number(body.episodeCount) || DRAMA_EPISODE_RANGE.default);
      if (episodeCount < DRAMA_EPISODE_RANGE.min || episodeCount > DRAMA_EPISODE_RANGE.max)
        throw fail(`Choose ${DRAMA_EPISODE_RANGE.min} to ${DRAMA_EPISODE_RANGE.max} episodes`);
      const userTitle = String(body.title || "").trim().slice(0, 120);
      const artStyleId = String(body.artStyleId || template.artStyleId);
      if (!artStyleId.startsWith("preset:") && !(await ctx.customArtStyle(session.user.id, a.id, artStyleId)))
        throw fail("That art style no longer exists");
      const created = await dependencies.createProject(session.user.id, a.id, {
        sourceType: DRAMA_SERIES_SOURCE,
        title: userTitle || template.name,
        createdFrom: "drama-template",
      });
      const series = await dependencies.updateProject(session.user.id, created.id, {
        metadata: {
          ...created.metadata,
          drama: {
            kind: "series",
            templateId: template.id,
            userTitle: Boolean(userTitle),
            twist: String(body.twist || "").trim().slice(0, 2000),
            episodeCount,
            episodeSeconds: episodeLength(body.episodeSeconds).seconds,
            artStyleId,
            tone: template.tone,
            cast: normalizeDramaCast(template.cast),
            voices: {},
            episodes: [],
            outline: "pending",
          },
        },
        accountId: a.id,
        expectedVersion: created.version || 1,
      });
      res.status(201).json({ series: seriesView(await startOutline(session.user.id, series)) });
    }),
  );

  app.get(
    "/api/drama/series/:id",
    route(async (req, res, session) => {
      const a = await account(req, session);
      const series = await loadSeries(session.user.id, a.id, req.params.id);
      const episodes = await seriesEpisodes(session.user.id, a.id, series.id);
      res.json({ series: seriesView(series), episodes: episodes.map(episodeView), portraits: castPortraits(episodes) });
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
      const found = existing.find((project) => Number(project.metadata.drama.episode) === n && project.status !== "archived");
      if (found) return res.json({ project: found });
      // The closest earlier episode passes on voices, music choices, and locked character sheets.
      const previous = [...existing].reverse().find((project) => Number(project.metadata.drama.episode) < n) || existing.at(-1) || null;
      const previousSettings = previous?.metadata?.settings || {};
      const created = await dependencies.createProject(session.user.id, a.id, {
        sourceType: "maker",
        sourceId: `${series.id}:${n}`,
        title: plan.title,
        brief: episodeBrief(series, n),
        createdFrom: "drama-series",
        settings: episodeSettings(series, previousSettings),
      });
      const previousCast = new Map((previousSettings.visualBible?.cast || []).map((character) => [character.id, character]));
      const allowed = new Set(previous?.metadata?.referenceAssets || []);
      const inherited = previous
        ? [...new Set([...previousCast.values()].flatMap((character) => (character.approvedReferences || []).filter((asset) => allowed.has(asset))))]
        : [];
      const moved = inherited.length ? await copyAssets(previous, created.id, inherited) : new Map();
      const cast = (drama.cast || []).map((character) => ({
        ...character,
        approvedReferences: (previousCast.get(character.id)?.approvedReferences || []).map((asset) => moved.get(asset)).filter(Boolean),
      }));
      const project = await dependencies.updateProject(session.user.id, created.id, {
        metadata: {
          ...created.metadata,
          drama: { seriesId: series.id, episode: n, templateId: drama.templateId },
          referenceAssets: [...moved.values()],
          settings: {
            ...created.metadata.settings,
            visualBible: {
              ...(previousSettings.visualBible || {}),
              version: 1,
              locked: true,
              consistency: true,
              cast,
            },
          },
        },
        outputs: { ...created.outputs, title: { current: plan.title, concept: [plan.hook, plan.payoff].filter(Boolean).join(" "), ideas: [] } },
        accountId: a.id,
        expectedVersion: created.version || 1,
      });
      res.status(201).json({ project });
    }),
  );
}
