// Juel: the one AutoYT agent. A manager talks to the user and hands work to specialists; every ability
// in the app is a route in JUEL_ROUTES, owned by a specialist and graded by risk, and Juel calls it as the
// signed-in user, so each route's own sign-in, checks, and limits still apply. A new route has to be
// catalogued here (or excluded, with a reason): server/juel.test.ts fails the build otherwise.

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

/** Risk, lowest first. Paid, publish, and delete always wait for the user's approval. */
export const JUEL_RISKS = ["read", "change", "paid", "publish", "delete"];
export const needsApproval = (risk) => risk === "paid" || risk === "publish" || risk === "delete";

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
  "DELETE /api/studio/agents/chats/:id": ["studio", "delete", "Deletes one of your Creator Studio agent chats."],
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
  "GET /api/studio/agents/chats": ["studio", "read", "Lists your Creator Studio agent chats."],
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
  "POST /api/maker/projects/:id/vibe-edit": ["producer", "change", "Sends a finished Create Video plan to Vibe Edit as a new editable timeline."],
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
  "POST /api/studio/agents/chats/:id/approve": ["studio", "paid", "Approves or skips a studio agent's proposed generations, starting the approved ones."],
  "POST /api/studio/generations": ["studio", "paid", "Starts a new Creator Studio generation such as an image, video, audio, design, or explainer."],
  "POST /api/studio/generations/:id/design": ["studio", "change", "Saves your edited HTML back into an Editable Design generation."],
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
  "POST /api/automation/agents/:id/chat": "the old agent chat: Juel is the agent now",
  "POST /api/automation/agents/chat/transcribe": "voice-input plumbing for chat UI",
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
  "POST /api/transcribe/upload": "raw file upload from the Rewriter drop area; Juel passes links to POST /api/transcribe",
  "POST /api/movie/identify-file": "needs a raw video file in the request body",
  "POST /api/recaps/uploads": "raw binary file upload stream",
  "POST /api/studio/agents/chats": "the old agent chat: Juel is the agent now",
  "POST /api/tiktok/comments/cache": "worker push endpoint",
  "POST /api/tools/thumbnail": "binary file download",
  "POST /api/vibe-edit/chat": "the old agent chat: Juel is the agent now",
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
    return { key, params, specialist, risk, does, approval: needsApproval(risk) };
  }
  return null;
}

/** The tools a specialist (or all of them) can use, for a prompt: one line each. Admin routes only for admins.
 *  @param {{ specialist?: string, admin?: boolean, routes?: JuelRouteTable }} [options] */
export function juelTools({ specialist = "", admin = false, routes = JUEL_ROUTES } = {}) {
  return Object.entries(routes)
    .filter(([, [owner]]) => (specialist ? owner === specialist : true) && (admin || owner !== "admin"))
    .map(([key, [owner, risk, does]]) => ({ route: key, specialist: owner, risk, does, approval: needsApproval(risk) }));
}

export class JuelRefusal extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** Calls a catalogued route as the user (their session cookie on a loopback request), so the route's own
 *  checks run. Refuses unknown and excluded routes, admin routes for non-admins, and risky ones without
 *  the user's approval. Returns { status, data, route }.
 *  @param {{ method?: string, path: string, body?: unknown, query?: Record<string, unknown> }} call
 *  @param {{ baseUrl: string, cookie?: string, admin?: boolean, approved?: boolean, signal?: AbortSignal, fetchImpl?: typeof fetch } & JuelTables} options */
export async function callRoute({ method = "GET", path, body, query } = {}, { baseUrl, cookie = "", admin = false, approved = false, signal, fetchImpl = globalThis.fetch, routes = JUEL_ROUTES, excluded = JUEL_EXCLUDED } = {}) {
  const hit = matchRoute(method, path, { routes, excluded });
  if (!hit) throw new JuelRefusal(`Juel has no tool for ${String(method).toUpperCase()} ${path}.`, "unknown");
  if (hit.excluded) throw new JuelRefusal(`Juel doesn't call ${hit.key}: ${hit.excluded}.`, "excluded");
  if (hit.specialist === "admin" && !admin) throw new JuelRefusal("That's an admin tool.", "forbidden");
  if (hit.approval && !approved) throw new JuelRefusal(`${hit.does} needs your approval first.`, "approval");
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query || {})) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  const verb = String(method).toUpperCase();
  const response = await fetchImpl(url, {
    method: verb,
    headers: { cookie, accept: "application/json", "x-juel": "1", ...(body !== undefined && verb !== "GET" ? { "content-type": "application/json" } : {}) },
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
