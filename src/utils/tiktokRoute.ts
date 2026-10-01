/**
 * Small SPA router for MovieID without pulling in react-router.
 *
 * URL shape:
 *   /                                      -> selected automation agent overview
 *   /tools                                 -> tools catalog
 *   /movie                                 -> Movie ID
 *   /downloader                            -> Video Downloader
 *   /tiktok                                -> TikTok Explorer
 *   /tiktok/saved                          -> saved TikTok lists
 *   /tiktok/saved/playlist/<slug>          -> saved playlist or collection
 *   /tiktok/saved/channel/<slug>           -> saved channel feed
 *   /tiktok/post/<slug>                    -> saved individual post
 *   /tiktok?tab=collection&url=<encoded>   -> unsaved playlist/collection/video
 *   /tiktok?tab=channel&url=<encoded>      -> unsaved profile feed
 *   /youtube                               -> YouTube Niche Radar
 *   /niches                                -> top-level niche index
 *   /niches/<top>                          -> sub-niches for a top-level niche
 *   /niches/<top>/<sub>                    -> MSNs for a sub-niche
 *   /niches/<top>/<sub>/<msn>              -> MSN detail
 *   /feed                                  -> YouTube channel feed
 *   /channels                              -> YouTube Channel Management
 *   /compile?mode=search&q=<query>          -> Long-form compilation studio with a restorable source
 *   /agent                                  -> automation agents
 *   /agent/<slug>/<tab>                     -> a persistent agent workspace tab
 *   /agent/<slug>/uploads/<id>               -> an agent upload detail
 *   /automation                             -> legacy automation route
 *   /rewriter                              -> AI Rewriter
 *   /tts                                   -> Text to Speech
 *   /prompts                               -> Prompt Library
 *   /studio/<app>                          -> Creator Studio app (image, video, lipsync, agents, ...)
 *   /tools/<tool>                          -> a mini app from the Tools suite (background-remover, transcriber, ...)
 *   /vibe-edit[/<project>]                 -> Vibe Edit, the chat-driven video editor
 */

export const MAIN_VIEWS = ["tools", "tool", "movie", "downloader", "tiktok", "youtube", "niches", "feed", "channels", "publish", "compile", "automation", "rewriter", "voiceover", "tts", "prompts", "discover", "projects", "create", "styles", "drama", "products", "studio", "vibe-edit"] as const;
export type MainView = (typeof MAIN_VIEWS)[number];
export type ListTab = "collection" | "channel";
export type TikTokSection = "analyze" | "saved";
export type AutomationSection = "chat" | "overview" | "analytics" | "report" | "setup" | "voice" | "compile" | "uploads" | "runs";
export type TikTokSortMode = "views-desc" | "views-asc" | "date-desc" | "date-asc";
export type TikTokLengthFilter = "all" | "short" | "medium" | "long" | "longform16x9" | "unknown";
export type TikTokSavedView = "videos" | "genres";
export type CompilationSourceMode = "url" | "search";
export type CompilationSortMode = "views" | "oldest" | "newest" | "length";
export const STUDIO_TABS = ["apps", "image", "editable-design", "cinema", "design-agent", "ai-influencer", "video", "clipping", "motion-control", "vibe-motion", "lipsync", "body-swap", "marketing", "promo", "explainer", "audio", "agents", "workflows"] as const;
export type StudioTab = (typeof STUDIO_TABS)[number];
/** The Tools suite: one small app per job, each at /tools/<id>. */
export const TOOL_IDS = [
  "background-remover",
  "layer-splitter",
  "image-upscaler",
  "image-expander",
  "relight",
  "restyle",
  "object-remover",
  "magic-edit",
  "thumbnail-maker",
  "video-upscaler",
  "transcriber",
  "audio-extractor",
  "thumbnail-downloader",
  "poster-finder",
  "title-generator",
  "description-writer",
  "hashtag-generator",
] as const;
export type ToolId = (typeof TOOL_IDS)[number];
export const isToolId = (value: string | null | undefined): value is ToolId => typeof value === "string" && (TOOL_IDS as readonly string[]).includes(value);
// Layers Studio was split into the image tools; its old operations map onto them.
const LEGACY_STUDIO_TOOLS: Record<string, ToolId> = { layers: "background-remover" };

