// Juel: the one AutoYT agent. A manager talks to the user and hands work to specialists; every ability
// in the app is a route in JUEL_ROUTES, owned by a specialist and graded by risk, and Juel calls it as the
// signed-in user, so each route's own sign-in, checks, and limits still apply. A new route has to be
// catalogued here (or excluded, with a reason): server/juel.test.ts fails the build otherwise.
// The same catalogue is the public API: personal access tokens call these routes (scoped by risk) and the
// MCP server at /mcp gives AI agents Juel and the whole API.
import { createHash, randomBytes } from "node:crypto";

/** The specialists the manager hands work to. Their briefs go into the manager's prompt. */
export const JUEL_SPECIALISTS = {
  automation: { name: "Automation", brief: "channel automation agents: their schedules, runs, source pools, learning, and compilations" },
  publisher: { name: "Publisher", brief: "connected channels and accounts, uploads, thumbnails, playlists, posting, and scheduling" },
  recap: { name: "Recap", brief: "Movie to Recap: analysing a film, the script and storyboard, matching footage, rendering, posting" },
  editor: { name: "Editor", brief: "Vibe Edit: the timeline, captions, voiceover, music, B-roll, auto edit, and exports" },
  producer: { name: "Producer", brief: "Create Video projects (script, voice, visuals, thumbnail, export), digital products, production profiles, channel styles" },
  studio: { name: "Studio", brief: "image, video, and music generation, workflows, design, explainers, the prompt library, mini tools, and voices" },
  film: { name: "Film", brief: "Drama and Film: series, episodes, characters, locations, voices, clips, and the final cut" },
  research: { name: "Research", brief: "YouTube Radar, niches, competitors, growth insights, Movie ID, source scans, downloads, transcripts, rewriting" },
  community: { name: "Community", brief: "comment replies on YouTube and TikTok and their rules" },
  account: { name: "Account", brief: "the user's account, settings, plan, credits, billing, and support" },
  admin: { name: "Admin", brief: "the admin console: users, plans, usage, system health (admins only)" },
};

/** Risk, lowest first. Nothing waits on a card: a paid call shows the user its credit cost and runs when
 *  their balance covers it (else it's refused); publish and delete run only when the user asked for them. */
export const JUEL_RISKS = ["read", "change", "paid", "publish", "delete"];
export const spendsCredits = (risk) => risk === "paid";

/** @typedef {Record<string, string[]>} JuelRouteTable "METHOD /path" -> [specialist, risk, what it does] */
/** @typedef {Record<string, string>} JuelExclusions "METHOD /path" -> why Juel never calls it */
/** @typedef {{ routes?: JuelRouteTable, excluded?: JuelExclusions }} JuelTables */

/** "METHOD /path" -> [specialist, risk, what it does], for every route Juel can call.
 *  @type {JuelRouteTable} */
