import { useState, useCallback, useEffect, useMemo, ReactNode, FormEvent } from "react";
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
  UploadCloud,
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
} from "lucide-react";
import { identifyMovie } from "./services/gemini";
import { AuthSessionPayload, ConnectedYouTubeAccount, ExtractionState, MovieResult } from "./types";
import { cn } from "./lib/utils";
import TikTokExplorer from "./components/TikTokExplorer";
import { MovieAnalysisTabs } from "./components/MovieAnalysisTabs";
import { RewriterEngine } from "./components/RewriterEngine";
import { YouTubeRadar } from "./components/YouTubeRadar";
import { ChannelManagement } from "./components/ChannelManagement";
import { YouTubePublishing } from "./components/YouTubePublishing";
import { AutomationAgents } from "./components/AutomationAgents";
import { CompilationStudio } from "./components/CompilationStudio";
import { NicheLibrary } from "./components/NicheLibrary";
import { LandingPage } from "./components/LandingPage";
import { BrandLogo } from "./components/BrandLogo";
import { LegalPage } from "./components/LegalPage";
import { readDeepLink, writeDeepLink, type MainView as View } from "./utils/tiktokRoute";

export default function App() {
  const publicPath = window.location.pathname;
  if (publicPath === "/privacy") return <LegalPage type="privacy" />;
  if (publicPath === "/terms") return <LegalPage type="terms" />;

  return <WorkspaceApp />;
}

