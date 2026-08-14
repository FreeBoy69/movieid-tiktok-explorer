import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Activity, AudioLines, Bot, Check, ChevronRight, Film, Loader2, TriangleAlert, X } from "lucide-react";
import { cn } from "../lib/utils";
import { BACKGROUND_PROCESS_EVENT } from "../utils/backgroundProcesses";

export type BackgroundProcess = {
  id: string;
  kind: "compilation" | "voice_studio" | "agent_run";
  status: "queued" | "running" | "stopping" | "done" | "error";
  title: string;
  message: string;
  error?: string;
  progress?: number | null;
  agentId?: string;
  agentName?: string;
  uploadId?: string;
  createdAt: number;
  updatedAt: number;
};

const DISMISSED_KEY = "autoyt-dismissed-background-processes";
const ACTIVE_STATUSES = new Set(["queued", "running", "stopping"]);

function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const value = JSON.parse(window.localStorage.getItem(DISMISSED_KEY) || "[]");
    return new Set(Array.isArray(value) ? value.map(String) : []);
  } catch {
    return new Set();
  }
}

function processIcon(kind: BackgroundProcess["kind"], className: string) {
  if (kind === "voice_studio") return <AudioLines className={className} />;
  if (kind === "agent_run") return <Bot className={className} />;
  return <Film className={className} />;
}

function processKindLabel(kind: BackgroundProcess["kind"]): string {
  if (kind === "voice_studio") return "Voice Studio";
  if (kind === "agent_run") return "Candidate run";
  return "Compilation";
}