export interface TikTokDeepLink {
  view: MainView;
  projectId?: string;
  projectStage?: string;
  sceneId?: string;
  productId?: string;
  productTab?: "write" | "cover" | "read";
  channelVideoId?: string;
  studioGenerationId?: string;
  discoveryQuery?: string;
  /** Create Drama: the open series, and the episode open in its editor. */
  seriesId?: string;
  episodeId?: string;
  section?: TikTokSection;
  tab?: ListTab;
  /** Fully-qualified TikTok URL already passed through `canonicalBareTikTokProfileUrl` when a profile. */
  url?: string;
  slug?: string;
  nichePath?: string[];
  postSlug?: string;
  automationTab?: AutomationSection;
  uploadId?: string;
  /** Same-origin path to restore when leaving a nested channel, post, or preview. */
  returnTo?: string;
  tiktokSort?: TikTokSortMode;
  tiktokLength?: TikTokLengthFilter;
  tiktokSavedView?: TikTokSavedView;
  compileMode?: CompilationSourceMode;
  compileQuery?: string;
  compileCount?: number;
  compileLoaded?: number;
  compileSort?: CompilationSortMode;
  compileClipId?: string;
  studioTab?: StudioTab;
  toolId?: ToolId;
}

function isMainView(v: string | null | undefined): v is MainView {
  return typeof v === "string" && MAIN_VIEWS.includes(v as MainView);
}

function isListTab(v: string | null | undefined): v is ListTab {
  return v === "collection" || v === "channel";
}

function isAutomationSection(v: string | null | undefined): v is AutomationSection {
  return v === "chat" || v === "overview" || v === "analytics" || v === "report" || v === "setup" || v === "voice" || v === "compile" || v === "uploads" || v === "runs";
}

function isTikTokSortMode(v: string | null | undefined): v is TikTokSortMode {
  return v === "views-desc" || v === "views-asc" || v === "date-desc" || v === "date-asc";
}

function isTikTokLengthFilter(v: string | null | undefined): v is TikTokLengthFilter {
  return v === "all" || v === "short" || v === "medium" || v === "long" || v === "longform16x9" || v === "unknown";
}

function isTikTokSavedView(v: string | null | undefined): v is TikTokSavedView {
  return v === "videos" || v === "genres";
}

function isCompilationSourceMode(v: string | null | undefined): v is CompilationSourceMode {
  return v === "url" || v === "search";
}

function isCompilationSortMode(v: string | null | undefined): v is CompilationSortMode {
  return v === "views" || v === "oldest" || v === "newest" || v === "length";
}

function positiveInteger(value: string | null, max = 5000): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return undefined;
  return Math.min(max, Math.floor(parsed));
}

export function normalizeInternalAppPath(value: string | null | undefined): string | undefined {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return undefined;
  try {
    const base = "https://autoyt.local";
    const parsed = new URL(raw, base);
    if (parsed.origin !== base) return undefined;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return undefined;
  }
}