function WorkspaceApp() {
  const initialLink = useMemo(() => readDeepLink(), []);
  const [routeLink, setRouteLink] = useState(initialLink);
  const [activeView, setActiveView] = useState<View>(initialLink.view);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [channelTheme, setChannelTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return window.localStorage.getItem("autoyt-theme") === "dark" ? "dark" : "light";
  });
  const [publishingVideoId, setPublishingVideoId] = useState("");
  const [rewriterInput, setRewriterInput] = useState("");
  const [rewriterPhases, setRewriterPhases] = useState<any[]>([]);
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
    if (next === "publish") {
      const link = { view: "publish" as const };
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
      <div className="grid min-h-screen place-items-center bg-[#F9F8F6] text-[#1A1A1A]">
        <div className="flex items-center gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white px-5 py-4 text-sm font-bold shadow-sm">
          <Loader2 className="h-4 w-4 animate-spin text-[#FF0033]" />
          Loading workspace
        </div>
      </div>
    );
  }

  if (!auth?.user) {
    return <LandingPage auth={auth} />;
  }

  const isDarkMode = channelTheme === "dark";

  return (
    <div className={cn("min-h-screen flex flex-col md:flex-row", isDarkMode ? "bg-[#070A12] text-white" : "bg-[#F9F8F6] text-[#1A1A1A]")} data-build="compile-audio-20260502">
      <header className={cn("sticky top-0 z-40 flex h-16 items-center justify-between border-b px-4 shadow-sm backdrop-blur md:hidden", isDarkMode ? "border-white/10 bg-[#080B12]/95" : "border-[#1A1A1A]/5 bg-white/95")}>
        <button
          onClick={() => setIsMobileNavOpen(true)}
          className="grid h-11 w-11 place-items-center rounded-xl border border-[#1A1A1A]/10 bg-[#FDFCFA] text-[#1A1A1A] shadow-sm transition-colors hover:bg-[#1A1A1A]/5"
          aria-label="Open navigation menu"
          aria-expanded={isMobileNavOpen}
        >
          <Menu className="h-5 w-5" />
        </button>
        <BrandLogo variant="vertical" className="h-12 w-16" imageClassName="max-h-full max-w-full" />
        <AccountCircleButton auth={auth} onClick={() => setIsAccountMenuOpen(true)} />
      </header>

      <div className="fixed left-1/2 top-5 z-50 hidden -translate-x-1/2 md:block">
        <ChannelSelectorPill auth={auth} onClick={() => setIsAccountMenuOpen(true)} darkMode={isDarkMode} />
      </div>

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
              className="relative flex h-full w-[86vw] max-w-[340px] flex-col border-r border-[#1A1A1A]/10 bg-white px-4 py-5 shadow-2xl"
              aria-label="Mobile navigation"
            >
              <div className="mb-8 flex items-center justify-between">
                <div className="min-w-0">
                  <BrandLogo variant="vertical" className="h-16 w-20" imageClassName="max-h-full max-w-full" />
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

              <nav className="space-y-2">
                <PrimaryNavigation activeView={activeView} onSelect={handleNavSelect} darkMode={isDarkMode} />
              </nav>
            </motion.aside>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.aside
        animate={{ width: isSidebarCollapsed ? 64 : 260 }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className={cn("hidden h-screen sticky top-0 shrink-0 overflow-x-hidden overflow-y-auto py-4 md:flex md:flex-col", isDarkMode ? "bg-[#090D16] text-white" : "bg-white text-[#1A1A1A]")}
      >
        <div className="flex items-center px-4 md:mb-6 h-10 w-auto md:w-full justify-between">
          <motion.div
            animate={{ opacity: isSidebarCollapsed ? 0 : 1, width: isSidebarCollapsed ? 0 : "auto" }}
            transition={{ duration: 0.2 }}
            className="leading-none whitespace-nowrap overflow-hidden"
          >
            <BrandLogo variant="horizontal" className="h-9 w-36" imageClassName="max-h-full max-w-full" />
          </motion.div>

          <button
            onClick={() => setIsSidebarCollapsed((p) => !p)}
            className={cn("hidden md:flex w-8 h-8 rounded-lg items-center justify-center transition-colors shrink-0", isDarkMode ? "text-white/45 hover:bg-white/10 hover:text-white" : "text-[#1A1A1A]/40 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5")}
            title="Toggle sidebar"
          >
            {isSidebarCollapsed ? <PanelLeftOpen className="w-[18px] h-[18px]" /> : <PanelLeftClose className="w-[18px] h-[18px]" />}
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-x-hidden px-4">
          <PrimaryNavigation activeView={activeView} onSelect={handleNavSelect} collapsed={isSidebarCollapsed} darkMode={isDarkMode} />
        </nav>
        <SidebarUserMenu
          auth={auth}
          collapsed={isSidebarCollapsed}
          open={isUserMenuOpen}
          onToggle={() => setIsUserMenuOpen((current) => !current)}
          onClose={() => setIsUserMenuOpen(false)}
          onLogout={logout}
          darkMode={isDarkMode}
          onDarkModeChange={(next) => setChannelTheme(next ? "dark" : "light")}
        />
      </motion.aside>

      <main className={cn("flex-1 border-t p-5 pt-24 md:rounded-tl-2xl md:border-l md:p-10 md:pt-28 lg:p-14 lg:pt-28 overflow-x-hidden shadow-sm", isDarkMode ? "border-white/10 bg-[#070A12]" : "border-[#1A1A1A]/5 bg-[#F9F8F6]")}>
        <div className={cn("mx-auto", ["feed", "channels", "publish", "automation", "compile", "niches", "youtube"].includes(activeView) ? "max-w-[1280px]" : "max-w-[1000px]")}>
          <AnimatePresence mode="wait">
            {activeView === "movie" ? (
              <motion.div key="movie-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-10">
                <header className="space-y-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Film className="w-5 h-5 text-[#FF0033]" />
                    <span className="text-sm font-semibold text-[#FF0033]">Identification engine</span>
                  </div>
                  <h1 className="text-4xl md:text-5xl font-serif font-bold tracking-tight text-[#1A1A1A]">Identify a movie from a clip.</h1>
                  <p className="text-base text-[#1A1A1A]/60 font-sans leading-relaxed max-w-xl">
                    Upload a recap clip and MovieID will compare dialogue, actors, visual cues, and TMDB data to find the most likely match.
                  </p>
                </header>

                <div className="space-y-10">
                  {movieState.status !== "done" && (
                    <div className="space-y-4">
                      <form onSubmit={analyzeMovieLink} className="rounded-xl border border-[#1A1A1A]/8 bg-white p-3 shadow-sm">
                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_150px]">
                          <input
                            value={movieLinkInput}
                            onChange={(event) => setMovieLinkInput(event.target.value)}
                            disabled={movieState.status === "processing"}
                            className="h-12 min-w-0 rounded-lg border border-[#1A1A1A]/10 bg-[#FDFCFA] px-4 text-sm outline-none transition focus:border-[#FF0033]/45"
                            placeholder="Paste TikTok, YouTube, Instagram, Facebook, X, or direct video URL"
                          />
                          <button
                            type="submit"
                            disabled={!movieLinkInput.trim() || movieState.status === "processing"}
                            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#1A1A1A] px-4 text-xs font-bold text-white transition hover:bg-[#FF0033] disabled:opacity-45"
                          >
                            {movieState.status === "processing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                            Check link
                          </button>
                        </div>
                      </form>

                      <motion.div
                        layout
                        {...dropzoneRootProps}
                        className={cn(
                          "relative group cursor-pointer transition-all duration-300",
                          "h-64 rounded-xl flex flex-col items-center justify-center gap-4",
                          "bg-white brand-dashed",
                          isDragActive && "bg-[#FF0033]/5",
                          movieState.status === "processing" && "pointer-events-none opacity-50",
                        )}
                      >
                        <input {...getInputProps()} />
                        <div className="w-12 h-12 rounded-full bg-[#F9F8F6] flex items-center justify-center text-[#FF0033] group-hover:scale-110 transition-transform">
                          {movieState.status === "processing" ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium">{movieState.status === "processing" ? movieState.message : isDragActive ? "Drop video here" : "Drag and drop a recap clip"}</p>
                          <p className="text-xs text-[#1A1A1A]/45 mt-1">Video files only</p>
                        </div>

                        {movieState.status === "processing" && (
                          <div className="absolute bottom-0 left-0 right-0 p-4">
                            <div className="h-1 w-full bg-[#FF0033]/10 rounded-full overflow-hidden">
                              <motion.div className="h-full bg-[#FF0033]" initial={{ width: 0 }} animate={{ width: `${movieState.progress}%` }} />
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
                      <motion.div key="movie-error" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="p-6 bg-white border border-red-100 rounded-xl flex gap-5 items-start shadow-sm">
                        <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center text-red-500 shrink-0"><AlertCircle className="w-5 h-5" /></div>
                        <div className="flex-1 space-y-4">
                          <div>
                            <h3 className="text-base font-bold text-red-900 mb-1">Processing failed</h3>
                            <p className="text-sm text-red-800/65 leading-relaxed font-sans">{movieState.error}</p>
                          </div>
                          <button onClick={() => setMovieState({ status: "idle", progress: 0, message: "" })} className="px-5 py-2 bg-red-900/10 text-red-900 rounded-lg text-xs font-bold hover:bg-red-900/20 transition-all">
                            Reset
                          </button>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              </motion.div>
            ) : activeView === "tiktok" ? (
              <motion.div key="tiktok-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <TikTokExplorer
                  onAnalyzeVideo={handleMovieIdentification}
                  initialUrl={routeLink.view === "tiktok" ? routeLink.url : undefined}
                  initialSlug={routeLink.view === "tiktok" ? routeLink.slug : undefined}
                  initialPostSlug={routeLink.view === "tiktok" ? routeLink.postSlug : undefined}
                  autoAnalyze={routeLink.view === "tiktok" && (!!routeLink.url || !!routeLink.slug || !!routeLink.postSlug || routeLink.section === "saved")}
                  initialTab={routeLink.tab}
                  initialSection={routeLink.section}
                  routeKey={`${routeLink.view}:${routeLink.section || ""}:${routeLink.tab || ""}:${routeLink.url || ""}:${routeLink.slug || ""}:${routeLink.postSlug || ""}`}
                />
              </motion.div>
            ) : activeView === "youtube" ? (
              <motion.div key="youtube-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <YouTubeRadar />
              </motion.div>
            ) : activeView === "niches" ? (
              <motion.div key="niches-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <NicheLibrary initialPath={routeLink.view === "niches" ? routeLink.nichePath : undefined} />
              </motion.div>
            ) : activeView === "feed" || activeView === "channels" ? (
              <motion.div key={`${activeView}-view`} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <ChannelManagement
                  auth={auth}
                  onAuthRefresh={refreshAuth}
                  initialTab={activeView === "feed" ? "feed" : "optimize"}
                  theme={channelTheme}
                  onOpenVideo={(videoId) => {
                    setPublishingVideoId(videoId);
                    switchView("publish");
                  }}
                />
              </motion.div>
            ) : activeView === "publish" ? (
              <motion.div key="publish-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <YouTubePublishing auth={auth} initialVideoId={publishingVideoId} />
              </motion.div>
            ) : activeView === "compile" ? (
              <motion.div key="compile-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <CompilationStudio auth={auth} />
              </motion.div>
            ) : activeView === "automation" ? (
              <motion.div key="automation-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <AutomationAgents auth={auth} initialSlug={routeLink.view === "automation" ? routeLink.slug : undefined} />
              </motion.div>
            ) : (
              <motion.div key="rewriter-view" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <RewriterEngine initialTranscript={rewriterInput} phases={rewriterPhases} onBack={() => switchView("movie")} />
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="mt-24 pt-8 border-t border-[#1A1A1A]/5 flex flex-col md:flex-row justify-between gap-8 text-xs text-[#1A1A1A]/40">
            <div className="space-y-2">
              <p>System v1.2.0 - MovieID workspace</p>
              <p>Copyright 2026 MovieID Agent</p>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}

function PrimaryNavigation({ activeView, onSelect, collapsed = false, darkMode = false }: { activeView: View; onSelect: (view: View) => void; collapsed?: boolean; darkMode?: boolean }) {
  return (
    <>
      <SidebarLink icon={<LayoutDashboard className="w-5 h-5 shrink-0" />} label="Movie ID" active={activeView === "movie"} onClick={() => onSelect("movie")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<PlayCircle className="w-5 h-5 shrink-0" />} label="TikTok Explorer" active={activeView === "tiktok"} onClick={() => onSelect("tiktok")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Radar className="w-5 h-5 shrink-0" />} label="YouTube Radar" active={activeView === "youtube"} onClick={() => onSelect("youtube")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Database className="w-5 h-5 shrink-0" />} label="Niche Library" active={activeView === "niches"} onClick={() => onSelect("niches")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Home className="w-5 h-5 shrink-0" />} label="Feed" active={activeView === "feed"} onClick={() => onSelect("feed")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Youtube className="w-5 h-5 shrink-0" />} label="Channel Management" active={activeView === "channels"} onClick={() => onSelect("channels")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<UploadCloud className="w-5 h-5 shrink-0" />} label="Publishing" active={activeView === "publish"} onClick={() => onSelect("publish")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Scissors className="w-5 h-5 shrink-0" />} label="Compilations" active={activeView === "compile"} onClick={() => onSelect("compile")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Bot className="w-5 h-5 shrink-0" />} label="Automation" active={activeView === "automation"} onClick={() => onSelect("automation")} collapsed={collapsed} darkMode={darkMode} />
      <SidebarLink icon={<Zap className="w-5 h-5 shrink-0" />} label="AI Rewriter" active={activeView === "rewriter"} onClick={() => onSelect("rewriter")} collapsed={collapsed} darkMode={darkMode} />
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
        "w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-colors font-sans text-[13px] font-medium relative group",
        darkMode
          ? active ? "bg-white/10 text-white" : "text-white/58 hover:bg-white/8 hover:text-white"
          : active ? "bg-[#1A1A1A]/5 text-[#1A1A1A]" : "text-[#1A1A1A]/60 hover:text-[#1A1A1A] hover:bg-[#1A1A1A]/5",
        disabled && "opacity-50 cursor-not-allowed",
        collapsed && "justify-center px-0 py-2.5",
      )}
    >
      <span className={cn("shrink-0", darkMode ? active ? "text-white" : "text-white/42 group-hover:text-white" : active ? "text-[#1A1A1A]" : "text-[#1A1A1A]/50 group-hover:text-[#1A1A1A]")}>{icon}</span>
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
      className="group relative grid h-11 w-11 place-items-center rounded-full border border-[#1A1A1A]/10 bg-white shadow-sm transition hover:border-[#FF0033]/25 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#FFDE32] focus:ring-offset-2 focus:ring-offset-[#F9F8F6]"
      aria-label="Open account switcher"
      title={label}
    >
      {image ? (
        <img src={image} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
      ) : (
        <Youtube className="h-5 w-5 text-[#FF0033]" />
      )}
      <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-[#FFDE32]" aria-hidden="true" />
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
        "group inline-flex h-10 min-w-[188px] items-center justify-between gap-2 rounded-full border px-2.5 shadow-[0_18px_60px_rgba(0,0,0,0.18)] backdrop-blur-xl transition focus:outline-none focus:ring-2 focus:ring-[#2E7BFF]/45",
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
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#FFDE32] text-[#1A1A1A]">
              <Youtube className="h-4 w-4" />
            </span>
          )}
          <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#FF0033] ring-2", darkMode ? "ring-[#151923]" : "ring-white")}>
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
        <div className={cn("fixed bottom-20 left-4 z-[120] w-[280px] rounded-2xl border p-3 shadow-2xl", darkMode ? "border-white/10 bg-[#171B26] text-white" : "border-[#1A1A1A]/10 bg-white text-[#171717]", collapsed && "left-3")}>
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
                  <input type="checkbox" checked={darkMode} onChange={(event) => onDarkModeChange(event.target.checked)} className="h-4 w-4 accent-[#FFDE32]" />
                </label>
                <button onClick={() => void onLogout()} className="flex h-10 w-full items-center gap-3 rounded-xl px-3 text-sm font-semibold text-[#1A1A1A]/72 transition hover:bg-[#FFF1F4] hover:text-[#FF0033]">
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
                <p className="text-[10px] font-black uppercase tracking-widest text-[#FF0033]">{panel.replace("-", " ")}</p>
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
            <p className={cn("truncate text-[11px] font-semibold", darkMode ? "text-white/45" : "text-[#1A1A1A]/45")}>{email}</p>
          </div>
        ) : null}
      </button>
    </div>
  );
}

function AvatarImage({ src, label, className }: { src: string; label: string; className?: string }) {
  return src ? <img src={src} alt="" className={cn("rounded-full object-cover", className)} referrerPolicy="no-referrer" /> : <div className={cn("grid place-items-center rounded-full bg-[#FFDE32] text-xs font-black text-[#171717]", className)}>{label.slice(0, 1).toUpperCase()}</div>;
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
                  return (
                    <button
                      key={account.id}
                      type="button"
                      onClick={() => void switchAccount(account)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition",
                        active
                          ? darkMode ? "bg-[#252A3A] text-white" : "bg-[#F4F5F8] text-[#1A1A1A]"
                          : darkMode ? "text-white/76 hover:bg-white/[0.055] hover:text-white" : "text-[#1A1A1A]/70 hover:bg-[#F9F8F6] hover:text-[#1A1A1A]",
                      )}
                      role="menuitem"
                    >
                      <span className="relative shrink-0">
                        {account.thumbnailUrl ? (
                          <img src={account.thumbnailUrl} alt="" className="h-9 w-9 rounded-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-[#FFDE32] text-[#1A1A1A]">
                            <Youtube className="h-4 w-4" />
                          </span>
                        )}
                        <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-[#FF0033] ring-2", darkMode ? "ring-[#252A3A]" : "ring-white")}>
                          <Youtube className="h-2.5 w-2.5 fill-white text-white" />
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold">{account.channelTitle}</span>
                        <span className={cn("block truncate text-[11px] font-semibold", active ? darkMode ? "text-white/45" : "text-[#1A1A1A]/45" : darkMode ? "text-white/28" : "text-[#1A1A1A]/35")}>YouTube</span>
                      </span>
                      {busy === account.id ? <Loader2 className="h-4 w-4 animate-spin text-[#2E7BFF]" /> : active ? <CheckCircle2 className="h-4 w-4 text-[#2E7BFF]" /> : null}
                    </button>
                  );
                }) : (
                  <p className={cn("rounded-xl px-3 py-4 text-sm font-semibold leading-6", darkMode ? "text-white/50" : "text-[#1A1A1A]/50")}>No connected YouTube channels yet.</p>
                )}
            </div>

            <div className={cn("my-1 h-px", darkMode ? "bg-white/8" : "bg-[#1A1A1A]/8")} />

            <div className="space-y-1">
              <a href="/api/auth/google?mode=connect&next=/channels" className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition", darkMode ? "text-white/82 hover:bg-white/[0.055] hover:text-white" : "text-[#1A1A1A]/75 hover:bg-[#F9F8F6] hover:text-[#1A1A1A]")} role="menuitem">
                <span className={cn("grid h-9 w-9 place-items-center rounded-full", darkMode ? "bg-white/[0.04] text-white/45" : "bg-[#FFDE32]/35 text-[#1A1A1A]/65")}>
                  <Youtube className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold">YouTube</span>
                  <span className={cn("block text-[11px] font-semibold", darkMode ? "text-white/28" : "text-[#1A1A1A]/40")}>Add channel</span>
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
  const [imageError, setImageError] = useState(false);
  const tmdb = result.tmdb;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-10">
      <div className="bg-white rounded-xl shadow-sm border border-[#1A1A1A]/5 overflow-hidden">
        <div className="confidence-meter" style={{ width: `${result.confidence * 100}%` }} />
        <div className="p-6 md:p-10 flex flex-col md:flex-row gap-8 items-start">
          <div className="shrink-0 w-full md:w-48 aspect-[2/3] bg-[#F9F8F6] rounded-lg flex flex-col items-center justify-center text-[#FF0033]/30 border border-dashed border-[#FF0033]/20 overflow-hidden relative shadow-inner">
            {result.posterUrl && !imageError ? (
              <img src={result.posterUrl} alt={`${result.title} poster`} className="w-full h-full object-cover transition-opacity duration-500" referrerPolicy="no-referrer" onError={() => setImageError(true)} />
            ) : (
              <div className="p-4 flex flex-col items-center justify-center text-center">
                <Film className="w-8 h-8 mb-2 opacity-20" />
                <span className="text-xs block mb-2">TMDB poster not found</span>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-6">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="text-xs font-semibold rounded-full px-2 py-1 bg-[#FF0033]/10 text-[#FF0033]">Confidence {Math.round(result.confidence * 100)}%</span>
                {result.imdbUrl && <ResultLink href={result.imdbUrl} label="IMDb" />}
                {tmdb?.tmdbUrl && <ResultLink href={tmdb.tmdbUrl} label="TMDB" />}
              </div>
              <h2 className="text-4xl md:text-5xl font-serif font-bold text-[#1A1A1A] mb-2 leading-tight">{result.title}</h2>
              <p className="text-sm font-mono tracking-wider text-[#1A1A1A]/60">{result.director} {result.year ? `(${result.year})` : ""}</p>
            </div>

            <p className="text-lg leading-relaxed text-[#1A1A1A]/80 italic font-serif max-w-2xl">"{result.summary}"</p>

            <button onClick={onReset} className="px-7 py-3 bg-[#FFDE32] text-[#1A1A1A] rounded-lg text-xs font-bold hover:bg-[#FF0033] hover:text-white transition-all shadow-lg shadow-[#FFDE32]/25">
              Start new analysis
            </button>
          </div>
        </div>
      </div>

      <MovieAnalysisTabs result={result} />
    </motion.div>
  );
}

function ResultLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs font-semibold text-[#1A1A1A]/60 hover:text-[#FF0033] transition-colors">
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
