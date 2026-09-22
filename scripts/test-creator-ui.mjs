import fs from "node:fs";
import path from "node:path";

const { chromium } = await import(
  "/Users/macbookpro/Documents/Enkare/enkare-fix-admin-events/enkare-platform/node_modules/playwright/index.mjs"
);

const { ART_STYLE_PRESETS } = await import("../src/utils/creatorPipeline.js");
const baseUrl = process.env.CREATOR_UI_BASE_URL || "http://127.0.0.1:4178";
const evidenceDir = "/tmp/autoyt-creator-evidence";
fs.mkdirSync(evidenceDir, { recursive: true });
const log = [];
const image = (color, label) =>
  `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="${color}"/><text x="32" y="190" font-size="36" fill="#171717">${label}</text></svg>`)}`;

const videos = [
  {
    id: "video-1",
    url: "https://www.youtube.com/watch?v=video-1",
    title: "The history mystery everyone gets wrong",
    thumbnailUrl: image("#d9c6a5", "History"),
    channelId: "channel-1",
    channelTitle: "Archive Stories",
    channelUrl: "https://www.youtube.com/@archivestories",
    channelThumbnailUrl: image("#1f6f8b", "AS"),
    publishedAt: "2026-09-01T00:00:00.000Z",
    viewCount: 125000,
    subscriberCount: 42000,
    durationSeconds: 720,
    viewsPerHour: 880,
    discoveryScore: 82,
    opportunityScore: 88,
    outlierScore: 74,
    facelessScore: 86,
    niche: "history",
    language: "en",
    region: "US",
  },
  {
    id: "video-2",
    url: "https://www.youtube.com/watch?v=video-2",
    title: "A recent update from the same archive",
    thumbnailUrl: image("#e2d5a7", "Recent"),
    channelId: "channel-1",
    channelTitle: "Archive Stories",
    channelUrl: "https://www.youtube.com/@archivestories",
    channelThumbnailUrl: image("#1f6f8b", "AS"),
    publishedAt: "2026-09-20T00:00:00.000Z",
    viewCount: 24000,
    subscriberCount: 42000,
    durationSeconds: 480,
    viewsPerHour: 410,
    discoveryScore: 74,
    opportunityScore: 70,
    outlierScore: 61,
    facelessScore: 84,
    niche: "history",
    language: "en",
    region: "US",
  },
  {
    id: "video-3",
    url: "https://www.youtube.com/watch?v=video-3",
    title: "The overnight mystery explained",
    thumbnailUrl: image("#b8d3c1", "Mystery"),
    channelId: "channel-2",
    channelTitle: "Night Archive",
    channelUrl: "https://www.youtube.com/@nightarchive",
    channelThumbnailUrl: image("#46634f", "NA"),
    publishedAt: "2026-09-15T00:00:00.000Z",
    viewCount: 83000,
    subscriberCount: 98000,
    durationSeconds: 940,
    viewsPerHour: 260,
    discoveryScore: 69,
    opportunityScore: 75,
    outlierScore: 68,
    facelessScore: null,
    niche: "mystery",
    language: "en",
    region: "US",
  },
];

const project = {
  id: "p1",
  accountId: "account-1",
  sourceType: "maker",
  sourceId: "",
  title: "The history mystery",
  status: "active",
  stage: "title",
  version: 1,
  styleId: "",
  metadata: {
    brief: "A concise history story for curious viewers.",
    settings: {
      wordCount: 800,
      aspect: "16:9",
      voiceId: "voice-1",
      visualStyle: "cinematic documentary",
      artStyleId: "preset:watercolor",
      thumbnailReference: image("#c9d6df", "Reference"),
      thumbnailPrompt: "Make the person yellow and change the word machine to soda",
      thumbnailMode: "channel",
      visualSegments: [
        { id: "seg-1", start: 0, end: 8, animate: true, quality: "high" },
        { id: "seg-800", start: 8, end: 24, imageCount: 2 },
      ],
      sceneSeconds: 12,
      quality: "standard",
      research: true,
      soundtrackVolume: 0.18,
      preserveDialogue: true,
    },
    studio: { agentId: "agent-1", uploadId: "upload-1" },
  },
  outputs: {
    title: {
      current: "The history mystery everyone gets wrong",
      ideas: [
        {
          title: "The history mystery everyone gets wrong",
          reason: "A clear contradiction and a promise of correction.",
          concept: "Retrace the one archival detail historians skipped, and show how it rewrites the ending everyone learned.",
          format: "Everyone gets it wrong",
        },
        {
          title: "Why this archive changed the timeline",
          reason: "Leads with evidence and consequence.",
        },
      ],
      reference: { mode: "channel", url: "https://www.youtube.com/@archivestories" },
      concept: "Retrace the one archival detail historians skipped, and show how it rewrites the ending everyone learned.",
      format: "The [claim] everyone gets wrong",
      blueprint: {
        key: "k",
        source: "channel",
        channel: { title: "Archive Stories", url: "https://www.youtube.com/@archivestories", subscribers: 42000, thumbnailUrl: image("#1f6f8b", "AS") },
        summary: "Calm, evidence-first history documentaries that overturn a popular myth.",
        topics: ["Myths of history", "Lost archives", "Cold War secrets", "Forgotten trials"],
        titleFormats: [
          { name: "Everyone gets it wrong", template: "The [subject] everyone gets wrong", example: "The history mystery everyone gets wrong", why: "Challenges what viewers think they know." },
          { name: "Why X changed Y", template: "Why [evidence] changed [belief]", example: "Why this archive changed the timeline", why: "Promises a concrete reveal." },
          { name: "Colon case study", template: "[Place]: The Most [adjective] [noun]", example: "Camp 14: The Most Hidden Trial", why: "Specific place plus an extreme claim." },
        ],
        titleRules: ["Under 60 characters", "Title case", "One named subject"],
        conceptPattern: "Open on the accepted story, introduce the overlooked evidence, then resolve with a new conclusion.",
        descriptionFormat: { structure: ["One-line hook", "Sources", "Chapters"], opening: "Restates the myth", length: "~120 words", includes: ["sources"] },
        thumbnailFormat: { composition: "Portrait left, scene right", text: "2-3 heavy yellow words", palette: "Dark red and black", style: "Photo collage with red arrow", observed: true },
        scriptFormat: { hook: "States the myth, then contradicts it", structure: ["myth", "evidence", "reveal"], pacing: "Short sentences", voice: "Calm narrator", ending: "Returns to the myth" },
        avoid: ["Clickbait without payoff"],
        videos: [
          { title: "The history mystery everyone gets wrong", url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", thumbnailUrl: image("#d9c6a5", "Top 1"), viewCount: 125000 },
          { title: "Why this archive changed the timeline", url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", thumbnailUrl: image("#9ebbb0", "Top 2"), viewCount: 98000 },
          { title: "Camp 14: The Most Hidden Trial", url: "https://www.youtube.com/watch?v=ccccccccccc", thumbnailUrl: image("#e1cc77", "Top 3"), viewCount: 61000 },
          { title: "The letter nobody opened", url: "https://www.youtube.com/watch?v=ddddddddddd", thumbnailUrl: image("#c4a0a0", "Top 4"), viewCount: 40000 },
        ],
      },
    },
    script: {
      draft:
        "The accepted version of this story leaves one detail unexplained. The archive points somewhere else entirely.",
      outline: ["Open the contradiction", "Show the evidence", "Resolve the mystery"],
      sources: [
        {
          title: "Archive reference",
          url: "https://en.wikipedia.org/wiki/Archive",
        },
      ],
    },
    voiceover: {
      asset: image("#eee", "Audio"),
      duration: 24,
      segments: [
        { start: 0, end: 8, text: "The accepted version leaves one detail unexplained." },
        { start: 8, end: 16, text: "The archive points somewhere else entirely." },
        { start: 16, end: 24, text: "That changes the conclusion." },
      ],
    },
    visualPlan: {
      aspect: "16:9",
      scenes: [
        {
          id: "scene-1",
          start: 0,
          end: 8,
          text: "The accepted version leaves one detail unexplained.",
          prompt: "An archival desk in warm light",
          motion: "push",
          animate: true,
          asset: image("#d8c59c", "Scene 1"),
        },
        {
          id: "scene-2",
          start: 8,
          end: 16,
          text: "The archive points somewhere else entirely.",
          prompt: "A map with one route highlighted",
          motion: "still",
          asset: image("#9ebbb0", "Scene 2"),
        },
        {
          id: "scene-3",
          start: 16,
          end: 24,
          text: "That changes the conclusion.",
          prompt: "A final document close-up",
          motion: "still",
          asset: image("#e1cc77", "Scene 3"),
        },
      ],
    },
    soundtrack: {
      mood: "tense investigative",
      query: "tense documentary strings",
      source: "voiceover",
      duration: 24,
      segments: [
        { id: "mus-1", start: 0, end: 8, mood: "Uneasy open", prompt: "Sparse low strings in D minor at 70 BPM, felt piano pulses, slow build", muted: false },
        { id: "mus-2", start: 8, end: 16, mood: "Discovery", prompt: "Pizzicato strings and soft synth arpeggio, rising tension", muted: true },
        { id: "mus-3", start: 16, end: 24, mood: "Resolution", prompt: "Warm cello line resolving to F major, gentle swell", muted: false },
      ],
    },
    thumbnail: {
      reference: image("#c9d6df", "Reference"),
      asset: image("#f0cf55", "Thumbnail"),
      variants: [
        { asset: image("#f0cf55", "Variant 1"), prompt: "Contrast" },
        { asset: image("#8bb5c4", "Variant 2"), prompt: "Evidence" },
        { asset: image("#d8a76d", "Variant 3"), prompt: "Reveal" },
      ],
    },
  },
  updatedAt: Date.now(),
};

const json = (route, value, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(value),
  });

async function configureRoutes(page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (pathname === "/api/auth/session")
      return json(route, {
        user: { id: "user-1", email: "creator@example.com", name: "Creator" },
        accounts: [
          {
            id: "account-1",
            channelTitle: "Archive Stories",
            channelHandle: "@archivestories",
            platform: "youtube",
          },
        ],
        activeAccount: {
          id: "account-1",
          channelTitle: "Archive Stories",
          channelHandle: "@archivestories",
          platform: "youtube",
        },
        googleConfigured: true,
      });
    if (pathname === "/api/creator-projects")
      return json(route, {
        projects: [
          {
            ...project,
            outputs: { title: project.outputs.title, script: project.outputs.script },
          },
        ],
      });
    if (pathname === "/api/channel-styles")
      return json(route, {
        styles: [
          {
            id: "style-1",
            sourceType: "youtube",
            sourceUrl: "https://www.youtube.com/@archivestories",
            name: "Archive Stories inspired",
            niche: "history documentary",
            profile: {
              guide: "Calm pacing, evidence-first hooks, clean transitions.",
              settings: { wordCount: 800, language: "en", voiceId: "voice-1" },
              samples: [
                {
                  id: "sample-1",
                  title: "Reference video",
                  url: "https://www.youtube.com/watch?v=video-1",
                  role: "outlier",
                },
              ],
              transcriptLearning: "Three reference transcripts analyzed",
              provenance: "Structural patterns only.",
            },
          },
        ],
      });
    if (pathname === "/api/maker/collections")
      return json(route, {
        collections: [
          {
            id: "collection-1",
            name: "History outliers",
            data: {
              search: "history",
              selected: ["channel-1"],
              filters: {},
            },
          },
        ],
      });
    if (pathname === "/api/maker/capabilities")
      return json(route, {
        images: { available: true, provider: "OpenRouter" },
        animation: { available: true, provider: "OpenRouter", model: "vendor/video-model", models: ["vendor/video-model", "vendor/video-lite"], reason: "" },
        music: { available: false, provider: "ElevenLabs", model: "", reason: "Set ELEVENLABS_API_KEY on the server to generate original music. You can still import a royalty-free track." },
      });
    if (pathname === "/api/maker/art-styles")
      return json(route, {
        presets: ART_STYLE_PRESETS,
        styles: [
          { id: "research_custom-1", name: "Documentary 3D", description: "Soft 3D animation, muted palette", images: [image("#8aa1b1", "Ref 1"), image("#b1a38a", "Ref 2"), image("#9ab18a", "Ref 3")] },
        ],
      });
    if (pathname === "/api/maker/discover")
      return json(route, {
        videos,
        competitors: [],
        channels: [],
        sampledAt: Date.now(),
      });
    if (pathname === "/api/maker/projects/p1")
      return json(route, {
        project,
        jobs: [
          {
            id: "job-running",
            stage: "soundtrack",
            status: "running",
            progress: 40,
            message: "Writing draft",
            createdAt: Date.now() - 30000,
          },
        ],
      });
    if (/\/api\/maker\/projects\/p1\/jobs\//.test(pathname))
      return json(
        route,
        {
          job: {
            id: "job-1",
            stage: pathname.split("/").pop(),
            status: "queued",
            progress: 0,
            message: "Queued",
            createdAt: Date.now(),
          },
        },
        202,
      );
    if (pathname === "/api/automation/voice/status")
      return json(route, {
        online: true,
        profiles: [
          { id: "voice-1", name: "Documentary narrator", voiceType: "preset", sampleCount: 1 },
        ],
        stemEngine: "local",
        avatarProviders: {},
      });
    if (pathname === "/api/automation/voice/narration-styles")
      return json(route, { styles: [] });
    if (pathname === "/api/automation/agents")
      return json(route, {
        agents: [
          {
            id: "agent-1",
            name: "Archive Stories agent",
            youtubeAccountId: "account-1",
            channelTitle: "Archive Stories",
          },
        ],
      });
    if (pathname === "/api/automation/agents/agent-1")
      return json(route, {
        uploads: [
          {
            id: "upload-1",
            title: "Archive source",
            thumbnailUrl: image("#b8a36e", "Source"),
            sourceUrl: "https://www.youtube.com/watch?v=video-1",
          },
        ],
      });
    if (pathname.includes("/api/automation/uploads/upload-1/voice/jobs/latest"))
      return json(route, { job: null });
    if (pathname.includes("/api/automation/uploads/upload-1/voice/jobs"))
      return json(route, { jobs: [] });
    if (pathname === "/api/automation/voice/music/search")
      return json(route, { tracks: [] });
    if (pathname.includes("background")) return json(route, { processes: [] });
    return json(route, {});
  });
}

// The workspace scrolls inside .maker-scroll, so a full-page capture would stop
// at the fold. Grow the viewport to the inner height for the capture.
async function shootTall(page, file) {
  const size = page.viewportSize();
  const height = await page.evaluate(() => {
    const el = document.querySelector(".maker-scroll");
    return el ? Math.ceil(el.scrollHeight + el.getBoundingClientRect().top + 24) : innerHeight;
  });
  await page.setViewportSize({ width: size.width, height: Math.min(7000, Math.max(size.height, height)) });
  await page.waitForTimeout(150);
  await page.screenshot({ path: file });
  await page.setViewportSize(size);
}

async function inspect(page, label) {
  const result = await page.evaluate(() => ({
    title: document.title,
    path: `${location.pathname}${location.search}`,
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll("*")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && rect.right > innerWidth + 2;
      })
      .slice(0, 10)
      .map((element) => ({
        tag: element.tagName,
        className: String(element.className).slice(0, 120),
        right: Math.round(element.getBoundingClientRect().right),
      })),
  }));
  log.push({ label, ...result });
  if (result.scrollWidth > result.viewport.width + 2)
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(result)}`);
  return result;
}

