# TubeGen-inspired creator workflow for AutoYT

Status: implemented in the working tree on September 22, 2026 (see *Implementation status* at the end). Plan based on `tubegen tut.mp4`, watched on September 22, 2026. The source is a 49:22, 1280x720 tutorial. Visuals were reviewed from the Watch scene frames and the narration was transcribed with AutoYT's VPS-local Whisper. This is a workflow study, not a request to copy TubeGen's branding, source code, or protected assets.

## What the tutorial demonstrates

| Time | Workflow | Product behavior to carry into AutoYT |
| --- | --- | --- |
| 00:42 | Dashboard | A compact command center with Create Video, credit/usage visibility, plan/status, and Styles shortcut. |
| 11:14 | Niche Finder | Default no-cost discovery, shuffle, advanced filters, sort modes, channel search, bookmarks, similar channels, and Copy Style. |
| 18:04 | Styles | Reusable channel style profiles with reference videos, word count, language, voice, speed, and voice clones. |
| 23:12 | Create Video | A project starts from a style, then moves through Title, Script, Description, Voiceover, Visuals, Thumbnail, and Soundtrack. |
| 24:22–30:20 | Parallel generation | Independent stages generate at the same time; dependent stages unlock when their inputs exist. |
| 30:52 | Voiceover | Use generated script or paste one, choose a voice, generate, preview, and retain the asset in the project. |
| 31:53 | Soundtrack | Generate music from the voiceover, infer tone, and split it automatically by narrative sections or manually. |
| 32:49–42:20 | Visuals | Choose aspect ratio, quality, animation, style, image count, then use an advanced transcript timeline to split segments and control each segment. |
| 42:20 | Export | Render animated scenes, download a ready-to-edit asset bundle, and keep voiceover, music, images, videos, script, and timestamps together. |
| 45:56 | Project History | Reopen, duplicate, edit, archive, delete, download, and selectively retain lightweight project data after archival. |

## AutoYT starting point

AutoYT already has useful foundations:

- YouTube Radar already searches multiple query lanes, enriches videos with channel statistics, scores opportunity/outliers, infers niches, and exposes competitor channels and recent videos.
- Niche Library and agent learning already store macro, sub, and micro-niche signals, source performance, hooks, and monetization context.
- Creator Projects already persist a source video and generate `title`, `seo`, `script`, `visualPlan`, `thumbnail`, and `publishingPlan` stages.
- Voiceover Studio already has transcript preparation, local Whisper, voiceover, soundtrack, captions, scene splitting, timeline controls, preview, ETA, and background-job state.
- Compilation Studio already handles clip discovery, sorting, selection, target duration, rights confirmation, 9:16/16:9 output, background processing, and YouTube upload.

The goal is to compose these capabilities into one coherent creator workflow. We should not create a second niche database, a second project model, or a second render queue.

## Product shape

Use one persistent workspace with three top-level modes:

1. **Discover**: find a niche, channels, videos, hooks, styles, and source collections.
2. **Project**: turn a discovery result into a durable creative brief and reusable project.
3. **Create**: generate, review, render, and publish the video.

The channel picker remains global. The selected channel determines the default niche profile, publishing account, learned performance context, and chat history. Chat is an assistant layer over all three modes and can start or resume any stage without forcing the user to leave the current surface.

## Phase 1: Discovery workspace

### User flow

1. Open `/discover` and see a focused query bar plus saved research collections.
2. Start with a default scan for recent, faceless, niche-matched channels and videos.
3. Refine with filters without losing the result set.
4. Select a channel card to inspect its profile, recent uploads, outliers, competitors, and style signals.
5. Bookmark the channel, add it to a research collection, open the external channel, or create a style profile.
6. Select one or more channels/videos and click **Create Project**. The selected evidence becomes the project brief.

### Filters and sort modes

- Recency of the channel's first upload and most recent upload.
- Long-form, Shorts, or both.
- Language and region.
- Faceless confidence and monetization confidence, each clearly marked as inferred.
- Median views, average views, view-to-subscriber ratio, recent views per hour, subscriber range, video count, upload cadence, and duration range.
- Niche include/exclude terms and a micro-niche goal.
- Sort by discovery score, recency, median views, subscribers, upload consistency, view-to-subscriber ratio, and opportunity.