export const JUEL_ROUTES = {
  "DELETE /api/admin/team/:email": ["admin", "delete", "Removes a person from the admin team."],
  "DELETE /api/automation/agents/:id": ["automation", "delete", "Deletes this automation agent permanently (agent id)."],
  "DELETE /api/automation/agents/:id/chats/:chatId": ["automation", "delete", "Deletes a saved chat conversation with this agent (agent id, chat id)."],
  "DELETE /api/automation/agents/:id/remake/faces/:faceId": ["automation", "delete", "Deletes an avatar photo from this agent's remake faces (agent id, face id)."],
  "DELETE /api/automation/uploads/:id": ["automation", "delete", "Removes an agent upload record, optionally deleting the published YouTube video too (upload id)."],
  "DELETE /api/digital-products/:id": ["producer", "delete", "Deletes a digital product and its cover."],
  "DELETE /api/maker/art-styles/:id": ["producer", "delete", "Deletes one of your custom art styles and its images."],
  "DELETE /api/maker/collections/:id": ["research", "delete", "Deletes one of your research collections."],
  "DELETE /api/prompts/custom/:id": ["studio", "delete", "Deletes one of your saved custom prompts."],
  "DELETE /api/recaps/:id": ["recap", "delete", "Permanently deletes a recap with its source film, renders, and narration files."],
  "DELETE /api/saved/tiktok-playlists": ["research", "delete", "Removes a saved TikTok source from your library (key)."],
  "DELETE /api/studio/generations/:id": ["studio", "delete", "Deletes a Creator Studio generation and its output files."],
  "DELETE /api/studio/marketing/avatars/:id": ["studio", "delete", "Deletes one of your custom ad presenters."],
  "DELETE /api/studio/marketing/products/:id": ["studio", "delete", "Deletes one of your saved ad products."],
  "DELETE /api/vibe-edit/projects/:id": ["editor", "delete", "Removes a Vibe Edit project from the user's project list (project id)."],
  "DELETE /api/voicebox/profiles/:id": ["studio", "delete", "Permanently deletes one of your cloned voices."],
  "DELETE /api/youtube/accounts/:id": ["publisher", "delete", "Disconnects this YouTube/TikTok channel account from AutoYT (account id)."],
  "DELETE /api/youtube/comments/:id": ["community", "delete", "Deletes a comment your channel posted (comment id)."],
  "DELETE /api/youtube/videos/:id": ["publisher", "delete", "Permanently deletes a video from your YouTube channel and its AutoYT record (video id)."],
  "DELETE /api/youtube/videos/:videoId/captions/:captionId": ["publisher", "delete", "Deletes a caption track from your YouTube video."],
  "GET /api/admin/activity": ["admin", "read", "Lists recent activity across jobs, projects and agents."],
  "GET /api/admin/activity/:type/:ref": ["admin", "read", "Shows one activity record with its user and agent."],
  "GET /api/admin/audit": ["admin", "read", "Lists the admin audit log, filterable by admin or target."],
  "GET /api/admin/billing/ledger": ["admin", "read", "Lists credit ledger entries across users."],
  "GET /api/admin/billing/orders": ["admin", "read", "Lists payment orders."],
  "GET /api/admin/billing/plans": ["admin", "read", "Lists billing plans with subscribers, economics and 30-day provider cost."],
  "GET /api/admin/billing/plans/:id": ["admin", "read", "Shows one billing plan's details and economics."],
  "GET /api/admin/billing/plans/:id/subscribers": ["admin", "read", "Lists users subscribed to one billing plan."],
  "GET /api/admin/billing/provider-prices": ["admin", "read", "Lists AI models used with real costs, catalog prices and overrides."],
  "GET /api/admin/billing/summary": ["admin", "read", "Shows a billing revenue and plan summary."],
  "GET /api/admin/insights": ["admin", "read", "Shows business insights: MRR, ARR, churn and cohorts."],
  "GET /api/admin/me": ["admin", "read", "Returns the current admin's identity, role and permissions."],
  "GET /api/admin/overview": ["admin", "read", "Shows admin dashboard totals, usage series, top users, signups and recent audit."],
  "GET /api/admin/queues/:queue": ["admin", "read", "Lists media or creator queue jobs with status counts."],
  "GET /api/admin/settings": ["admin", "read", "Shows governance, billing and support settings plus provider list."],
  "GET /api/admin/support/tickets": ["admin", "read", "Lists support tickets from all users with filters."],
  "GET /api/admin/support/tickets/:id": ["admin", "read", "Shows one support ticket thread including internal notes."],
  "GET /api/admin/system": ["admin", "read", "Shows system health: queue states, recent failures and external services."],
  "GET /api/admin/team": ["admin", "read", "Lists super admins and admin team members with roles."],
  "GET /api/admin/team/:email": ["admin", "read", "Shows one admin team member's role and audit activity stats."],
  "GET /api/admin/usage": ["admin", "read", "Shows AI usage and cost totals over a period."],
  "GET /api/admin/usage/breakdown": ["admin", "read", "Breaks usage down by provider, model, feature or operation."],
  "GET /api/admin/usage/events": ["admin", "read", "Lists individual AI usage events."],
  "GET /api/admin/users": ["admin", "read", "Lists and searches users with paging."],
  "GET /api/admin/users/:id": ["admin", "read", "Shows one user's profile, billing and account details."],
  "GET /api/admin/users/:id/content": ["admin", "read", "Lists content and projects one user has created."],
  "GET /api/admin/users/:id/sessions": ["admin", "read", "Lists one user's sign-in sessions."],
  "GET /api/admin/users/:id/usage": ["admin", "read", "Shows one user's AI usage and costs."],
  "GET /api/app/notice": ["account", "read", "Returns the current site announcement, maintenance notice and AI pause flag."],
  "GET /api/auth/session": ["account", "read", "Returns the signed-in user, connected channels and active channel."],
  "GET /api/automation/active-runs": ["automation", "read", "Lists your automation agents that are currently running and their phase."],
  "GET /api/automation/agents": ["automation", "read", "Lists your automation agents with their settings and status."],
  "GET /api/automation/agents/:id": ["automation", "read", "Shows one automation agent with its recent runs, uploads and learning profile (agent id)."],
  "GET /api/automation/agents/:id/chats": ["automation", "read", "Lists saved chat conversations with this automation agent (agent id)."],
  "GET /api/automation/agents/:id/learning": ["automation", "read", "Shows what this agent has learned about which micro-niches perform best (agent id)."],
  "GET /api/automation/agents/:id/report": ["automation", "read", "Shows this agent's performance report with upload results and recommended decisions (agent id)."],
  "GET /api/automation/agents/:id/source-pool": ["automation", "read", "Shows how this agent's source pool is being used, scan issues and active deep scans."],
  "GET /api/automation/options": ["automation", "read", "Lists your connected channels and saved sources available for setting up automation agents."],
  "GET /api/automation/uploads/:id/voice/jobs": ["studio", "read", "Lists the Voice Studio job history for an upload (upload id)."],
  "GET /api/automation/uploads/:id/voice/jobs/latest": ["studio", "read", "Shows the latest Voice Studio job for an upload (upload id)."],
  "GET /api/automation/voice/jobs/:id": ["studio", "read", "Shows progress and output files of a Voice Studio job (job id)."],
  "GET /api/automation/voice/music/search": ["studio", "read", "Searches royalty-free background music by mood or keywords (q, mood)."],
  "GET /api/automation/voice/narration-styles": ["studio", "read", "Lists your saved narration styles for Voice Studio."],
  "GET /api/automation/voice/status": ["studio", "read", "Shows whether Voice Studio is online, available voices and stem/caption engines."],
  "GET /api/background-jobs": ["account", "read", "Lists your running and recent background jobs across the app."],
  "GET /api/billing/lingbase/config": ["account", "read", "Returns the public LingBase payment client configuration."],
  "GET /api/billing/me": ["account", "read", "Shows the user's plan, credit balance, available plans and credit bundles."],
  "GET /api/billing/history": ["account", "read", "Shows the user's payments, credit ledger, and the last 30 days of credit use by feature and by day."],
  "GET /api/account/overview": ["account", "read", "Shows the user's profile, when they joined, signed-in device count and connected channel count."],
  "GET /api/account/telegram": ["account", "read", "Shows whether the user's Telegram chat is linked to AutoYT."],
  "GET /api/channel-styles": ["producer", "read", "Lists saved channel style profiles for your connected channel."],
  "GET /api/compilations/jobs/:id": ["publisher", "read", "Shows progress and result of a compilation job (job id)."],
  "GET /api/creator-projects": ["producer", "read", "Lists your creator projects for a connected YouTube channel, optionally filtered by source."],
  "GET /api/digital-products": ["producer", "read", "Lists your digital products (ebooks) with their drafts."],
  "GET /api/digital-products/story-bibles": ["producer", "read", "Lists your drama series story bibles that can be adapted into ebooks."],
  "GET /api/drama/episodes/:id": ["film", "read", "Shows an episode with its script, scenes, boards, voices, clips, and final cut status."],
  "GET /api/drama/series": ["film", "read", "Lists the user's drama/film series with episode made and rendered counts."],
  "GET /api/drama/series/:id": ["film", "read", "Shows a series with its concept, cast, outline, and episode list (series id)."],
  "GET /api/drama/series/:id/production": ["film", "read", "Shows a series' production state: character sheets, location sheets, and designed voices (series id)."],
  "GET /api/feed/insights": ["research", "read", "Lists feed insight cards (ideas, alerts, opportunities) for your channel, optionally by type."],
  "GET /api/film/song/analyze/:id": ["film", "read", "Checks the progress and result of a song analysis job (job id)."],
  "GET /api/growth/insights": ["research", "read", "Shows growth insights and opportunities for your connected YouTube channel."],
  "GET /api/maker/art-styles": ["producer", "read", "Lists preset and your custom art styles for Create Video visuals."],
  "GET /api/maker/capabilities": ["producer", "read", "Shows which Create Video media features (images, animation, music, stock) are available."],
  "GET /api/maker/collections": ["research", "read", "Lists your saved research collections for the active channel."],
  "GET /api/maker/projects/:id": ["producer", "read", "Shows a Create Video project with its stages, outputs, and jobs."],
  "GET /api/maker/projects/:id/storage": ["producer", "read", "Shows how much storage each kind of file in a Create Video project uses."],
  "GET /api/maker/styles/:id/jobs": ["producer", "read", "Lists the learning jobs for one of your channel styles."],
  "GET /api/movie/poster": ["research", "read", "Looks up a movie's poster, overview, cast and TMDB/IMDb links by title and year."],
  "GET /api/niches": ["research", "read", "Lists the niche library with macro and sub-niche hierarchy and geo tiers."],
  "GET /api/production/profiles": ["producer", "read", "Lists the available production profiles and playbooks for Create Video."],
  "GET /api/prompts": ["studio", "read", "Searches the prompt library and your saved prompts by query, category, and output type."],
  "GET /api/prompts/suggest": ["studio", "read", "Suggests library prompts for a category and optional context."],
  "GET /api/recaps": ["recap", "read", "Lists the user's Movie to Recap projects with status, plus recap length limits."],
  "GET /api/recaps/:id": ["recap", "read", "Shows a recap's status, outputs, posts, and its script (recap id)."],
  "GET /api/recaps/:id/backdrops": ["recap", "read", "Gets text-free film stills from TMDB for a recap's progress slideshow (recap id)."],
  "GET /api/recaps/:id/post/channels": ["recap", "read", "Lists the user's connected channels this recap can be posted to (recap id)."],
  "GET /api/recaps/sources": ["recap", "read", "Lists the user's saved film sources used for finding movies to recap."],
  "GET /api/saved/tiktok-playlists": ["research", "read", "Lists your saved TikTok sources (profiles, collections) with summaries."],
  "GET /api/saved/tiktok-playlists/by-slug/:slug": ["research", "read", "Gets a saved TikTok source and its videos by slug."],
  "GET /api/saved/tiktok-playlists/by-url": ["research", "read", "Gets a saved TikTok source and its videos by URL."],
  "GET /api/saved/tiktok-playlists/deep-scan": ["research", "read", "Shows active TikTok source deep scans, optionally for one URL."],
  "GET /api/saved/tiktok-playlists/genre-scan": ["research", "read", "Shows story-genre scan progress for a saved TikTok source (key or slug)."],
  "GET /api/saved/tiktok-playlists/movie-scan": ["research", "read", "Shows movie-identification scan results and summary for a saved TikTok source."],
  "GET /api/saved/tiktok-playlists/movie-scan/pending": ["research", "read", "Lists a saved source's videos still waiting for comment caching (key or slug)."],
  "GET /api/saved/tiktok-post-analyses": ["research", "read", "Lists saved movie-ID analyses of TikTok posts, optionally for one source."],
  "GET /api/saved/tiktok-post-analyses/:slug": ["research", "read", "Gets the saved movie-ID analysis for one TikTok post (slug)."],
  "GET /api/saved/tiktok-posts/:slug": ["research", "read", "Finds a saved TikTok post by slug across your saved sources."],
  "GET /api/studio/catalog": ["studio", "read", "Lists the Creator Studio models and tools available for images, video, audio, and more."],
  "GET /api/studio/generations": ["studio", "read", "Lists your recent Creator Studio generations, optionally filtered by tab."],
  "GET /api/studio/marketing": ["studio", "read", "Lists your ad products, presenter avatars, and available ad video models."],
  "GET /api/support/tickets": ["account", "read", "Lists the user's support requests with status and last reply."],
  "GET /api/support/tickets/:id": ["account", "read", "Shows one of the user's support requests with its message thread."],
  "GET /api/transcribe/jobs/:id": ["research", "read", "Shows status and transcript of a queued transcription job (job id)."],
  "GET /api/vibe-edit/projects": ["editor", "read", "Lists the user's Vibe Edit projects."],
  "GET /api/vibe-edit/projects/:id": ["editor", "read", "Opens a Vibe Edit project's full timeline document (project id)."],
  "GET /api/vibe-edit/renders/:id": ["editor", "read", "Checks the progress and result of a Vibe Edit export (render id)."],
  "GET /api/voicebox/history/:id": ["studio", "read", "Checks the status of a voice generation and returns its audio link."],
  "GET /api/voicebox/profiles": ["studio", "read", "Lists the voices you can use, including your own cloned voices."],
  "GET /api/youtube/channel/dashboard": ["publisher", "read", "Shows your connected channel's stats, recent videos, growth insights and feed suggestions."],
  "GET /api/youtube/monetization": ["publisher", "read", "Shows YouTube revenue and monetization analytics for your channel over a chosen period."],
  "GET /api/youtube/playlists": ["publisher", "read", "Lists the playlists on your connected YouTube channel."],
  "GET /api/youtube/videos/:id/analytics": ["publisher", "read", "Shows views, watch time and audience analytics for one of your videos (video id, days)."],
  "GET /api/youtube/videos/:id/captions": ["publisher", "read", "Lists the caption tracks on one of your YouTube videos (video id)."],
  "GET /api/youtube/videos/:id/comments": ["community", "read", "Lists comments and replies on one of your videos (video id)."],
  "GET /api/youtube/videos/:id/optimization": ["publisher", "paid", "Generates AI title, description and tag suggestions to optimize one of your videos."],
  "GET /api/youtube/videos/:videoId/captions/:captionId/download": ["publisher", "read", "Downloads a caption track's text as SRT or another format."],
  "PATCH /api/creator-projects/:id": ["producer", "change", "Updates a creator project's fields, outputs, or status."],
  "PATCH /api/drama/episodes/:id": ["film", "change", "Edits an episode's title, scene script, or settings (quality, subtitles, title cards)."],
  "PATCH /api/drama/series/:id": ["film", "change", "Edits a series: title, logline, tone, cast, episodes, locations, story bible, song, voices, or archive status."],
  "PATCH /api/maker/projects/:id": ["producer", "change", "Edits a Create Video project's title, brief, settings, stage output, or status, including archive/delete."],
  "PATCH /api/maker/styles/:id": ["producer", "change", "Renames or updates a channel style profile, or marks it deleted."],
  "PATCH /api/recaps/:id/script": ["recap", "change", "Saves edits to a recap script: title and each format's narration beats and timings."],
  "PATCH /api/saved/tiktok-playlists/auto-tags": ["research", "change", "Adds automatic tags to a saved TikTok source (key, tags)."],
  "PATCH /api/saved/tiktok-playlists/tags": ["research", "change", "Sets the tags on a saved TikTok source (key, tags)."],
  "PATCH /api/voicebox/profiles/:id": ["studio", "change", "Renames one of your voices or changes its description."],
  "PATCH /api/youtube/comments/:id": ["community", "publish", "Edits the text of a comment your channel posted (comment id, text)."],
  "PATCH /api/youtube/videos/:id/metadata": ["publisher", "publish", "Updates a published YouTube video's title, description, tags or privacy (video id)."],
  "PATCH /api/youtube/videos/:videoId/captions/:captionId": ["publisher", "publish", "Updates an existing caption track on your YouTube video."],
  "POST /api/account/delete": ["account", "delete", "Permanently deletes the user's account and data after typed confirmation."],
  "POST /api/admin/billing/plans": ["admin", "change", "Creates or updates a billing plan's price, credits, features and default."],
  "POST /api/admin/billing/plans/:id/bulk": ["admin", "change", "Grants credits to, or moves, every user on a plan."],
  "POST /api/admin/billing/provider-prices/refresh": ["admin", "change", "Reloads the provider model price catalog."],
  "POST /api/admin/creator-jobs/:id/:action": ["admin", "delete", "Retries a failed creator stage job or cancels a queued/running one."],
  "POST /api/admin/jobs/:id/cancel": ["admin", "delete", "Cancels a queued or running media job."],
  "POST /api/admin/jobs/:id/retry": ["admin", "paid", "Requeues a failed or cancelled media job to run again."],
  "POST /api/admin/queues/:queue/bulk": ["admin", "delete", "Bulk retries recent failed jobs or cancels queued jobs in a queue."],
  "POST /api/admin/support/tickets/:id": ["admin", "change", "Updates a support ticket's status, priority or assignee."],
  "POST /api/admin/support/tickets/:id/messages": ["admin", "change", "Posts an admin reply or internal note on a support ticket."],
  "POST /api/admin/team": ["admin", "change", "Adds a person to the admin team or changes their role."],
  "POST /api/admin/users/:id/agents/pause": ["admin", "change", "Pauses one or all of a user's active automation agents."],
  "POST /api/admin/users/:id/billing": ["admin", "change", "Updates a user's billing account: unlimited flag, notes or status."],
  "POST /api/admin/users/:id/plan": ["admin", "change", "Changes a user's plan, optionally resetting their monthly allowance."],
  "POST /api/admin/users/:id/sessions/:sessionId/revoke": ["admin", "delete", "Signs a user out of one session by deleting it."],
  "POST /api/admin/users/:id/sessions/revoke": ["admin", "delete", "Signs a user out everywhere by deleting all their sessions."],
  "POST /api/admin/users/:id/status": ["admin", "delete", "Suspends a user (with reason, ending all sessions) or restores them."],
  "POST /api/admin/users/:id/tokens": ["admin", "change", "Grants or revokes credits for a user with a ledger note."],
  "POST /api/automation/agents": ["automation", "change", "Creates or updates an automation agent with its channel, sources and schedule settings."],
  "POST /api/automation/agents/:id/delete": ["automation", "delete", "Deletes this automation agent permanently (agent id); POST alias of the delete route."],
  "POST /api/automation/agents/:id/chat": ["automation", "change", "Consults this agent's own operator (its memory, learning, live performance, tools, and settings rules) with a message; it can change the agent's settings and its answer is shown to the user (body: {message})."],
  "POST /api/automation/agents/:id/remake/faces": ["automation", "change", "Uploads an avatar photo this agent can swap into its remakes (agent id, image)."],
  "POST /api/automation/agents/:id/run": ["automation", "publish", "Runs this automation agent once now, producing and publishing its next video (agent id)."],
  "POST /api/automation/agents/:id/run-compilation": ["automation", "publish", "Starts a long-form compilation run for this agent that builds and uploads a video."],
  "POST /api/automation/agents/:id/stop": ["automation", "change", "Stops this agent's in-progress run unless it has already started publishing (agent id)."],
  "POST /api/automation/agents/:id/voice/sources": ["studio", "paid", "Imports a YouTube or TikTok video as a Voice Studio source for this agent (source url)."],
  "POST /api/automation/performance/check": ["automation", "change", "Refreshes view and performance stats for your agent uploads from the last 90 days."],
  "POST /api/automation/uploads/:id/movie-id/correct": ["automation", "change", "Corrects the identified movie for an agent upload to the right title/year (upload id)."],
  "POST /api/automation/uploads/:id/reupload": ["automation", "publish", "Re-downloads an agent upload's source and uploads it again to YouTube in HD (upload id)."],
  "POST /api/automation/uploads/:id/voice/jobs": ["studio", "paid", "Starts a Voice Studio job on an upload: voiceover, voice clone, captions, stems or avatar remake."],
  "POST /api/automation/voice/jobs/:id/stop": ["studio", "change", "Stops a running Voice Studio job (job id)."],
  "POST /api/billing/lingbase/sync": ["account", "change", "Syncs the user's LingBase payments into their plan and credit balance."],
  "POST /api/channel-styles/copy": ["producer", "change", "Analyzes another YouTube channel and saves its style as a reusable profile for your channel."],
  "POST /api/competitors/youtube/discover": ["research", "change", "Finds competitor YouTube channels similar to yours and saves them as tracked competitors."],
  "POST /api/compilations/create": ["publisher", "publish", "Builds a long-form compilation from selected clips and uploads it to your channel or for download."],
  "POST /api/creator-projects": ["producer", "change", "Creates a creator project for a channel from a video, brief, or style."],
  "POST /api/creator-projects/:id/generate/:stage": ["producer", "paid", "AI-drafts one project stage: title, SEO, script, visual plan, thumbnail, or publishing plan."],
  "POST /api/digital-products": ["producer", "change", "Creates a digital product draft from an idea or a drama story bible."],
  "POST /api/digital-products/:id/cover": ["producer", "paid", "Generates an ebook cover image for a digital product."],
  "POST /api/digital-products/:id/generate": ["producer", "paid", "AI-writes the full ebook manuscript for a digital product from its idea."],
  "POST /api/downloader/inspect": ["research", "read", "Inspects a video URL and lists its title, duration and available download formats (url)."],
  "POST /api/drama/episodes/:id/final": ["film", "paid", "Cuts all rendered scene clips into the final episode video with title cards and subtitles."],
  "POST /api/drama/episodes/:id/prepare": ["film", "paid", "Draws storyboards and voices dialogue for every scene in an episode that still needs them."],
  "POST /api/drama/episodes/:id/quality-review": ["film", "change", "Runs a preflight quality check on an episode and saves the review with AI next-step advice."],
  "POST /api/drama/episodes/:id/render-all": ["film", "paid", "Renders video clips for every scene missing or out of date in an episode (requires confirmed)."],
  "POST /api/drama/episodes/:id/scenes/:sid/:step": ["film", "paid", "Runs one scene step: draws its storyboard, voices its dialogue, or renders its video clip (confirmed)."],
  "POST /api/drama/episodes/:id/script": ["film", "paid", "Writes the episode's screenplay with AI from the series outline, with an optional creator note."],
  "POST /api/drama/idea": ["film", "paid", "Develops a drama, film, or music-video concept with AI from chat messages (messages, format)."],
  "POST /api/drama/series": ["film", "paid", "Creates a series or film from a template or concept, then starts its AI outline and poster."],
  "POST /api/drama/series/:id/characters/:cid/lock": ["film", "change", "Locks one of a character's generated sheets as its reference image (asset)."],
  "POST /api/drama/series/:id/characters/:cid/photo": ["film", "change", "Uploads a base64 PNG/JPEG/WebP photo as a character's likeness reference (image, mediaType)."],
  "POST /api/drama/series/:id/characters/:cid/sheet": ["film", "paid", "Generates one or two AI character reference sheets for a series character (series id, character id, count)."],
  "POST /api/drama/series/:id/characters/:cid/voice-design": ["film", "paid", "Designs three candidate AI voices for a character from a voice description and sample line."],
  "POST /api/drama/series/:id/characters/:cid/voice-preview": ["film", "paid", "Speaks a sample line in a chosen voice for a character so you can hear it (voiceId, text)."],
  "POST /api/drama/series/:id/characters/:cid/voice-select": ["film", "paid", "Assigns a voice to a character: an existing voiceId, or clones a chosen designed voice."],
  "POST /api/drama/series/:id/episodes": ["film", "change", "Creates (or returns) the episode project for an outlined episode number (episode)."],
  "POST /api/drama/series/:id/locations/:lid/lock": ["film", "change", "Locks one of a location's generated sheets as its reference image (asset)."],
  "POST /api/drama/series/:id/locations/:lid/sheet": ["film", "paid", "Generates an AI reference sheet image for a series location (series id, location id)."],
  "POST /api/drama/series/:id/outline": ["film", "paid", "Rewrites the series episode outline with AI, with an optional note (confirm if episodes exist)."],
  "POST /api/drama/series/:id/poster": ["film", "paid", "Generates an AI cover poster for an original (non-template) series."],
  "POST /api/drama/series/:id/song/beats": ["film", "change", "Re-detects the beat grid of a music video's song and saves it to the series."],
  "POST /api/feed/insights/:id/action": ["research", "change", "Marks a feed insight as done, used or dismissed (insight id, action)."],
  "POST /api/film/song/analyze": ["film", "paid", "Starts analyzing an uploaded song: beat grid, vocal separation, and lyric transcription (studio file)."],
  "POST /api/maker/art-styles": ["producer", "change", "Saves a custom art style from a name, description, and 1-4 reference images."],
  "POST /api/maker/art-styles/from-video": ["producer", "paid", "Captures a reusable art style from a video link using download, AI vision, and an example image."],
  "POST /api/maker/collections": ["research", "change", "Saves a new research collection with a name and data."],
  "POST /api/maker/discover": ["research", "paid", "Finds competitor channels for a niche query or YouTube link, ranked by AI."],
  "POST /api/maker/jobs/:id/stop": ["producer", "change", "Stops a queued or running Create Video job."],
  "POST /api/maker/projects/:id/cast/:castId/approve": ["producer", "change", "Locks a generated character sheet as that cast member's reference image."],
  "POST /api/maker/projects/:id/cast/:castId/sheets": ["producer", "paid", "Generates character reference sheet images for one cast member."],
  "POST /api/maker/projects/:id/cast/suggest": ["producer", "paid", "AI-reads the project script and suggests recurring on-screen characters."],
  "POST /api/maker/projects/:id/duplicate": ["producer", "change", "Duplicates a Create Video project with its text outputs and settings."],
  "POST /api/maker/projects/:id/jobs/:stage": ["producer", "paid", "Starts a Create Video stage job, such as script, voiceover, visuals, thumbnail, or final render."],
  "POST /api/maker/projects/:id/prune": ["producer", "delete", "Permanently removes chosen kinds of files from a Create Video project to free storage."],
  "POST /api/maker/projects/:id/quality-review": ["producer", "change", "Runs a rule-based quality check on a Create Video project against a production profile."],
  "POST /api/maker/projects/:id/reference-assets": ["producer", "change", "Uploads a base64 reference image to a Create Video project."],
  "POST /api/maker/projects/:id/soundtrack": ["producer", "change", "Imports a licensed base64 music file as the project's soundtrack."],
  "POST /api/maker/projects/:id/soundtrack-source": ["producer", "change", "Uploads or clears an audio/video file whose track becomes the project's audio source."],
  "POST /api/maker/projects/:id/soundtrack-url": ["producer", "change", "Imports licensed music from a URL as the project's soundtrack."],
  "POST /api/maker/projects/:id/studio": ["producer", "change", "Attaches a finished studio voice job's video, narration, captions, and scenes to a project."],
  "POST /api/maker/projects/:id/thumbnail-reference": ["producer", "change", "Sets a thumbnail reference image from an upload or a YouTube video link."],
  "POST /api/maker/projects/:id/vibe-edit": ["producer", "change", "Opens a Create Video project's own Vibe Edit edit, building it from the storyboard the first time; {refresh: true} swaps in changed scene media keeping the cuts, {rebuild: true} starts it over. Returns {projectId, stale}."],
  "POST /api/maker/projects/:id/vibe-edit/export": ["producer", "change", "Makes a Vibe Edit export (gen-vibe-….mp4 file) the Create Video project's final video, with captions from the edit (file)."],
  "POST /api/maker/similar": ["research", "read", "Finds channels similar to a given channel from recent YouTube videos."],
  "POST /api/maker/styles/:id/learn": ["producer", "paid", "Starts a job that learns a channel style from its videos."],
  "POST /api/movie/identify-link": ["research", "paid", "Identifies the movie shown in a recap video from its URL."],
  "POST /api/prompts/custom": ["studio", "change", "Saves a custom prompt with title, text, and categories."],
  "POST /api/prompts/favorites": ["studio", "change", "Adds or removes a prompt from your favorites."],
  "POST /api/recaps": ["recap", "paid", "Starts a new movie recap from a film link or upload with voice, formats, tone, and look options."],
  "POST /api/recaps/:id/back": ["recap", "change", "Stops rendering and returns the recap to the storyboard for script edits, keeping analysis and script."],
  "POST /api/recaps/:id/cancel": ["recap", "change", "Stops a recap that is in progress."],
  "POST /api/recaps/:id/intro": ["recap", "paid", "Turns the long recap's teaser intro on (AI writes the line) or off (on)."],
  "POST /api/recaps/:id/names": ["recap", "paid", "Corrects character names in the recap script to the film's TMDB cast using AI."],
  "POST /api/recaps/:id/post": ["recap", "publish", "Uploads a rendered recap to a channel with title, description, tags, and privacy (format, accountId)."],
  "POST /api/recaps/:id/post/draft": ["recap", "paid", "Writes an AI title, description, and tags for posting a recap to a chosen channel (format, accountId)."],
  "POST /api/recaps/:id/posts/:postId/thumbnail": ["recap", "publish", "Sets the YouTube thumbnail of an already posted recap video to the recap's still or poster."],
  "POST /api/recaps/:id/recut": ["recap", "paid", "Replaces one cut of a finished recap with an AI-picked better shot, or a chosen time."],
  "POST /api/recaps/:id/render": ["recap", "paid", "Renders this recap with the current script, optionally changing voice, captions, zoom, or pan."],
  "POST /api/recaps/:id/retry": ["recap", "paid", "Restarts a failed or stuck recap from its current stage, optionally with a new voice."],
  "POST /api/recaps/:id/rewrite": ["recap", "paid", "Writes the recap script again with AI from the existing film analysis."],
  "POST /api/recaps/:id/shots": ["recap", "paid", "Ranks the best candidate film shots for one recap cut's narration with AI (format, index, note)."],
  "POST /api/recaps/sources/search": ["recap", "read", "Searches the user's saved film sources for a movie (query)."],
  "POST /api/rewrite": ["research", "paid", "Rewrites a pasted script into fresh wording with AI (text)."],
  "POST /api/saved/tiktok-playlists": ["research", "change", "Saves a TikTok source playlist and its videos to your library."],
  "POST /api/saved/tiktok-playlists/deep-scan": ["research", "change", "Starts a background deep scan to fetch many more videos from a TikTok source (url)."],
  "POST /api/saved/tiktok-playlists/genre-scan": ["research", "paid", "Scans the next batch of a saved TikTok source's videos for story genres with AI."],
  "POST /api/saved/tiktok-playlists/movie-scan": ["research", "paid", "Identifies the movies in the next batch of a saved TikTok source's videos."],
  "POST /api/saved/tiktok-post-analyses": ["research", "change", "Saves a movie-ID analysis result for a TikTok post."],
  "POST /api/studio/generations": ["studio", "paid", "Starts a new Creator Studio generation such as an image, video, audio, design, or explainer."],
  "POST /api/studio/generations/:id/design": ["studio", "change", "Saves your edited HTML back into an Editable Design generation."],
  "GET /api/studio/generations/:id/motion": ["studio", "read", "Reads a Promo, Explainer, or Vibe Motion graphic's document and the edits made to it in its player."],
  "POST /api/studio/generations/:id/motion": ["studio", "change", "Saves edits to a motion graphic's elements (moved, resized, recoloured, reworded, or timed; body {edits: {selectorPath: {dx, dy, scale, text, color, hidden, from, to}}}) and re-renders a film."],
  "POST /api/studio/generations/:id/export": ["studio", "paid", "Renders a motion graphic, promo, or explainer generation to MP4 or GIF."],
  "POST /api/studio/generations/:id/stop": ["studio", "change", "Stops a Creator Studio generation that is still running."],
  "POST /api/studio/imports": ["studio", "paid", "Imports an image or downloads a video from a pasted link into your studio library."],
  "POST /api/studio/marketing/avatars": ["studio", "paid", "Creates a custom ad presenter from a photo, or AI-generates one from a description."],
  "POST /api/studio/marketing/avatars/:id/pin": ["studio", "change", "Pins or unpins an ad presenter avatar."],
  "POST /api/studio/marketing/products": ["studio", "change", "Saves a product for ads from uploaded images, name, and description."],
  "POST /api/studio/marketing/products/import": ["studio", "paid", "Imports a product or app from a web page link, with AI-written name and benefits."],
  "POST /api/studio/uploads": ["studio", "change", "Uploads a raw image, audio, or video file into your studio library."],
  "POST /api/support/tickets": ["account", "change", "Opens a new support request with a subject, category and message."],
  "POST /api/support/tickets/:id/messages": ["account", "change", "Adds the user's reply to their support request and reopens it."],
  "POST /api/tiktok/list": ["research", "change", "Fetches the video list for a TikTok profile, collection or search and saves it as a source."],
  "POST /api/tiktok/probe-dimensions": ["research", "read", "Looks up size, duration, stats and clean playback URLs for a list of TikTok videos."],
  "POST /api/tiktok/process": ["research", "paid", "Downloads a TikTok video without watermark and returns a playable link or base64."],
  "POST /api/tiktok/resolve-source": ["research", "read", "Turns any pasted TikTok link into the channel or collection source to follow."],
  "POST /api/tools/read": ["studio", "read", "Reads a web page link and returns its text."],
  "POST /api/tools/text": ["studio", "paid", "Runs a mini text tool: YouTube titles, descriptions, or hashtags from a topic or transcript."],
  "POST /api/transcribe": ["research", "paid", "Transcribes a video URL using captions or Whisper; may queue and return a job id."],
  "POST /api/vibe-edit/broll": ["editor", "paid", "Finds and trims stock b-roll footage matching spoken lines (moments, aspect, subject)."],
  "POST /api/vibe-edit/import-audio": ["editor", "change", "Imports an audio file from a public URL into the user's Vibe Edit library (url)."],
  "POST /api/vibe-edit/motion/edit": ["editor", "change", "Films a Vibe Edit motion title again with edits made in its player (html, vars, edits)."],
  "POST /api/vibe-edit/motion": ["editor", "paid", "Renders an animated motion title overlay clip from a title kind, text, aspect, and look."],
  "POST /api/vibe-edit/renders": ["editor", "paid", "Starts exporting a Vibe Edit project timeline to a finished video (project, overlays)."],
  "POST /api/vibe-edit/renders/:id/stop": ["editor", "change", "Stops a running Vibe Edit export (render id)."],
  "POST /api/vibe-edit/transcribe": ["editor", "paid", "Transcribes an uploaded media file into text with word timings for captions (file)."],
  "POST /api/vibe-edit/voiceover": ["editor", "paid", "Generates voiceover audio for script lines in a chosen voice with optional direction and language."],
  "POST /api/voicebox/generate": ["studio", "paid", "Generates speech audio from text in one of your voices."],
  "POST /api/voicebox/profiles": ["studio", "change", "Creates a new voice profile you own, with name, language, and voice type."],
  "POST /api/voicebox/profiles/:id/samples": ["studio", "paid", "Uploads a base64 audio sample to clone a voice, transcribing it and optionally denoising."],
  "POST /api/youtube/accounts/:id/select": ["publisher", "change", "Switches your active connected channel to this account (account id)."],
  "POST /api/youtube/channel/comment-agent/post": ["community", "publish", "Posts a chosen set of drafted comment replies publicly on your channel (items)."],
  "POST /api/youtube/channel/comment-agent/run": ["community", "publish", "Drafts AI replies to recent channel comments; posts them publicly when dryRun is false."],
  "POST /api/youtube/comments/:id/moderation": ["community", "publish", "Publishes, holds or rejects a comment on your channel, optionally banning its author."],
  "POST /api/youtube/comments/:id/reply": ["community", "publish", "Publicly replies to a YouTube comment as your channel (comment id, text)."],
  "POST /api/youtube/playlists": ["publisher", "publish", "Creates a new playlist on your YouTube channel (title, description, privacy)."],
  "POST /api/youtube/playlists/:playlistId/items": ["publisher", "publish", "Adds one of your videos to a YouTube playlist (playlist id, video id)."],
  "POST /api/youtube/radar": ["research", "read", "Scans YouTube for trending or keyword-matching videos and channels (YouTube Radar)."],
  "POST /api/youtube/videos/:id/captions": ["publisher", "publish", "Uploads a new caption track to one of your YouTube videos (video id)."],
  "POST /api/youtube/videos/:id/comments": ["community", "publish", "Posts a new top-level comment on a YouTube video as your channel (video id, text)."],
  "POST /api/youtube/videos/:id/thumbnail": ["publisher", "publish", "Sets a custom thumbnail image on a published YouTube video (video id, image body)."],
  "PUT /api/admin/settings/:key": ["admin", "change", "Saves a settings group; billing changes reprice auto-priced plans."],
  "PUT /api/automation/agents/:id/chats/:chatId": ["automation", "change", "Saves a chat conversation with this agent; an empty chat deletes it."],
  "PUT /api/digital-products/:id": ["producer", "change", "Saves edits to a digital product draft."],
  "PUT /api/maker/collections/:id": ["research", "change", "Updates a research collection's name and data."],
  "PUT /api/recaps/sources": ["recap", "change", "Replaces the user's saved list of film sources (sources)."],
  "PUT /api/vibe-edit/projects/:id": ["editor", "change", "Saves a Vibe Edit project's full timeline document (project)."],
};