export function currentAppPath(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readCommonQuery(params: URLSearchParams): Pick<TikTokDeepLink, "returnTo"> {
  return { returnTo: normalizeInternalAppPath(params.get("from")) };
}

function readTikTokQuery(search: string): Pick<TikTokDeepLink, "tab" | "url" | "returnTo" | "tiktokSort" | "tiktokLength" | "tiktokSavedView"> {
  const params = new URLSearchParams(search);

  const rawTab = params.get("tab");
  const rawSort = params.get("sort");
  const rawLength = params.get("length");
  const rawSavedView = params.get("layout");
  return {
    tab: isListTab(rawTab) ? rawTab : undefined,
    url: (params.get("url") || "").trim() || undefined,
    returnTo: normalizeInternalAppPath(params.get("from")),
    tiktokSort: isTikTokSortMode(rawSort) ? rawSort : undefined,
    tiktokLength: isTikTokLengthFilter(rawLength) ? rawLength : undefined,
    tiktokSavedView: isTikTokSavedView(rawSavedView) ? rawSavedView : undefined,
  };
}

export function readDeepLinkFromLocation(pathname: string, search = ""): TikTokDeepLink {
  const pathParts = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);
  if (pathParts[0] === "drama") {
    return {
      view: "drama",
      seriesId: pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined,
      ...(pathParts[2] === "ep" && pathParts[3] ? { episodeId: decodeURIComponent(pathParts[3]) } : {}),
    };
  }
  if (pathParts[0] === "products") {
    const rawTab = pathParts[2];
    const productTab = rawTab === "cover" ? "cover" : rawTab === "reader" || rawTab === "read" ? "read" : rawTab === "manuscript" || rawTab === "write" ? "write" : undefined;
    return { view: "products", productId: pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined, productTab };
  }
  if (pathParts[0] === "vibe-edit") return { view: "vibe-edit", ...(pathParts[1] ? { projectId: decodeURIComponent(pathParts[1]) } : {}) };
  if (["discover", "projects", "create", "styles"].includes(pathParts[0])) {
    const sceneIndex = pathParts.indexOf("scene");
    return { view: pathParts[0] as MainView, projectId: pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined, projectStage: pathParts[2] || "brief", sceneId: sceneIndex >= 0 && pathParts[sceneIndex + 1] ? decodeURIComponent(pathParts[sceneIndex + 1]) : undefined, discoveryQuery: params.get("q") || undefined };
  }

  if (pathParts[0] === "tools") {
    if (isToolId(pathParts[1])) return { view: "tool", toolId: pathParts[1] };
    return { view: "tools" };
  }

  if (pathParts[0] === "movie") {
    return { view: "movie" };
  }

  if (pathParts[0] === "downloader") {
    return { view: "downloader" };
  }

  if (pathParts[0] === "tts") {
    return { view: "tts" };
  }

  if (pathParts[0] === "prompts") {
    return { view: "prompts" };
  }

  if (pathParts[0] === "studio") {
    if (LEGACY_STUDIO_TOOLS[pathParts[1] || ""]) return { view: "tool", toolId: LEGACY_STUDIO_TOOLS[pathParts[1]] };
    const tab = STUDIO_TABS.find((item) => item === pathParts[1]);
    // The studio app list now lives on Explore.
    if (!tab || tab === "apps") return { view: "tools" };
    return { view: "studio", studioTab: tab, studioGenerationId: pathParts[2] === "generations" && pathParts[3] ? decodeURIComponent(pathParts[3]) : undefined };
  }

  if (pathParts[0] === "rewriter") {
    return { view: "rewriter" };
  }
  if (pathParts[0] === "voiceover") {
    return { view: "voiceover", slug: params.get("agent") || undefined, uploadId: params.get("upload") || undefined };
  }

  if (pathParts[0] === "youtube") {
    return { view: "youtube" };
  }

  if (pathParts[0] === "niches") {
    const nichePath = pathParts.slice(1).map((part) => decodeURIComponent(part)).filter(Boolean);
    return { view: "niches", slug: nichePath[0], nichePath };
  }

  if (pathParts[0] === "feed") {
    return { view: "feed", channelVideoId: pathParts[1] === "video" && pathParts[2] ? decodeURIComponent(pathParts[2]) : undefined };
  }

  if (pathParts[0] === "channels") {
    return { view: "channels", channelVideoId: pathParts[1] === "video" && pathParts[2] ? decodeURIComponent(pathParts[2]) : undefined };
  }

  if (pathParts[0] === "publish") {
    return { view: "channels" };
  }

  if (pathParts[0] === "compile") {
    const rawMode = params.get("mode");
    const rawSort = params.get("sort");
    return {
      view: "compile",
      compileMode: isCompilationSourceMode(rawMode) ? rawMode : undefined,
      compileQuery: (params.get("q") || "").trim() || undefined,
      compileCount: positiveInteger(params.get("count")),
      compileLoaded: positiveInteger(params.get("loaded")),
      compileSort: isCompilationSortMode(rawSort) ? rawSort : undefined,
      compileClipId: (params.get("clip") || "").trim() || undefined,
      ...readCommonQuery(params),
    };
  }

  if (pathParts[0] === "agent" || pathParts[0] === "automation") {
    const isCanonicalAgentRoute = pathParts[0] === "agent";
    const rawPathTab = isCanonicalAgentRoute ? pathParts[2] : undefined;
    const rawQueryTab = isCanonicalAgentRoute ? undefined : params.get("tab");
    const rawTab = rawPathTab || rawQueryTab;
    const pathSlug = isCanonicalAgentRoute && pathParts[1] && !isAutomationSection(pathParts[1]) ? pathParts[1] : undefined;
    const pathOnlyTab = isCanonicalAgentRoute && !pathSlug && isAutomationSection(pathParts[1]) ? pathParts[1] : undefined;
    const legacySlug = !isCanonicalAgentRoute && pathParts[1] ? pathParts[1] : undefined;
    const uploadPath = pathParts[2] === "uploads" && pathParts[3] ? decodeURIComponent(pathParts[3]) : undefined;
    return {
      view: "automation",
      slug: pathSlug || legacySlug ? decodeURIComponent(pathSlug || legacySlug || "") : undefined,
      automationTab: isAutomationSection(rawTab) ? rawTab : pathOnlyTab,
      uploadId: uploadPath || params.get("upload") || undefined,
    };
  }

  if (pathParts[0] === "tiktok") {
    const query = readTikTokQuery(search);
    if (pathParts[1] === "saved") {
      if (pathParts[2] === "playlist" && pathParts[3]) {
        return {
          view: "tiktok",
          section: "analyze",
          ...query,
          tab: "collection",
          slug: decodeURIComponent(pathParts[3]),
        };
      }
      if (pathParts[2] === "channel" && pathParts[3]) {
        return {
          view: "tiktok",
          section: "analyze",
          ...query,
          tab: "channel",
          slug: decodeURIComponent(pathParts[3]),
        };
      }
      return { view: "tiktok", section: "saved", ...query };
    }
    // Backward compatibility for saved links generated by older builds.
    if (pathParts[1] === "playlist" && pathParts[2]) {
      return {
        view: "tiktok",
        section: "analyze",
        ...query,
        tab: "collection",
        slug: decodeURIComponent(pathParts[2]),
      };
    }
    if (pathParts[1] === "channel" && pathParts[2]) {
      return {
        view: "tiktok",
        section: "analyze",
        ...query,
        tab: "channel",
        slug: decodeURIComponent(pathParts[2]),
      };
    }
    if (pathParts[1] === "post" && pathParts[2]) {
      return {
        view: "tiktok",
        section: "analyze",
        postSlug: decodeURIComponent(pathParts[2]),
        ...query,
      };
    }
    return { view: "tiktok", section: "analyze", ...query };
  }

  // Backward compatibility for links generated by older builds.
  if (pathParts[0] === "playlist" && pathParts[1]) {
    return {
      view: "tiktok",
      section: "analyze",
      tab: "collection",
      slug: decodeURIComponent(pathParts[1]),
    };
  }
  if (pathParts[0] === "channel" && pathParts[1]) {
    return {
      view: "tiktok",
      section: "analyze",
      tab: "channel",
      slug: decodeURIComponent(pathParts[1]),
    };
  }
  if (pathParts[0] === "post" && pathParts[1]) {
    return {
      view: "tiktok",
      section: "analyze",
      postSlug: decodeURIComponent(pathParts[1]),
    };
  }

  const rawView = params.get("view");
  // Explore is the home page; unknown paths still land on Automation as before.
  const view: MainView = isMainView(rawView) ? rawView : pathParts.length ? "automation" : "tools";
  return {
    view,
    section: view === "tiktok" ? "analyze" : undefined,
    ...readTikTokQuery(search),
  };
}