Use median and distribution metrics in the primary ranking. Keep average views as a secondary metric so one viral outlier does not distort a channel's typical performance.

### Result cards

Each channel card should show the profile image, name, handle, external link, niche, median views, subscriber count, recent upload cadence, best recent outlier, faceless/monetization confidence, and a compact action row:

- Bookmark.
- Similar channels.
- Copy style.
- Add to collection.
- Create project.

Each video card should show the creator identity, thumbnail, title, views, VPH, duration, published age, discovery score, and a link to the original. The same card component should be used in Radar, Feed, TikTok Explorer, and project source selection.

### Discovery persistence

Add saved `research_collections` containing the query, filters, result IDs, selected channels, selected videos, notes, and snapshots of metrics at save time. A saved collection must reopen at the same filters and route, even if live metrics later change.

## Phase 2: Style and project foundation

### Style profile

Promote the existing channel-style concept into a reusable profile with:

- Source channel and external URL.
- Reference videos with role labels: outlier, recent, representative, or manually selected.
- Transcript/style guide generated from the reference corpus.
- Hook patterns, title patterns, pacing, average target duration, word count, voice, speed, subtitle treatment, thumbnail cues, and visual style.
- Rights/provenance note and a clear “inspired by” boundary. The system should reproduce structural patterns, not copy scripts or thumbnails verbatim.

### Project model

Keep `CreatorProject` as the persistence boundary, but expand it from “a project attached to one source video” to a first-class creative workspace:

- `id`, `accountId`, `ownerId`, `title`, `status`, `version`.
- `nicheProfileId`, `styleProfileId`, `researchCollectionId`.
- `brief`: audience, promise, format, platform, target duration, tone, and source/rights notes.
- `inputs`: source videos, channel evidence, transcript, title candidates, selected voice, selected visual style, and selected music policy.
- `outputs`: structured stage outputs and asset references, never only rendered HTML or free-form JSON.
- `stageStates`: idle, queued, running, ready, stale, failed, archived.
- `createdAt`, `updatedAt`, `archivedAt`, `lastOpenedAt`.

Every stage output must be versioned and traceable to the input version that produced it. If the user changes the title or script, dependent stages become stale instead of silently retaining mismatched assets.

### Project history

Add a durable `/projects` route with search, filters, active/archived tabs, status, thumbnail, title, style, niche, last updated, and actions for reopen, duplicate, archive, restore, delete, and download bundle. Archive removes large generated media according to retention policy while keeping the brief, script, metadata, transcript, and a manifest of removed assets.

## Phase 3: Create Video workspace

### Flow

`/create` opens a project picker first. The user can reopen a project, duplicate one, or start from a style, saved research collection, a channel/video, or a blank brief.

The stage rail is:

1. **Title**: generate from selected style outliers, recent winners, a channel URL, or manual title list. Return multiple candidates with reasons and use-title action.
2. **Script**: generate from title and brief, or paste a script. Include web research toggle, word count override, additional context, and a transcript-backed outline.
3. **Description**: generate after title/script; retain tags, chapters, disclosure, and links as structured fields.
4. **Voiceover**: choose saved voice, speed, pronunciation, narration style, and local/remote provider. Preview before downstream jobs.
5. **Soundtrack**: infer mood from transcript, choose royalty-free providers, auto split by narrative sections, manual override, ducking, and explicit old-audio replacement/mix behavior.
6. **Visuals**: choose 9:16/16:9/1:1, quality, motion, visual style, image count, source policy, and advanced transcript timeline.
7. **Thumbnail**: choose a reference frame or upload a reference, describe changes, generate variants, compare, and select one.
8. **Review and export**: inspect video, voice, music, captions, durations, rights markers, and platform metadata. Render, download bundle, publish, or send to a connected channel.

### Dependency-aware concurrency

Run independent stages together:

- Title, initial description outline, and thumbnail brief can start from the project brief.
- Script unlocks description, voiceover, soundtrack, and visuals.
- Voiceover unlocks soundtrack timing, transcript scene boundaries, and visual timing.
- Selected visuals, voiceover, soundtrack, captions, and metadata unlock final render.

