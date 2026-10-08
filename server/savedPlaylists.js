// SavedPlaylists: routes under /api/saved/tiktok-playlists, moved out of server.js along with the
// helpers only they use. Everything else they need comes in through `deps`.
import crypto from "crypto";
import { savedPlaylistGenreScanSummary, groupSavedPlaylistGenreMemberships, genreMembershipFromStoryResult, genreMembershipFromMovieResult, pendingSavedPlaylistGenreVideos, mergeSavedPlaylistGenreMemberships } from "../src/utils/savedPlaylistGenres.js";
import { attachMovieIdentificationSource } from "../src/utils/movieIdentificationSource.js";
import fs from "fs";

export function registerSavedPlaylists(app, deps) {
  const {
    addSavedPlaylistAutoTags,
    cleanupDownloadArtifacts,
    extractTikTokVideoIdFromUrl,
    generateDeepSeekJson,
    getCachedMovieIdentification,
    getCachedTikTokComments,
    getSavedPlaylistGenreScanState,
    getSavedPlaylistRecordByKey,
    getSessionRecord,
    identifyMovieFromVideoFile,
    jsonbLiteral,
    listActiveTikTokSourceDeepScans,
    listSavedPlaylistRecords,
    listSavedPostAnalyses,
    makeLinkAnalysisVideoPath,
    movieCacheLookupFromUrl,
    normalizePlaylistListUrl,
    normalizeSavedSourceTags,
    publicTikTokSourceDeepScan,
    queueTikTokSourceDeepScan,
    resolveDownloadedOutput,
    runPsql,
    runTikTokDownload,
    runTikTokDownloadWithAudioRetry,
    runYtDlpAudioDownload,
    runYtDlpSocialDownload,
    saveSavedPostAnalysis,
    saveTikTokPlaylistToDb,
    savedGenreScanState,
    savedPlaylistDisplayTitle,
    savedPlaylistSummaryFromRecord,
    savedSlugForRecord,
    savedSourceAutoTags,
    slugifySavedPlaylistTitle,
    slugifySavedPost,
    sqlString,
    tikTokDownloadMaxBytes,
    tiktokCollectionTitleFromUrl,
    tiktokHandleFromUrl,
    tiktokSourceDeepScanKey,
    transcribeMediaFileForAnalysis,
    transcriptExcerpt,
  } = deps;

  function savedPlaylistSlugCandidates(row) {
      const candidates = new Set();
      const add = (value) => {
          const slug = slugifySavedPlaylistTitle(value || "");
          if (slug)
              candidates.add(slug);
      };
      const analyzed = row?.analyzedUrl || "";
      const key = row?.key || "";
      const handle = tiktokHandleFromUrl(analyzed || key);
      const collectionTitle = tiktokCollectionTitleFromUrl(analyzed) || tiktokCollectionTitleFromUrl(key);
      add(row?.slug);
      add(savedSlugForRecord(row));
      add(savedPlaylistDisplayTitle(row));
      add(collectionTitle);
      if (handle && collectionTitle)
          add(`${handle} ${collectionTitle}`);
      add(analyzed);
      add(key);
      return [...candidates];
  }

  async function refreshSavedPlaylistAutoTags(userId, record, state = null) {
      const key = normalizePlaylistListUrl(record?.key || record?.analyzedUrl || "");
      if (!key)
          return [];
      const scanState = state || await getSavedPlaylistGenreScanState(userId, key).catch(() => savedGenreScanState());
      const autoTags = savedSourceAutoTags(record, scanState);
      await runPsql(`
  UPDATE saved_tiktok_playlists
  SET auto_tags = ${jsonbLiteral(autoTags)}, updated_at = now()
  WHERE user_id = ${sqlString(userId)}
    AND key = ${sqlString(key)};
  `);
      return autoTags;
  }

  async function getSavedPlaylistRecordBySlug(userId, slug) {
      const wanted = slugifySavedPlaylistTitle(slug);
      if (!wanted)
          return null;
      const out = await runPsql(`
  SELECT COALESCE((
    SELECT json_build_object(
      'key', key,
      'slug', slug,
      'analyzedUrl', analyzed_url,
      'playlist', playlist,
      'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
      'tags', tags,
      'autoTags', auto_tags,
      'genreScanState', (
        SELECT state FROM saved_tiktok_playlist_genre_scans g
        WHERE g.user_id = saved_tiktok_playlists.user_id
          AND g.playlist_key = saved_tiktok_playlists.key
        LIMIT 1
      )
    )
    FROM saved_tiktok_playlists
    WHERE user_id = ${sqlString(userId)}
      AND slug = ${sqlString(wanted)}
    ORDER BY saved_at DESC
    LIMIT 1
  ), 'null'::json);
  `);
      const exact = JSON.parse(out || "null");
      if (exact?.playlist?.videos?.length)
          return exact;
      const records = await listSavedPlaylistRecords(userId);
      const match = records.find((record) => savedPlaylistSlugCandidates(record).includes(wanted));
      return match || null;
  }

  async function deleteSavedPlaylistFromDb(userId, key) {
      const normalized = normalizePlaylistListUrl(key);
      if (!normalized)
          return;
      await runPsql(`DELETE FROM saved_tiktok_playlists WHERE user_id = ${sqlString(userId)} AND key = ${sqlString(normalized)};`);
  }

  async function updateSavedPlaylistTags(userId, key, tags) {
      const normalized = normalizePlaylistListUrl(key);
      if (!normalized)
          throw new Error("Saved source key is missing.");
      const cleanTags = normalizeSavedSourceTags(tags, 80);
      const out = await runPsql(`
  UPDATE saved_tiktok_playlists
  SET tags = ${jsonbLiteral(cleanTags)}, updated_at = now()
  WHERE user_id = ${sqlString(userId)}
    AND key = ${sqlString(normalized)}
  RETURNING json_build_object(
    'key', key,
    'slug', slug,
    'analyzedUrl', analyzed_url,
    'playlist', playlist,
    'savedAt', FLOOR(EXTRACT(EPOCH FROM saved_at) * 1000)::bigint,
    'tags', tags,
    'autoTags', auto_tags
  );
  `);
      const record = JSON.parse(out || "null");
      if (!record)
          throw new Error("Saved source not found.");
      return record;
  }

  function savedGenreScanDbId(userId, playlistKey) {
      return `sgs_${crypto.createHash("sha1").update(`${userId || ""}:${playlistKey || ""}`).digest("hex").slice(0, 28)}`;
  }

  async function saveSavedPlaylistGenreScanState(userId, record, state, status = "ready") {
      const playlistKey = normalizePlaylistListUrl(record?.key || record?.analyzedUrl || "");
      if (!playlistKey)
          throw new Error("Saved playlist key is missing.");
      const id = savedGenreScanDbId(userId, playlistKey);
      const slug = String(record?.slug || savedSlugForRecord(record) || "").trim();
      const cleanState = savedGenreScanState(state);
      await runPsql(`
  INSERT INTO saved_tiktok_playlist_genre_scans (id, user_id, playlist_key, playlist_slug, status, state, created_at, updated_at)
  VALUES (
    ${sqlString(id)}, ${sqlString(userId)}, ${sqlString(playlistKey)}, ${sqlString(slug)},
    ${sqlString(status)}, ${jsonbLiteral(cleanState)}, now(), now()
  )
  ON CONFLICT (user_id, playlist_key) DO UPDATE SET
    playlist_slug = EXCLUDED.playlist_slug,
    status = EXCLUDED.status,
    state = EXCLUDED.state,
    updated_at = now();
  `);
      await refreshSavedPlaylistAutoTags(userId, record, cleanState).catch(() => []);
      return cleanState;
  }

  function savedPlaylistGenreScanPayload(record, state = {}) {
      const scanState = savedGenreScanState(state);
      const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
      const memberships = scanState.memberships;
      return {
          key: record?.key || "",
          slug: record?.slug || savedSlugForRecord(record),
          title: savedPlaylistDisplayTitle(record),
          summary: savedPlaylistGenreScanSummary(videos, memberships),
          groups: groupSavedPlaylistGenreMemberships(memberships),
          memberships,
          errors: scanState.errors,
          startedAt: scanState.startedAt || 0,
          updatedAt: scanState.updatedAt || 0,
      };
  }

  function savedGenreScanVideoUrl(video = {}) {
      const direct = String(video.playUrl || video.sourceUrl || video.url || "").trim();
      if (direct)
          return direct;
      const handle = String(video.authorHandle || video.uploaderId || "").replace(/^@/, "").trim();
      const id = String(video.id || "").trim();
      return handle && id ? `https://www.tiktok.com/@${handle}/video/${id}` : "";
  }

  const SAVED_STORY_GENRE_BUCKETS = [
      "Action",
      "Adventure",
      "Comedy",
      "Crime",
      "Drama",
      "Fantasy",
      "Historical",
      "Horror",
      "Isekai",
      "Martial Arts",
      "Mystery",
      "Psychological",
      "Romance",
      "Sci-Fi",
      "Slice of Life",
      "Sports",
      "Supernatural",
      "Thriller",
      "War",
  ];

  function savedStoryGenrePrompt(video, transcript) {
      const title = String(video?.title || "").trim();
      const author = String(video?.authorHandle || video?.author || "").trim();
      return `Classify this short-form recap clip by story genre from its narration transcript.

  Choose 1 to 4 genre buckets only from this allowed list:
  ${SAVED_STORY_GENRE_BUCKETS.join(", ")}

  Rules:
  - Classify the story being told, not the TikTok creator or hashtag style.
  - Use Sports only when competition, training, athletic stakes, or match/race progress drives the story.
  - Use Romance only when the relationship arc is central.
  - Use Thriller, Mystery, Psychological, Horror, or Crime only when their story evidence is clear.
  - Use Isekai only when transfer/reincarnation into another world is explicit.
  - Do not identify the movie/anime title. This scan is for fast story grouping only.
  - If the transcript is too thin to classify, return an empty genres array.

  Return JSON only:
  {"genres":["Drama"],"summary":"One short sentence about the story arc.","storySignals":["training arc"],"confidence":0.0}

  Source title/caption: ${transcriptExcerpt(title, 500) || "Unknown"}
  Creator: ${transcriptExcerpt(author, 160) || "Unknown"}
  Transcript:
  ${transcriptExcerpt(transcript, 9000)}`;
  }

  function normalizeSavedStoryGenreLabels(values) {
      const bucketMap = new Map(SAVED_STORY_GENRE_BUCKETS.map((genre) => [genre.toLowerCase(), genre]));
      const normalized = [];
      for (const raw of Array.isArray(values) ? values : []) {
          const key = String(raw || "").replace(/\s+/g, " ").trim().toLowerCase();
          const genre = bucketMap.get(key);
          if (genre && !normalized.includes(genre))
              normalized.push(genre);
      }
      return normalized.slice(0, 4);
  }

  async function transcribeSavedGenreStoryVideo(video) {
      const rawUrl = savedGenreScanVideoUrl(video);
      if (!rawUrl)
          throw new Error("Saved clip URL is missing.");
      const tempFile = makeLinkAnalysisVideoPath();
      let audioFirstError = "";
      try {
          try {
              await runYtDlpAudioDownload(rawUrl, tempFile);
          }
          catch (error) {
              audioFirstError = error instanceof Error ? error.message : String(error || "");
              await runTikTokDownloadWithAudioRetry({ ...video, playUrl: rawUrl }, tempFile, { preferYtDlp: true });
          }
          const mediaPath = resolveDownloadedOutput(tempFile);
          const transcript = await transcribeMediaFileForAnalysis(mediaPath);
          if (!transcript)
              throw new Error("Local transcription did not detect narration.");
          return transcript;
      }
      catch (error) {
          const message = error instanceof Error ? error.message : String(error || "Story transcription failed");
          if (audioFirstError && !message.includes(audioFirstError)) {
              throw new Error(`${message} Audio-first attempt: ${audioFirstError}`.slice(0, 1200));
          }
          throw error;
      }
      finally {
          cleanupDownloadArtifacts(tempFile);
      }
  }

  async function inferSavedPlaylistStoryGenres(video) {
      const transcript = await transcribeSavedGenreStoryVideo(video);
      const raw = await generateDeepSeekJson(savedStoryGenrePrompt(video, transcript), {
          temperature: 0.1,
          maxTokens: 420,
      });
      return genreMembershipFromStoryResult(video, {
          genres: normalizeSavedStoryGenreLabels(raw?.genres),
          summary: transcriptExcerpt(raw?.summary || "", 500),
          storySignals: Array.isArray(raw?.storySignals) ? raw.storySignals.slice(0, 6) : [],
          confidence: Number(raw?.confidence || 0),
          transcriptExcerpt: transcriptExcerpt(transcript, 1200),
      });
  }

  async function scanSavedPlaylistGenreVideo(video) {
      const rawUrl = savedGenreScanVideoUrl(video);
      if (!rawUrl)
          throw new Error("Saved clip URL is missing.");
      const cached = await getCachedMovieIdentification(movieCacheLookupFromUrl(rawUrl)).catch(() => null);
      if (cached) {
          const official = genreMembershipFromMovieResult(video, cached);
          if (official.status === "verified")
              return official;
      }
      return await inferSavedPlaylistStoryGenres(video);
  }

  async function scanSavedPlaylistGenreBatch(userId, record, options = {}) {
      const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
      if (!videos.length)
          throw new Error("Saved playlist has no clips.");
      const previous = await getSavedPlaylistGenreScanState(userId, record.key || record.analyzedUrl);
      const batchSize = Math.min(Math.max(Number(options.batchSize) || 4, 1), 12);
      const pending = pendingSavedPlaylistGenreVideos(videos, previous.memberships, batchSize);
      const updates = [];
      const errors = [...previous.errors];
      for (const video of pending) {
          try {
              updates.push(await scanSavedPlaylistGenreVideo(video));
          }
          catch (error) {
              const message = error instanceof Error ? error.message : String(error || "Story genre scan failed");
              updates.push({
                  videoKey: String(video.id || savedGenreScanVideoUrl(video) || "").trim(),
                  video,
                  status: "needs_review",
                  genres: [],
                  reason: "story_genre_scan_failed",
                  error: message.slice(0, 500),
                  scannedAt: Date.now(),
              });
              errors.push({
                  videoKey: String(video.id || savedGenreScanVideoUrl(video) || "").trim(),
                  title: String(video.title || "").slice(0, 200),
                  message: message.slice(0, 500),
                  at: Date.now(),
              });
          }
      }
      const nextState = {
          memberships: mergeSavedPlaylistGenreMemberships(previous.memberships, updates),
          errors: errors.slice(-80),
          startedAt: previous.startedAt || Date.now(),
          updatedAt: Date.now(),
      };
      const summary = savedPlaylistGenreScanSummary(videos, nextState.memberships);
      await saveSavedPlaylistGenreScanState(userId, record, nextState, summary.pending ? "scanning" : "ready");
      return savedPlaylistGenreScanPayload(record, nextState);
  }

  async function listPendingCommentCacheVideos(record) {
      const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
      const pending = [];
      for (const video of videos) {
          const rawUrl = savedGenreScanVideoUrl(video);
          const videoId = extractTikTokVideoIdFromUrl(rawUrl || "");
          if (!videoId)
              continue;
          const cached = await getCachedTikTokComments(videoId).catch(() => null);
          if (cached?.threads?.length)
              continue;
          pending.push({
              videoId,
              url: rawUrl,
              slug: slugifySavedPost(video),
              title: String(video.title || "").slice(0, 200),
          });
      }
      return pending;
  }

  async function identifySavedPlaylistVideoMovie(video, options = {}) {
      const rawUrl = savedGenreScanVideoUrl(video);
      if (!rawUrl)
          throw new Error("Saved clip URL is missing.");
      const cacheLookup = { ...movieCacheLookupFromUrl(rawUrl), cacheOnly: options.cacheOnly !== false };
      const skipMovieCache = options.skipMovieCache === true;
      if (!skipMovieCache) {
          const cachedMovie = await getCachedMovieIdentification(cacheLookup).catch(() => null);
          if (cachedMovie?.title)
              return { result: attachMovieIdentificationSource(cachedMovie, "movie-cache"), source: "movie-cache" };
      }
      if (options.geminiFallback === false)
          throw new Error("Movie ID unavailable and video scan fallback disabled.");
      const tempFile = makeLinkAnalysisVideoPath();
      try {
          let downloader = "yt-dlp";
          if (/tiktok\.com/i.test(rawUrl)) {
              const candidateUrls = Array.isArray(video?.cleanPlaybackUrls) ? video.cleanPlaybackUrls : [];
              downloader = await runTikTokDownload(rawUrl, tempFile, candidateUrls);
          }
          else {
              downloader = await runYtDlpSocialDownload(rawUrl, tempFile);
          }
          const downloadedFile = resolveDownloadedOutput(tempFile);
          const stat = fs.statSync(downloadedFile);
          const maxBytes = tikTokDownloadMaxBytes();
          if (stat.size > maxBytes) {
              throw new Error(`Downloaded video is too large (${Math.round(stat.size / 1024 / 1024)}MB; limit ${Math.round(maxBytes / 1024 / 1024)}MB).`);
          }
          const result = await identifyMovieFromVideoFile(downloadedFile, "video/mp4", { ...cacheLookup, skipCommentLookup: true });
          return { result: attachMovieIdentificationSource(result, downloader), source: downloader };
      }
      finally {
          try {
              cleanupDownloadArtifacts(tempFile);
          }
          catch {
              /* best-effort cleanup */
          }
      }
  }

  function savedPlaylistMovieScanSummary(videos = [], analyses = {}, recent = []) {
      const total = videos.length;
      const doneSlugs = new Set(Object.keys(analyses || {}));
      for (const item of recent) {
          if (item?.slug && item.ok)
              doneSlugs.add(item.slug);
      }
      let analyzed = 0;
      for (const video of videos) {
          if (doneSlugs.has(slugifySavedPost(video)))
              analyzed += 1;
      }
      return {
          total,
          analyzed,
          pending: Math.max(total - analyzed, 0),
      };
  }

  async function scanSavedPlaylistMovieBatch(userId, record, options = {}) {
      const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
      if (!videos.length)
          throw new Error("Saved playlist has no clips.");
      const playlistKey = normalizePlaylistListUrl(record?.key || record?.analyzedUrl || "");
      const analyses = await listSavedPostAnalyses(userId, playlistKey).catch(() => ({}));
      const batchSize = Math.min(Math.max(Number(options.batchSize) || 1, 1), 6);
      const wantedSlugs = new Set((Array.isArray(options.slugs) ? options.slugs : options.slug ? [options.slug] : [])
          .map((value) => String(value || "").trim())
          .filter(Boolean));
      let pendingVideos = videos.filter((video) => !analyses[slugifySavedPost(video)]);
      if (wantedSlugs.size)
          pendingVideos = pendingVideos.filter((video) => wantedSlugs.has(slugifySavedPost(video)));
      pendingVideos = pendingVideos.slice(0, batchSize);
      const processed = [];
      const errors = [];
      for (const video of pendingVideos) {
          const slug = slugifySavedPost(video);
          try {
              const { result, source } = await identifySavedPlaylistVideoMovie(video, {
                  cacheOnly: true,
                  geminiFallback: options.geminiFallback !== false,
                  skipMovieCache: options.skipMovieCache === true,
              });
              const saved = await saveSavedPostAnalysis(userId, {
                  slug,
                  postSlug: slug,
                  playlistKey,
                  video,
                  result,
                  analyzedAt: Date.now(),
              });
              processed.push({
                  slug,
                  ok: true,
                  source,
                  title: String(result?.title || "").slice(0, 160),
                  commentHint: Boolean(result?.commentHint),
                  analysis: saved,
              });
          }
          catch (error) {
              const message = error instanceof Error ? error.message : String(error || "Movie scan failed");
              processed.push({ slug, ok: false, error: message.slice(0, 500) });
              errors.push({
                  slug,
                  title: String(video.title || "").slice(0, 200),
                  message: message.slice(0, 500),
                  at: Date.now(),
              });
          }
      }
      const mergedAnalyses = { ...analyses };
      for (const item of processed) {
          if (item.ok && item.analysis?.result)
              mergedAnalyses[item.slug] = item.analysis;
      }
      return {
          key: record?.key || "",
          slug: record?.slug || savedSlugForRecord(record),
          title: savedPlaylistDisplayTitle(record),
          summary: savedPlaylistMovieScanSummary(videos, mergedAnalyses),
          pendingComments: [],
          processed,
          errors: errors.slice(-40),
          analyses: mergedAnalyses,
      };
  }

      app.get("/api/saved/tiktok-playlists", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const records = await listSavedPlaylistRecords(session.user.id);
              res.json({ summaries: records.map(savedPlaylistSummaryFromRecord) });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
          }
      });
      app.get("/api/saved/tiktok-playlists/by-url", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
              const record = await getSavedPlaylistRecordByKey(session.user.id, rawUrl);
              res.json({ record });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
          }
      });
      app.get("/api/saved/tiktok-playlists/by-slug/:slug", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const record = await getSavedPlaylistRecordBySlug(session.user.id, req.params.slug);
              res.json({ record });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Saved playlist database unavailable" });
          }
      });
      app.post("/api/saved/tiktok-playlists", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const { rawUrl, playlist, analyzedUrl } = req.body || {};
              const record = await saveTikTokPlaylistToDb(session.user.id, rawUrl, playlist, analyzedUrl);
              res.json({ record, summary: savedPlaylistSummaryFromRecord(record) });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not save playlist" });
          }
      });
      app.patch("/api/saved/tiktok-playlists/tags", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = String(req.body?.key || "").trim();
              const record = await updateSavedPlaylistTags(session.user.id, key, req.body?.tags || []);
              res.json({ record, summary: savedPlaylistSummaryFromRecord(record) });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not update saved source tags" });
          }
      });
      app.patch("/api/saved/tiktok-playlists/auto-tags", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = String(req.body?.key || "").trim();
              const record = await addSavedPlaylistAutoTags(session.user.id, key, req.body?.tags || []);
              res.json({ record, summary: record ? savedPlaylistSummaryFromRecord(record) : null });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not update saved source auto tags" });
          }
      });
      app.post("/api/saved/tiktok-playlists/deep-scan", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const url = String(req.body?.url || req.body?.rawUrl || req.body?.analyzedUrl || "").trim();
              if (!url)
                  return res.status(400).json({ error: "URL is required" });
              const job = queueTikTokSourceDeepScan(session.user.id, url, {
                  seedVideoUrl: req.body?.seedVideoUrl,
                  targetCount: req.body?.targetCount,
                  knownCount: req.body?.knownCount,
              });
              res.status(202).json({ scan: publicTikTokSourceDeepScan(job) });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not start TikTok deep scan" });
          }
      });
      app.get("/api/saved/tiktok-playlists/deep-scan", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const url = typeof req.query.url === "string" ? req.query.url.trim() : "";
              const scans = listActiveTikTokSourceDeepScans(session.user.id);
              if (!url)
                  return res.json({ scans });
              const key = tiktokSourceDeepScanKey(session.user.id, url);
              const match = scans.find((scan) => tiktokSourceDeepScanKey(session.user.id, scan.url) === key) || null;
              res.json({ scan: match, scans });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not load TikTok deep scan" });
          }
      });
      app.get("/api/saved/tiktok-playlists/genre-scan", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = typeof req.query.key === "string" ? req.query.key : "";
              const slug = typeof req.query.slug === "string" ? req.query.slug : "";
              const record = key
                  ? await getSavedPlaylistRecordByKey(session.user.id, key)
                  : slug
                      ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                      : null;
              if (!record)
                  return res.status(404).json({ error: "Saved playlist not found" });
              const state = await getSavedPlaylistGenreScanState(session.user.id, record.key || record.analyzedUrl);
              res.json({ scan: savedPlaylistGenreScanPayload(record, state) });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Saved genre scan unavailable" });
          }
      });
      app.post("/api/saved/tiktok-playlists/genre-scan", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = String(req.body?.key || "").trim();
              const slug = String(req.body?.slug || "").trim();
              const record = key
                  ? await getSavedPlaylistRecordByKey(session.user.id, key)
                  : slug
                      ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                      : null;
              if (!record)
                  return res.status(404).json({ error: "Saved playlist not found" });
              res.json({ scan: await scanSavedPlaylistGenreBatch(session.user.id, record, { batchSize: req.body?.batchSize }) });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not scan saved playlist genres" });
          }
      });
      app.get("/api/saved/tiktok-playlists/movie-scan/pending", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = String(req.query.key || "").trim();
              const slug = String(req.query.slug || "").trim();
              const record = key
                  ? await getSavedPlaylistRecordByKey(session.user.id, key)
                  : slug
                      ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                      : null;
              if (!record)
                  return res.status(404).json({ error: "Saved playlist not found" });
              const pendingComments = await listPendingCommentCacheVideos(record);
              res.json({
                  key: record.key || "",
                  slug: record.slug || savedSlugForRecord(record),
                  title: savedPlaylistDisplayTitle(record),
                  pendingComments,
                  pendingCount: pendingComments.length,
              });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not list pending comment cache videos" });
          }
      });
      app.get("/api/saved/tiktok-playlists/movie-scan", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = String(req.query.key || "").trim();
              const slug = String(req.query.slug || "").trim();
              const record = key
                  ? await getSavedPlaylistRecordByKey(session.user.id, key)
                  : slug
                      ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                      : null;
              if (!record)
                  return res.status(404).json({ error: "Saved playlist not found" });
              const playlistKey = normalizePlaylistListUrl(record.key || record.analyzedUrl || "");
              const analyses = await listSavedPostAnalyses(session.user.id, playlistKey).catch(() => ({}));
              const videos = Array.isArray(record?.playlist?.videos) ? record.playlist.videos : [];
              res.json({
                  scan: {
                      key: record.key || "",
                      slug: record.slug || savedSlugForRecord(record),
                      title: savedPlaylistDisplayTitle(record),
                      summary: savedPlaylistMovieScanSummary(videos, analyses),
                      pendingComments: await listPendingCommentCacheVideos(record),
                      analyses,
                  },
              });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Saved movie scan unavailable" });
          }
      });
      app.post("/api/saved/tiktok-playlists/movie-scan", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = String(req.body?.key || "").trim();
              const slug = String(req.body?.slug || "").trim();
              const record = key
                  ? await getSavedPlaylistRecordByKey(session.user.id, key)
                  : slug
                      ? await getSavedPlaylistRecordBySlug(session.user.id, slug)
                      : null;
              if (!record)
                  return res.status(404).json({ error: "Saved playlist not found" });
              res.json({
                  scan: await scanSavedPlaylistMovieBatch(session.user.id, record, {
                      batchSize: req.body?.batchSize,
                      slug: req.body?.slug,
                      slugs: req.body?.slugs,
                      geminiFallback: req.body?.geminiFallback !== false,
                      skipMovieCache: req.body?.skipMovieCache === true,
                  }),
              });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not scan saved playlist movies" });
          }
      });
      app.delete("/api/saved/tiktok-playlists", async (req, res) => {
          try {
              const session = await getSessionRecord(req);
              if (!session?.user)
                  return res.status(401).json({ error: "Sign in required" });
              const key = typeof req.query.key === "string" ? req.query.key : "";
              await deleteSavedPlaylistFromDb(session.user.id, key);
              res.json({ ok: true });
          }
          catch (error) {
              res.status(503).json({ error: error instanceof Error ? error.message : "Could not remove playlist" });
          }
      });
}