export function readDeepLink(): TikTokDeepLink {
  if (typeof window === "undefined") return { view: "movie" };
  return readDeepLinkFromLocation(window.location.pathname, window.location.search);
}

function addReturnTo(params: URLSearchParams, returnTo?: string): void {
  const normalized = normalizeInternalAppPath(returnTo);
  if (normalized) params.set("from", normalized);
}

function addTikTokPresentation(params: URLSearchParams, link: TikTokDeepLink): void {
  if (link.tiktokSort && link.tiktokSort !== "views-desc") params.set("sort", link.tiktokSort);
  if (link.tiktokLength && link.tiktokLength !== "all") params.set("length", link.tiktokLength);
  if (link.tiktokSavedView && link.tiktokSavedView !== "videos") params.set("layout", link.tiktokSavedView);
  addReturnTo(params, link.returnTo);
}

export function buildDeepLinkHref(link: TikTokDeepLink): string {
  let href = "/";
  let params: URLSearchParams | null = null;
  const withQuery = () => {
    const qs = params?.toString();
    return `${href}${qs ? `?${qs}` : ""}`;
  };

  if (link.view === "drama")
    return link.seriesId
      ? `/drama/${encodeURIComponent(link.seriesId)}${link.episodeId ? `/ep/${encodeURIComponent(link.episodeId)}` : ""}`
      : "/drama";
  if (link.view === "products") {
    if (!link.productId) return "/products";
    const tab = link.productTab === "cover" ? "cover" : link.productTab === "read" ? "reader" : "manuscript";
    return `/products/${encodeURIComponent(link.productId)}/${tab}`;
  }
  if (link.view === "vibe-edit") return link.projectId ? `/vibe-edit/${encodeURIComponent(link.projectId)}` : "/vibe-edit";
  if (["discover", "projects", "create", "styles"].includes(link.view)) {
    if (link.projectId) return `/projects/${encodeURIComponent(link.projectId)}/${encodeURIComponent(link.projectStage || "brief")}${link.sceneId ? `/scene/${encodeURIComponent(link.sceneId)}` : ""}`;
    return `/${link.view}${link.discoveryQuery ? `?q=${encodeURIComponent(link.discoveryQuery)}` : ""}`;
  }

  if (link.view === "tools") return "/";
  if (link.view === "tool") return link.toolId ? `/tools/${link.toolId}` : "/";
  if (link.view === "downloader") return "/downloader";
  if (link.view === "movie") return "/movie";
  if (link.view === "tts") return "/tts";
  if (link.view === "prompts") return "/prompts";
  if (link.view === "studio") return `/studio/${link.studioTab || "apps"}${link.studioGenerationId ? `/generations/${encodeURIComponent(link.studioGenerationId)}` : ""}`;
  if (link.view === "rewriter") return "/rewriter";
  if (link.view === "voiceover") {
    href = "/voiceover";
    params = new URLSearchParams();
    if (link.slug) params.set("agent", link.slug);
    if (link.uploadId) params.set("upload", link.uploadId);
    return withQuery();
  }
  if (link.view === "publish") return "/publish";
  if (link.view === "channels") return link.channelVideoId ? `/channels/video/${encodeURIComponent(link.channelVideoId)}` : "/channels";
  if (link.view === "feed") return link.channelVideoId ? `/feed/video/${encodeURIComponent(link.channelVideoId)}` : "/feed";
  if (link.view === "youtube") return "/youtube";
  if (link.view === "niches") {
    const nichePath = link.nichePath?.length ? link.nichePath : link.slug ? [link.slug] : [];
    return nichePath.length ? `/niches/${nichePath.map((part) => encodeURIComponent(part)).join("/")}` : "/niches";
  }
  if (link.view === "automation") {
    href = link.slug
      ? link.uploadId
        ? `/agent/${encodeURIComponent(link.slug)}/uploads/${encodeURIComponent(link.uploadId)}`
        : `/agent/${encodeURIComponent(link.slug)}/${link.automationTab || "overview"}`
      : "/agent";
    params = new URLSearchParams();
    if (link.uploadId && !link.slug) params.set("upload", link.uploadId);
    return withQuery();
  }
  if (link.view === "compile") {
    href = "/compile";
    params = new URLSearchParams();
    if (link.compileMode) params.set("mode", link.compileMode);
    if (link.compileQuery) params.set("q", link.compileQuery);
    if (link.compileCount) params.set("count", String(Math.min(5000, Math.max(1, Math.floor(link.compileCount)))));
    if (link.compileLoaded) params.set("loaded", String(Math.min(5000, Math.max(1, Math.floor(link.compileLoaded)))));
    if (link.compileSort && link.compileSort !== "views") params.set("sort", link.compileSort);
    if (link.compileClipId) params.set("clip", link.compileClipId);
    addReturnTo(params, link.returnTo);
    return withQuery();
  }
  if (link.view === "tiktok") {
    params = new URLSearchParams();
    if (link.section === "saved") {
      href = "/tiktok/saved";
    } else if (link.postSlug) {
      href = `/tiktok/post/${encodeURIComponent(link.postSlug)}`;
    } else if (link.slug && link.tab) {
      const prefix = link.tab === "channel" ? "channel" : "playlist";
      href = `/tiktok/saved/${prefix}/${encodeURIComponent(link.slug)}`;
    } else {
      href = "/tiktok";
      if (link.tab) params.set("tab", link.tab);
      if (link.url) params.set("url", link.url);
    }
    addTikTokPresentation(params, link);
    return withQuery();
  }
  return href;
}

