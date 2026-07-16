import { useState, useCallback, useEffect, useMemo, useRef, ReactNode, FormEvent } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "motion/react";
import {
  Upload,
  Film,
  ExternalLink,
  Loader2,
  AlertCircle,
  LayoutDashboard,
  PlayCircle,
  Radar,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  Youtube,
  LogOut,
  PlusCircle,
  CheckCircle2,
  Bot,
  Database,
  Scissors,
  ChevronDown,
  Home,
  Settings,
  HelpCircle,
  Globe2,
  Moon,
  CreditCard,
  SlidersHorizontal,
  Star,
  AudioLines,
  Music,
  Trash2,
} from "lucide-react";
import { identifyMovie } from "./services/gemini";
import { AuthSessionPayload, ConnectedYouTubeAccount, ExtractionState, MovieResult } from "./types";
import { cn } from "./lib/utils";
import TikTokExplorer from "./components/TikTokExplorer";
import { MovieAnalysisTabs, type MainTab as MovieAnalysisTab } from "./components/MovieAnalysisTabs";
import { RewriterEngine } from "./components/RewriterEngine";
import { YouTubeRadar } from "./components/YouTubeRadar";
import { ChannelManagement } from "./components/ChannelManagement";
import { AutomationAgents } from "./components/AutomationAgents";
import { CompilationStudio } from "./components/CompilationStudio";
import { NicheLibrary } from "./components/NicheLibrary";
import { LandingPage } from "./components/LandingPage";
import { BrandLogo } from "./components/BrandLogo";
import { LegalPage } from "./components/LegalPage";
import { TextToSpeechStudio } from "./components/TextToSpeechStudio";
import { readDeepLink, writeDeepLink, type MainView as View } from "./utils/tiktokRoute";

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

  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const workspaceRootRef = useRef<HTMLDivElement>(null);
  const initialLink = useMemo(() => readDeepLink(), []);
  const [routeLink, setRouteLink] = useState(initialLink);
  const [activeView, setActiveView] = useState<View>(initialLink.view);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAgentChatOpen, setIsAgentChatOpen] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [channelTheme, setChannelTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("autoyt-theme") === "dark" ? "dark" : "light";
  });
  const [rewriterInput, setRewriterInput] = useState("");
  const [rewriterPhases, setRewriterPhases] = useState<any[]>([]);
  const [ttsInput, setTtsInput] = useState("");
  const [channelDetailOpen, setChannelDetailOpen] = useState(false);
  const [automationDetailOpen, setAutomationDetailOpen] = useState(false);
  const [auth, setAuth] = useState<AuthSessionPayload | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [movieState, setMovieState] = useState<ExtractionState>({
    status: "idle",
    progress: 0,
    message: "",
  });
  const [movieLinkInput, setMovieLinkInput] = useState("");

  const refreshAuth = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session");
      const data = (await response.json()) as AuthSessionPayload;
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
    writeDeepLink({ view: "movie" }, true);
  }, [auth?.googleConfigured]);

  const switchView = useCallback((next: View) => {
    setActiveView(next);
    if (next === "movie") {
      const link = { view: "movie" as const };
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
    if (!isMobileNavOpen && !isAccountMenuOpen && !isUserMenuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMobileNavOpen(false);
      if (event.key === "Escape") setIsAccountMenuOpen(false);
      if (event.key === "Escape") setIsUserMenuOpen(false);
    };
    if (isMobileNavOpen) document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isMobileNavOpen, isAccountMenuOpen, isUserMenuOpen]);

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
      setMovieState({
        status: "error",
        progress: 0,
        message: "Error",
        error: err instanceof Error ? err.message : "Movie analysis failed",
      });
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

  if (!auth?.user) {
    return <LandingPage auth={auth} />;
  }

  const isDarkMode = channelTheme === "dark";
  const showChannelSelector = activeView === "feed" || (activeView === "channels" && !channelDetailOpen) || (activeView === "automation" && !automationDetailOpen);
  const isEdgeToEdgeView = ["movie", "tiktok", "youtube", "niches", "compile", "tts", "automation", "rewriter"].includes(activeView) || (activeView === "channels" && channelDetailOpen);
  const hideMobileWorkspaceHeader = activeView === "automation" && automationDetailOpen;

  return (
    <div ref={workspaceRootRef} className={cn("flex min-h-dvh min-w-0 flex-col overflow-x-clip md:flex-row", isDarkMode ? "bg-[#070A12] text-white" : "bg-[#F9F8F6] text-[#1A1A1A]")} data-build="compile-audio-20260502">
      {!hideMobileWorkspaceHeader ? <header className="absolute inset-x-0 top-0 z-40 flex h-16 items-center justify-between bg-transparent px-4 md:hidden">
        <button
          onClick={() => setIsMobileNavOpen(true)}
          className="grid h-11 w-11 place-items-center rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] text-[#1A1A1A] shadow-sm transition-colors hover:bg-[#1A1A1A]/5"
          aria-label="Open navigation menu"
          aria-expanded={isMobileNavOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <BrandLogo variant="vertical" theme={isDarkMode ? "dark" : "light"} className="h-[3.6rem] w-[4.8rem]" imageClassName="max-h-full max-w-full" />
        <AccountCircleButton auth={auth} onClick={() => setIsAccountMenuOpen(true)} />
      </header> : null}

      {showChannelSelector ? (
        <div className="fixed left-1/2 top-5 z-50 hidden -translate-x-1/2 md:block">
          <ChannelSelectorPill auth={auth} onClick={() => setIsAccountMenuOpen(true)} darkMode={isDarkMode} />
        </div>
      ) : null}

      <AccountSwitcherModal
        auth={auth}
        open={isAccountMenuOpen}
        onClose={() => setIsAccountMenuOpen(false)}
        onRefresh={refreshAuth}
        darkMode={isDarkMode}
      />

      <AnimatePresence>
        {isMobileNavOpen && (
          <motion.div className="fixed inset-0 z-[80] md:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button className="absolute inset-0 cursor-default bg-[#1A1A1A]/30 backdrop-blur-sm" aria-label="Close navigation menu" onClick={() => setIsMobileNavOpen(false)} />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex h-full w-[min(86vw,340px)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border-r border-[#1A1A1A]/10 bg-white px-4 py-5 shadow-2xl"
              aria-label="Mobile navigation"
            >
              <div className="mb-8 flex items-center justify-between">
                <div className="min-w-0">
                  <BrandLogo variant="vertical" className="h-[4.8rem] w-24" imageClassName="max-h-full max-w-full" />
                  <p className="mt-1 text-xs font-medium text-[#1A1A1A]/45">Workspace navigation</p>
                </div>
                <button
                  onClick={() => setIsMobileNavOpen(false)}
                  className="grid h-10 w-10 place-items-center rounded-xl border border-[#1A1A1A]/10 text-[#1A1A1A]/65 transition-colors hover:bg-[#1A1A1A]/5 hover:text-[#1A1A1A]"
                  aria-label="Close navigation menu"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                <PrimaryNavigation activeView={activeView} onSelect={handleNavSelect} darkMode={isDarkMode} />
              </nav>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: isSidebarCollapsed || isAgentChatOpen ? 64 : 260 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={cn("sticky top-0 hidden h-dvh shrink-0 overflow-hidden border-r py-4 md:flex md:flex-col", isDarkMode ? "border-[#f9dc0b]/12 bg-[#151916] text-[#F8F5E8]" : "border-[#dadada] bg-[#f9f9f9] text-[#1A1A1A]")}
      >
        <div className="flex items-center px-4 md:mb-6 h-10 w-auto md:w-full justify-between">
          <motion.div
            animate={{ opacity: isSidebarCollapsed || isAgentChatOpen ? 0 : 1, width: isSidebarCollapsed || isAgentChatOpen ? 0 : "auto" }}
            transition={{ duration: 0.2 }}
            className="leading-none whitespace-nowrap overflow-hidden"
          >
            <BrandLogo variant="horizontal" theme={isDarkMode ? "dark" : "light"} className="h-7 w-[7.7rem]" imageClassName="max-h-full max-w-full" />
          </motion.div>

          <button
            onClick={() => setIsSidebarCollapsed((p) => !p)}
            className={cn("hidden md:flex rounded-lg items-center justify-center transition-colors shrink-0", isSidebarCollapsed || isAgentChatOpen ? "w-10 h-10" : "w-8 h-8", isDarkMode ? "text-white/45 hover:bg-white/10 hover:text-white" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5")}
            title="Toggle sidebar"
          >
            {isSidebarCollapsed || isAgentChatOpen ? <img src="/favicon.svg" alt="AutoYT" className="w-10 h-10 object-contain" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1.5 overflow-x-hidden px-4">
          <PrimaryNavigation activeView={activeView} onSelect={handleNavSelect} collapsed={isSidebarCollapsed || isAgentChatOpen} darkMode={isDarkMode} />
        </nav>
        <SidebarUserMenu
          auth={auth}
          collapsed={isSidebarCollapsed || isAgentChatOpen}
          open={isUserMenuOpen}
          onToggle={() => setIsUserMenuOpen((current) => !current)}
          onClose={() => setIsUserMenuOpen(false)}
          onLogout={logout}
          darkMode={isDarkMode}
          onDarkModeChange={(next) => setChannelTheme(next ? "dark" : "light")}
        />
      </motion.aside>

      <main className={cn(
        "workspace-content min-w-0 flex-1 overflow-x-clip md:border-l",
        isEdgeToEdgeView
          ? cn("flex h-dvh flex-col overflow-hidden px-0 pb-0 md:rounded-none md:pt-0", hideMobileWorkspaceHeader ? "pt-0" : "pt-16")
          : "overflow-y-auto px-4 pb-4 pt-20 sm:px-5 sm:pb-5 md:rounded-tl-2xl md:p-8 lg:p-10 xl:p-14",
        isDarkMode ? "border-white/10 bg-[#070A12]" : "border-[#1A1A1A]/5 bg-[#F9F8F6]",
      )}>
        <div className={cn("min-w-0", isEdgeToEdgeView ? "h-full w-full flex-1 overflow-hidden flex flex-col" : "mx-auto", !isEdgeToEdgeView && (["feed", "channels", "publish", "automation", "compile", "niches", "youtube"].includes(activeView) ? "max-w-[1280px]" : "max-w-[1000px]"))}>
          <AnimatePresence mode="wait">
            {activeView === "movie" ? (
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
                      <form onSubmit={analyzeMovieLink} className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFB] p-2 shadow-sm">
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
                    ) : movieState.status === "error" ? (
                      <motion.div key="movie-error" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="p-6 bg-white border border-[#f9dc0b]/18 rounded-xl flex gap-5 items-start shadow-sm">
                        <div className="w-10 h-10 rounded-full bg-[#fff9d6] flex items-center justify-center text-[#f9dc0b] shrink-0"><AlertCircle className="w-5 h-5" /></div>
                        <div className="flex-1 space-y-4">
                          <div>
                            <h3 className="text-base font-bold text-[#443b00] mb-1">Processing failed</h3>
                            <p className="text-sm text-[#6a5b00]/65 leading-relaxed font-sans">{movieState.error}</p>
                          </div>
                          <button onClick={() => setMovieState({ status: "idle", progress: 0, message: "" })} className="px-5 py-2 bg-[#6a5b00]/10 text-[#443b00] rounded-lg text-xs font-bold hover:bg-[#6a5b00]/20 transition-all">
                            Reset
                          </button>
                        </div>
                      </motion.div>
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
                  routeKey={`${routeLink.view}:${routeLink.section || ""}:${routeLink.tab || ""}:${routeLink.url || ""}:${routeLink.slug || ""}:${routeLink.postSlug || ""}`}
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
                <CompilationStudio auth={auth} />
              </motion.div>
            ) : activeView === "automation" ? (
              <motion.div key="automation-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <AutomationAgents auth={auth} initialSlug={routeLink.view === "automation" ? routeLink.slug : undefined} onDetailChange={setAutomationDetailOpen} onChatModeChange={setIsAgentChatOpen} theme={channelTheme} />
              </motion.div>
            ) : activeView === "rewriter" ? (
              <motion.div key="rewriter-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="h-full min-h-0 overflow-hidden">
                <RewriterEngine initialTranscript={rewriterInput} phases={rewriterPhases} onBack={() => switchView("movie")} />
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

          {!isEdgeToEdgeView ? (
            <footer className="mt-24 pt-8 border-t border-[#1A1A1A]/5 flex flex-col md:flex-row justify-between gap-8 text-xs text-[#1A1A1A]/40">
              <div className="space-y-2">
                <p>System v1.2.0 - AutoYT workspace</p>
                <p>Copyright 2026 AutoYT. All rights reserved.</p>
              </div>
            </footer>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function PrimaryNavigation({ activeView, onSelect, collapsed = false, darkMode = false }: { activeView: View; onSelect: (view: View) => void; collapsed?: boolean; darkMode?: boolean }) {
  const items = [
    { icon: <LayoutDashboard className="w-5 h-5 shrink-0" />, label: "Movie ID", view: "movie" as View },
    { icon: <PlayCircle className="w-5 h-5 shrink-0" />, label: "TikTok Explorer", view: "tiktok" as View },
    { icon: <Radar className="w-5 h-5 shrink-0" />, label: "YouTube Radar", view: "youtube" as View },
    { icon: <Database className="w-5 h-5 shrink-0" />, label: "Niche Library", view: "niches" as View },
    { icon: <Home className="w-5 h-5 shrink-0" />, label: "Feed", view: "feed" as View },
    { icon: <Youtube className="w-5 h-5 shrink-0" />, label: "Channel Management", view: "channels" as View },
    { icon: <Scissors className="w-5 h-5 shrink-0" />, label: "Compilations", view: "compile" as View },
    { icon: <Bot className="w-5 h-5 shrink-0" />, label: "Automation", view: "automation" as View },
    { icon: <Zap className="w-5 h-5 shrink-0" />, label: "AI Rewriter", view: "rewriter" as View },
    { icon: <AudioLines className="w-5 h-5 shrink-0" />, label: "Text to Speech", view: "tts" as View },
  ];

  return (
    <>
      {items.map((item) => (
        <SidebarLink
          key={item.view}
          icon={item.icon}
          label={item.label}
          active={activeView === item.view}
          onClick={() => onSelect(item.view)}
          collapsed={collapsed}
          darkMode={darkMode}
        />
      ))}
    </>
  );
}

function SidebarLink({ icon, label, active, onClick, disabled, collapsed, darkMode = false }: { icon: ReactNode; label: string; active: boolean; onClick?: () => void; disabled?: boolean; collapsed?: boolean; darkMode?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={collapsed ? label : undefined}
      className={cn(
        "group relative flex items-center gap-3 font-sans text-[15px] font-semibold transition-[color,transform] duration-200 active:scale-[0.98]",
        darkMode
          ? active ? "text-[#F8F5E8]" : "text-[#F8F5E8]/60 hover:text-[#F8F5E8]"
          : active ? "text-[#1A1A1A]" : "text-[#1A1A1A]/58 hover:text-[#1A1A1A]",
        disabled && "opacity-50 cursor-not-allowed",
        collapsed ? "h-10 w-10 justify-center p-0" : "w-full px-3 py-2.5",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute h-5 w-[3px] rounded-full bg-[#f9dc0b] transition-[opacity,transform] duration-200",
          collapsed ? "-left-3" : "left-0",
          active ? "scale-y-100 opacity-100" : "scale-y-50 opacity-0",
        )}
      />
      <span className={cn("shrink-0 transition-colors duration-200", active ? "text-[#f9dc0b]" : darkMode ? "text-[#F8F5E8]/45 group-hover:text-[#F8F5E8]" : "text-[#1A1A1A]/45 group-hover:text-[#1A1A1A]")}>{icon}</span>
      {!collapsed && <span className="whitespace-nowrap">{label}</span>}
    </button>
  );
}

function AccountCircleButton({ auth, onClick }: { auth: AuthSessionPayload; onClick: () => void }) {
  const image = auth.activeAccount?.thumbnailUrl || auth.user?.avatarUrl || "";
  const label = auth.activeAccount?.channelTitle || auth.user?.name || "Switch account";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative grid h-11 w-11 place-items-center rounded-full border border-[#1A1A1A]/10 bg-white shadow-sm transition hover:border-[#1A1A1A]/25 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#f9dc0b] focus:ring-offset-2 focus:ring-offset-[#F9F8F6]"
      aria-label="Open account switcher"
      title={label}
    >
      {image ? (
        <img src={image} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <Youtube className="h-5 w-5 text-[#f9dc0b]" />
      )}
      <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#f9dc0b]" aria-hidden="true" />
    </button>
  );
}

function ChannelSelectorPill({ auth, onClick, darkMode }: { auth: AuthSessionPayload; onClick: () => void; darkMode: boolean }) {
  const image = auth.activeAccount?.thumbnailUrl || auth.user?.avatarUrl || "";
  const label = auth.activeAccount?.channelTitle || "Add YouTube channel";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group inline-flex h-10 min-w-[188px] items-center justify-between gap-2 rounded-full border px-2.5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl transition focus:outline-none focus:ring-2 focus:ring-[#f9dc0b]/45",
        darkMode
          ? "border-white/8 bg-[#151923]/95 text-white hover:border-white/16 hover:bg-[#1A1F2D]"
          : "border-[#1A1A1A]/8 bg-white/95 text-[#1A1A1A] hover:border-[#1A1A1A]/14 hover:bg-[#FDFCFA]",
      )}
      aria-label="Open channel selector"
      title={label}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="relative shrink-0">
          {image ? (
            <img src={image} alt="" className="h-7 w-7 rounded-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A]">
              <Youtube className="h-4 w-4" />
            </span>
          )}
          <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#f9dc0b] ring-2", darkMode ? "ring-[#151923]" : "ring-white")}>
            <Youtube className="h-2.5 w-2.5 fill-white text-white" />
          </span>
        </span>
        <span className="truncate text-sm font-bold">{label}</span>
      </span>
      <ChevronDown className={cn("h-4 w-4 shrink-0 transition", darkMode ? "text-white/50 group-hover:text-white/85" : "text-[#1A1A1A]/45 group-hover:text-[#1A1A1A]/75")} />
    </button>
  );
}

function SidebarUserMenu({
  auth,
  collapsed,
  open,
  onToggle,
  onClose,
  onLogout,
  darkMode,
  onDarkModeChange,
}: {
  auth: AuthSessionPayload;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onClose?: () => void;
  onLogout: () => Promise<void>;
  darkMode: boolean;
  onDarkModeChange: (next: boolean) => void;
}) {
  const [panel, setPanel] = useState<"main" | "plans" | "account" | "channel" | "affiliate" | "help" | "language">("main");
  const image = auth.user?.avatarUrl || "";
  const label = auth.user?.name || auth.user?.email || "Account";
  const email = auth.user?.email || "Sign in";

  useEffect(() => {
    if (!open) setPanel("main");
  }, [open]);

  const settings = [
    { key: "plans", label: "Plans", icon: <Star className="h-4 w-4" /> },
    { key: "account", label: "Account Settings", icon: <Settings className="h-4 w-4" /> },
    { key: "channel", label: "Channel Settings", icon: <SlidersHorizontal className="h-4 w-4" /> },
    { key: "affiliate", label: "Affiliate Center", icon: <CreditCard className="h-4 w-4" /> },
    { key: "help", label: "Help", icon: <HelpCircle className="h-4 w-4" /> },
    { key: "language", label: "English", icon: <Globe2 className="h-4 w-4" /> },
  ] as const;

  return (
    <div className={cn("relative pb-4", collapsed ? "px-3" : "px-4")}>
      {open ? (
        <div className={cn("fixed bottom-20 left-3 right-3 z-[120] max-w-[280px] rounded-2xl border p-3 shadow-2xl md:left-4 md:right-auto md:w-[280px]", darkMode ? "border-white/10 bg-[#171B26] text-white" : "border-[#1A1A1A]/10 bg-white text-[#171717]", collapsed && "md:left-3")}>
          {panel === "main" ? (
            <>
              <div className={cn("mb-3 flex items-center gap-3 rounded-2xl p-2.5", darkMode ? "bg-white/8" : "bg-[#F3F4F8]")}>
                <AvatarImage src={image} label={label} className="h-10 w-10" />
                <div className="min-w-0">
                  <p className={cn("truncate text-sm font-black", darkMode ? "text-white" : "text-[#1A1A1A]")}>{label}</p>
                  <p className={cn("truncate text-[11px] font-semibold", darkMode ? "text-white/45" : "text-[#1A1A1A]/45")}>{email}</p>
                </div>
              </div>
              <div className="space-y-1">
                {settings.map((item) => (
                  <button key={item.key} onClick={() => setPanel(item.key)} className={cn("flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold transition", darkMode ? "text-white/72 hover:bg-white/8 hover:text-white" : "text-[#1A1A1A]/72 hover:bg-[#F4F4F2] hover:text-[#1A1A1A]")}>
                    <span className={darkMode ? "text-white/45" : "text-[#1A1A1A]/45"}>{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {item.key === "language" ? <ChevronDown className={cn("h-4 w-4", darkMode ? "text-white/30" : "text-[#1A1A1A]/30")} /> : null}
                  </button>
                ))}
                <label className={cn("flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold", darkMode ? "text-white/72" : "text-[#1A1A1A]/72")}>
                  <Moon className={cn("h-4 w-4", darkMode ? "text-white/45" : "text-[#1A1A1A]/45")} />
                  <span className="flex-1">Dark Mode</span>
                  <input type="checkbox" checked={darkMode} onChange={(event) => onDarkModeChange(event.target.checked)} className="h-4 w-4 accent-[#f9dc0b]" />
                </label>
                <button onClick={() => void onLogout()} className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-[#1A1A1A]/72 transition hover:bg-[#F7FEE7] hover:text-[#1A1A1A]">
                  <LogOut className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </>
          ) : (
            <div>
              <button onClick={() => setPanel("main")} className={cn("mb-3 flex h-9 items-center gap-2 rounded-xl px-2 text-sm font-black", darkMode ? "text-white/70 hover:bg-white/8" : "text-[#1A1A1A]/70 hover:bg-[#F4F4F2]")}>
                <ChevronDown className="h-4 w-4 rotate-90" />
                Back
              </button>
              <div className={cn("rounded-2xl p-4", darkMode ? "bg-white/8" : "bg-[#F7F7F5]")}>
                <p className="text-[10px] font-black uppercase tracking-widest text-[#f9dc0b]">{panel.replace("-", " ")}</p>
                <h3 className="mt-2 text-lg font-black">{panel === "plans" ? "Creator workspace" : panel === "account" ? "Account profile" : panel === "channel" ? "Channel defaults" : panel === "affiliate" ? "Affiliate center" : panel === "language" ? "Language" : "Help center"}</h3>
                <p className={cn("mt-2 text-sm font-medium leading-6", darkMode ? "text-white/58" : "text-[#1A1A1A]/58")}>This section is ready for your account controls, connected channel defaults, billing, language, and support settings.</p>
              </div>
            </div>
          )}
        </div>
      ) : null}
      <button
        onClick={onToggle}
        className={cn(
          "flex items-center gap-3 rounded-2xl text-left transition",
          darkMode ? "hover:bg-white/8" : "hover:bg-[#F4F4F2]",
          collapsed ? "h-10 w-10 justify-center rounded-full p-0" : "w-full p-2",
        )}
        title={collapsed ? label : undefined}
      >
        <AvatarImage src={image} label={label} className="h-10 w-10" />
        {!collapsed ? (
          <div className="min-w-0">
            <p className={cn("truncate text-sm font-black", darkMode ? "text-white" : "text-[#1A1A1A]")}>{label}</p>
            <p className={cn("truncate text-[11px] font-semibold", darkMode ? "text-white/45" : "text-[#1A1A1A]/45")}>Architect Account</p>
          </div>
        ) : null}
      </button>
    </div>
  );
}

function AvatarImage({ src, label, className }: { src: string; label: string; className?: string }) {
  return src ? <img src={src} alt="" className={cn("rounded-full object-cover", className)} referrerPolicy="no-referrer" /> : <div className={cn("grid place-items-center rounded-full bg-[#f9dc0b] text-xs font-black text-[#171717]", className)}>{label.slice(0, 1).toUpperCase()}</div>;
}

function AccountSwitcherModal({ auth, open, onClose, onRefresh, darkMode }: { auth: AuthSessionPayload; open: boolean; onClose: () => void; onRefresh: () => Promise<void>; darkMode: boolean }) {
  const [busy, setBusy] = useState("");
  const accounts = auth.accounts || [];

  async function switchAccount(account: ConnectedYouTubeAccount) {
    setBusy(account.id);
    try {
      const response = await fetch(`/api/youtube/accounts/${encodeURIComponent(account.id)}/select`, { method: "POST" });
      if (!response.ok) throw new Error("Could not switch account");
      await onRefresh();
      onClose();
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
      alert(error instanceof Error ? error.message : "Could not disconnect account");
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
              "absolute left-1/2 top-[66px] w-[calc(100vw-2rem)] max-w-[292px] -translate-x-1/2 overflow-hidden rounded-[18px] border p-2 shadow-[0_24px_80px_rgba(0,0,0,0.28)] ring-1 backdrop-blur-xl",
              darkMode
                ? "border-white/10 bg-[#171B26] text-white ring-black/20"
                : "border-[#1A1A1A]/10 bg-white/95 text-[#1A1A1A] ring-[#1A1A1A]/5",
            )}
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
            <h1 className="truncate text-sm font-semibold tracking-tight">Movie ID</h1>
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
