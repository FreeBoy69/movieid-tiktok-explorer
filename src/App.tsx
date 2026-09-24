import {
  lazy,
  Suspense,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  FormEvent,
} from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  Film,
  ExternalLink,
  Loader2,
  X,
  Youtube,
  PlusCircle,
  CheckCircle2,
  Music,
  Trash2,
} from "lucide-react";
import { identifyMovie } from "./services/gemini";
import { AuthSessionPayload, ConnectedYouTubeAccount, ExtractionState, MovieResult } from "./types";
import { cn } from "./lib/utils";
import { toast } from "./utils/toast";
import TikTokExplorer from "./components/TikTokExplorer";
import { MovieAnalysisTabs, type MainTab as MovieAnalysisTab } from "./components/MovieAnalysisTabs";
import { RewriterEngine } from "./components/RewriterEngine";
import { VoiceoverStudio } from "./components/VoiceoverStudio";
import { CreatorWorkspace } from "./components/CreatorWorkspace";
import { YouTubeRadar } from "./components/YouTubeRadar";
import { ChannelManagement } from "./components/ChannelManagement";
import { AutomationAgents } from "./components/AutomationAgents";
import { CompilationStudio } from "./components/CompilationStudio";
import { NicheLibrary } from "./components/NicheLibrary";
import { GuestToolView, SignInDialog } from "./components/GuestToolView";
import { LegalPage } from "./components/LegalPage";
import { TextToSpeechStudio } from "./components/TextToSpeechStudio";
import { PromptLibrary } from "./components/PromptLibrary";
import { AppHeader } from "./components/AppHeader";
import { SiteNotice } from "./components/AccountServices";
import type { NavTarget } from "./utils/appNavigation";
import { ToolsHub } from "./components/ToolsHub";
import { VideoDownloader } from "./components/VideoDownloader";
import { CreatorStudio } from "./components/CreatorStudio";
import { readDeepLink, writeDeepLink, type MainView as View } from "./utils/tiktokRoute";
import { BackgroundProcessCenter, openBackgroundProcessCenter, type BackgroundProcess } from "./components/BackgroundProcessCenter";

// The admin console ships as its own chunk so users never download it.
const AdminApp = lazy(() => import("./admin/AdminApp"));

const MOVIE_RESULT_TABS: Array<{ id: MovieAnalysisTab; label: string }> = [
  { id: "movie", label: "Movie ID" },
  { id: "transcript", label: "Transcript" },
  { id: "story", label: "Story" },
  { id: "visuals", label: "Visuals" },
  { id: "niche", label: "Niche" },
  { id: "evidence", label: "Evidence" },
  { id: "details", label: "Details" },
];

