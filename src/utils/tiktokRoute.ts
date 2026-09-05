/**
 * Small SPA router for MovieID without pulling in react-router.
 *
 * URL shape:
 *   /                                      -> selected automation agent chat
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
 *   /automation                            -> TikTok to YouTube automation agents
 *   /rewriter                              -> AI Rewriter
 *   /tts                                   -> Text to Speech
 */

export const MAIN_VIEWS = ["tools", "movie", "downloader", "tiktok", "youtube", "niches", "feed", "channels", "publish", "compile", "automation", "rewriter", "voiceover", "tts"] as const;
export type MainView = (typeof MAIN_VIEWS)[number];
export type ListTab = "collection" | "channel";
export type TikTokSection = "analyze" | "saved";
export type AutomationSection = "chat" | "overview" | "analytics" | "report" | "setup" | "voice" | "compile" | "uploads" | "runs";
export type TikTokSortMode = "views-desc" | "views-asc" | "date-desc" | "date-asc";
export type TikTokLengthFilter = "all" | "short" | "medium" | "long" | "longform16x9" | "unknown";
export type TikTokSavedView = "videos" | "genres";
export type CompilationSourceMode = "url" | "search";
export type CompilationSortMode = "views" | "oldest" | "newest" | "length";

export interface TikTokDeepLink {
  view: MainView;
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

  if (pathParts[0] === "tools") {
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
    return { view: "feed" };
  }

  if (pathParts[0] === "channels") {
    return { view: "channels" };
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

  if (pathParts[0] === "automation") {
    const rawTab = params.get("tab");
    return {
      view: "automation",
      slug: pathParts[1] ? decodeURIComponent(pathParts[1]) : undefined,
      automationTab: isAutomationSection(rawTab) ? rawTab : undefined,
      uploadId: params.get("upload") || undefined,
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
  const view: MainView = isMainView(rawView) ? rawView : "automation";
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

  if (link.view === "tools") return "/tools";
  if (link.view === "downloader") return "/downloader";
  if (link.view === "movie") return "/movie";
  if (link.view === "tts") return "/tts";
  if (link.view === "rewriter") return "/rewriter";
  if (link.view === "voiceover") {
    href = "/voiceover";
    params = new URLSearchParams();
    if (link.slug) params.set("agent", link.slug);
    if (link.uploadId) params.set("upload", link.uploadId);
    return withQuery();
  }
  if (link.view === "publish") return "/publish";
  if (link.view === "channels") return "/channels";
  if (link.view === "feed") return "/feed";
  if (link.view === "youtube") return "/youtube";
  if (link.view === "niches") {
    const nichePath = link.nichePath?.length ? link.nichePath : link.slug ? [link.slug] : [];
    return nichePath.length ? `/niches/${nichePath.map((part) => encodeURIComponent(part)).join("/")}` : "/niches";
  }
  if (link.view === "automation") {
    href = link.slug ? `/automation/${encodeURIComponent(link.slug)}` : "/automation";
    params = new URLSearchParams();
    if (link.automationTab) params.set("tab", link.automationTab);
    if (link.uploadId) params.set("upload", link.uploadId);
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