function elapsedLabel(startedAt: number, finishedAt: number): string {
  const seconds = Math.max(0, Math.round((finishedAt - startedAt) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function updatedLabel(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function ProcessRow({ process, darkMode, now, onOpen, onDismiss }: {
  process: BackgroundProcess;
  darkMode: boolean;
  now: number;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  const active = ACTIVE_STATUSES.has(process.status);
  const failed = process.status === "error";
  const progress = typeof process.progress === "number" ? Math.min(Math.max(process.progress, 0), 100) : null;
  const detail = failed ? process.error || process.message : process.message;

  return (
    <article className={cn("group border-b px-5 py-4 last:border-b-0", darkMode ? "border-white/8" : "border-[#1A1A1A]/8")}>
      <div className="flex items-start gap-3">
        <span className={cn(
          "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
          failed
            ? darkMode ? "bg-red-400/12 text-red-300" : "bg-red-50 text-red-600"
            : active
              ? "bg-[#f9dc0b] text-[#1A1A1A]"
              : darkMode ? "bg-emerald-400/12 text-emerald-300" : "bg-emerald-50 text-emerald-700",
        )}>
          {failed ? <TriangleAlert className="h-4 w-4" /> : active ? processIcon(process.kind, "h-4 w-4") : <Check className="h-4 w-4" />}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className={cn("truncate text-sm font-bold", darkMode ? "text-[#F8F5E8]" : "text-[#1A1A1A]")}>{process.title}</p>
              <p className={cn("mt-0.5 text-[11px] font-semibold", darkMode ? "text-[#F8F5E8]/45" : "text-[#1A1A1A]/45")}>
                {processKindLabel(process.kind)} · {active ? elapsedLabel(process.createdAt, now) : updatedLabel(process.updatedAt, now)}
              </p>
            </div>
            {!active ? (
              <button type="button" onClick={onDismiss} className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-md opacity-60 transition hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9dc0b]", darkMode ? "hover:bg-white/8" : "hover:bg-[#1A1A1A]/6")} aria-label={`Dismiss ${process.title}`}>
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>

          <p className={cn("mt-2 line-clamp-2 text-xs font-medium leading-5", failed ? darkMode ? "text-red-200/85" : "text-red-700" : darkMode ? "text-[#F8F5E8]/65" : "text-[#1A1A1A]/62")} title={detail}>
            {detail || (active ? "Working" : "Finished")}
          </p>

          {active ? (
            <div className={cn("mt-3 h-1 overflow-hidden rounded-full", darkMode ? "bg-white/10" : "bg-[#1A1A1A]/8")}>
              {progress !== null ? (
                <motion.div className="h-full rounded-full bg-[#f9dc0b]" animate={{ width: `${Math.max(progress, 3)}%` }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} />
              ) : (
                <motion.div className="h-full w-1/3 rounded-full bg-[#f9dc0b]" animate={{ x: ["-110%", "310%"] }} transition={{ duration: 1.3, ease: "easeInOut", repeat: Infinity }} />
              )}
            </div>
          ) : null}

          <button type="button" onClick={onOpen} className={cn("mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9dc0b]", darkMode ? "bg-white/8 text-[#F8F5E8] hover:bg-white/12" : "bg-[#1A1A1A]/6 text-[#1A1A1A] hover:bg-[#1A1A1A]/10")}>
            Open
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </article>
  );
}

export function BackgroundProcessCenter({ darkMode = false, onOpenProcess }: {
  darkMode?: boolean;
  onOpenProcess: (process: BackgroundProcess) => void;
}) {
  const [open, setOpen] = useState(false);
  const [processes, setProcesses] = useState<BackgroundProcess[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(readDismissed);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  const activeRef = useRef(false);
  const loadingRef = useRef(false);

  const loadProcesses = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const response = await fetch("/api/background-jobs", { headers: { Accept: "application/json" }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load background activity");
      const next = Array.isArray(data.processes) ? data.processes : [];
      activeRef.current = next.some((process: BackgroundProcess) => ACTIVE_STATUSES.has(process.status));
      setProcesses(next);
      setNow(Date.now());
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load background activity");
    } finally {
      loadingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = 0;
    const tick = async () => {
      await loadProcesses();
      if (!stopped) timer = window.setTimeout(tick, activeRef.current ? 3000 : 15000);
    };
    const refresh = () => void loadProcesses();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    void tick();
    window.addEventListener(BACKGROUND_PROCESS_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      window.removeEventListener(BACKGROUND_PROCESS_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [loadProcesses]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const visibleProcesses = useMemo(() => processes.filter((process) => ACTIVE_STATUSES.has(process.status) || !dismissed.has(process.id)), [dismissed, processes]);
  const active = useMemo(() => visibleProcesses.filter((process) => ACTIVE_STATUSES.has(process.status)), [visibleProcesses]);
  const recent = useMemo(() => visibleProcesses.filter((process) => !ACTIVE_STATUSES.has(process.status)), [visibleProcesses]);

  const persistDismissed = useCallback((next: Set<string>) => {
    setDismissed(next);
    window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next].slice(-200)));
  }, []);

  const dismiss = useCallback((id: string) => {
    persistDismissed(new Set([...dismissed, id]));
  }, [dismissed, persistDismissed]);

  const clearRecent = useCallback(() => {
    persistDismissed(new Set([...dismissed, ...recent.map((process) => process.id)]));
  }, [dismissed, persistDismissed, recent]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-4 right-4 z-[70] inline-flex h-11 items-center gap-2 rounded-xl border px-3 shadow-[0_10px_28px_rgba(26,26,26,0.16)] transition duration-200 hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9dc0b] md:bottom-5 md:right-5",
          active.length
            ? "border-[#d8bf00] bg-[#f9dc0b] text-[#1A1A1A]"
            : darkMode ? "border-white/12 bg-[#191D1A] text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-[#FDFCFA] text-[#1A1A1A]",
        )}
        aria-label={active.length ? `Open background activity, ${active.length} active` : "Open background activity"}
        aria-expanded={open}
      >
        {active.length ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
        <span className="hidden text-xs font-bold sm:inline">{active.length ? `${active.length} active` : "Activity"}</span>
        {active.length ? <span className="grid min-w-5 place-items-center rounded-md bg-[#1A1A1A] px-1.5 py-0.5 text-[10px] font-black text-[#f9dc0b] sm:hidden">{active.length}</span> : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div className="fixed inset-0 z-[140]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" className="absolute inset-0 cursor-default bg-[#1A1A1A]/24 backdrop-blur-[2px]" onClick={() => setOpen(false)} aria-label="Close background activity" />
            <motion.aside
              role="dialog"
              aria-modal="true"
              aria-labelledby="background-activity-title"
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
              className={cn("absolute inset-y-0 right-0 flex w-full max-w-[420px] flex-col border-l shadow-[-16px_0_40px_rgba(26,26,26,0.14)]", darkMode ? "border-white/10 bg-[#111411] text-[#F8F5E8]" : "border-[#1A1A1A]/10 bg-[#FDFCFA] text-[#1A1A1A]")}
            >
              <header className={cn("flex min-h-16 items-center justify-between border-b px-5", darkMode ? "border-white/8" : "border-[#1A1A1A]/8")}>
                <div className="min-w-0">
                  <h2 id="background-activity-title" className="text-base font-bold">Background activity</h2>
                  <p className={cn("mt-0.5 text-xs font-semibold", darkMode ? "text-[#F8F5E8]/45" : "text-[#1A1A1A]/45")} aria-live="polite">
                    {active.length ? `${active.length} process${active.length === 1 ? "" : "es"} running` : "All caught up"}
                  </p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className={cn("grid h-9 w-9 place-items-center rounded-lg transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9dc0b]", darkMode ? "hover:bg-white/8" : "hover:bg-[#1A1A1A]/6")} aria-label="Close background activity">
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                {error ? (
                  <div className={cn("mx-5 mt-5 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold", darkMode ? "bg-red-400/10 text-red-200" : "bg-red-50 text-red-700")}>
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                ) : null}

                {!visibleProcesses.length && !error ? (
                  <div className="grid min-h-[52vh] place-items-center px-8 text-center">
                    <div>
                      <span className={cn("mx-auto grid h-11 w-11 place-items-center rounded-xl", darkMode ? "bg-white/8 text-[#F8F5E8]/55" : "bg-[#1A1A1A]/6 text-[#1A1A1A]/50")}><Activity className="h-5 w-5" /></span>
                      <p className="mt-4 text-sm font-bold">No background activity</p>
                      <p className={cn("mt-1 text-xs font-medium", darkMode ? "text-[#F8F5E8]/45" : "text-[#1A1A1A]/45")}>New compilations and media jobs will appear here.</p>
                    </div>
                  </div>
                ) : null}

                {active.length ? (
                  <section aria-labelledby="active-processes-title">
                    <div className="flex items-center justify-between px-5 pb-2 pt-5">
                      <h3 id="active-processes-title" className="text-xs font-black uppercase text-[#9a8500]">In progress</h3>
                      <span className={cn("text-[11px] font-bold tabular-nums", darkMode ? "text-[#F8F5E8]/40" : "text-[#1A1A1A]/40")}>{active.length}</span>
                    </div>
                    <div className={cn("border-y", darkMode ? "border-white/8" : "border-[#1A1A1A]/8")}>
                      {active.map((process) => <ProcessRow key={process.id} process={process} darkMode={darkMode} now={now} onOpen={() => { onOpenProcess(process); setOpen(false); }} onDismiss={() => dismiss(process.id)} />)}
                    </div>
                  </section>
                ) : null}

                {recent.length ? (
                  <section aria-labelledby="recent-processes-title">
                    <div className="flex items-center justify-between px-5 pb-2 pt-5">
                      <h3 id="recent-processes-title" className={cn("text-xs font-black uppercase", darkMode ? "text-[#F8F5E8]/45" : "text-[#1A1A1A]/45")}>Recent</h3>
                      <button type="button" onClick={clearRecent} className={cn("rounded-md px-2 py-1 text-[11px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f9dc0b]", darkMode ? "text-[#F8F5E8]/55 hover:bg-white/8 hover:text-[#F8F5E8]" : "text-[#1A1A1A]/50 hover:bg-[#1A1A1A]/6 hover:text-[#1A1A1A]")}>Clear</button>
                    </div>
                    <div className={cn("border-y", darkMode ? "border-white/8" : "border-[#1A1A1A]/8")}>
                      {recent.map((process) => <ProcessRow key={process.id} process={process} darkMode={darkMode} now={now} onOpen={() => { onOpenProcess(process); setOpen(false); }} onDismiss={() => dismiss(process.id)} />)}
                    </div>
                  </section>
                ) : null}
              </div>
            </motion.aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