The UI should show a stage-level status and a single global progress line, with ETA based on measured job history. Leaving the page must not stop a job. `/processes` or the existing background center should show every stage and allow resume, retry, or stop.

### Advanced visual timeline

Reuse Voiceover Studio's timeline rather than building a second editor. Add:

- Transcript word/phrase boundaries as split candidates.
- A scene segment list with start/end, script excerpt, prompt, asset count, quality, animation, camera lock, and source policy.
- Split at nearest semantic or silence boundary.
- Per-segment regenerate, animate, delete, replace prompt, and retry.
- “Generate prompts” before expensive image/video generation.
- “Generate all” as an explicit second action after prompt review.
- Asset-level status and retry without rerunning successful segments.
- Output package containing narration, music, images, animated clips, rendered video, subtitles, script, and timestamps.

## Phase 4: Chat as the control surface

Chat should be able to say what is ready and execute the next valid action:

- “Find 20 recent anime recap channels under 100k subscribers.”
- “Bookmark the best five and create a project from the top three outliers.”
- “Generate three titles, then start the script and thumbnail brief.”
- “Use my saved Aniworld style, 800 words, and the client voice.”
- “Split visuals at transcript beats, animate the hook and use stills for the explanation.”
- “Render a preview, show the failed scenes, and retry only those scenes.”

Every action should return a structured card with source links, selected inputs, estimated cost/time, status, and an undo or open-project action. The agent must not claim a stage completed until its job record and asset manifest confirm it.

## Phase 5: Reliability and rights controls

- Enforce source rights confirmation before compilation or publishing.
- Store provenance for every channel, video, image, music track, voice, and generated asset.
- Keep provider keys server-side and use expiring capability URLs where external providers need media access.
- Make retries idempotent by stage and input fingerprint; never create duplicate paid jobs after a timeout.
- Validate output dimensions, duration, frame rate, audio presence, narration alignment, and subtitle coverage before export.
- Fail closed when a required scene role, media input, or provider response is missing.
- Add retention rules for archived assets and a visible storage estimate before expensive generation.

## Implementation order

1. Extract shared `ResearchCard`, `ChannelCard`, `VideoCard`, `StageStatus`, `AssetManifest`, and `ProjectStageRail` components.
2. Add saved research collections and the `/discover` route, backed by the existing Radar and Niche Library data.
3. Upgrade Creator Projects into the versioned first-class model and build `/projects` history.
4. Connect discovery actions to style profiles and project creation.
5. Consolidate Create Video around Voiceover Studio and add dependency-aware stage jobs.
6. Add soundtrack and visual advanced timeline orchestration with resumable per-segment generation.
7. Add chat commands, cards, approvals, undo, and background process linking.
8. Add export/publish validation, rights/provenance, retention, and end-to-end tests.

## Acceptance checks

- A user can search a niche, change filters, sort results, bookmark a channel, view competitors, copy its style, and create a project without losing the result state.
- A project reopened after refresh retains its selected channel, style, research evidence, stage outputs, and asset statuses.
- Title, description, and thumbnail can generate concurrently; script-dependent stages remain visibly blocked until script readiness.
- Voiceover completion unlocks soundtrack and visuals without restarting the project.
- A visual segment can be regenerated without charging or rerunning successful segments.
- Leaving the tab does not stop work; returning shows the same job and ETA.
- A final render cannot publish if video duration, audio, captions, rights confirmation, or target aspect ratio validation fails.
- All major discovery and create actions are available through chat and through direct UI routes.

## Tutorial-specific follow-up

The tutorial includes additional account, Discord, team-credit, subscription, and affiliate flows. Those are intentionally separate from the creator workflow above. AutoYT already has channel/account management and background processes; adding a second credit economy or community system should wait for a product decision. The valid tutorial file and transcript are retained locally under `/tmp/autoyt-watch-tubegen` for any follow-up implementation pass.

## UI direction (TubeGen layout, AutoYT palette)

A second, UI-focused watch of the tutorial (107 frames sampled across every feature) set the layout. TubeGen's structure is mirrored; its blue/violet palette and branding are not. AutoYT keeps warm paper `#f9f8f6`, white cards, charcoal ink, and yellow `#f9dc0b` for the single active or primary element.