/** Routes Juel never calls, with why: sign-in flows, webhooks, worker callbacks, raw media streams.
 *  @type {JuelExclusions} */
export const JUEL_EXCLUDED = {
  "DELETE /api/juel/threads/:id": "Juel's own conversations",
  "GET /api/juel/threads": "Juel's own conversations",
  "GET /api/juel/threads/:id": "Juel's own conversations",
  "POST /api/juel/chat": "Juel's own chat",
  "POST /api/juel/quote": "Juel's own credit quotes",
  "GET /api/account/tokens": "API tokens: managed by the signed-in user in the browser only",
  "POST /api/account/tokens": "API tokens: managed by the signed-in user in the browser only",
  "DELETE /api/account/tokens/:id": "API tokens: managed by the signed-in user in the browser only",
  "GET /api/openapi.json": "the API's own description",
  "GET /api/auth/google": "sign-in/OAuth flow",
  "GET /api/auth/google/callback": "OAuth callback",
  "GET /api/auth/native/start": "sign-in/OAuth flow",
  "GET /api/auth/social/:platform": "sign-in/OAuth flow",
  "GET /api/auth/social/:platform/callback": "OAuth callback",
  "GET /api/auth/tiktok": "sign-in/OAuth flow",
  "GET /api/auth/tiktok/callback": "OAuth callback",
  "GET /api/auth/youtube/callback": "OAuth callback",
  "GET /api/automation/agents/:id/remake/faces/:faceId": "image file for preview",
  "GET /api/automation/voice/avatar-input/:token": "provider file fetch",
  "GET /api/automation/voice/files/:name": "file stream for a media player",
  "GET /api/billing/checkout/verify": "payment callback",
  "GET /api/compilations/download/:name": "raw file download",
  "GET /api/digital-products/:id/assets/:file": "file stream for display",
  "GET /api/drama/public/:token/:file": "temporary public file link for model providers",
  "GET /api/maker/art-styles/:id/images/:file": "image file stream",
  "GET /api/maker/projects/:id/assets/:file": "file stream for a media player",
  "GET /api/maker/projects/:id/scene-images.zip": "zip file download",
  "GET /api/recaps/:id/files/:name": "video file stream for player/download",
  "GET /api/recaps/:id/media/:name": "media file stream for the editor",
  "GET /api/recaps/:id/sheets/:name": "image file for the script editor",
  "GET /api/studio/files/:name": "file stream for a media player",
  "GET /api/studio/public/:token/:name": "provider file link, unauthenticated",
  "GET /api/tiktok/covers/:file": "image file stream",
  "GET /api/tiktok/video/:name": "file stream for a media player",
  "GET /api/voicebox/audio/:id": "audio stream for a media player",
  "GET /api/voicebox/profiles/:id/preview": "audio stream for a media player",
  "GET /api/voicebox/status": "health check",
  "GET /internal/exec/:id/events": "internal worker endpoint",
  "GET /internal/exec/:id/input": "internal worker endpoint",
  "GET /internal/exec/claim": "internal worker endpoint",
  "GET /internal/exec/status": "internal worker endpoint",
  "GET /internal/job-exec.mjs": "serves worker script",
  "GET /internal/job-transcribe.mjs": "serves worker script",
  "POST /api/admin/db-import": "raw SQL import with deploy token",
  "POST /api/auth/apple/native": "sign-in/OAuth flow",
  "POST /api/auth/logout": "sign-out",
  "POST /api/auth/native/exchange": "sign-in/OAuth flow",
  "POST /api/auth/native/ticket": "sign-in/OAuth flow",
  "POST /api/automation/agents/chat/transcribe": "voice-input plumbing for chat UI",
  "POST /api/transcribe/upload": "raw file upload from the Rewriter drop area; Juel passes links to POST /api/transcribe",
  "POST /api/billing/checkout": "payment checkout: the user pays themselves",
  "POST /api/billing/lingbase/checkout": "payment checkout: the user pays themselves",
  "POST /api/billing/lingbase/portal": "payment portal: the user manages billing themselves",
  "POST /api/billing/paystack/webhook": "payment webhook",
  "POST /api/telegram/webhook": "Telegram bot webhook",
  "POST /api/account/telegram/link": "links the user's own Telegram chat by hand",
  "DELETE /api/account/telegram": "unlinks the user's own Telegram chat by hand",
  "POST /api/account/sessions/revoke-others": "security action: the agent's own session would sign the user out of their browser",
  "GET /api/admin/telegram": "Telegram bridge setup: an admin does it by hand",
  "PUT /api/admin/telegram": "Telegram bridge setup: holds the bot token",
  "DELETE /api/admin/telegram": "Telegram bridge setup: an admin does it by hand",
  "POST /api/admin/telegram/link": "Telegram bridge setup: links the admin's own chat",
  "DELETE /api/admin/telegram/links/:chatId": "Telegram bridge setup: an admin does it by hand",
  "POST /api/downloader/download": "returns raw file download",
  "POST /api/movie/identify-file": "needs a raw video file in the request body",
  "POST /api/recaps/uploads": "raw binary file upload stream",
  "POST /api/tiktok/comments/cache": "worker push endpoint",
  "POST /api/tools/thumbnail": "binary file download",
  "POST /api/youtube/videos/upload": "needs a raw video file in the request body",
  "POST /internal/exec/:id/cancel": "internal worker endpoint",
  "POST /internal/exec/:id/finish": "internal worker endpoint",
  "POST /internal/exec/:id/stream": "internal worker endpoint",
  "POST /internal/exec/local": "internal worker endpoint",
  "POST /internal/promo/fetch": "internal worker endpoint",
  "POST /internal/voicebox/endpoint": "internal worker endpoint",
  "PUT /internal/exec/:id/output": "internal worker endpoint",
};