export default function App() {
  const publicPath = window.location.pathname;
  if (publicPath === "/privacy") return <LegalPage type="privacy" />;
  if (publicPath === "/terms") return <LegalPage type="terms" />;
  if (publicPath === "/admin" || publicPath.startsWith("/admin/"))
    return <Suspense fallback={<div className="min-h-dvh bg-[#0f1113]" />}><AdminApp /></Suspense>;

  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const initialLink = useMemo(() => readDeepLink(), []);
  const [routeLink, setRouteLink] = useState(initialLink);
  const [activeView, setActiveView] = useState<View>(initialLink.view);
  const [agentChatSidebarHost, setAgentChatSidebarHost] = useState<HTMLDivElement | null>(null);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [channelMenuAnchor, setChannelMenuAnchor] = useState<DOMRect | null>(null);
  const [channelTheme, setChannelTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    // Dark is the default; light is an explicit choice.
    return window.localStorage.getItem("autoyt-theme") === "light" ? "light" : "dark";
  });
  const [rewriterInput, setRewriterInput] = useState("");
  const [rewriterPhases, setRewriterPhases] = useState<any[]>([]);
  const [ttsInput, setTtsInput] = useState("");
  const [channelDetailOpen, setChannelDetailOpen] = useState(false);
  const [automationDetailOpen, setAutomationDetailOpen] = useState(false);
  // Full-screen editors (Create Video's storyboard and timeline) hide the header.
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    const onFocus = (event: Event) => setFocusMode(Boolean((event as CustomEvent).detail));
    window.addEventListener("autoyt-focus-mode", onFocus);
    return () => window.removeEventListener("autoyt-focus-mode", onFocus);
  }, []);
  // The Explore hero puts the header over its artwork: "top" while the hero is behind it, "scrolled" after.
  const [headerOverHero, setHeaderOverHero] = useState<"" | "top" | "scrolled">("");
  useEffect(() => {
    const onHero = (event: Event) => setHeaderOverHero(((event as CustomEvent).detail as "" | "top" | "scrolled") || "");
    window.addEventListener("autoyt-header-over-hero", onHero);
    return () => window.removeEventListener("autoyt-header-over-hero", onHero);
  }, []);
  const [auth, setAuth] = useState<AuthSessionPayload | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [signInOpen, setSignInOpen] = useState(false);
  const [movieState, setMovieState] = useState<ExtractionState>({
    status: "idle",
    progress: 0,
    message: "",
  });
  const [movieLinkInput, setMovieLinkInput] = useState("");

  const refreshAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session?refreshAccounts=1", { cache: "no-store" });
      const data = (await response.json()) as AuthSessionPayload;
      if (data.suspended)
        toast.error("This account has been suspended, so it can't be used right now. If you think this is a mistake, contact the AutoYT team.", { title: "Account suspended", duration: 15000 });
      setAuth(data);
    } catch {
      setAuth({ user: null, accounts: [], activeAccount: null, googleConfigured: false, error: "Auth unavailable" });
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  useEffect(() => {
    if (window.location.pathname !== "/auth/error") return;
    const message = new URLSearchParams(window.location.search).get("message") || "Google sign-in failed";
    window.history.replaceState({}, "", "/");
    toast.error(message);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("autoyt-theme", channelTheme);
    document.documentElement.dataset.theme = channelTheme;
  }, [channelTheme]);

  useEffect(() => {
    const root = workspaceRootRef.current;
    if (!root) return;

    const observed = new Set<HTMLElement>();
    const measure = (header: HTMLElement) => {
      const shell = header.parentElement;
      if (!shell?.classList.contains("workspace-floating-shell")) return;
      const clearance = Math.ceil(header.offsetTop + header.getBoundingClientRect().height + 12);
      shell.style.setProperty("--workspace-floating-clearance", `${clearance}px`);
    };
    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => measure(entry.target as HTMLElement));
    });
    const syncHeaders = () => {
      root.querySelectorAll<HTMLElement>(".workspace-floating-header").forEach((header) => {
        if (!observed.has(header)) {
          observed.add(header);
          resizeObserver.observe(header);
        }
        measure(header);
      });
    };
    const mutationObserver = new MutationObserver(syncHeaders);

    syncHeaders();
    mutationObserver.observe(root, { childList: true, subtree: true });
    window.addEventListener("resize", syncHeaders);
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncHeaders);
    };
  }, [authLoading, auth?.user?.id]);

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    setAuth({ user: null, accounts: [], activeAccount: null, googleConfigured: auth?.googleConfigured ?? true });
    setIsAccountMenuOpen(false);
    writeDeepLink({ view: "tools" }, true);
    setActiveView("tools");
    setRouteLink({ view: "tools" });
  }, [auth?.googleConfigured]);

  const switchView = useCallback((next: View) => {
    setActiveView(next);
    if (["discover", "projects", "create", "styles", "drama"].includes(next)) {
      const link = { view: next };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "voiceover") {
      const link = { view: "voiceover" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "tools") {
      const link = { view: "tools" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "movie") {
      const link = { view: "movie" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "downloader") {
      const link = { view: "downloader" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "rewriter") {
      const link = { view: "rewriter" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "youtube") {
      const link = { view: "youtube" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "niches") {
      const link = { view: "niches" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "feed") {
      const link = { view: "feed" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "channels") {
      const link = { view: "channels" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "compile") {
      const link = { view: "compile" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "automation") {
      const link = { view: "automation" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "studio") {
      const current = readDeepLink();
      const link = { view: "studio" as const, studioTab: current.view === "studio" ? current.studioTab : "apps" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "prompts") {
      const link = { view: "prompts" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    if (next === "tts") {
      const link = { view: "tts" as const };
      writeDeepLink(link);
      setRouteLink(link);
      return;
    }
    const current = readDeepLink();
    const link = current.view === "tiktok" ? current : { view: "tiktok" as const, section: "analyze" as const };
    writeDeepLink(link);
    setRouteLink(link);
  }, []);

  const openBackgroundProcess = useCallback((process: BackgroundProcess) => {
    if (process.kind === "creator_project" && process.projectId) {
      writeDeepLink({ view: "projects", projectId: process.projectId, projectStage: process.stage });
      return;
    }
    if (process.kind === "creator_style") {
      writeDeepLink({ view: "styles" });
      return;
    }
    if (process.kind === "voice_studio") {
      writeDeepLink({ view: "voiceover", slug: process.agentId, uploadId: process.uploadId });
      return;
    }
    if (process.kind === "compilation" && !process.agentId) {
      writeDeepLink({ view: "compile" });
      return;
    }
    if (process.agentId) {
      writeDeepLink({
        view: "automation",
        slug: process.agentId,
        automationTab: process.kind === "compilation" ? "compile" : "chat",
        uploadId: process.uploadId,
      });
      return;
    }
    writeDeepLink({ view: "automation" });
  }, []);

  useEffect(() => {
    const onPop = () => {
      const link = readDeepLink();
      setRouteLink(link);
      setActiveView(link.view);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const handleNav = (e: any) => {
      setRewriterInput(e.detail.transcript);
      setRewriterPhases(e.detail.phases || []);
      setIsMobileNavOpen(false);
      switchView("rewriter");
    };
    window.addEventListener("navToRewriter", handleNav);
    return () => window.removeEventListener("navToRewriter", handleNav);
  }, [switchView]);

  useEffect(() => {
    const handleNav = (e: any) => {
      setTtsInput(String(e.detail?.text || ""));
      setIsMobileNavOpen(false);
      switchView("tts");
    };
    window.addEventListener("navToTts", handleNav);
    return () => window.removeEventListener("navToTts", handleNav);
  }, [switchView]);

  useEffect(() => {
    if (!isMobileNavOpen && !isAccountMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileNavOpen(false);
      if (event.key === "Escape") setIsAccountMenuOpen(false);
    };
    if (isMobileNavOpen) document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobileNavOpen, isAccountMenuOpen]);

  const handleNavigate = useCallback(
    (target: NavTarget) => {
      if (target.view === "studio") {
        const link = { view: "studio" as const, studioTab: target.studioTab || ("apps" as const) };
        setActiveView("studio");
        writeDeepLink(link);
        setRouteLink(link);
        return;
      }
      switchView(target.view as View);
    },
    [switchView],
  );

  const handleNavSelect = useCallback(
    (next: View) => {
      setIsMobileNavOpen(false);
      switchView(next);
    },
    [switchView],
  );

  const handleMovieIdentification = useCallback(async (fileOrUrl: File | string) => {
    setMovieState({
      status: "processing",
      progress: 10,
      message: typeof fileOrUrl === "string" ? "Downloading video..." : "Uploading video...",
      result: undefined,
    });
    setActiveView("movie");
    writeDeepLink({ view: "movie" });
    setRouteLink({ view: "movie" });

    const progressInterval = window.setInterval(() => {
      setMovieState((prev) => {
        if (prev.progress >= 90) return prev;
        const progress = prev.progress + 5;
        return {
          ...prev,
          progress,
          message:
            progress < 30
              ? "Fetching resource..."
              : progress < 50
                ? "Analyzing audio..."
                : progress < 80
                  ? "Scanning visual markers..."
                  : "Cross-referencing databases...",
        };
      });
    }, 1000);

    try {
      let result: MovieResult;
      if (typeof fileOrUrl === "string") {
        const response = await fetch("/api/movie/identify-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: fileOrUrl }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.details || data.error || "Failed to process video link.");
        result = data.result as MovieResult;
      } else {
        result = await identifyMovie(fileOrUrl);
      }

      window.clearInterval(progressInterval);
      setMovieState({ status: "done", progress: 100, message: "Complete", result });
    } catch (err) {
      window.clearInterval(progressInterval);
      setMovieState({ status: "idle", progress: 0, message: "" });
      toast.error(err instanceof Error ? err.message : "Movie analysis failed", { title: "Processing failed" });
    }
  }, []);

  const analyzeMovieLink = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const url = movieLinkInput.trim();
      if (!url || movieState.status === "processing") return;
      await handleMovieIdentification(url);
    },
    [handleMovieIdentification, movieLinkInput, movieState.status],
  );

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return;
      await handleMovieIdentification(acceptedFiles[0]);
    },
    [handleMovieIdentification],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [] },
    multiple: false,
    disabled: movieState.status === "processing",
  } as any);
  const dropzoneRootProps = getRootProps() as any;

  if (authLoading) {
    return (
      <div className="grid min-h-dvh place-items-center bg-[#F9F8F6] p-4 text-[#1A1A1A]">
        <div className="flex items-center gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white px-5 py-4 text-sm font-bold shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[#f9dc0b]" />
          Loading workspace
        </div>
      </div>
    );
  }

  const session = auth ?? { user: null, accounts: [], activeAccount: null, googleConfigured: false };
  const isGuest = !session.user;

  const isDarkMode = channelTheme === "dark";
  // Agent chat history is mounted into the app rail so chat never creates a second sidebar.
  const hasAutomationWorkspaceSidebar = activeView === "automation" && automationDetailOpen;
  // Full-height apps still sit inside the same gutters as Image Studio; the creator workspace and studio pages pad themselves.
  const isInsetEdgeView = !focusMode && !hasAutomationWorkspaceSidebar && ["movie", "downloader", "tiktok", "youtube", "niches", "compile", "tts", "prompts", "automation", "rewriter", "voiceover"].includes(activeView);
  const isEdgeToEdgeView = ["movie", "downloader", "tiktok", "youtube", "niches", "compile", "tts", "prompts", "automation", "rewriter", "voiceover", "discover", "projects", "create", "styles", "drama", "studio"].includes(activeView) || (activeView === "channels" && channelDetailOpen);

  return (
    <div ref={workspaceRootRef} className={cn("relative flex h-dvh min-w-0 flex-col overflow-hidden", isDarkMode ? "bg-[#0f1113] text-white" : "bg-[#F9F8F6] text-[#1A1A1A]")} data-build="compile-audio-20260502">
      {!focusMode ? <SiteNotice theme={channelTheme} /> : null}
      {!focusMode ? <AppHeader
        view={activeView}
        studioTab={routeLink.view === "studio" ? routeLink.studioTab : undefined}
        theme={channelTheme}
        overHero={activeView === "tools" ? headerOverHero : ""}
        account={{
          name: session.user?.name || session.user?.email || "Account",
          email: session.user?.email || "",
          image: session.user?.avatarUrl || "",
          channel: session.activeAccount?.channelTitle || "",
          channelImage: session.activeAccount?.thumbnailUrl || "",
        }}
        signedIn={!isGuest}
        onSignIn={() => setSignInOpen(true)}
        onNavigate={handleNavigate}
        onThemeChange={setChannelTheme}
        onOpenActivity={openBackgroundProcessCenter}
        onOpenChannels={(anchor) => { setChannelMenuAnchor(anchor); setIsAccountMenuOpen(true); }}
        onLogout={() => void logout()}
      /> : null}

      {!isGuest && <AccountSwitcherModal
        auth={session}
        open={isAccountMenuOpen}
        anchor={channelMenuAnchor}
        onClose={() => setIsAccountMenuOpen(false)}
        onRefresh={refreshAuth}
        darkMode={isDarkMode}
      />}

      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} googleConfigured={session.googleConfigured} theme={channelTheme} />

      <div className="flex min-h-0 flex-1">
      {hasAutomationWorkspaceSidebar ? (
        // Agent chats get their own panel beside the conversation, like a generation page's control column.
        <div ref={setAgentChatSidebarHost} role="complementary" className={cn("hidden w-[280px] shrink-0 overflow-hidden border-r md:block", isDarkMode ? "border-white/8 bg-[#0f1113]" : "border-[#1A1A1A]/8 bg-[#F9F8F6]")} aria-label="Chats" />
      ) : null}
      <main className={cn(
        "workspace-content min-w-0 flex-1 overflow-x-clip",
        isEdgeToEdgeView
          ? cn("flex h-full min-h-0 flex-col overflow-hidden", isInsetEdgeView && "px-4 pb-4 pt-3 sm:px-6 sm:pb-5 sm:pt-4 lg:px-10 lg:pb-6 lg:pt-6 xl:px-14")
          : "overflow-y-auto px-4 pb-6 pt-8 sm:px-5 md:p-8 lg:p-10 xl:p-14",
        "app-backdrop",
      )}>
        <div className={cn("min-w-0", isEdgeToEdgeView ? cn("h-full w-full flex-1 overflow-hidden flex flex-col", isInsetEdgeView && "mx-auto max-w-[1440px]") : "mx-auto", !isEdgeToEdgeView && (["tools", "feed", "channels", "publish", "automation", "compile", "niches", "youtube"].includes(activeView) ? "max-w-[1280px]" : "max-w-[1000px]"))}>
          <AnimatePresence mode="wait">
            {isGuest && activeView !== "tools" ? (
              <GuestToolView key={`${activeView}-${routeLink.view === "studio" ? routeLink.studioTab : ""}`} view={activeView} studioTab={routeLink.view === "studio" ? routeLink.studioTab : undefined} theme={channelTheme} onBack={() => handleNavigate({ view: "tools" })} onUse={() => setSignInOpen(true)} />
            ) : ["discover", "projects", "create", "styles", "drama"].includes(activeView) ? (
              <CreatorWorkspace key="creator-workspace" route={routeLink} accountId={auth?.activeAccount?.id} theme={channelTheme} />
            ) : activeView === "studio" ? (
              <motion.div key="studio-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full min-h-0 overflow-hidden">
                <CreatorStudio
                  theme={channelTheme}
                  tab={routeLink.view === "studio" ? routeLink.studioTab : undefined}
                  onTabChange={(studioTab) => {
                    const link = { view: "studio" as const, studioTab };
                    writeDeepLink(link);
                    setRouteLink(link);
                  }}
                />
              </motion.div>
            ) : activeView === "tools" ? (
              <motion.div key="tools-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <ToolsHub theme={channelTheme} onOpen={handleNavSelect} onNavigate={handleNavigate} />
              </motion.div>
            ) : activeView === "downloader" ? (
              <motion.div key="downloader-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <VideoDownloader theme={channelTheme} />
              </motion.div>
            ) : activeView === "movie" ? (
              <motion.div
                key="movie-view"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className={cn(
                  "h-full min-h-0",
                  movieState.status === "done" ? "overflow-hidden p-0" : "overflow-y-auto p-4 md:p-6 lg:p-8",
                )}
              >
                {movieState.status !== "done" ? (
                  <header className="sr-only">
                    <h1>Identify a movie from a clip</h1>
                  </header>
                ) : null}

                <div className={cn(movieState.status !== "done" ? "grid min-h-[calc(100dvh-8rem)] place-items-center" : "h-full min-h-0")}>
                  {movieState.status !== "done" && (
                    <div className="w-full max-w-3xl space-y-8">
                      <h1 className="text-center font-serif text-3xl font-bold tracking-tight text-[#1A1A1A] sm:text-4xl">Identify a movie from a clip.</h1>
                      <form onSubmit={analyzeMovieLink} className={cn("rounded-xl border p-2 shadow-sm", isDarkMode ? "border-white/10 bg-white/[0.04]" : "border-[#E5E7EB] bg-[#FAFAFB]")}>
                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                          <input
                            value={movieLinkInput}
                            onChange={(event) => setMovieLinkInput(event.target.value)}
                            disabled={movieState.status === "processing"}
                            className="h-12 min-w-0 rounded-lg border border-transparent bg-white px-4 text-sm font-medium outline-none transition focus:border-[#111827]"
                            placeholder="Paste TikTok, YouTube, Instagram, Facebook, X, or direct video URL"
                          />
                          <button
                            type="submit"
                            disabled={!movieLinkInput.trim() || movieState.status === "processing"}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#111827] px-4 text-sm font-bold text-white transition hover:bg-[#f9dc0b] hover:text-[#111827] disabled:opacity-40"
                          >
                            {movieState.status === "processing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                            Process
                          </button>
                        </div>
                      </form>

                      <motion.div
                        layout
                        {...dropzoneRootProps}
                        className={cn(
                          "relative grid min-h-64 cursor-pointer place-items-center rounded-xl border border-dashed p-8 text-center transition",
                          isDragActive ? "border-[#f9dc0b] bg-[#fff9d6]" : "border-[#DADDE3] bg-white hover:border-[#111827]",
                          movieState.status === "processing" && "pointer-events-none opacity-50",
                        )}
                      >
                        <input {...getInputProps()} />
                        <div>
                          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f9dc0b] text-[#111827]">
                            {movieState.status === "processing" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
                          </span>
                          <p className="mt-4 text-sm font-bold">{movieState.status === "processing" ? movieState.message : isDragActive ? "Drop video here" : "Drag and drop a video file"}</p>
                          <p className="mt-1 text-xs font-medium text-[#6B7280]">MP4, MOV, WebM, or direct video link</p>
                        </div>

                        {movieState.status === "processing" && (
                          <div className="absolute bottom-0 left-0 right-0 p-4">
                            <div className="h-1 w-full bg-[#f9dc0b]/10 rounded-full overflow-hidden">
                              <motion.div className="h-full bg-[#f9dc0b]" initial={{ width: 0 }} animate={{ width: `${movieState.progress}%` }} />
                            </div>
                          </div>
                        )}
                      </motion.div>
                    </div>
                  )}

                  <AnimatePresence mode="wait">
                    {movieState.status === "done" && movieState.result ? (
                      <ResultDisplay key="movie-result" result={movieState.result} onReset={() => setMovieState({ status: "idle", progress: 0, message: "" })} />
                    ) : null}
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : activeView === "tiktok" ? (
              <motion.div key="tiktok-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <TikTokExplorer
                  onAnalyzeVideo={handleMovieIdentification}
                  initialUrl={routeLink.view === "tiktok" ? routeLink.url : undefined}
                  initialSlug={routeLink.view === "tiktok" ? routeLink.slug : undefined}
                  initialPostSlug={routeLink.view === "tiktok" ? routeLink.postSlug : undefined}
                  autoAnalyze={routeLink.view === "tiktok" && (!!routeLink.url || !!routeLink.slug || !!routeLink.postSlug || routeLink.section === "saved")}
                  initialTab={routeLink.tab}
                  initialSection={routeLink.section}
                  initialReturnTo={routeLink.returnTo}
                  initialSort={routeLink.tiktokSort}
                  initialLength={routeLink.tiktokLength}
                  initialSavedView={routeLink.tiktokSavedView}
                  routeKey={`${routeLink.view}:${routeLink.section || ""}:${routeLink.tab || ""}:${routeLink.url || ""}:${routeLink.slug || ""}:${routeLink.postSlug || ""}:${routeLink.returnTo || ""}:${routeLink.tiktokSort || ""}:${routeLink.tiktokLength || ""}:${routeLink.tiktokSavedView || ""}`}
                  theme={channelTheme}
                  auth={auth}
                />
              </motion.div>
            ) : activeView === "youtube" ? (
              <motion.div key="youtube-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <YouTubeRadar />
              </motion.div>
            ) : activeView === "niches" ? (
              <motion.div key="niches-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-y-auto p-4 md:p-6">
                <NicheLibrary initialPath={routeLink.view === "niches" ? routeLink.nichePath : undefined} />
              </motion.div>
            ) : activeView === "feed" || activeView === "channels" ? (
              <motion.div key={`${activeView}-view`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className={cn(activeView === "channels" && channelDetailOpen ? "h-full min-h-0" : "")}>
                <ChannelManagement
                  auth={auth}
                  onAuthRefresh={refreshAuth}
                  initialTab={activeView === "feed" ? "feed" : "optimize"}
                  theme={channelTheme}
                  onDetailChange={setChannelDetailOpen}
                />
              </motion.div>
            ) : activeView === "compile" ? (
              <motion.div key="compile-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <CompilationStudio
                  auth={auth}
                  initialMode={routeLink.view === "compile" ? routeLink.compileMode : undefined}
                  initialQuery={routeLink.view === "compile" ? routeLink.compileQuery : undefined}
                  initialCount={routeLink.view === "compile" ? routeLink.compileCount : undefined}
                  initialLoaded={routeLink.view === "compile" ? routeLink.compileLoaded : undefined}
                  initialSort={routeLink.view === "compile" ? routeLink.compileSort : undefined}
                  initialClipId={routeLink.view === "compile" ? routeLink.compileClipId : undefined}
                  initialReturnTo={routeLink.view === "compile" ? routeLink.returnTo : undefined}
                  routeKey={`${routeLink.view}:${routeLink.compileMode || ""}:${routeLink.compileQuery || ""}:${routeLink.compileCount || ""}:${routeLink.compileLoaded || ""}:${routeLink.compileSort || ""}:${routeLink.compileClipId || ""}:${routeLink.returnTo || ""}`}
                />
              </motion.div>
            ) : activeView === "automation" ? (
              <motion.div key="automation-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <AutomationAgents
                  auth={auth}
                  initialSlug={routeLink.view === "automation" ? routeLink.slug : undefined}
                  initialTab={routeLink.view === "automation" ? routeLink.automationTab : undefined}
                  initialUploadId={routeLink.view === "automation" ? routeLink.uploadId : undefined}
                  onDetailChange={setAutomationDetailOpen}
                  chatSidebarHost={agentChatSidebarHost}
                  theme={channelTheme}
                />
              </motion.div>
            ) : activeView === "voiceover" ? (
              <motion.div key="voiceover-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
                <VoiceoverStudio theme={channelTheme} agentId={routeLink.slug} uploadId={routeLink.uploadId} accountId={auth?.activeAccount?.id} />
              </motion.div>
            ) : activeView === "rewriter" ? (
              <motion.div key="rewriter-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <RewriterEngine initialTranscript={rewriterInput} phases={rewriterPhases} onBack={() => switchView("movie")} />
              </motion.div>
            ) : activeView === "prompts" ? (
              <motion.div key="prompts-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <PromptLibrary theme={channelTheme} />
              </motion.div>
            ) : activeView === "tts" ? (
              <motion.div key="tts-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <TextToSpeechStudio theme={channelTheme} initialText={ttsInput} />
              </motion.div>
            ) : (
              <motion.div key="fallback-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <div className="p-8 text-center text-[#1A1A1A]/40">View not found</div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
      </div>
      <BackgroundProcessCenter darkMode={isDarkMode} onOpenProcess={openBackgroundProcess} />
    </div>
  );
}

function channelMenuPosition(rect: DOMRect | null) {
  return {
    left: Math.max(12, Math.min(rect?.left ?? 16, window.innerWidth - 304)),
    top: (rect?.bottom ?? 56) + 8,
  };
}

function AccountSwitcherModal({ auth, open, anchor, onClose, onRefresh, darkMode }: { auth: AuthSessionPayload; open: boolean; anchor: DOMRect | null; onClose: () => void; onRefresh: () => Promise<void>; darkMode: boolean }) {
  const [busy, setBusy] = useState("");
  const accounts = auth.accounts || [];

  async function switchAccount(account: ConnectedYouTubeAccount) {
    setBusy(account.id);
    try {
      const response = await fetch(`/api/youtube/accounts/${encodeURIComponent(account.id)}/select`, { method: "POST" });
      if (!response.ok) throw new Error("Could not switch account");
      await onRefresh();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch account");
    } finally {
      setBusy("");
    }
  }

  async function disconnectAccount(account: ConnectedYouTubeAccount) {
    setBusy(account.id);
    try {
      const response = await fetch(`/api/youtube/accounts/${encodeURIComponent(account.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Could not disconnect account");
      }
      await onRefresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not disconnect account");
    } finally {
      setBusy("");
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <button type="button" className="absolute inset-0 cursor-default bg-transparent" aria-label="Close channel selector" onClick={onClose} />
          <motion.section
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute w-[calc(100vw-24px)] max-w-[292px] overflow-y-auto rounded-[18px] border p-2 shadow-[0_24px_80px_rgba(0,0,0,0.28)] ring-1 backdrop-blur-xl",
              darkMode
                ? "border-white/10 bg-[#171B26] text-white ring-black/20"
                : "border-[#1A1A1A]/10 bg-white/95 text-[#1A1A1A] ring-[#1A1A1A]/5",
            )}
            style={{ ...channelMenuPosition(anchor), maxHeight: `calc(100dvh - ${channelMenuPosition(anchor).top + 12}px)` }}
            role="menu"
            aria-label="Select YouTube channel"
          >
            <div className="max-h-[292px] space-y-1 overflow-y-auto">
                {accounts.length ? accounts.map((account) => {
                  const active = auth.activeAccount?.id === account.id;
                  const isTikTok = account.platform === "tiktok";
                  const PlatformIcon = isTikTok ? Music : Youtube;
                  const platformName = isTikTok ? "TikTok" : "YouTube";
                  return (
                    <div
                      key={account.id}
                      className={cn(
                        "group flex w-full items-center justify-between rounded-xl transition",
                        active
                          ? darkMode ? "bg-[#252A3A] text-white" : "bg-[#F4F5F8] text-[#1A1A1A]"
                          : darkMode ? "text-white/76 hover:bg-white/[0.055] hover:text-white" : "text-[#1A1A1A]/70 hover:bg-[#F9F8F6] hover:text-[#1A1A1A]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => void switchAccount(account)}
                        className="flex flex-1 items-center gap-3 rounded-l-xl px-2.5 py-2.5 text-left transition min-w-0 bg-transparent"
                        role="menuitem"
                      >
                        <span className="relative shrink-0">
                          {account.thumbnailUrl ? (
                            <img src={account.thumbnailUrl} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                          ) : (
                            <span className="grid h-9 w-9 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A]">
                              <PlatformIcon className="h-4 w-4" />
                            </span>
                          )}
                          <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-[#f9dc0b] ring-2", darkMode ? "ring-[#252A3A]" : "ring-white")}>
                            <PlatformIcon className="h-2.5 w-2.5 fill-white text-white" />
                          </span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold">{account.channelTitle}</span>
                          <span className={cn("block truncate text-[11px] font-semibold", active ? darkMode ? "text-white/45" : "text-[#1A1A1A]/45" : darkMode ? "text-white/28" : "text-[#1A1A1A]/35")}>
                            {platformName}
                          </span>
                        </span>
                      </button>

                      <div className="relative flex items-center justify-center w-9 h-9 mr-1.5 shrink-0">
                        {/* Status indicators visible by default, hidden on hover */}
                        <div className={cn(
                          "transition-all duration-200 flex items-center justify-center absolute inset-0",
                          "group-hover:opacity-0 group-hover:scale-75"
                        )}>
                          {busy === account.id ? (
                            <Loader2 className="h-4 w-4 animate-spin text-[#f9dc0b]" />
                          ) : active ? (
                            <CheckCircle2 className="h-4 w-4 text-[#f9dc0b]" />
                          ) : null}
                        </div>

                        {/* Trash/delete action, visible on hover */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to disconnect ${account.channelTitle}?`)) {
                              void disconnectAccount(account);
                            }
                          }}
                          className={cn(
                            "absolute inset-0 flex items-center justify-center rounded-lg opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100 transition-all duration-200",
                            darkMode
                              ? "text-white/40 hover:text-[#FF4D4D] hover:bg-[#FF4D4D]/10"
                              : "text-[#1A1A1A]/40 hover:text-[#E53E3E] hover:bg-[#E53E3E]/8"
                          )}
                          title="Disconnect channel"
                          aria-label={`Disconnect ${account.channelTitle}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                }) : (
                  <p className={cn("rounded-xl px-3 py-4 text-sm font-semibold leading-6", darkMode ? "text-white/50" : "text-[#1A1A1A]/50")}>No connected YouTube channels yet.</p>
                )}
            </div>

            <div className={cn("my-1 h-px", darkMode ? "bg-white/8" : "bg-[#1A1A1A]/8")} />

            <div className="space-y-1">
              <a href="/api/auth/google?mode=connect&next=/channels" className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition", darkMode ? "text-white/82 hover:bg-white/[0.055] hover:text-white" : "text-[#1A1A1A]/75 hover:bg-[#F9F8F6] hover:text-[#1A1A1A]")} role="menuitem">
                <span className={cn("grid h-9 w-9 place-items-center rounded-full", darkMode ? "bg-white/[0.04] text-white/45" : "bg-[#f9dc0b]/35 text-[#1A1A1A]/65")}>
                  <Youtube className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">YouTube</span>
                  <span className={cn("block text-[11px] font-semibold", darkMode ? "text-white/28" : "text-[#1A1A1A]/40")}>Add channel</span>
                </span>
                <PlusCircle className={cn("h-4 w-4", darkMode ? "text-white/32" : "text-[#1A1A1A]/38")} />
              </a>

              <a href="/api/auth/tiktok?mode=connect&next=/channels" className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition", darkMode ? "text-white/82 hover:bg-white/[0.055] hover:text-white" : "text-[#1A1A1A]/75 hover:bg-[#F9F8F6] hover:text-[#1A1A1A]")} role="menuitem">
                <span className={cn("grid h-9 w-9 place-items-center rounded-full", darkMode ? "bg-white/[0.04] text-white/45" : "bg-[#f9dc0b]/35 text-[#1A1A1A]/65")}>
                  <Music className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">TikTok</span>
                  <span className={cn("block text-[11px] font-semibold", darkMode ? "text-white/28" : "text-[#1A1A1A]/40")}>Add account</span>
                </span>
                <PlusCircle className={cn("h-4 w-4", darkMode ? "text-white/32" : "text-[#1A1A1A]/38")} />
              </a>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ResultDisplay({ result, onReset }: { key?: string; result: MovieResult; onReset: () => void }) {
  const [activeTab, setActiveTab] = useState<MovieAnalysisTab>("movie");

  return (
    <motion.section initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#1A1A1A]">
      <header className="workspace-floating-header flex min-h-14 flex-col gap-2 px-4 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-center">
          <div className="flex min-w-0 shrink-0 items-center gap-3">
            <Film className="h-4 w-4 text-[#6B7280]" />
            <h1 className="truncate text-sm font-semibold tracking-tight">Clip analysis</h1>
          </div>
          <div className="flex min-w-0 gap-1 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:ml-4">
            {MOVIE_RESULT_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition md:px-4",
                  activeTab === tab.id ? "bg-[#111827] text-white" : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={onReset} className="inline-flex h-9 items-center justify-center rounded-lg bg-[#111827] px-3 text-xs font-bold text-white transition hover:bg-[#f9dc0b] hover:text-[#111827]">
            New analysis
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="min-h-full">
          <MovieAnalysisTabs result={result} hideTabs activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
      </div>
    </motion.section>
  );
}