| TubeGen pattern | AutoYT implementation |
| --- | --- |
| Sidebar: Create Video, Niche Finder, Styles, Project History | Same order in the one existing rail, after Tools. No second sidebar. |
| Dashboard hero cards + big-number stats | `/create`: yellow "Create a video", charcoal "Find a niche", white "Your styles" cards; Total / This month / In progress stats; recent projects. |
| "Select a Style" modal before a project opens | "Start a new video" modal: style tiles (with dashed Create style tile), saved research, YouTube channel, or blank. Opens straight on the Title stage. |
| Centered "Create Video" header + pill stage bar | Same, with the active stage as a yellow pill, a check for finished stages, a spinner while a stage runs in the background, and a dot for stale stages. |
| Generator card per stage (icon, name, one line, Generate top right) | Every stage uses one card with that anatomy. Title uses three icon option rows with radios; results are radio rows plus "Use title and continue". |
| Script: Web Search toggle, collapsed "Show options" | Same. Options summary shows style and word count. |
| Voiceover: collapsed script, voice picker, player | Same, plus the Whisper-aligned transcript. |
| Numbered steps for Soundtrack and Thumbnail | Soundtrack: source, mood and segments, find and import. Thumbnail: describe, generate three variants, choose one. |
| Visuals: Advanced toggle, numbered settings, Segment Settings, timeline, then Scene Generation with a sticky footer | Settings view (aspect, safe prompts, style, source; quality preset pills, pan-and-zoom and pacing tiles, image-count slider). Scene view: timeline with zoom, playhead, split, scene chips; per-scene cards with quoted transcript, duration bar, prompt, and image actions; sticky footer with scene count, Generate all images, Render video. |
| Niche Finder: centered header, filter chips, 3-column channel cards, Similar Channels / Copy Style, bookmarks, Advanced Filters modal | Same, including a Shuffle button and "Channels similar to X / Back to search". Cards show subscribers, median views, sample size, cadence, median length, and inferred faceless as chips. Monetization is not shown because it can't be verified. |
| Styles: cover cards, Review link, voice clones section, Create/Edit Style modal | Same. Edit modal: name, word count, language, voice, reference videos with roles, and a collapsed style guide with "Analyze 3 transcripts". |
| Project History: expandable rows, itemized archive warning | Same rows and actions. The archive modal lists what is kept, because AutoYT archive is non-destructive (TubeGen deletes media on archive). |

## Implementation status

Done in this pass:

- The UI above: `src/components/CreatorWorkspace.tsx` and `.css` were rebuilt, and the navigation in `src/App.tsx` was reordered.
- Channel bookmarks: they are saved as a research collection (`kind: "bookmarks"`) with snapshots taken at save time. This adds a new `PUT /api/maker/collections/:id` endpoint.
- The "Safe prompts" setting now changes the scene-prompt instruction on the server. Before this pass it only affected the fingerprint.
- Fixed a discovery bug: a `minRatio` of 0 (the default) was dropping every channel with unknown subscribers. A regression test covers it.
- Verification: `tsc` is clean, `vite build` passes, and all 55 test files (276 tests) pass. `scripts/test-creator-ui.mjs` (Playwright with mocked APIs) passes at 1440, 1024, and 390px, in light and dark themes, with no horizontal overflow on Create Video, Project History, Niche Finder, Styles, Title, Visuals, and the embedded Studio.

Second pass (the same day):