const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
try {
  for (const viewport of [
    { width: 1440, height: 1000, name: "desktop" },
    { width: 1024, height: 900, name: "tablet" },
    { width: 390, height: 844, name: "mobile" },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: viewport.name === "mobile" ? "dark" : "light",
    });
    await context.addInitScript(({ dark, videos }) => {
      localStorage.setItem("autoyt-theme", dark ? "dark" : "light");
      sessionStorage.setItem(
        "autoyt-research-account-1",
        JSON.stringify({
          result: { videos, competitors: [] },
          filters: { minViews: 0, minSubs: 0, maxSubs: 0, faceless: false, sort: "score", days: 90, duration: "any", region: "US" },
          search: "history",
          selected: [],
        }),
      );
    }, { dark: viewport.name === "mobile", videos });
    const page = await context.newPage();
    await configureRoutes(page);
    await page.goto(`${baseUrl}/discover`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Niche Finder" }).waitFor();
    if (process.env.CREATOR_UI_DEBUG === "1")
      console.log(await page.locator("body").innerText());
    await page.getByText("Archive Stories").first().waitFor();
    await inspect(page, `discover-${viewport.name}`);
    await page.screenshot({
      path: path.join(evidenceDir, `discover-${viewport.name}.png`),
      fullPage: true,
    });

    for (const [route, heading, name] of [
      ["/create", "Create Video", "create"],
      ["/projects", "Project History", "projects"],
    ]) {
      await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: heading }).first().waitFor();
      await page.getByText("The history mystery").first().waitFor();
      await inspect(page, `${name}-${viewport.name}`);
      await page.screenshot({
        path: path.join(evidenceDir, `${name}-${viewport.name}.png`),
        fullPage: true,
      });
    }

    await page.goto(`${baseUrl}/styles`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Styles", exact: true }).waitFor();
    await inspect(page, `styles-${viewport.name}`);
    await page.screenshot({
      path: path.join(evidenceDir, `styles-${viewport.name}.png`),
      fullPage: true,
    });

    await page.goto(`${baseUrl}/projects/p1/title`, {
      waitUntil: "networkidle",
    });
    await page.getByText("The history mystery").first().waitFor();
    await inspect(page, `project-title-${viewport.name}`);
    await shootTall(page, path.join(evidenceDir, `project-title-${viewport.name}.png`));

    await page.getByRole("button", { name: "Visuals" }).click();
    await page.locator(".maker-scenes article").first().waitFor();
    await inspect(page, `project-visuals-${viewport.name}`);
    await page.screenshot({
      path: path.join(evidenceDir, `project-visuals-${viewport.name}.png`),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Back to settings" }).first().click();
    await page.locator(".maker-art-grid").waitFor();
    await inspect(page, `project-visual-settings-${viewport.name}`);
    await shootTall(page, path.join(evidenceDir, `project-visual-settings-${viewport.name}.png`));
    await page.getByRole("button", { name: "Custom style" }).click();
    await page.getByRole("dialog", { name: "Create custom art style" }).waitFor();
    await page.waitForTimeout(500);
    await inspect(page, `art-style-modal-${viewport.name}`);
    await page.screenshot({ path: path.join(evidenceDir, `art-style-modal-${viewport.name}.png`) });
    await page.keyboard.press("Escape");

    for (const [stage, label, selector] of [
      ["soundtrack", "soundtrack", ".maker-music-list"],
      ["thumbnail", "thumbnail", ".maker-thumb-picks"],
    ]) {
      await page.goto(`${baseUrl}/projects/p1/${stage}`, { waitUntil: "networkidle" });
      await page.locator(selector).waitFor();
      await inspect(page, `project-${label}-${viewport.name}`);
      await shootTall(page, path.join(evidenceDir, `project-${label}-${viewport.name}.png`));
    }

    await page.goto(`${baseUrl}/projects/p1/visualPlan`, { waitUntil: "networkidle" });
    await page.locator(".maker-scenes article").first().waitFor();
    await page.getByRole("button", { name: /^Animate \d+ scene/ }).first().click();
    await page.getByRole("dialog").waitFor();
    await page.waitForTimeout(500);
    await inspect(page, `animate-confirm-${viewport.name}`);
    await page.screenshot({ path: path.join(evidenceDir, `animate-confirm-${viewport.name}.png`) });
    await page.keyboard.press("Escape");

    await page.goto(`${baseUrl}/projects`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Show actions" }).first().click();
    await page.getByRole("button", { name: "Edit details" }).click();
    await page.getByRole("dialog", { name: "Edit project" }).waitFor();
    await page.waitForTimeout(500);
    await inspect(page, `edit-project-${viewport.name}`);
    await page.screenshot({ path: path.join(evidenceDir, `edit-project-${viewport.name}.png`) });
    await page.keyboard.press("Escape");

    await page.goto(`${baseUrl}/projects/p1/studio`, {
      waitUntil: "networkidle",
    });
    await page.getByText("Voiceover Studio").waitFor();
    const studioState = await inspect(page, `project-studio-${viewport.name}`);
    if (!studioState.path.startsWith("/projects/p1/studio"))
      throw new Error(`Studio escaped the project route: ${studioState.path}`);
    if (await page.getByRole("button", { name: "Back to tools" }).count())
      throw new Error("Embedded studio exposed the URL-escaping back button");
    await page.screenshot({
      path: path.join(evidenceDir, `project-studio-${viewport.name}.png`),
      fullPage: true,
    });
    await context.close();
  }
  fs.writeFileSync(
    path.join(evidenceDir, "ui-qa.json"),
    JSON.stringify(log, null, 2),
  );
  console.log(
    JSON.stringify(
      log.map((entry) => ({
        label: entry.label,
        path: entry.path,
        viewport: entry.viewport,
        overflow: entry.overflow,
      })),
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
