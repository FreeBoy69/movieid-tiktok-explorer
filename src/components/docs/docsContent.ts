// The AutoYT docs: a guide to every part of the product, and the developer docs (tokens, the REST API, MCP).
// Pages are data so one renderer draws them and search reads the same words. Inline text understands
// **bold**, `code`, and [links](/path); links starting with "/" stay inside the app.

export type DocBlock =
  | { p: string }
  | { list: string[] }
  | { steps: string[] }
  | { code: string; label?: string; lang?: string }
  | { note: string; tone?: "info" | "warn" }
  | { table: { head: string[]; rows: string[][] } }
  | { h3: string };
export type DocSection = { id: string; title: string; blocks: DocBlock[] };
export type DocPage = { id: string; group: "Guide" | "Developers"; title: string; lead: string; sections: DocSection[]; reference?: boolean };

const TOKEN = "ayt_…";

export const DOCS: DocPage[] = [
  // ---------------------------------------------------------------- Guide
  {
    id: "introduction",
    group: "Guide",
    title: "Welcome to AutoYT",
    lead: "AutoYT is a workspace for running video channels: find what to make, produce it with AI, and publish it to the channels you connect.",
    sections: [
      {
        id: "what-it-is",
        title: "What AutoYT does",
        blocks: [
          { p: "AutoYT brings research, production, and publishing into one place. You can turn a film into a narrated recap, write and voice a video from a script, generate images, video, and music, edit on a timeline by chatting, and set up agents that run a channel on a schedule." },
          { p: "Everything you make lands in your **Projects**, and everything that publishes goes through the channels you connect in **Account > Channels**." },
        ],
      },
      {
        id: "how-it-is-organized",
        title: "How the app is organized",
        blocks: [
          { p: "The header holds every destination. The same list appears in the phone menu and in search (⌘K)." },
          {
            table: {
              head: ["Area", "What's there"],
              rows: [
                ["Create", "One box for images and videos, with every template below it"],
                ["Image", "Image Studio, Cinema Studio, AI Influencer, and the image tools"],
                ["Video", "Create Video, Movie to Recap, Vibe Edit, Compilations, Video Studio, and the marketing studios"],
                ["Create Film", "Series, short films, long films, and music videos"],
                ["Audio", "Audio Studio (speech and voices) and Music Generation"],
                ["Agents", "Automation agents, Creative Agents, the Design Agent, and Workflows"],
                ["Tools", "Downloads, transcripts, writing tools, research, and more"],
              ],
            },
          },
          { p: "**Juel**, AutoYT's assistant, is one button away on every page (⌘J). It knows the page you're on and can do almost anything in the app for you. See [Juel](/docs/juel)." },
        ],
      },
      {
        id: "who-its-for",
        title: "Who it's for",
        blocks: [
          { p: "Creators and small teams who run one or more channels and want a repeatable path from idea to published video. Developers can drive the same features from their own scripts and AI agents: see [Developers](/docs/developers)." },
          { note: "AutoYT helps you make and publish videos. It can't promise views, subscribers, or revenue, and some features (voice cloning, recaps of films) are only for material you have the rights to use." },
        ],
      },
    ],
  },
  {
    id: "getting-started",
    group: "Guide",
    title: "Getting started",
    lead: "Sign in, connect a channel, and make your first video in a few minutes.",
    sections: [
      {
        id: "sign-in",
        title: "Sign in",
        blocks: [
          { steps: ["Open [autoyt.cc](/) and choose **Sign in with Google**.", "Pick a plan in **Account > Plan & billing**. Your monthly credits arrive straight away.", "Choose light or dark in **Account > Profile** if you want to change the look."] },
        ],
      },
      {
        id: "connect-a-channel",
        title: "Connect a channel",
        blocks: [
          { p: "Publishing needs at least one connected channel. Go to [Account > Channels](/account/channels) and connect YouTube, TikTok, Instagram, Facebook, Snapchat, Pinterest, X, or LinkedIn. You can connect several and switch the active one from the header." },
        ],
      },
      {
        id: "first-video",
        title: "Make your first video",
        blocks: [
          { p: "The quickest routes to a finished video:" },
          {
            list: [
              "**From a film:** open [Movie to Recap](/tools/movie-recap), paste a film link or upload a file, and AutoYT writes, voices, and cuts a narrated recap.",
              "**From an idea:** open [Create Video](/create), describe the video, and go stage by stage from script to final render.",
              "**From a prompt:** type into the box on the [Create](/) page and pick Image or Video.",
              "**Just ask:** press ⌘J and tell Juel what you want made.",
            ],
          },
        ],
      },
      {
        id: "where-things-go",
        title: "Where your work goes",
        blocks: [
          { p: "Videos you make are in [Projects](/projects). Studio images, videos, and music are under **Your creations** in each studio. Long jobs keep running when you leave the page; the activity button in the header shows their progress." },
        ],
      },
    ],
  },
  {
    id: "credits",
    group: "Guide",
    title: "Credits and plans",
    lead: "AI work is paid for in credits. You always see what a step costs before it runs, and nothing starts that your balance can't cover.",
    sections: [
      {
        id: "how-credits-work",
        title: "How credits work",
        blocks: [
          { p: "Each plan includes a monthly allowance of credits. When an AI model writes, draws, speaks, or renders for you, its real cost is charged in credits. Your allowance is used first, then any credits you bought." },
          { p: "Free steps cost nothing: browsing, editing on the timeline, reading your analytics, searching stock footage." },
        ],
      },
      {
        id: "estimates",
        title: "Estimates before you spend",
        blocks: [
          { p: "Buttons that start paid work show an estimate, like **Render · ≈ 640 credits**. Images, video, speech, and music are quoted at their published rates; text work is quoted from what it has recently cost. The final charge can differ a little, because it follows the provider's actual usage." },
          { p: "When Juel does paid work for you, each step is listed under its reply with its estimate, along with what has been charged so far." },
        ],
      },
      {
        id: "low-balance",
        title: "When your balance is low",
        blocks: [
          { p: "If a step needs more credits than you have, it doesn't start. A notice shows your balance against what the step needs, with a **Get credits** button that opens [Plan & billing](/account/billing)." },
        ],
      },
      {
        id: "usage",
        title: "Seeing where credits went",
        blocks: [
          { p: "[Account > Usage](/account/usage) breaks your spending down by feature and by day. **Plan & billing** shows your plan, when it renews, your orders, and credit packs." },
        ],
      },
    ],
  },
  {
    id: "juel",
    group: "Guide",
    title: "Juel, your assistant",
    lead: "Juel is the one assistant in AutoYT. Ask it in plain words and it gets the work done across the app, with a team of specialists behind it.",
    sections: [
      {
        id: "open-juel",
        title: "Where to find it",
        blocks: [
          { list: ["Press **Juel** in the header, or ⌘J (Ctrl+J), on any page.", "In **Vibe Edit**, Juel is the assistant beside the timeline and edits it directly.", "On an **automation agent**, the Chat tab is Juel, and an **Ask Juel** box sits under the other tabs.", "In **Creative Agents** and the **Design Agent**, Juel works as the persona you pick."] },
        ],
      },
      {
        id: "what-it-does",
        title: "What it can do",
        blocks: [
          { p: "Juel can read and change almost everything you can: recaps, projects, films, studio generations, agents, channels, uploads, comments, and your account. It knows what you have open, so \"make the title shorter\" or \"render this again\" just works." },
          { list: ["\"How did my channel do this week?\" gets a report with headline numbers and a table.", "\"Make a 16:9 thumbnail for my next upload\" starts a generation and shows it when it's done.", "\"Add a DAY 1 title at the start\" edits the open Vibe Edit timeline.", "\"Run the agent now\" starts a run and tells you when the upload is ready."] },
        ],
      },
      {
        id: "specialists",
        title: "A team behind one chat",
        blocks: [
          { p: "Behind Juel is a team: Automation, Publisher, Recap, Editor, Producer, Studio, Film, Research, Community, and Account specialists. Juel plans each request, hands parts to the right specialists, and they share what they find, so one answer can draw on research, production, and publishing at once. You see each step as it happens." },
          { p: "On an automation agent, Juel also consults that agent's own operator, which knows the agent's history, what has worked on the channel, and its live numbers." },
        ],
      },
      {
        id: "paid-work",
        title: "Paid work and safety",
        blocks: [
          { p: "Juel starts paid work straight away and shows each step's credit estimate. If your balance can't cover a step, it stops and tells you what it needed." },
          { note: "Juel only publishes or deletes when you ask it to in the conversation. It never posts or removes anything on its own initiative." },
        ],
      },
      {
        id: "conversations",
        title: "Conversations and history",
        blocks: [
          { p: "Conversations are saved to your account. The history button lists this page's conversations first, then everything else; reopening a page or agent picks up where you left off. You can edit an earlier message, ask again, copy a reply, stop a reply in progress, or talk with the microphone." },
        ],
      },
    ],
  },
  {
    id: "movie-recap",
    group: "Guide",
    title: "Movie to Recap",
    lead: "Turn a full film into a narrated recap and a Short: AutoYT watches it, writes the story, voices it, and cuts the matching shots.",
    sections: [
      {
        id: "start",
        title: "Start a recap",
        blocks: [
          { steps: ["Open [Movie to Recap](/tools/movie-recap).", "Paste a link to the film or upload the file.", "Pick the voice, formats, tone, and look, then start. AutoYT identifies the film, writes the script, and builds a storyboard."] },
        ],
      },
      {
        id: "storyboard",
        title: "The storyboard",
        blocks: [
          { p: "Every line of narration is matched to a shot from the film. You can swap a shot for a better one, recut a moment, rewrite the script, or correct character names to the film's cast." },
          { list: ["**Screen size** zooms the picture slightly (10% by default), which helps keep recaps distinct from the source.", "**Freeze and zoom shots** holds and pushes into a frame where it suits the narration.", "Captions, voice, and the intro line can all be changed before rendering."] },
        ],
      },
      {
        id: "render-and-post",
        title: "Render and post",
        blocks: [
          { p: "**Render** builds the final video. When it's done, set the thumbnail on the final page; it becomes the YouTube thumbnail when you upload, and you can apply it to your latest uploads with **Set thumbnail**. AutoYT can draft the title, description, and tags for each channel." },
          { note: "Only recap films you have the right to use, and follow each platform's rules on reused content.", tone: "warn" },
        ],
      },
    ],
  },
  {
    id: "create-video",
    group: "Guide",
    title: "Create Video",
    lead: "Go from a brief to a finished, narrated video, one stage at a time, with full control at every step.",
    sections: [
      {
        id: "stages",
        title: "The stages",
        blocks: [
          {
            table: {
              head: ["Stage", "What happens"],
              rows: [
                ["Brief", "Set the story, audience, and defaults every later stage uses"],
                ["Title", "Generate titles from examples, a channel, or your saved style"],
                ["Script", "Narration built for retention, with optional web research; edit any line"],
                ["Description", "Description, tags, chapters, and disclosure, ready to publish"],
                ["Voiceover", "Turn the script into narration in the voice you choose"],
                ["Soundtrack", "Original music timed to the narration, or a royalty-free track"],
                ["Visuals", "Split the narration into scenes; use stock footage, generated images, or animated clips"],
                ["Thumbnail", "Copy the style of a winning video, edit a reference, or start fresh"],
                ["Export", "Captions, looks, and transitions, then render and download everything"],
              ],
            },
          },
          { p: "Paid stages show their estimate before you confirm. Stock footage is free. Projects live at [Projects](/projects)." },
          { h3: "Editing the cut" },
          { p: "**Approve storyboard** opens the project's own edit in the full Vibe Edit editor, right inside the project: trim and reorder shots, restyle captions, adjust each shot's move and entrance, change the look, and edit overlays as motion graphics. Its **Export** becomes the project's video in Review. If you change the storyboard later, the editor offers to bring the new media into your edit without losing your cuts." },
        ],
      },
      {
        id: "templates-and-styles",
        title: "Templates and styles",
        blocks: [
          { p: "Templates set up a whole format in one click, such as the **Stickman Explainer**, documentaries, and Top 10 lists. Save a channel's look in [Styles](/styles) and reuse it on every project. A finished video can open in Vibe Edit for fine edits." },
        ],
      },
    ],
  },
  {
    id: "create-film",
    group: "Guide",
    title: "Create Film",
    lead: "Write and produce drama series, short films, long films, and music videos with a consistent cast.",
    sections: [
      {
        id: "formats",
        title: "Formats",
        blocks: [
          { list: ["**Series:** short dramas, episode by episode.", "**Short film:** one complete story, two to five minutes.", "**Long film:** a feature told in parts with one cast.", "**Music video:** start from your song; AutoYT separates it, transcribes the lyrics, and builds a concept."] },
        ],
      },
      {
        id: "series-page",
        title: "Building a film",
        blocks: [
          { p: "Each film has tabs for its episodes, cast, locations, look, song, and story bible. Characters and locations get reference sheets so they stay consistent; each character gets a voice. Pick a cinema look and camera to set the style." },
          { p: "In an episode, every scene is storyboarded, voiced, and rendered into a clip. Rendering clips spends credits, and each step shows its estimate first." },
          { p: "On the **Final cut** tab, **Edit the final cut** opens the episode in the full Vibe Edit editor: its scenes on a timeline with their dialogue, the lines as subtitles, and the title and next-episode cards as editable motion graphics. Its export becomes the episode's final cut. **Quick cut** joins the scenes in order for free." },
        ],
      },
    ],
  },
  {
    id: "vibe-edit",
    group: "Guide",
    title: "Vibe Edit",
    lead: "A full timeline editor you can also talk to: describe the edit and Juel makes it on the timeline.",
    sections: [
      {
        id: "timeline",
        title: "The timeline",
        blocks: [
          { p: "Drop in video, images, and audio, then trim, split, and arrange them on tracks. Lock or hide tracks, add markers, and preview at any point. Your edits save as you go." },
        ],
      },
      {
        id: "with-juel",
        title: "Editing with Juel",
        blocks: [
          { p: "The assistant beside the timeline is Juel. Ask for edits like \"add captions\", \"remove the pauses\", \"put a title at the start\", or \"duck the music under the voice\" and they appear on the timeline. Steps that spend credits, such as voiceover, captions, and generated media, show their estimate first." },
        ],
      },
      {
        id: "captions-voices-export",
        title: "Captions, voices, and export",
        blocks: [
          { p: "Choose from 35 caption styles, generate voiceover in dozens of voices with direction, add stock B-roll that matches what's being said, and animated titles. Give each clip a camera move (push, pull, or pan) and an entrance (fade, flash, glitch, or zoom), and the whole edit a look. Double-click into a motion title with **Edit graphic** to move, resize, reword, or recolour any part of it. **Export** renders the finished video." },
          { p: "Vibe Edit is the one editor in AutoYT: Create Video and Create Film open their videos in it too, and their exports become those projects' videos." },
        ],
      },
    ],
  },
  {
    id: "studios",
    group: "Guide",
    title: "The studios",
    lead: "Generate images, video, audio, and finished ads from a prompt, each in a studio built for it.",
    sections: [
      {
        id: "image",
        title: "Image",
        blocks: [
          { list: ["**Image Studio:** text to image and image to image, with reference uploads.", "**Cinema Studio:** pick a camera, lens, focal length, and aperture, then describe the shot.", "**AI Influencer:** one face, consistent in every scene."] },
        ],
      },
      {
        id: "video",
        title: "Video",
        blocks: [
          { list: ["**Video Studio:** text or image to video, and upscaling.", "**Motion Control:** a character copies a reference move.", "**Lip Sync:** make a portrait speak your audio.", "**Body Swap:** replace the person in a video.", "**Vibe Motion:** prompted motion graphics and titles.", "**AI Clipping:** turn a long video into ready-to-post shorts."] },
        ],
      },
      {
        id: "audio",
        title: "Audio",
        blocks: [
          { p: "**Audio Studio** turns text into speech in a library of voices, and can clone a voice from a sample you're authorized to use. **Music Generation** composes original cues from a prompt." },
        ],
      },
      {
        id: "marketing",
        title: "Marketing",
        blocks: [
          { list: ["**Marketing Studio:** turn a product photo into an ad, with a presenter if you like.", "**Promo Studio:** launch videos in motion graphics.", "**Explainer Studio:** narrated product walkthroughs in your voice."] },
          { h3: "Editing motion graphics" },
          { p: "Promo films, explainers, and Vibe Motion graphics can be edited right in their player: choose **Edit in the player** on a result, then click any text, shape, or picture. Drag it to move it, drag its corner to resize it, and change its words, colour, or when it's on screen. **Save and render** makes the new video; your edits stay with the graphic, so you can come back and change them." },
        ],
      },
      {
        id: "agents",
        title: "Creative Agents and Workflows",
        blocks: [
          { p: "**Creative Agents** and the **Design Agent** are Juel working as a Creative Director, Thumbnail Designer, Storyboard Artist, Ad Creative, or Designer. Describe what you need and it starts the generations and shows them in the chat. **Workflows** chain several studios into one pipeline." },
        ],
      },
    ],
  },
  {
    id: "tools",
    group: "Guide",
    title: "Tools",
    lead: "Focused utilities for images, downloads, transcripts, and writing.",
    sections: [
      {
        id: "image-tools",
        title: "Image tools",
        blocks: [
          { p: "Editable Design (posters with live text and movable layers), Background Remover, Layer Splitter, Image Upscaler, Image Expander, Relight, Restyle, Object Remover, Magic Edit, and Thumbnail Maker." },
        ],
      },
      {
        id: "utilities",
        title: "Utilities",
        blocks: [
          { p: "Video Downloader, Audio Extractor, Vocal Remover, Video Transcriber, Video Upscaler, Thumbnail Downloader, and Poster Finder. Your saved [Styles](/styles) and every video in [Projects](/projects) are here too." },
        ],
      },
      {
        id: "writing",
        title: "Writing",
        blocks: [
          { p: "AI Rewriter (turn transcripts into original scripts), Title Generator, Description Writer, Hashtag Generator, the Prompt Library, and the Digital Product Maker for illustrated, reader-ready books." },
        ],
      },
    ],
  },
  {
    id: "research",
    group: "Guide",
    title: "Research",
    lead: "Find what's working before you make it.",
    sections: [
      {
        id: "finding-niches",
        title: "Finding niches and channels",
        blocks: [
          { list: ["**Niche Finder:** channels and outlier videos in any niche.", "**YouTube Radar:** scan niches and spot emerging channels.", "**TikTok Explorer:** analyze videos, channels, and collections.", "**Niche Library:** the map of content markets.", "**Feed:** new videos from the channels you follow."] },
        ],
      },
      {
        id: "movie-id",
        title: "Movie ID",
        blocks: [
          { p: "Paste any clip and Movie ID names the film, with the evidence it used: frames, transcript, and story." },
        ],
      },
    ],
  },
  {
    id: "automation",
    group: "Guide",
    title: "Automation agents",
    lead: "An automation agent runs a channel for you: it picks sources, makes videos, and publishes them on your schedule.",
    sections: [
      {
        id: "set-up",
        title: "Set up an agent",
        blocks: [
          { steps: ["Open [Automation](/automation) and create an agent for one of your connected channels.", "Choose its sources (saved playlists, channels, tags, or a link), its voice, and its formats.", "Set the schedule: how many posts a day and at what times, plus optional long-form compilations.", "Switch it on. Each run spends credits for the work it does."] },
        ],
      },
      {
        id: "watching-it-work",
        title: "Watching it work",
        blocks: [
          { p: "Each agent has tabs for its overview, analytics, reports, setup, voice, compilations, uploads, and run log. It learns from how its uploads perform and uses that in its next decisions." },
        ],
      },
      {
        id: "talk-to-it",
        title: "Talking to it",
        blocks: [
          { p: "The agent's **Chat** tab is Juel, working with the agent's own operator. Ask for a performance report, change the schedule, run a candidate now, or research competitors. You can also message your agent from Telegram (see [Telegram](/docs/telegram))." },
        ],
      },
    ],
  },
  {
    id: "channels",
    group: "Guide",
    title: "Channels and publishing",
    lead: "Connect your accounts once, then publish, schedule, and manage everything from AutoYT.",
    sections: [
      {
        id: "platforms",
        title: "Supported platforms",
        blocks: [
          { p: "YouTube, TikTok, Instagram (Business or Creator), Facebook Pages, Snapchat, Pinterest, X, and LinkedIn. Connect them in [Account > Channels](/account/channels)." },
        ],
      },
      {
        id: "publishing",
        title: "Publishing",
        blocks: [
          { p: "Publish now or schedule a time, with the title, description, tags, thumbnail, playlist, and visibility. [Channel Management](/channels) shows each channel's videos, suggests optimizations, and helps reply to comments." },
        ],
      },
    ],
  },
  {
    id: "telegram",
    group: "Guide",
    title: "Telegram",
    lead: "Talk to your automation agents from Telegram: ask for reports, change settings, or start runs, by text or voice note.",
    sections: [
      {
        id: "link",
        title: "Link Telegram",
        blocks: [
          { steps: ["Open [Account > Telegram](/account/telegram) and press **Link Telegram**.", "Telegram opens with the AutoYT bot; press **Start** within 15 minutes.", "Message the bot. It answers as your agent, and the conversation is saved in AutoYT."] },
        ],
      },
      {
        id: "commands",
        title: "Commands",
        blocks: [
          { table: { head: ["Command", "What it does"], rows: [["/agents", "Switch which agent you're talking to"], ["/new", "Start a fresh conversation"], ["/stop", "Cancel a reply that's still running"]] } },
        ],
      },
    ],
  },

  // ---------------------------------------------------------------- Developers
  {
    id: "developers",
    group: "Developers",
    title: "Build with AutoYT",
    lead: "Everything you can do in AutoYT, you can do from code or an AI agent: a REST API, an MCP server, and Juel itself, all on your own account and credits.",
    sections: [
      {
        id: "what-you-can-build",
        title: "What you can build",
        blocks: [
          { list: ["Let **Claude Code, Codex, or any MCP client** make recaps, videos, and images, or manage your channels, by connecting to AutoYT's MCP server.", "**Script your channel:** start renders, pull analytics, and schedule uploads from your own tools with the REST API.", "**Delegate whole tasks** to Juel with one call and get back what it did, what it cost, and links to the results."] },
        ],
      },
      {
        id: "quickstart",
        title: "Quickstart",
        blocks: [
          { steps: ["Create a token in [Account > Developers](/account/developers). Pick the smallest scope that does the job.", "Call the API with the token as a Bearer header:"] },
          { code: `curl https://autoyt.cc/api/recaps \\\n  -H "Authorization: Bearer ${TOKEN}"`, label: "List your recaps", lang: "bash" },
          { steps: ["Or connect an AI agent over MCP, for example Claude Code:"] },
          { code: `claude mcp add --transport http autoyt https://autoyt.cc/mcp \\\n  --header "Authorization: Bearer ${TOKEN}"`, label: "Claude Code", lang: "bash" },
        ],
      },
      {
        id: "how-it-fits",
        title: "How it fits together",
        blocks: [
          { p: "The API is the same set of routes the AutoYT app uses, run as you. Each route has a **risk** (read, change, paid, publish, delete) that your token's scope must allow, and paid routes are checked against your credits before they run. The MCP server wraps the same API for AI agents and adds Juel as a tool." },
          { p: "Next: [Authentication](/docs/authentication), [REST API](/docs/rest-api), [MCP](/docs/mcp), and the [API reference](/docs/api-reference)." },
        ],
      },
    ],
  },
  {
    id: "authentication",
    group: "Developers",
    title: "Authentication",
    lead: "Personal access tokens let code and AI agents act as you, within a scope you choose.",
    sections: [
      {
        id: "tokens",
        title: "Personal access tokens",
        blocks: [
          { p: "Create tokens in [Account > Developers](/account/developers). A token starts with `ayt_` and is shown once, so copy it straight away. Send it on every request:" },
          { code: `Authorization: Bearer ${TOKEN}`, label: "Header" },
          { p: "Revoke a token there at any time; anything using it stops working immediately. You can have up to 20." },
        ],
      },
      {
        id: "scopes",
        title: "Scopes",
        blocks: [
          { table: { head: ["Scope", "Can call routes whose risk is", "Use it for"], rows: [["Read only", "read", "Reports, dashboards, looking things up"], ["Create", "read, change, paid", "Making things: recaps, renders, generations"], ["Full", "read, change, paid, publish, delete", "Posting to channels and cleaning up"]] } },
          { p: "Admin routes also need an administrator's token. Signing in, payments, and token management are never available to tokens." },
        ],
      },
      {
        id: "keeping-tokens-safe",
        title: "Keeping tokens safe",
        blocks: [
          { list: ["Treat a token like a password: keep it in an environment variable or secret store, never in code you share.", "Use one token per tool, named after it, so you can revoke one without breaking the others.", "Prefer **Read only** or **Create** unless the tool really needs to publish or delete."] },
        ],
      },
    ],
  },
  {
    id: "rest-api",
    group: "Developers",
    title: "REST API",
    lead: "JSON over HTTPS at https://autoyt.cc/api. Every route is listed, with what it does and what it may cost, in the API reference.",
    sections: [
      {
        id: "requests",
        title: "Requests and responses",
        blocks: [
          { p: "Send JSON bodies with `Content-Type: application/json`; responses are JSON. Path parameters such as `:id` are the ids the API returns, for example `rcp_…` for a recap." },
          { code: `curl -X POST https://autoyt.cc/api/recaps/rcp_8f2c1a9d/render \\\n  -H "Authorization: Bearer ${TOKEN}" \\\n  -H "Content-Type: application/json" \\\n  -d '{}'`, label: "Render a recap", lang: "bash" },
          { p: "Long jobs (renders, generations, transcriptions) usually answer `202` straight away and keep working; read the item again to follow its status." },
        ],
      },
      {
        id: "credits",
        title: "Credits",
        blocks: [
          { p: "Before a paid route runs, it is quoted and checked against your balance. The quote comes back in the `X-AutoYT-Credits-Estimate` response header. If your balance can't cover it, the call is refused with `402` and nothing is charged:" },
          { code: `{\n  "error": "Not enough credits. This needs about 640 credits and you have 120.",\n  "code": "insufficient_credits",\n  "needed": 640,\n  "balance": 120\n}`, label: "402 response", lang: "json" },
          { p: "To check before calling, use the MCP tool `quote_credits` or read your balance with `credit_balance`." },
        ],
      },
      {
        id: "errors",
        title: "Errors",
        blocks: [
          { table: { head: ["Status", "Meaning"], rows: [["400", "The request is missing something; the error says what"], ["401", "The token is missing, wrong, or revoked (`invalid_token`)"], ["402", "Not enough credits (`insufficient_credits`)"], ["403", "Outside the token's scope, or an admin route (`token_scope`)"], ["404", "That item doesn't exist or isn't yours"], ["429", "Over 300 requests a minute (`rate_limited`)"], ["5xx", "Something failed on our side; retry with backoff"]] } },
          { p: "Error bodies are `{ \"error\": \"…\", \"code\": \"…\" }`, with a message written for people." },
        ],
      },
      {
        id: "openapi",
        title: "OpenAPI",
        blocks: [
          { p: "The full description is at [/api/openapi.json](/api/openapi.json) (OpenAPI 3.1). Each operation carries `x-risk`, `x-scope`, and `x-spends-credits`, so you can generate clients or check a call's scope before making it." },
        ],
      },
    ],
  },
  {
    id: "mcp",
    group: "Developers",
    title: "MCP server",
    lead: "Connect Claude Code, Codex, or any MCP client to AutoYT, and your agent can make videos, read your analytics, and hand whole tasks to Juel.",
    sections: [
      {
        id: "endpoint",
        title: "The endpoint",
        blocks: [
          { p: "AutoYT speaks MCP over Streamable HTTP at `https://autoyt.cc/mcp`, authenticated with a personal access token in the `Authorization` header. The token's scope bounds everything the agent can do, including what it asks Juel to do." },
        ],
      },
      {
        id: "connect",
        title: "Connect a client",
        blocks: [
          { h3: "Claude Code" },
          { code: `claude mcp add --transport http autoyt https://autoyt.cc/mcp \\\n  --header "Authorization: Bearer ${TOKEN}"`, lang: "bash" },
          { h3: "Codex" },
          { p: "Add this to `~/.codex/config.toml` and set `AUTOYT_TOKEN` in your shell:" },
          { code: `[mcp_servers.autoyt]\nurl = "https://autoyt.cc/mcp"\nbearer_token_env_var = "AUTOYT_TOKEN"`, lang: "toml" },
          { h3: "Other clients" },
          { p: "Any client that can add a remote HTTP server with a header:" },
          { code: `{\n  "mcpServers": {\n    "autoyt": {\n      "type": "http",\n      "url": "https://autoyt.cc/mcp",\n      "headers": { "Authorization": "Bearer ${TOKEN}" }\n    }\n  }\n}`, lang: "json" },
          { note: "Clients that only connect through a sign-in (OAuth) flow can't use AutoYT's MCP server yet." },
        ],
      },
      {
        id: "tools",
        title: "Tools",
        blocks: [
          { table: { head: ["Tool", "What it does"], rows: [["ask_juel", "Hand Juel a task in plain words; get back its reply, steps, credits, media links, and reports"], ["find_capabilities", "Search every API route by words, area, or risk"], ["describe_capability", "One route's details, cost, and the code that handles it"], ["call_api", "Call any route as you; the token's scope applies"], ["quote_credits", "What a call would cost, and whether your balance covers it"], ["credit_balance", "Your plan, balance, and usage this period"]] } },
        ],
      },
      {
        id: "try-it",
        title: "Things to ask your agent",
        blocks: [
          { list: ["\"Use AutoYT to make a recap of this film: <link>. Tell me the cost first.\"", "\"Pull last week's performance for my automation agents and summarize what worked.\"", "\"Generate three 16:9 thumbnail options for my latest recap.\"", "\"Find the AutoYT route that schedules an upload and show me its fields.\""] },
        ],
      },
    ],
  },
  {
    id: "juel-api",
    group: "Developers",
    title: "Juel from the API",
    lead: "ask_juel hands a whole task to Juel and its team of specialists, so your agent doesn't have to work route by route.",
    sections: [
      {
        id: "request",
        title: "Calling ask_juel",
        blocks: [
          { table: { head: ["Argument", "Meaning"], rows: [["message", "The task, in plain words (required)"], ["thread_id", "Continue an earlier conversation; returned by every call"], ["context", "Optional item to work on, such as { surface: \"recap\", entityId: \"rcp_…\" }"]] } },
          { p: "Conversations started over MCP show up in Juel's history in the app, so you can pick them up in the browser." },
        ],
      },
      {
        id: "response",
        title: "What comes back",
        blocks: [
          { code: `{\n  "thread_id": "juel_k3m9q2x1ab4c",\n  "reply": "I started a 16:9 thumbnail for your latest recap; it's below.",\n  "steps": ["Studio: Making a thumbnail"],\n  "credits": {\n    "started": [{ "what": "Starts a new Creator Studio generation", "about": 600 }],\n    "refused": [],\n    "charged_so_far": 12\n  },\n  "media": [],\n  "generations": [{ "id": "gen_…", "app": "image", "status_url": "https://autoyt.cc/api/studio/generations?tab=image" }],\n  "reports": []\n}`, label: "ask_juel result", lang: "json" },
          { p: "`media` lists images, videos, and audio from results with full URLs; `reports` carries any report Juel made (title, numbers, table) and agent operators' answers." },
        ],
      },
    ],
  },
  {
    id: "api-reference",
    group: "Developers",
    title: "API reference",
    lead: "Every route a token can call, read live from the API's own description.",
    reference: true,
    sections: [],
  },
];

export const DOC_GROUPS: Array<DocPage["group"]> = ["Guide", "Developers"];

/** Plain text of a block, for search. */
export function blockText(block: DocBlock): string {
  if ("p" in block) return block.p;
  if ("list" in block) return block.list.join(" ");
  if ("steps" in block) return block.steps.join(" ");
  if ("code" in block) return `${block.label || ""} ${block.code}`;
  if ("note" in block) return block.note;
  if ("h3" in block) return block.h3;
  return [...block.table.head, ...block.table.rows.flat()].join(" ");
}