- **Chat control (Phase 4).** The `projects` chat tool now supports `status`, and status comes from saved job records: ready, running, stale, failed, or blocked, plus the next valid step. You can create a project from a saved style by name. Text stages queue directly. Voiceover, thumbnails, scene images, animation, and rendering return an approval button (`creator_stage`), and nothing starts until the user clicks it. The discover tool links to Niche Finder with the query filled in.
- **Similar channels.** `POST /api/maker/similar` builds a query from the channel's niche and its repeated title words. It searches Radar and leaves out the source channel.
- **Scene animation through OpenRouter.** Image-to-video uses `POST /videos` with the scene image as an input reference and the model set in `OPENROUTER_VIDEO_MODEL`. Each job is checkpointed per scene, so a retry resumes the paid job instead of submitting a new one. Clips are saved as scene assets, rendered in place of stills (padded to the scene's length), and included in the export bundle. When the key or model is missing, the UI switches the feature off and says what to set.
- **Storage and pruning.** `GET /api/maker/projects/:id/storage` reports usage by category. `POST /api/maker/projects/:id/prune` needs explicit confirmation and removes only render working files, renders, clips, and scene images. Voiceover, soundtrack, thumbnails, and references are always kept. It saves a list of removed files with the project. This is exposed as "Free up space" in Project History.
- **Estimates.** The confirmation dialogs now show request counts and approximate storage before paid generation.
- Contract tests cover similar-channel exclusion, storage categories, the pruning confirmation, kept categories, and the removal manifest. A real FFmpeg render of a mixed animated-clip and still sequence produced 6.0s at 1280×720 with audio and subtitle streams.

Third pass (the same day), closing gaps found by re-watching the tutorial with a full local transcript:

- **Thumbnail from a reference.** Upload an image or paste a YouTube link (the server fetches its public thumbnail), describe the changes, and choose 1–3 variants. The reference is sent to the image model as an input image and is never dropped on a retry. The result grid shows the reference beside each variant.
- **Original soundtrack.** The audio source is the generated voiceover or an uploaded audio/video file, which is converted to WAV and transcribed during auto-split. Auto-split returns timed segments with a mood and music direction for each. Segments can be split, retimed, muted, or removed by hand. Composing uses Google Lyria 3 Pro through OpenRouter (`/chat/completions` with `modalities: ["text","audio"]` and `stream: true`; the model can be overridden with `OPENROUTER_MUSIC_MODEL`). Each request covers up to about 170s of consecutive segments, with the timed plan in the prompt. The streamed audio is assembled whatever its format (WAV, WAV pieces, MP3, or bare PCM), then looped or trimmed in FFmpeg to fit its span exactly. Each part is saved under its request fingerprint, so a retry never pays twice, and muted ranges are silenced in FFmpeg. Provider names are kept out of UI copy and error messages. Royalty-free import still works.
- **Art style library.** Twelve built-in styles plus reusable custom styles built from 1–4 reference frames. Custom styles are stored as `creator_research_collections` rows with `kind: "artStyle"`, so no migration is needed, and their images live under `art-styles/`. The research collection routes refuse and hide those rows.
- **Per-segment settings.** The narration splits only at sentence ends. Each segment sets animation, quality (Standard 1K / High 2K / Ultra 4K), and an image count capped at one image per sentence. Scene planning uses `segmentScenes`.
- **Animation controls.** A direction prompt per scene, a model picker (`OPENROUTER_VIDEO_MODEL` plus `OPENROUTER_VIDEO_MODELS`), and a fixed-camera option.
- **Fix:** saving the scene list used to drop `animate` and `clip`. It now keeps them, and keeps a clip only while its image and animation direction are unchanged.
- **Scene reference images:** the per-scene "Reference" source is now actually sent to the image model. Before, it was ignored.
- **Smaller gaps:**
  - Download all scene images as a zip with `timestamps.txt`.
  - Project History: Edit details (rename, change style) and Download thumbnail.
  - Style editor: voice speed, delivery, and pronunciation. Voicebox has no stability, similarity, or exaggeration controls, so those are not shown.
  - Voice cloning: optional background noise removal (FFmpeg highpass, lowpass, and FFT denoise).
  - Niche Finder: channel-created date range, channel video count range, average views range, max median views, and a "Newest channels" sort. Content quality was left out because there's no signal to base it on.

Still open:

- Paid smoke tests for the third pass: OpenRouter `/images` with `input_references` (reference thumbnail edits and art-style matching) and Lyria 3 Pro streamed audio are built from their documented request shapes but haven't run against the live APIs. Lyria's exact length control isn't documented, so length is requested in the prompt and enforced by FFmpeg.
- Real end-to-end runs against a database and paid providers. The OpenRouter video model and its request parameters (`duration`, `resolution`) need one paid smoke test before production use.
- A credit economy. This is intentionally out of scope; confirmation dialogs name the provider instead.