/**
 * Push / replace the URL without reloading. Safe to call with the same value:
 * we skip when the resulting href matches the current one so browser history
 * stays meaningful.
 */
export function writeDeepLink(link: TikTokDeepLink, replace = false): void {
  if (typeof window === "undefined") return;
  const href = buildDeepLinkHref(link);

  const current = currentAppPath();
  if (href === current) return;
  const explicitReturn = normalizeInternalAppPath(link.returnTo);
  const previousState = typeof window.history.state === "object" && window.history.state ? window.history.state : {};
  const state = {
    ...previousState,
    autoytNavigation: true,
    autoytFrom: explicitReturn || (replace ? previousState.autoytFrom : current),
  };
  if (replace) window.history.replaceState(state, "", href);
  else window.history.pushState(state, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function navigateBack(returnTo: string | null | undefined, fallback = "/tiktok"): void {
  if (typeof window === "undefined") return;
  const state = typeof window.history.state === "object" && window.history.state ? window.history.state : {};
  const target = normalizeInternalAppPath(returnTo) || normalizeInternalAppPath(state.autoytFrom) || normalizeInternalAppPath(fallback) || "/";
  if (state.autoytNavigation && state.autoytFrom === target && window.history.length > 1) {
    window.history.back();
    return;
  }
  window.history.replaceState({ autoytNavigation: true }, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