const PARAM = /:([A-Za-z_]\w*)/g;
const compiled = new Map();
function pattern(key) {
  if (!compiled.has(key)) {
    const [method, path] = key.split(" ");
    const names = [...path.matchAll(PARAM)].map((m) => m[1]);
    const source = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\?:([A-Za-z_]\w*)/g, "([^/]+)");
    compiled.set(key, { method, names, regex: new RegExp(`^${source}/?$`) });
  }
  return compiled.get(key);
}

/** The catalogue entry a concrete call belongs to ("POST /api/recaps/rcp_1/render" -> "POST
 *  /api/recaps/:id/render"), its path params, and whether it's excluded; null when nothing matches.
 *  @param {string} method @param {string} path @param {JuelTables} [tables] */
export function matchRoute(method, path, { routes = JUEL_ROUTES, excluded = JUEL_EXCLUDED } = {}) {
  const verb = String(method || "GET").toUpperCase();
  const clean = String(path || "").split("?")[0];
  // Exact paths first, so "/api/recaps/new" never reads as "/api/recaps/:id".
  const keys = [...Object.keys(routes), ...Object.keys(excluded)].sort((a, b) => (a.match(PARAM) || []).length - (b.match(PARAM) || []).length);
  for (const key of keys) {
    const p = pattern(key);
    if (p.method !== verb && p.method !== "ALL") continue;
    const hit = clean.match(p.regex);
    if (!hit) continue;
    const params = Object.fromEntries(p.names.map((name, i) => [name, decodeURIComponent(hit[i + 1])]));
    if (excluded[key]) return { key, params, excluded: excluded[key] };
    const [specialist, risk, does] = routes[key];
    return { key, params, specialist, risk, does, spends: spendsCredits(risk) };
  }
  return null;
}

/** The tools a specialist (or all of them) can use, for a prompt: one line each. Admin routes only for admins.
 *  @param {{ specialist?: string, admin?: boolean, routes?: JuelRouteTable }} [options] */
export function juelTools({ specialist = "", admin = false, routes = JUEL_ROUTES } = {}) {
  return Object.entries(routes)
    .filter(([, [owner]]) => (specialist ? owner === specialist : true) && (admin || owner !== "admin"))
    .map(([key, [owner, risk, does]]) => ({ route: key, specialist: owner, risk, does, spends: spendsCredits(risk) }));
}

export class JuelRefusal extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Calls a catalogued route as the user (their session cookie on a loopback request), so the route's own
 *  checks run. Refuses unknown and excluded routes, and admin routes for non-admins (the caller checks
 *  credits first). Returns { status, data, route }.
 *  @param {{ method?: string, path: string, body?: unknown, query?: Record<string, unknown> }} call
 *  @param {{ baseUrl: string, cookie?: string, authorization?: string, admin?: boolean, signal?: AbortSignal, fetchImpl?: typeof fetch } & JuelTables} options */
export async function callRoute({ method = "GET", path, body, query } = {}, { baseUrl, cookie = "", authorization = "", admin = false, signal, fetchImpl = globalThis.fetch, routes = JUEL_ROUTES, excluded = JUEL_EXCLUDED } = {}) {
  const hit = matchRoute(method, path, { routes, excluded });
  if (!hit) throw new JuelRefusal(`Juel has no tool for ${String(method).toUpperCase()} ${path}.`, "unknown");
  if (hit.excluded) throw new JuelRefusal(`Juel doesn't call ${hit.key}: ${hit.excluded}.`, "excluded");
  if (hit.specialist === "admin" && !admin) throw new JuelRefusal("That's an admin tool.", "forbidden");
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const verb = String(method).toUpperCase();
  const response = await fetchImpl(url, {
    method: verb,
    headers: { cookie, ...(authorization ? { authorization } : {}), accept: "application/json", "x-juel": "1", ...(body !== undefined && verb !== "GET" ? { "content-type": "application/json" } : {}) },
    body: body !== undefined && verb !== "GET" ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { text: text.slice(0, 2000) };
  }
  return { status: response.status, data, route: hit.key };
}

// ---------- Credits: what a call costs, quoted to the user and checked against their balance ----------

/** What each route that spends credits costs, as provider operations with a flat price (image, video,
 *  speech, music, transcription) and text-model calls (llm), each with a count: "image:2 llm". A function
 *  gets the call and its path params when the count or kind depends on them; { usd } is a provider price. A
 *  paid route that isn't listed counts as one text-model call. Text-only routes are quoted at what they've
 *  recently cost (featureCosts), since model prices move; media at its flat rate, as the pages quote it. */
const count = (v, max = 20) => Math.max(1, Math.min(max, Math.round(Number(v) || 1)));
const VIDEO_TABS = new Set(["video", "cinema", "ai-influencer", "motion-control", "lipsync", "body-swap", "marketing", "clipping"]);
export const JUEL_COSTS = {
  "GET /api/youtube/videos/:id/optimization": "llm",
  "POST /api/admin/jobs/:id/retry": "",
  "POST /api/automation/agents/:id/chat": "llm:2",
  "POST /api/automation/agents/:id/run": "llm:4 speech image",
  "POST /api/automation/agents/:id/run-compilation": "llm:2",
  "POST /api/automation/agents/:id/voice/sources": "transcription",
  "POST /api/automation/uploads/:id/voice/jobs": (c) => (String(c.body?.action) === "clone" ? "speech" : { voiceover: "transcription speech", captions: "transcription", stems: "music", avatar: "video" }[String(c.body?.mode || "voiceover")] || "speech"),
  "POST /api/creator-projects/:id/generate/:stage": (_c, p) => (p.stage === "thumbnail" ? "image" : "llm"),
  "POST /api/digital-products/:id/cover": "image",
  "POST /api/digital-products/:id/generate": "llm:4",
  "POST /api/drama/episodes/:id/final": "",
  "POST /api/drama/episodes/:id/prepare": "image:6 speech:6",
  "POST /api/drama/episodes/:id/render-all": "video:6",
  "POST /api/drama/episodes/:id/scenes/:sid/:step": (_c, p) => ({ board: "image", voice: "speech" })[p.step] || "video",
  "POST /api/drama/episodes/:id/script": "llm:2",
  "POST /api/drama/idea": "llm",
  "POST /api/drama/series": "llm:2 image",
  "POST /api/drama/series/:id/characters/:cid/sheet": "image:2",
  "POST /api/drama/series/:id/characters/:cid/voice-design": "speech:3",
  "POST /api/drama/series/:id/characters/:cid/voice-preview": "speech",
  "POST /api/drama/series/:id/characters/:cid/voice-select": "speech",
  "POST /api/drama/series/:id/locations/:lid/sheet": "image",
  "POST /api/drama/series/:id/outline": "llm:2",
  "POST /api/drama/series/:id/poster": "image",
  "POST /api/film/song/analyze": "transcription music",
  "POST /api/maker/art-styles/from-video": "image llm:2",
  "POST /api/maker/discover": "llm:2",
  "POST /api/maker/projects/:id/cast/:castId/sheets": "image:2",
  "POST /api/maker/projects/:id/cast/suggest": "llm",
  "POST /api/maker/projects/:id/jobs/:stage": (c, p) => {
    if (p.stage === "voiceover") return "speech";
    if (p.stage === "thumbnail") return `image:${count(c.body?.count || 3, 6)}`;
    if (p.stage === "review" || c.body?.action === "stock") return "";
    if (c.body?.action === "animate") return "video:4";
    if (c.body?.action === "music") return "music";
    if (c.body?.action === "images" || p.stage === "visuals") return c.body?.sceneId ? "image" : "image:8";
    return "llm:2";
  },
  "POST /api/maker/styles/:id/learn": "transcription llm:4",
  "POST /api/movie/identify-link": "llm:2",
  "POST /api/recaps": "transcription speech llm:8",
  "POST /api/recaps/:id/intro": "llm",
  "POST /api/recaps/:id/names": "llm",
  "POST /api/recaps/:id/post/draft": "llm",
  "POST /api/recaps/:id/recut": "llm",
  "POST /api/recaps/:id/render": "speech",
  "POST /api/recaps/:id/retry": "llm:4",
  "POST /api/recaps/:id/rewrite": "llm:2",
  "POST /api/recaps/:id/shots": "llm",
  "POST /api/rewrite": "llm",
  "POST /api/saved/tiktok-playlists/genre-scan": "llm:3",
  "POST /api/saved/tiktok-playlists/movie-scan": "llm:3",
  "POST /api/studio/generations/:id/export": "",
  "POST /api/studio/imports": "",
  "POST /api/studio/marketing/avatars": "image",
  "POST /api/studio/marketing/products/import": "llm",
  "POST /api/tiktok/process": "",
  "POST /api/tools/text": "llm",
  "POST /api/transcribe": "transcription",
  "POST /api/vibe-edit/broll": "llm",
  "POST /api/vibe-edit/motion": "llm:2",
  "POST /api/vibe-edit/renders": "",
  "POST /api/vibe-edit/transcribe": "transcription",
  "POST /api/vibe-edit/voiceover": "speech",
  "POST /api/voicebox/generate": "speech",
  "POST /api/voicebox/profiles/:id/samples": "transcription",
  // A studio generation: the model's own per-second price when it has one, else the app's flat price.
  "POST /api/studio/generations": async (c, _p, { catalog }) => {
    const tab = String(c.body?.tab || "");
    const s = c.body?.settings || {};
    const listed = await catalog?.().catch(() => null);
    const models = (Array.isArray(listed?.[tab]) ? listed[tab] : VIDEO_TABS.has(tab) ? listed?.video : null) || [];
    const model = models.find((m) => m.id === c.body?.model) || models[0];
    if (model?.pricePerSecond) return { usd: model.pricePerSecond * (Number(s.duration) || 5) };
    if (tab === "music" || tab === "audio") return s.audioMode === "voice" ? "speech" : "music";
    return VIDEO_TABS.has(tab) ? "video" : `image:${count(s.count, 6)}`;
  },
};
/** One text-model call, for routes with no recent history. */
const LLM_USD = 0.004;
const TOKENS_PER_CREDIT = 100;

/** "POST /api/recaps/rcp_8f2c1a9d/render" -> "POST /api/recaps/:id/render": how usage events name a route
 *  (featureFromRequest in adminConsole.js). */
function featureOf(method, path) {
  const clean = String(path || "").split("?")[0].split("/")
    .map((part) => (/^[0-9a-f-]{16,}$/i.test(part) || (/\d/.test(part) && part.length > 10) || /^[a-z]{2,5}_[A-Za-z0-9-]{6,}$/.test(part) ? ":id" : part))
    .join("/");
  return `${String(method || "GET").toUpperCase()} ${clean}`.slice(0, 160);
}

/** Internal tokens a cost spec ("image:2 llm", { usd }, or "") comes to, and whether it has media in it. */
function priceSpec(spec, pricing) {
  const flat = pricing?.flatTokens || {};
  const perUsd = Number(pricing?.tokensPerUsd) || 1_000_000;
  if (spec && typeof spec === "object") return { tokens: (Number(spec.usd) || 0) * perUsd, media: true };
  let tokens = 0;
  let media = false;
  for (const part of String(spec || "").split(/\s+/).filter(Boolean)) {
    const [op, n] = part.split(":");
    const units = count(n || 1, 50);
    if (op === "llm") tokens += LLM_USD * perUsd * units;
    else {
      tokens += (Number(flat[op] ?? flat.default) || 0) * units;
      media = true;
    }
  }
  return { tokens, media };
}
const toCredits = (tokens) => (tokens > 0 ? Math.max(1, Math.ceil(tokens / TOKENS_PER_CREDIT)) : 0);

/** What a route call will cost the user: { credits, route, does }, or null when it spends nothing.
 *  @param {{ method?: string, path: string, body?: any }} call
 *  @param {{ pricing?: any, history?: Record<string, { tokens: number }>, catalog?: () => Promise<any> }} [sources] */
export async function estimateCredits(call, { pricing, history = {}, catalog } = {}) {
  const hit = matchRoute(call.method, call.path);
  if (!hit || hit.excluded || (!hit.spends && JUEL_COSTS[hit.key] === undefined)) return null;
  const raw = JUEL_COSTS[hit.key];
  const spec = typeof raw === "function" ? await raw(call, hit.params, { catalog }) : raw ?? "llm";
  let { tokens, media } = priceSpec(spec, pricing);
  const past = history[featureOf(call.method, call.path)];
  if (!media && past?.tokens > 0) tokens = past.tokens;
  return { credits: toCredits(tokens), route: hit.key, does: hit.does };
}

/** Credits an action on the open page will spend, from the cost spec the page gave it. */
export function pageActionCredits(action, pricing) {
  return toCredits(priceSpec(action?.cost ?? (action?.risk === "paid" ? "llm" : ""), pricing).tokens);
}

/** Why the user can't spend `credits` ({ balance, needed, message }), or null when they can. */
export function creditShortfall(snapshot, credits) {
  if (!snapshot || snapshot.unlimited || !credits) return null;
  const balance = Math.floor((Number(snapshot.balance) || 0) / TOKENS_PER_CREDIT);
  if (snapshot.userStatus === "suspended") return { balance, needed: credits, message: "This account is suspended. Contact support to restore access." };
  if ((snapshot.status && snapshot.status !== "active") || snapshot.planId === "pending") return { balance, needed: credits, message: "Choose a plan to start creating." };
  if (balance >= credits) return null;
  return { balance, needed: credits, message: `This needs about ${credits.toLocaleString("en-US")} credits and you have ${balance.toLocaleString("en-US")}.` };
}

// ---------- The brain: a manager, and specialists that work together ----------

/** The code behind a route (its registration and handler), so a specialist can read which fields a route it
 *  hasn't used takes before calling it. Read once from the server's own files. */
const routeSources = new Map();
let indexed = false;
async function routeSource(key) {
  if (!indexed) {
    indexed = true;
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const root = process.cwd();
    const files = ["server.js", ...(await fs.readdir(path.join(root, "server")).catch(() => [])).filter((f) => f.endsWith(".js")).map((f) => `server/${f}`)];
    for (const file of files) {
      const lines = (await fs.readFile(path.join(root, file), "utf8").catch(() => "")).split("\n");
      lines.forEach((line, i) => {
        const m = line.match(/\b(?:app|router)\.(get|post|put|patch|delete|all)\(\s*["'`]([^"'`]+)["'`]/);
        if (m) routeSources.set(`${m[1].toUpperCase()} ${m[2]}`, lines.slice(i, i + 70).join("\n"));
      });
    }
  }
  return routeSources.get(key) || "";
}

const clipText = (value, max) => {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** What the user is looking at, fetched from the route that shows it: the open recap, project, series, edit. */
const SURFACE_READS = {
  recap: (id) => `/api/recaps/${encodeURIComponent(id)}`,
  automation: (id) => `/api/automation/agents/${encodeURIComponent(id)}`,
  editor: (id) => `/api/vibe-edit/projects/${encodeURIComponent(id)}`,
  producer: (id) => `/api/maker/projects/${encodeURIComponent(id)}`,
  film: (id) => `/api/drama/series/${encodeURIComponent(id)}`,
};

/** The actions a page offers (cleaned): which specialist uses them, and per action its args, what it does,
 *  its risk, and its cost spec ("speech:1"). Unknown risks count as paid, so they're priced and checked. */
export function pageTools(raw) {
  if (!raw || typeof raw !== "object" || !JUEL_SPECIALISTS[raw.specialist]) return null;
  const actions = {};
  for (const [type, a] of Object.entries(raw.actions || {}).slice(0, 40)) {
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(type) || !a || typeof a !== "object") continue;
    const cost = typeof a.cost === "string" && /^[a-z]+(:\d+)?( [a-z]+(:\d+)?)*$/.test(a.cost) ? a.cost.slice(0, 80) : undefined;
    actions[type] = { args: String(a.args || "{}").slice(0, 400), about: String(a.about || "").slice(0, 200), risk: JUEL_RISKS.includes(a.risk) ? a.risk : "paid", ...(cost ? { cost } : {}) };
  }
  return Object.keys(actions).length ? { specialist: raw.specialist, actions } : null;
}

/** The Creative Studio's personas (the old Creative and Design Agents): the page names one and the Studio
 *  specialist works as it. */
export const STUDIO_PERSONAS = {
  creative: { name: "Creative Director", intro: "I plan and produce images, videos, and music from one idea.", brief: "a versatile creative director for video creators" },
  thumbnail: { name: "Thumbnail Designer", intro: "I design high-click YouTube thumbnails.", brief: "a YouTube thumbnail designer. Default to 16:9 images with a bold focal subject, strong contrast, and at most 4 words of large on-image text" },
  storyboard: { name: "Storyboard Artist", intro: "I break a story into consistent shots and animate them.", brief: "a storyboard artist who keeps characters and style consistent from shot to shot" },
  ads: { name: "Ad Creative", intro: "I turn a product into ad images and short ad videos.", brief: "a performance ad creative who writes scroll-stopping social ad concepts" },
  design: { name: "Design Agent", intro: "I make posters, social graphics, logos, and brand visuals.", brief: "a senior graphic designer who makes posters, social graphics, logos, and brand visuals with precise typography and layout. Prefer image models that render text well" },
};

/** Extra know-how a specialist gets for where the user is. */
const SPECIALIST_GUIDES = {
  // An open automation agent has its own operator: the agent's memory, learning profile, live performance,
  // monetization, internal tools, and settings rules. Juel consults it rather than re-deriving all that.
  automation: (context) => (context?.surface === "automation" && context.entityId
    ? `THE OPEN AGENT'S OPERATOR: for anything about this agent (how it's doing, reports, analytics, what to post, changing its settings, schedule, sources, runs), consult it first: POST /api/automation/agents/${context.entityId}/chat with body {"message": "the user's request in full, plus what you need"}. It knows the agent's memory, learning, and live numbers, runs its own tools, applies settings changes itself, and its full answer (report, cards, actions) is shown to the user under Juel's reply. Its reply is your finding; don't redo its work.`
    : ""),
  studio: (context) => {
    const persona = STUDIO_PERSONAS[context?.details?.persona];
    return `${persona ? `WORK AS: ${persona.brief}.\n` : ""}MAKING THINGS: POST /api/studio/generations with {"tab": "image" | "video" | "music" (or another studio app), "prompt": "a rich, specific generation prompt", "settings": {"aspectRatio": "16:9" | "9:16" | "1:1" | "4:5", "count": 1-4 (images), "duration": 5 | 8 (video), "instrumental": true (a music cue)}}. Start at most 4 per turn, only when the user wants something made; ask one clarifying question instead when the request is too vague. Each result appears under Juel's reply.`;
  },
};

const MAX_ROUNDS = 4;
const MAX_ASKS = 3;

/** One specialist's work on a task: up to MAX_ROUNDS of reading a route's code, calling routes, and asking
 *  another specialist, then a note of what it found or did for the shared board. */
async function specialistWork({ specialist, task, board, context, call, page, show, think, admin, onStep, depth = 0, asks = { n: 0 } }) {
  const tools = juelTools({ specialist, admin }).map((t) => `${t.route} [${t.risk}] ${t.does}`).join("\n");
  // The open page's own actions (Vibe Edit's timeline edits), when the page offers them to this specialist.
  const pageActions = page && context?.clientTools?.specialist === specialist ? Object.entries(context.clientTools.actions || {}) : [];
  const pageList = pageActions.map(([type, a]) => `${type} ${a.args || "{}"} [${a.risk || "change"}] ${a.about || ""}`).join("\n");
  const guide = SPECIALIST_GUIDES[specialist]?.(context) || "";
  const others = Object.entries(JUEL_SPECIALISTS).filter(([id]) => id !== specialist && (admin || id !== "admin")).map(([id, s]) => `${id}: ${s.brief}`).join("\n");
  const log = [];
  let note = "";
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const prompt = `You are the ${JUEL_SPECIALISTS[specialist].name} specialist inside Juel, the AutoYT app's agent. You work for the signed-in user through the app's own API routes, which run as them.

YOUR TASK: ${task}

WHERE THE USER IS: ${clipText({ ...(context || {}), clientTools: undefined }, 3000)}

THE TEAM'S BOARD (what other specialists found or did this turn):
${board.length ? board.map((b) => `- ${b.specialist}: ${b.note}`).join("\n") : "(empty)"}

${guide ? `${guide}

` : ""}YOUR ROUTES (method path [risk] what it does). Path params like :id are filled in by you:
${tools || "(none)"}

${pageList ? `ACTIONS ON THE OPEN PAGE (type {args} [risk] what it does). They run in the user's browser on what's open (the open item is in WHERE THE USER IS); prefer them to routes for editing what's open:
${pageList}

` : ""}OTHER SPECIALISTS you can ask one question:
${others}

WHAT YOU DID SO FAR THIS TASK:
${log.length ? log.join("\n") : "(nothing yet)"}

Rules: call a route only to do the task. Every call runs at once, as the user. Paid ones spend the user's credits (the user sees each one's cost); one their balance can't cover is refused, so then stop and say what it needed. Publish or delete only what the user asked to publish or delete in this conversation, never on your own initiative. When a route wants "confirmed": true, the user's request is the confirmation. Never invent ids: read them first. When you don't know a route's body fields, ask to read its code first ("read": ["POST /api/x/:id"]). To put a picture, video, or sound the user should see right in the chat (a finished recap or export, a thumbnail, a poster, a clip, a voice sample), list it in "show" with its exact URL as a route returned it. Stop as soon as the task is done.

Return JSON only: {"read":["METHOD /path", ...], "calls":[{"method":"GET","path":"/api/...","query":{},"body":{},"why":"short"}],${pageList ? ` "page":[{"type":"action type","args":{},"why":"short"}],` : ""} "show":[{"type":"image"|"video"|"audio","url":"exact URL from a result","label":"short caption"}], "ask":{"specialist":"id","question":"..."} or null, "done":true|false, "note":"one or two sentences for the board: what you found or did, with key facts and ids"}`;
    const plan = await think(prompt);
    note = String(plan?.note || note || "").slice(0, 1200);
    for (const key of (Array.isArray(plan?.read) ? plan.read : []).slice(0, 3)) {
      const source = await routeSource(String(key));
      log.push(`READ ${key}: ${source ? clipText(source, 2500) : "no such route"}`);
    }
    const calls = (Array.isArray(plan?.calls) ? plan.calls : []).slice(0, 4);
    for (const c of calls) {
      onStep?.({ specialist, text: c.why || `${c.method} ${c.path}` });
      try {
        const result = await call({ method: c.method, path: c.path, query: c.query, body: c.body, why: c.why, specialist });
        log.push(`CALLED ${c.method} ${c.path} -> ${result.status}${result.credits ? ` (≈${result.credits} credits)` : ""}: ${clipText(result.data, 2500)}`);
      } catch (error) {
        log.push(`CALL ${c.method} ${c.path} refused: ${error instanceof Error ? error.message : error}`);
      }
    }
    const pageCalls = pageActions.length ? (Array.isArray(plan?.page) ? plan.page : []).slice(0, 12) : [];
    for (const p of pageCalls) {
      onStep?.({ specialist, text: p.why || String(p.type) });
      try {
        const result = await page({ type: String(p.type), args: p.args && typeof p.args === "object" ? p.args : {}, why: p.why, specialist });
        log.push(`PAGE ${p.type} -> sent to the open page, which applies it now${result.credits ? ` (≈${result.credits} credits)` : ""}`);
      } catch (error) {
        log.push(`PAGE ${p.type} refused: ${error instanceof Error ? error.message : error}`);
      }
    }
    const shows = Array.isArray(plan?.show) ? plan.show.slice(0, 8) : [];
    if (shows.length && show) {
      const shown = show(shows, specialist);
      log.push(`SHOWED ${shown} of ${shows.length} in the chat${shown < shows.length ? " (the others weren't URLs a route returned this turn)" : ""}`);
    }
    const ask = plan?.ask;
    if (ask?.specialist && JUEL_SPECIALISTS[ask.specialist] && ask.specialist !== specialist && depth < 2 && asks.n < MAX_ASKS && (admin || ask.specialist !== "admin")) {
      asks.n += 1;
      onStep?.({ specialist, text: `asks ${JUEL_SPECIALISTS[ask.specialist].name}: ${clipText(ask.question, 160)}` });
      const answer = await specialistWork({ specialist: ask.specialist, task: String(ask.question), board, context, call, page, show, think, admin, onStep, depth: depth + 1, asks });
      log.push(`ASKED ${ask.specialist}: ${ask.question} -> ${answer}`);
      board.push({ specialist: ask.specialist, note: `(for ${specialist}) ${answer}` });
    }
    if (plan?.done || (!calls.length && !pageCalls.length && !ask && !(plan?.read || []).length)) break;
  }
  return note || "Nothing to report.";
}

/** One turn of a Juel conversation. Returns { reply, steps, board }; `shown` says what the caller shows
 *  under the reply (an operator's report, generations).
 *  @param {{ message: string, history?: Array<{ role: string, content: string }>, context?: any, admin?: boolean, think: (prompt: string) => Promise<any>, call: (call: any) => Promise<any>, page?: (action: any) => Promise<any>, show?: (items: any[], specialist: string) => number, onStep?: (step: { specialist: string, text: string }) => void, shown?: () => string }} turn */
export async function juelTurn({ message, history = [], context = {}, admin = false, think, call, page, show, onStep, shown }) {
  const team = Object.entries(JUEL_SPECIALISTS).filter(([id]) => admin || id !== "admin").map(([id, s]) => `${id}: ${s.brief}`).join("\n");
  // The page's action list goes to its specialist's prompt, not into everyone's context.
  const { clientTools, ...where } = context || {};
  const onPage = (clientTools?.specialist && JUEL_SPECIALISTS[clientTools.specialist] ? `\nThe open page lets the ${clientTools.specialist} specialist edit it directly (${Object.keys(clientTools.actions || {}).length} actions), so send edits of what's open there.` : "")
    + (where.surface === "automation" && where.entityId ? "\nAn automation agent is open: anything about it goes to the automation specialist, who consults the agent's own operator." : "")
    + (STUDIO_PERSONAS[where.details?.persona] ? `\nThe user is talking to the ${STUDIO_PERSONAS[where.details.persona].name}: making things goes to the studio specialist.` : "");
  const plan = await think(`You are Juel, the AutoYT app's agent: a manager who answers the user and hands work to specialists.

WHERE THE USER IS: ${clipText(where, 3000)}${onPage}

THE TEAM:
${team}

CONVERSATION SO FAR:
${history.slice(-12).map((m) => `${m.role === "user" ? "User" : "Juel"}: ${clipText(m.content, 600)}`).join("\n") || "(new)"}

USER: ${message}

Plan the turn. If the message needs the app (reading data, changing something, making or posting something), list the specialists who do it, in order, each with a precise task; they share a board, so later ones see earlier results. If it's conversation or a question you can answer from the context, answer directly with no plan.
Return JSON only: {"reply":"your answer when no plan is needed, else empty","plan":[{"specialist":"id","task":"..."}]}`);
  const steps = [];
  const board = [];
  const work = (Array.isArray(plan?.plan) ? plan.plan : []).filter((p) => JUEL_SPECIALISTS[p?.specialist] && (admin || p.specialist !== "admin")).slice(0, 4);
  if (!work.length) return { reply: String(plan?.reply || "").trim() || "I'm here. What should we do?", steps, board };
  const step = (s) => {
    steps.push(s);
    onStep?.(s);
  };
  for (const item of work) {
    step({ specialist: item.specialist, text: String(item.task).slice(0, 200) });
    const note = await specialistWork({ specialist: item.specialist, task: String(item.task), board, context, call, page, show, think, admin, onStep: step });
    board.push({ specialist: item.specialist, note });
  }
  const final = await think(`You are Juel, the AutoYT app's agent. Your specialists finished this turn.

USER ASKED: ${message}

THE BOARD:
${board.map((b) => `- ${b.specialist}: ${b.note}`).join("\n")}

${shown?.() ? `SHOWN BELOW YOUR REPLY: ${shown()}. Don't repeat it; point to it in a few words.\n\n` : ""}Write the reply to the user: plain, short (under 120 words), what was done or found, with the facts that matter. Say what paid work started and that it spends credits; when something was refused for low credits, say what it needed. Never claim something happened that the board doesn't show.
When the user asked for a report, numbers, a status overview, or a comparison, also give "report": a title, up to 6 headline numbers as cards, and a table (up to 8 columns, 20 rows) built only from facts on the board. Otherwise leave it out.
Return JSON only: {"reply":"...", "report": {"title":"...", "cards":[{"label":"...","value":"...","tone":"good"|"warn"|"neutral"}], "table":{"columns":["..."],"rows":[["..."]]}} or null}`);
  return { reply: String(final?.reply || "").trim() || board.map((b) => b.note).join(" "), steps, board, report: cleanReport(final?.report) };
}

/** Juel's own report for a reply: a title, headline numbers, and a table, all plain text and capped. */
export function cleanReport(raw) {
  if (!raw || typeof raw !== "object") return null;
  const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const cards = (Array.isArray(raw.cards) ? raw.cards : []).slice(0, 6).map((c) => ({ label: text(c?.label, 40), value: text(c?.value, 40), tone: ["good", "warn"].includes(c?.tone) ? c.tone : "neutral" })).filter((c) => c.label && c.value);
  const columns = (Array.isArray(raw.table?.columns) ? raw.table.columns : []).slice(0, 8).map((c) => text(c, 40));
  const rows = columns.length ? (Array.isArray(raw.table?.rows) ? raw.table.rows : []).slice(0, 20).filter(Array.isArray).map((r) => columns.map((_, i) => text(r[i], 120))) : [];
  const title = text(raw.title, 120);
  if (!cards.length && !rows.length) return null;
  return { kind: "report", title, cards, table: rows.length ? { columns, rows } : null };
}

const MEDIA_EXT = /\.(png|jpe?g|webp|gif|avif|mp4|webm|mov|m4v|mp3|wav|m4a|ogg|aac|flac)(\?|#|$)/i;
/** Every URL a route returned this turn (media files and /api/ links), so "show" can only use real ones. */
export function urlsIn(value, found = new Set(), depth = 0) {
  if (depth > 6 || found.size > 2000) return found;
  if (typeof value === "string") {
    const v = value.trim();
    if (v.length < 2048 && (/^https:\/\//i.test(v) || v.startsWith("/")) && (MEDIA_EXT.test(v) || v.startsWith("/api/"))) found.add(v);
  } else if (Array.isArray(value)) {
    for (const item of value.slice(0, 300)) urlsIn(item, found, depth + 1);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) urlsIn(item, found, depth + 1);
  }
  return found;
}

/** The media a specialist asked to show, kept to URLs a route really returned, typed by what they are. */
export function cleanShows(items, seen) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const url = String(item?.url || "").trim();
    if (!url || !seen.has(url) || out.some((o) => o.url === url)) continue;
    const ext = (url.match(MEDIA_EXT)?.[1] || "").toLowerCase();
    const type = ["image", "video", "audio"].includes(item?.type) ? item.type : /mp4|webm|mov|m4v/.test(ext) ? "video" : /mp3|wav|m4a|ogg|aac|flac/.test(ext) ? "audio" : "image";
    out.push({ type, url, label: String(item?.label || "").replace(/\s+/g, " ").trim().slice(0, 140) });
  }
  return out.slice(0, 8);
}

// ---------- The public API and MCP: personal access tokens for people's scripts and AI agents ----------

/** What a token may call, by route risk. Admin routes also need an admin's token. */
export const TOKEN_SCOPES = {
  read: { label: "Read only", risks: ["read"] },
  create: { label: "Create (read, change, and spend credits)", risks: ["read", "change", "paid"] },
  full: { label: "Full (also publish and delete)", risks: ["read", "change", "paid", "publish", "delete"] },
};
export const TOKEN_PREFIX = "ayt_";
const TOKENS_OWNER = "_system";
const TOKENS_DOC = "api-tokens.json";
const MAX_TOKENS_PER_USER = 20;
const sha256 = (value) => createHash("sha256").update(String(value)).digest("hex");

/** Why a token can't call this route (null when it can): it must be catalogued, not excluded, in scope,
 *  and admin routes need an admin. Juel's own routes and token management are excluded for tokens. */
export function tokenRefusal(hit, scope, admin = false) {
  if (!hit) return "That route isn't part of the AutoYT API. Search with find_capabilities or GET /api/openapi.json.";
  if (hit.excluded) return `That route isn't available to API tokens (${hit.excluded}).`;
  if (hit.specialist === "admin" && !admin) return "That's an admin route.";
  if (!(TOKEN_SCOPES[scope] || TOKEN_SCOPES.read).risks.includes(hit.risk)) {
    const what = { change: "change things", paid: "spend credits", publish: "publish", delete: "delete" }[hit.risk] || hit.risk;
    return `This token's scope (${scope}) can't ${what}. Create a token with a wider scope in Account > Developers.`;
  }
  return null;
}

// Set by registerJuel: the token store, admin check, and credit sources the auth middleware needs.
let api = null;
const rate = new Map();
/** At most `limit` requests a minute per token. */
function rateLimited(id, limit = 300) {
  const now = Date.now();
  const hits = (rate.get(id) || []).filter((t) => now - t < 60000);
  hits.push(now);
  rate.set(id, hits);
  return hits.length > limit;
}

/** Signs in a request carrying "Authorization: Bearer ayt_…": the token's scope and the credit check run
 *  here, before the route, which then sees the token's user as signed in (server.js reads req.apiToken).
 *  Requests without a token pass straight through. */
export async function juelApiAuth(req, res, next) {
  const header = String(req.headers.authorization || "");
  const raw = /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, "").trim() : "";
  if (!raw.startsWith(TOKEN_PREFIX)) return next();
  try {
    if (!api) return res.status(503).json({ error: "The API is starting up. Try again in a moment." });
    const token = await api.tokens.resolve(raw);
    if (!token) return res.status(401).json({ error: "That API token is invalid or was revoked.", code: "invalid_token" });
    if (rateLimited(token.id)) return res.status(429).json({ error: "Too many requests for this token. Slow down to 300 a minute.", code: "rate_limited" });
    req.apiToken = token;
    if (req.path === "/mcp") return next();
    const hit = matchRoute(req.method, req.path);
    const admin = hit?.specialist === "admin" ? await api.isAdmin(token.email) : false;
    const refusal = tokenRefusal(hit, token.scope, admin);
    if (refusal) return res.status(403).json({ error: refusal, code: "token_scope" });
    const quote = await estimateCredits({ method: req.method, path: req.path, body: req.body }, await api.quoteSources({ authorization: header })).catch(() => null);
    if (quote?.credits) {
      const short = creditShortfall(await api.snapshot(token.userId), quote.credits);
      if (short) return res.status(402).json({ error: `Not enough credits. ${short.message}`, code: "insufficient_credits", needed: short.needed, balance: short.balance });
      res.setHeader("X-AutoYT-Credits-Estimate", String(quote.credits));
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** OpenAPI 3.1 for every route a token can call, from the catalogue: what it does, its risk, its params. */
export function openApiSpec(serverUrl) {
  const paths = {};
  for (const [key, [specialist, risk, does]] of Object.entries(JUEL_ROUTES)) {
    const [method, path] = key.split(" ");
    const names = [...path.matchAll(PARAM)].map((m) => m[1]);
    const route = path.replace(PARAM, "{$1}");
    paths[route] ||= {};
    paths[route][method.toLowerCase()] = {
      summary: does.length > 110 ? `${does.slice(0, 107)}…` : does,
      description: does,
      tags: [JUEL_SPECIALISTS[specialist]?.name || specialist],
      operationId: `${method.toLowerCase()}_${route.replace(/[{}]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
      "x-risk": risk,
      "x-scope": Object.entries(TOKEN_SCOPES).find(([, s]) => s.risks.includes(risk))?.[0],
      "x-spends-credits": risk === "paid" || JUEL_COSTS[key] !== undefined,
      ...(specialist === "admin" ? { "x-admin-only": true } : {}),
      parameters: names.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      ...(method === "GET" || method === "DELETE" ? {} : { requestBody: { required: false, content: { "application/json": { schema: { type: "object", additionalProperties: true } } } } }),
      responses: { 200: { description: "OK" }, 401: { description: "Missing or invalid token" }, 402: { description: "Not enough credits" }, 403: { description: "Outside the token's scope" } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "AutoYT API", version: "1.0.0", description: "Everything you can do in AutoYT, as the signed-in user. Create a personal access token in Account > Developers and send it as a Bearer token. Paid routes are quoted and checked against your credits before they run (X-AutoYT-Credits-Estimate). The same abilities are an MCP server at /mcp." },
    servers: [{ url: serverUrl }],
    components: { securitySchemes: { token: { type: "http", scheme: "bearer", description: "A personal access token (ayt_…)" } } },
    security: [{ token: [] }],
    tags: Object.values(JUEL_SPECIALISTS).map((s) => ({ name: s.name, description: s.brief })),
    paths,
  };
}

/** The tools AutoYT's MCP server offers: Juel itself, and the whole API through search, describe, and call. */
export const MCP_TOOLS = [
  {
    name: "ask_juel",
    title: "Ask Juel",
    description: "Hand AutoYT's agent Juel a task in plain words (\"make a recap of this film\", \"how did my channel do this week\", \"design a thumbnail for…\"). Juel plans it with its team of specialists, calls the app for you, spends credits only within your token's scope and balance, and answers with what it did, what it cost, and links to any media or report. Pass thread_id to continue a conversation.",
    inputSchema: { type: "object", properties: { message: { type: "string", description: "What you want done or asked" }, thread_id: { type: "string", description: "Continue this Juel conversation (from an earlier answer)" }, context: { type: "object", description: "Optional: { surface, entityId } of an item to work on, e.g. { surface: 'recap', entityId: 'rcp_…' }" } }, required: ["message"] },
    annotations: { title: "Ask Juel", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "find_capabilities",
    title: "Find AutoYT capabilities",
    description: "Search AutoYT's API: every route with what it does, its risk (read, change, paid, publish, delete), and whether it spends credits. Filter by words, area, or risk.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words to match, e.g. 'recap render' or 'thumbnail'" }, area: { type: "string", enum: Object.keys(JUEL_SPECIALISTS) }, risk: { type: "string", enum: JUEL_RISKS } } },
    annotations: { title: "Find capabilities", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "describe_capability",
    title: "Describe one route",
    description: "Details of one route (\"POST /api/recaps/:id/render\"): what it does, its risk and credit cost, and the server code that handles it, so you can see which body fields it reads.",
    inputSchema: { type: "object", properties: { route: { type: "string", description: "METHOD /path as find_capabilities lists it" } }, required: ["route"] },
    annotations: { title: "Describe a route", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "call_api",
    title: "Call the AutoYT API",
    description: "Call one AutoYT route as you (e.g. GET /api/recaps, POST /api/recaps/rcp_1/render). Your token's scope decides what may run; paid routes are checked against your credits first. Returns the status and JSON.",
    inputSchema: { type: "object", properties: { method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] }, path: { type: "string", description: "A concrete path starting with /api/" }, query: { type: "object", additionalProperties: true }, body: { type: "object", additionalProperties: true } }, required: ["method", "path"] },
    annotations: { title: "Call the API", readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  {
    name: "quote_credits",
    title: "Quote a call's credits",
    description: "What one route call would cost in credits, and whether your balance covers it, without running it.",
    inputSchema: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, body: { type: "object", additionalProperties: true } }, required: ["method", "path"] },
    annotations: { title: "Quote credits", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "credit_balance",
    title: "Credit balance",
    description: "Your AutoYT plan, credit balance, and what you've used this period.",
    inputSchema: { type: "object", properties: {} },
    annotations: { title: "Credit balance", readOnlyHint: true, openWorldHint: false },
  },
];
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

/** Answers one MCP JSON-RPC message; `tools.call(name, args)` runs a tool. Notifications get null. */
export async function mcpRespond(message, { call }) {
  const id = message?.id;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const fail = (code, text) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message: text } });
  if (!message || message.jsonrpc !== "2.0" || typeof message.method !== "string") return fail(-32600, "Invalid request");
  if (id === undefined || id === null) return null;
  switch (message.method) {
    case "initialize": {
      const asked = String(message.params?.protocolVersion || "");
      return reply({
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "autoyt", title: "AutoYT", version: "1.0.0" },
        instructions: "AutoYT makes and runs video channels: movie recaps, edits, studio images/video/music, films, channel automation, publishing. For a task in plain words use ask_juel. To work route by route: find_capabilities, describe_capability, then call_api. Paid work spends the user's credits: quote_credits first when unsure.",
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: MCP_TOOLS });
    case "tools/call": {
      const name = String(message.params?.name || "");
      if (!MCP_TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool: ${name}`);
      try {
        const out = await call(name, message.params?.arguments || {});
        return reply({ content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out, null, 2) }], ...(out && typeof out === "object" ? { structuredContent: out } : {}), isError: false });
      } catch (error) {
        return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
      }
    }
    default:
      return fail(-32601, `Method not found: ${message.method}`);
  }
}

// ---------- Routes ----------

const THREADS = "juel-threads.json";
const MAX_THREADS = 120;
const newId = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;

const OPERATOR = "POST /api/automation/agents/:id/chat";
const STUDIO_GENERATE = "POST /api/studio/generations";

/** A finished turn's attachment, cut to what the panel draws: an agent operator's answer (its report,
 *  cards, live blocks, actions, sub-agents, applied settings) or a generation Juel started. */
function slimOperator(agentId, data) {
  return {
    kind: "operator",
    agentId,
    reply: clipText(String(data?.reply || ""), 4000),
    presentation: data?.presentation ? { title: String(data.presentation.title || ""), summary: String(data.presentation.summary || ""), html: String(data.presentation.html || "").slice(0, 16000), cards: Array.isArray(data.presentation.cards) ? data.presentation.cards.slice(0, 8) : [] } : null,
    cards: Array.isArray(data?.cards) ? data.cards.slice(0, 8) : [],
    blocks: Array.isArray(data?.blocks) ? data.blocks.slice(0, 12) : [],
    actions: Array.isArray(data?.actions) ? data.actions.slice(0, 8) : [],
    subagents: Array.isArray(data?.subagents) ? data.subagents.slice(0, 6).map((s) => ({ id: s.id, name: s.name, status: s.status, summary: clipText(String(s.summary || ""), 600) })) : [],
    applied: Array.isArray(data?.applied) ? data.applied.slice(0, 20) : [],
    unapplied: Array.isArray(data?.unapplied) ? data.unapplied.slice(0, 20) : [],
  };
}

/** What the agent's operator remembers from the user's other Juel conversations about the same agent. */
function operatorMemory(threads, thread, agentId) {
  return threads
    .filter((t) => t.id !== thread.id && t.entityId === agentId && t.messages?.length)
    .slice(0, 5)
    .map((t) => {
      const user = [...t.messages].reverse().find((m) => m.role === "user");
      const reply = [...t.messages].reverse().find((m) => m.role === "assistant" && !m.error);
      return [`Conversation "${t.title}" (${String(t.updatedAt || t.createdAt).slice(0, 10)})`, user ? `user asked: ${clipText(String(user.content).replace(/\s+/g, " "), 140)}` : "", reply ? `assistant replied: ${clipText(String(reply.content).replace(/\s+/g, " "), 160)}` : ""].filter(Boolean).join(" — ");
    });
}

/** Old, big attachments (operator HTML, blocks) only stay on the latest replies, so threads stay small. */
function trimThread(thread) {
  if (thread.messages.length > 80) thread.messages.splice(0, thread.messages.length - 80);
  const replies = thread.messages.filter((m) => m.role === "assistant" && m.attachments?.length);
  for (const m of replies.slice(0, -8)) m.attachments = m.attachments.map((a) => (a.kind === "operator" ? { ...a, presentation: a.presentation ? { ...a.presentation, html: "" } : null, blocks: [] } : a));
}

/** Juel's chat: POST /api/juel/chat streams the turn as NDJSON (step, spend, credits, page, attach) and
 *  ends with the thread. Paid calls run straight away after a credit check; POST /api/juel/quote prices one
 *  call for the panel's own buttons.
 *  @param {any} app
 *  @param {{ session: (req: any) => Promise<any>, isAdmin: (email: string) => any, generateJson: (prompt: string, options?: any) => Promise<any>, docs: { read: (userId: string, name: string) => Promise<any[]>, save: (userId: string, name: string, limit: number) => Promise<any> }, port: number | string, withUsage: (userId: string, feature: string, run: () => any) => any, credits?: { snapshot: (userId: string) => Promise<any>, pricing: () => Promise<any>, history: () => Promise<any> } }} deps */
export function registerJuel(app, deps) {
  const baseUrl = `http://127.0.0.1:${deps.port}`;
  // Pricing for quotes: the admin's billing settings, what routes recently cost, and the studio's models.
  let catalog = null;
  const studioCatalog = (signIn) => {
    if (!catalog || Date.now() - catalog.at > 10 * 60 * 1000) {
      catalog = { at: Date.now(), value: callRoute({ method: "GET", path: "/api/studio/catalog" }, { baseUrl, ...signIn }).then((r) => (r.status === 200 ? r.data : null)).catch(() => null) };
    }
    return catalog.value;
  };
  /** @param {{ cookie?: string, authorization?: string }} signIn */
  const quoteSources = async (signIn) => ({
    pricing: await deps.credits?.pricing().catch(() => null),
    history: (await deps.credits?.history().catch(() => null)) || {},
    catalog: () => studioCatalog(signIn),
  });
  const snapshot = (userId) => deps.credits?.snapshot(userId).catch(() => null) ?? Promise.resolve(null);
  const signedIn = async (req, res) => {
    const session = await deps.session(req).catch(() => null);
    if (!session?.user) {
      res.status(401).json({ error: "Sign in required" });
      return null;
    }
    const admin = Boolean(await deps.isAdmin(String(session.user.email || "")).catch(() => false));
    return { userId: String(session.user.id), admin };
  };

  // The old Creative Studio agent chats become Juel conversations (per persona, generations attached) the
  // first time the list loads, so nothing said or made there is lost.
  const importStudioChats = async (userId, threads) => {
    const old = await deps.docs.read(userId, "agent-chats.json").catch(() => []);
    let added = 0;
    for (const chat of Array.isArray(old) ? old : []) {
      const id = `juel_studio_${chat.id}`;
      if (!chat?.id || threads.some((t) => t.id === id)) continue;
      threads.push({
        id,
        title: String(chat.title || "Studio chat").slice(0, 60),
        surface: "studio",
        entityId: `agent:${chat.agent || "creative"}`,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt || chat.createdAt,
        messages: (chat.messages || []).map((m) => (m.role === "user"
          ? { role: "user", content: String(m.content || ""), at: m.at }
          : { role: "assistant", content: String(m.content || ""), at: m.at, attachments: (m.actions || []).filter((a) => a.generationId).map((a) => ({ kind: "generation", id: a.generationId, tab: a.app, prompt: clipText(String(a.prompt || ""), 300) })) })),
      });
      added += 1;
    }
    if (!added) return;
    threads.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    await deps.docs.save(userId, THREADS, MAX_THREADS);
  };

  // An automation agent's conversations from before Juel (and the ones Telegram keeps adding there) come
  // in as Juel conversations about that agent; an imported one refreshes until it's continued in Juel.
  const importAgentChats = async (userId, agentId, cookie, threads) => {
    const got = await callRoute({ method: "GET", path: `/api/automation/agents/${encodeURIComponent(agentId)}/chats` }, { baseUrl, cookie, signal: AbortSignal.timeout(15000) }).catch(() => null);
    const chats = got?.status === 200 && Array.isArray(got.data?.chats) ? got.data.chats : [];
    let changed = 0;
    for (const chat of chats) {
      if (!chat?.id || !Array.isArray(chat.messages) || !chat.messages.length) continue;
      const id = `juel_agent_${chat.id}`;
      const updatedAt = new Date(Number(chat.updatedAt) || Date.now()).toISOString();
      const existing = threads.find((t) => t.id === id);
      if (existing && (!existing.importedAt || existing.importedAt >= updatedAt)) continue;
      const messages = chat.messages.filter((m) => m && (m.role === "user" || m.role === "assistant")).map((m) => {
        const at = new Date(Number(m.timestamp) || Number(chat.updatedAt) || Date.now()).toISOString();
        if (m.role === "user") return { role: "user", content: String(m.content || ""), at };
        const rich = m.actions?.length || m.subagents?.length || m.applied?.length || m.unapplied?.length;
        return { role: "assistant", content: String(m.content || ""), at, ...(m.stopped ? { stopped: true } : {}), ...(rich ? { attachments: [{ ...slimOperator(agentId, { ...m, reply: "" }) }] } : {}) };
      });
      const thread = { id, title: String(chat.title || "Agent chat").slice(0, 60), surface: "automation", entityId: agentId, createdAt: new Date(Number(chat.createdAt) || Date.now()).toISOString(), updatedAt, importedAt: updatedAt, messages };
      if (existing) Object.assign(existing, thread);
      else threads.push(thread);
      changed += 1;
    }
    if (!changed) return;
    threads.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    await deps.docs.save(userId, THREADS, MAX_THREADS);
  };

  app.get("/api/juel/threads", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const threads = await deps.docs.read(who.userId, THREADS);
    await importStudioChats(who.userId, threads).catch(() => undefined);
    if (req.query?.agent) await importAgentChats(who.userId, String(req.query.agent).slice(0, 120), String(req.headers.cookie || ""), threads).catch(() => undefined);
    res.json({ threads: threads.map(({ id, title, surface, entityId, updatedAt, createdAt }) => ({ id, title, surface, entityId: entityId || "", updatedAt: updatedAt || createdAt })) });
  });

  // What one call would cost and whether the balance covers it: the panel checks before an operator button runs.
  app.post("/api/juel/quote", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const call = { method: String(req.body?.method || "POST"), path: String(req.body?.path || ""), body: req.body?.body };
    const quote = await estimateCredits(call, await quoteSources({ cookie: String(req.headers.cookie || "") })).catch(() => null);
    const short = quote?.credits ? creditShortfall(await snapshot(who.userId), quote.credits) : null;
    res.json({ credits: quote?.credits || 0, does: quote?.does || "", short });
  });

  app.get("/api/juel/threads/:id", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const thread = (await deps.docs.read(who.userId, THREADS)).find((t) => t.id === req.params.id);
    if (!thread) return res.status(404).json({ error: "That conversation is gone." });
    res.json({ thread });
  });

  app.delete("/api/juel/threads/:id", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const threads = await deps.docs.read(who.userId, THREADS);
    const index = threads.findIndex((t) => t.id === req.params.id);
    if (index >= 0) threads.splice(index, 1);
    await deps.docs.save(who.userId, THREADS, MAX_THREADS);
    res.json({ deleted: index >= 0 });
  });

  /** One Juel turn for a user, from the browser chat or an MCP client: the conversation it continues (or a
   *  new one), its events streamed through `send` (step, spend, credits, page, attach, done), and the
   *  conversation saved at the end. `auth` is how its route calls sign in: the browser's cookie or the
   *  caller's API token (whose scope then bounds what Juel may do). */
  async function runTurn({ who, auth, message, threadId, where = {}, editFrom = -1, send, stop }) {
    const surface = String(where.surface || "").slice(0, 40);
    const entityId = String(where.entityId || "").slice(0, 120);
    const threads = await deps.docs.read(who.userId, THREADS);
    let thread = threads.find((t) => t.id === threadId);
    if (!thread) {
      thread = { id: newId("juel"), title: message.slice(0, 60), surface, entityId, messages: [], createdAt: new Date().toISOString() };
      threads.unshift(thread);
    }
    if (entityId) thread.entityId = entityId;
    // Continued in Juel: an imported conversation stops refreshing from its old store.
    delete thread.importedAt;
    // Editing an earlier message (or asking again) replaces it and everything after it.
    if (Number.isInteger(editFrom) && editFrom >= 0 && thread.messages[editFrom]?.role === "user") thread.messages.splice(editFrom);
    const signIn = { cookie: String(auth.cookie || ""), authorization: String(auth.authorization || "") };
    const context = { surface, label: String(where.label || "").slice(0, 120), entityId, details: where.details ?? null, clientTools: pageTools(where.clientTools) };
    const sources = await quoteSources(signIn);
    const before = await snapshot(who.userId);
    const spends = [];
    const attachments = [];
    const attach = (attachment) => {
      attachments.push(attachment);
      send({ type: "attach", attachment });
    };
    // A paid call is quoted, checked against the balance, and refused (with a toast) when it can't be covered.
    const charge = async (does, credits, specialist) => {
      if (!credits) return;
      const short = creditShortfall(await snapshot(who.userId), credits + spends.reduce((sum, s) => sum + (s.status === "started" ? s.credits : 0), 0));
      if (short) {
        spends.push({ specialist, does, credits, status: "refused" });
        send({ type: "credits", does, ...short });
        throw new JuelRefusal(`Not enough credits. ${short.message}`, "credits");
      }
    };
    const spent = (does, credits, specialist) => {
      if (!credits) return;
      const spend = { specialist, does, credits, status: "started" };
      spends.push(spend);
      send({ type: "spend", spend });
    };
    const signal = (ms) => AbortSignal.any([stop.signal, AbortSignal.timeout(ms)]);
    // Every URL a route returned this turn: what a specialist may show in the chat.
    const seen = new Set();
    // The open agent's operator: called with this conversation and memory of the user's other ones about the
    // agent, its progress streamed as steps, and its whole answer attached under Juel's reply.
    const consultOperator = async (agentId, body, specialist) => {
      const history = thread.messages.filter((m) => (m.role === "user" || m.role === "assistant") && !m.error && String(m.content || "").trim()).slice(-14).map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }));
      const ask = String(body?.message || body?.task || message).slice(0, 2000);
      const response = await fetch(new URL(`/api/automation/agents/${encodeURIComponent(agentId)}/chat`, baseUrl), {
        method: "POST",
        headers: { cookie: signIn.cookie, ...(signIn.authorization ? { authorization: signIn.authorization } : {}), accept: "application/x-ndjson", "content-type": "application/json", "x-juel": "1" },
        body: JSON.stringify({ messages: [...history, { role: "user", content: ask }], memory: operatorMemory(threads, thread, agentId), conversationId: thread.id }),
        signal: signal(6 * 60 * 1000),
      });
      if (!String(response.headers.get("content-type") || "").includes("ndjson")) return { status: response.status, data: await response.json().catch(() => null) };
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let data = null;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines.filter((l) => l.trim())) {
          const event = JSON.parse(line);
          if (event.type === "progress") send({ type: "step", specialist, text: String(event.message || "Working").slice(0, 160) });
          else if (event.type === "result") data = event.data;
          else if (event.type === "error") throw new Error(event.error || "The agent's operator couldn't answer.");
        }
      }
      if (!data) throw new Error("The agent's operator didn't answer.");
      urlsIn(data, seen);
      attach(slimOperator(agentId, data));
      return { status: 200, data: { reply: data.reply, applied: data.applied, unapplied: data.unapplied, actionsOffered: (data.actions || []).map((a) => a.label), shownToUser: true } };
    };
    const call = async ({ method, path, query, body, specialist }) => {
      const hit = matchRoute(method, path);
      const quote = hit && !hit.excluded ? await estimateCredits({ method, path, body }, sources).catch(() => null) : null;
      const credits = quote?.credits || 0;
      await charge(hit?.does || path, credits, specialist);
      if (hit?.key === OPERATOR && !hit.excluded) {
        const result = await consultOperator(hit.params.id, body, specialist);
        if (result.status < 400) spent(hit.does, credits, specialist);
        return { ...result, credits };
      }
      const result = await callRoute({ method, path, query, body }, { baseUrl, ...signIn, admin: who.admin, signal: signal(180000) });
      if (result.status === 402) send({ type: "credits", does: hit?.does || path, needed: credits, balance: null, message: String(result.data?.error || "You're out of credits.") });
      if (result.status < 400) {
        spent(hit?.does || path, credits, specialist);
        urlsIn(result.data, seen);
      }
      const generation = hit?.key === STUDIO_GENERATE && result.status < 400 ? result.data?.generation : null;
      if (generation?.id) attach({ kind: "generation", id: generation.id, tab: generation.tab || body?.tab || "", prompt: clipText(String(generation.prompt || body?.prompt || ""), 300) });
      return { ...result, credits };
    };
    // Pictures, videos, and sounds a specialist puts in the chat: only URLs a route returned this turn.
    const show = (items) => {
      const already = new Set(attachments.flatMap((a) => (a.kind === "media" ? a.items.map((i) => i.url) : [])));
      const media = cleanShows(items, seen).filter((m) => !already.has(m.url));
      if (media.length) attach({ kind: "media", items: media });
      return media.length;
    };
    // Actions on the open page run in the browser, after the same credit check for the paid ones.
    let applied = 0;
    const page = async ({ type, args, specialist }) => {
      const action = context.clientTools?.actions?.[type];
      if (!action) throw new JuelRefusal(`The open page has no "${type}" action.`, "unknown");
      const credits = pageActionCredits(action, sources.pricing);
      await charge(action.about || type, credits, specialist);
      applied += 1;
      spent(action.about || type, credits, specialist);
      send({ type: "page", surface, actions: [{ type, args }] });
      return { sent: true, credits };
    };
    const think = (prompt) => deps.generateJson(prompt, { maxTokens: 2500, signal: stop.signal });
    const shown = () => attachments.map((a) => (a.kind === "operator" ? "the agent operator's full answer (report, cards, buttons)" : a.kind === "media" ? `${a.items.length} picture/video/audio item(s) a specialist showed` : `the ${a.tab || "studio"} generation it started`)).join("; ");
    const at = new Date().toISOString();
    try {
      // A page that sends its live state (the open edit) needs no second look at the saved copy.
      if (SURFACE_READS[surface] && entityId && !where.details) {
        send({ type: "step", specialist: surface, text: "Looking at what you have open" });
        const open = await callRoute({ method: "GET", path: SURFACE_READS[surface](entityId) }, { baseUrl, ...signIn, admin: who.admin, signal: signal(20000) }).catch(() => null);
        if (open?.status === 200) {
          context.open = clipText(open.data, 6000);
          urlsIn(open.data, seen);
        }
      }
      const turn = await deps.withUsage(who.userId, "juel", () => juelTurn({ message, history: thread.messages, context, admin: who.admin, think, call, page, show, shown, onStep: (s) => send({ type: "step", ...s }) }));
      if (turn.report) attach(turn.report);
      // What the turn has actually charged so far (Juel's own thinking included); long jobs keep charging after.
      const after = before ? await snapshot(who.userId) : null;
      const charged = before && after ? Math.max(0, Math.round((Number(after.periodUsed) - Number(before.periodUsed)) / 100)) : null;
      thread.messages.push({ role: "user", content: message, at }, { role: "assistant", content: turn.reply, steps: turn.steps, ...(spends.length ? { spends } : {}), ...(attachments.length ? { attachments } : {}), ...(applied ? { applied } : {}), ...(charged ? { charged } : {}), at: new Date().toISOString() });
    } catch (error) {
      const stopped = stop.signal.aborted;
      thread.messages.push({ role: "user", content: message, at }, { role: "assistant", content: stopped ? "Stopped." : `Something went wrong: ${error instanceof Error ? error.message : error}`, ...(stopped ? { stopped: true } : { error: true }), ...(spends.length ? { spends } : {}), ...(attachments.length ? { attachments } : {}), at: new Date().toISOString() });
    }
    trimThread(thread);
    thread.updatedAt = new Date().toISOString();
    threads.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    await deps.docs.save(who.userId, THREADS, MAX_THREADS);
    send({ type: "done", thread });
    return thread;
  }

  app.post("/api/juel/chat", async (req, res) => {
    const who = await signedIn(req, res);
    if (!who) return;
    const message = String(req.body?.message || "").trim().slice(0, 4000);
    if (!message) return res.status(400).json({ error: "Write a message first." });
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    // The panel's Stop closes the stream; that stops the turn's model calls and route calls too.
    const stop = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) stop.abort(new Error("Stopped."));
    });
    const send = (event) => {
      if (!res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    const where = req.body?.context && typeof req.body.context === "object" ? req.body.context : {};
    await runTurn({ who, auth: { cookie: req.headers.cookie }, message, threadId: req.body?.threadId, where, editFrom: typeof req.body?.editFrom === "number" ? req.body.editFrom : -1, send, stop });
    res.end();
  });

  // ---------- Personal access tokens (only the hash is kept; the token is shown once) ----------
  const allTokens = () => deps.docs.read(TOKENS_OWNER, TOKENS_DOC);
  const saveTokens = () => deps.docs.save(TOKENS_OWNER, TOKENS_DOC, 100000);
  const publicToken = (t) => ({ id: t.id, name: t.name, scope: t.scope, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || null });
  const tokens = {
    async resolve(raw) {
      const hash = sha256(raw);
      const token = (await allTokens()).find((t) => t.hash === hash);
      if (!token) return null;
      // Last used is recorded at most every five minutes.
      if (!token.lastUsedAt || Date.now() - Date.parse(token.lastUsedAt) > 5 * 60 * 1000) {
        token.lastUsedAt = new Date().toISOString();
        void saveTokens().catch(() => undefined);
      }
      return { id: token.id, userId: token.userId, email: token.email, scope: token.scope, name: token.name };
    },
  };
  api = {
    tokens,
    isAdmin: async (email) => Boolean(await deps.isAdmin(String(email || "")).catch(() => false)),
    quoteSources,
    snapshot,
  };
  // Tokens are managed only from a signed-in browser: a token can't make or list tokens.
  const browserOnly = async (req, res) => {
    if (req.apiToken) {
      res.status(403).json({ error: "Manage API tokens from AutoYT in your browser (Account > Developers)." });
      return null;
    }
    const session = await deps.session(req).catch(() => null);
    if (!session?.user) {
      res.status(401).json({ error: "Sign in required" });
      return null;
    }
    return session.user;
  };
  app.get("/api/account/tokens", async (req, res) => {
    const user = await browserOnly(req, res);
    if (!user) return;
    const mine = (await allTokens()).filter((t) => t.userId === String(user.id)).map(publicToken);
    res.json({ tokens: mine, scopes: Object.fromEntries(Object.entries(TOKEN_SCOPES).map(([id, s]) => [id, s.label])) });
  });
  app.post("/api/account/tokens", async (req, res) => {
    const user = await browserOnly(req, res);
    if (!user) return;
    const name = String(req.body?.name || "").replace(/\s+/g, " ").trim().slice(0, 60) || "API token";
    const scope = TOKEN_SCOPES[req.body?.scope] ? String(req.body.scope) : "read";
    const list = await allTokens();
    if (list.filter((t) => t.userId === String(user.id)).length >= MAX_TOKENS_PER_USER) return res.status(400).json({ error: `You have ${MAX_TOKENS_PER_USER} tokens. Revoke one first.` });
    const raw = `${TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
    const token = { id: newId("tok"), userId: String(user.id), email: String(user.email || ""), name, scope, hash: sha256(raw), prefix: `${raw.slice(0, 8)}…${raw.slice(-4)}`, createdAt: new Date().toISOString() };
    list.push(token);
    await saveTokens();
    res.status(201).json({ token: raw, ...publicToken(token) });
  });
  app.delete("/api/account/tokens/:id", async (req, res) => {
    const user = await browserOnly(req, res);
    if (!user) return;
    const list = await allTokens();
    const index = list.findIndex((t) => t.id === req.params.id && t.userId === String(user.id));
    if (index >= 0) {
      list.splice(index, 1);
      await saveTokens();
    }
    res.json({ revoked: index >= 0 });
  });

  // The API's description, open to anyone (it lists routes, not data).
  app.get("/api/openapi.json", (req, res) => {
    res.json(openApiSpec(deps.appUrl?.(req) || baseUrl));
  });

  // ---------- MCP (Streamable HTTP, stateless, JSON responses) ----------
  app.post("/mcp", async (req, res) => {
    const token = req.apiToken;
    if (!token) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="AutoYT"');
      return res.status(401).json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Send a personal access token: Authorization: Bearer ayt_… (create one in AutoYT under Account > Developers)." } });
    }
    const who = { userId: token.userId, admin: await api.isAdmin(token.email) };
    const authorization = String(req.headers.authorization || "");
    const origin = deps.appUrl?.(req) || baseUrl;
    const absolute = (url) => (String(url).startsWith("/") ? `${origin}${url}` : String(url));
    const allowedRisks = (TOKEN_SCOPES[token.scope] || TOKEN_SCOPES.read).risks;
    const sources = () => quoteSources({ authorization });
    const run = {
      ask_juel: async (args) => {
        const message = String(args.message || "").trim().slice(0, 4000);
        if (!message) throw new Error("Write a message for Juel.");
        const stop = new AbortController();
        res.on("close", () => !res.writableEnded && stop.abort(new Error("The client went away.")));
        const timer = setTimeout(() => stop.abort(new Error("Juel took too long; ask for a smaller step.")), 9 * 60 * 1000);
        const where = args.context && typeof args.context === "object" ? { surface: args.context.surface, entityId: args.context.entityId, label: "API" } : { surface: "api", label: "API" };
        const thread = await runTurn({ who, auth: { authorization }, message, threadId: args.thread_id, where, send: () => undefined, stop }).finally(() => clearTimeout(timer));
        const last = thread.messages[thread.messages.length - 1] || {};
        const attachments = last.attachments || [];
        return {
          thread_id: thread.id,
          reply: last.content,
          ...(last.error ? { failed: true } : {}),
          steps: (last.steps || []).map((s) => `${JUEL_SPECIALISTS[s.specialist]?.name || s.specialist}: ${s.text}`),
          credits: {
            started: (last.spends || []).filter((s) => s.status === "started").map((s) => ({ what: s.does, about: s.credits })),
            refused: (last.spends || []).filter((s) => s.status === "refused").map((s) => ({ what: s.does, needs: s.credits })),
            charged_so_far: last.charged || 0,
          },
          media: attachments.filter((a) => a.kind === "media").flatMap((a) => a.items.map((i) => ({ ...i, url: absolute(i.url) }))),
          generations: attachments.filter((a) => a.kind === "generation").map((a) => ({ id: a.id, app: a.tab, prompt: a.prompt, status_url: absolute(`/api/studio/generations?tab=${encodeURIComponent(a.tab)}`) })),
          reports: attachments.filter((a) => a.kind === "report" || a.kind === "operator").map((a) => (a.kind === "report" ? { title: a.title, cards: a.cards, table: a.table } : { title: a.presentation?.title || "The agent's answer", answer: a.reply, cards: a.presentation?.cards?.length ? a.presentation.cards : a.cards, buttons: a.actions.map((x) => x.label), applied: a.applied })),
        };
      },
      find_capabilities: async (args) => {
        const words = String(args.query || "").toLowerCase().split(/\s+/).filter(Boolean);
        const found = juelTools({ admin: who.admin }).filter((t) => (!args.area || t.specialist === args.area) && (!args.risk || t.risk === args.risk) && words.every((w) => `${t.route} ${t.does}`.toLowerCase().includes(w)));
        return {
          count: found.length,
          routes: found.slice(0, 60).map((t) => ({ route: t.route, does: t.does, area: t.specialist, risk: t.risk, spends_credits: t.spends || JUEL_COSTS[t.route] !== undefined, your_token_can_call: allowedRisks.includes(t.risk) })),
          ...(found.length > 60 ? { note: `Showing 60 of ${found.length}: narrow the query.` } : {}),
        };
      },
      describe_capability: async (args) => {
        const [m = "", ...rest] = String(args.route || "").trim().split(/\s+/);
        const key = `${m.toUpperCase()} ${rest.join(" ")}`;
        const entry = JUEL_ROUTES[key];
        if (!entry) throw new Error(JUEL_EXCLUDED[key] ? `${key} isn't available to the API (${JUEL_EXCLUDED[key]}).` : `No route ${key}. Use find_capabilities to see the exact names.`);
        const [specialist, risk, does] = entry;
        if (specialist === "admin" && !who.admin) throw new Error("That's an admin route.");
        const cost = JUEL_COSTS[key];
        return { route: key, does, area: specialist, risk, your_token_can_call: allowedRisks.includes(risk), credits: typeof cost === "function" ? "depends on the request: use quote_credits" : cost !== undefined ? (cost ? `spends: ${cost}` : "usually free") : risk === "paid" ? "spends: one AI text call" : "free", handler_code: clipText(await routeSource(key), 8000) };
      },
      call_api: async (args) => {
        const method = String(args.method || "GET").toUpperCase();
        const path = String(args.path || "");
        if (!path.startsWith("/api/")) throw new Error("The path must start with /api/.");
        const result = await callRoute({ method, path, query: args.query, body: args.body }, { baseUrl, authorization, admin: who.admin, signal: AbortSignal.timeout(180000) });
        const text = JSON.stringify(result.data ?? null);
        return { status: result.status, route: result.route, ...(text.length > 60000 ? { data_truncated: `${text.slice(0, 60000)}…`, note: "The response was cut at 60,000 characters: filter it with query parameters." } : { data: result.data }) };
      },
      quote_credits: async (args) => {
        const call = { method: String(args.method || "POST"), path: String(args.path || ""), body: args.body };
        const quote = await estimateCredits(call, await sources());
        const short = quote?.credits ? creditShortfall(await snapshot(who.userId), quote.credits) : null;
        return { credits: quote?.credits || 0, does: quote?.does || "", balance_covers_it: !short, ...(short ? { shortfall: short } : {}) };
      },
      credit_balance: async () => {
        const s = await snapshot(who.userId);
        if (!s) return { note: "No billing account yet." };
        return { plan: s.planName, unlimited: Boolean(s.unlimited), balance_credits: Math.floor((Number(s.balance) || 0) / TOKENS_PER_CREDIT), used_this_period: Math.round((Number(s.periodUsed) || 0) / TOKENS_PER_CREDIT), renews: s.periodEnd || null };
      },
    };
    const body = req.body;
    const messages = Array.isArray(body) ? body : [body];
    const out = [];
    for (const message of messages.slice(0, 20)) {
      const answer = await deps.withUsage(who.userId, "mcp", () => mcpRespond(message, { call: (name, args) => run[name](args && typeof args === "object" ? args : {}) }));
      if (answer) out.push(answer);
    }
    if (!out.length) return res.status(202).end();
    res.json(Array.isArray(body) ? out : out[0]);
  });
  app.get("/mcp", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "AutoYT's MCP server speaks Streamable HTTP: POST JSON-RPC to /mcp with your token." }));
  app.delete("/mcp", (_req, res) => res.status(405).set("Allow", "POST").json({ error: "This MCP server keeps no sessions." }));
}
