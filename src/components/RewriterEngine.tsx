import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  AlignLeft,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  Mic,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  Sparkles,
  Upload,
  Volume2,
  Zap,
} from "lucide-react";
import { rewriteScriptWithDeepSeek } from "../services/deepseek";
import { cn } from "../lib/utils";

interface Props {
  initialTranscript?: string;
  phases?: any[];
  onBack: () => void;
}

type ScriptVersion = {
  id: string;
  title: string;
  content: string;
  timestamp: Date;
  wordCount: number;
  spokenTime: string;
  isAudioGenerated?: boolean;
  audioUrl?: string;
  audioId?: string;
};

type VoiceProfile = {
  id: string;
  name: string;
  description?: string;
  language?: string;
  defaultEngine?: string;
};

type AudioItem = {
  id: string;
  text: string;
  profileName: string;
  createdAt: string;
  duration?: number;
  audioUrl?: string;
  status?: "pending" | "completed" | "failed";
  error?: string;
};

type EditorTab = "script" | "settings" | "history" | "downloads";

const FALLBACK_VOICES: VoiceProfile[] = [
  { id: "demo-prime", name: "Prime", description: "Fast recap narrator", language: "en", defaultEngine: "kokoro" },
  { id: "demo-story", name: "Storyline", description: "Warm explainer voice", language: "en", defaultEngine: "kokoro" },
];

const ENGINES = [
  ["kokoro", "Kokoro"],
  ["qwen", "Qwen3-TTS 1.7B"],
  ["qwen-0.6b", "Qwen3-TTS 0.6B"],
  ["chatterbox_turbo", "Chatterbox Turbo"],
];

function calculateMetrics(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.floor(words / 150);
  const seconds = Math.floor((words % 150) / (150 / 60));
  return {
    wordCount: words,
    spokenTime: `${minutes}m ${seconds}s`,
  };
}

function formatClock(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function relativeTime(value: string) {
  const delta = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (delta < 60) return "just now";
  const minutes = Math.floor(delta / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || fallback);
  }
  return data;
}

export function RewriterEngine({ initialTranscript = "", phases = [], onBack }: Props) {
  const [view, setView] = useState<"input" | "processing" | "editor">("input");
  const [editorTab, setEditorTab] = useState<EditorTab>("script");
  const [videoLink, setVideoLink] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState("");
  const [versions, setVersions] = useState<ScriptVersion[]>([]);
  const [activeVersionId, setActiveVersionId] = useState("original");
  const [editableContent, setEditableContent] = useState("");
  const [isRewriting, setIsRewriting] = useState(false);
  const [generatingAudio, setGeneratingAudio] = useState(false);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [engine, setEngine] = useState("kokoro");
  const [language, setLanguage] = useState("en");
  const [speed, setSpeed] = useState(60);
  const [stability, setStability] = useState(50);
  const [similarity, setSimilarity] = useState(74);
  const [history, setHistory] = useState<AudioItem[]>([]);
  const [selectedAudioId, setSelectedAudioId] = useState("");
  const [autoplayAudioId, setAutoplayAudioId] = useState("");
  const [error, setError] = useState("");

  const voices = profiles.length ? profiles : FALLBACK_VOICES;
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) || voices[0];
  const activeVersion = versions.find((version) => version.id === activeVersionId);
  const selectedAudio = history.find((item) => item.id === selectedAudioId) || history[0] || null;
  const phaseCount = phases.length;

  useEffect(() => {
    void loadProfiles();
  }, []);

  useEffect(() => {
    if (initialTranscript.trim()) {
      seedTranscript(initialTranscript.trim());
    }
  }, [initialTranscript]);

  useEffect(() => {
    if (!selectedVoiceId && voices[0]?.id) {
      setSelectedVoiceId(voices[0].id);
      if (voices[0].defaultEngine) setEngine(voices[0].defaultEngine);
    }
  }, [selectedVoiceId, voices]);

  function seedTranscript(text: string) {
    const metrics = calculateMetrics(text);
    setVersions([{ id: "original", title: "Original Transcript", content: text, timestamp: new Date(), ...metrics }]);
    setActiveVersionId("original");
    setEditableContent(text);
    setView("editor");
  }

  async function loadProfiles() {
    try {
      const response = await fetch("/api/voicebox/profiles");
      const data = await readJson(response, "Voicebox profiles unavailable");
      const nextProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(nextProfiles);
      if (nextProfiles[0]?.id) {
        setSelectedVoiceId(nextProfiles[0].id);
        if (nextProfiles[0].defaultEngine) setEngine(nextProfiles[0].defaultEngine);
      }
    } catch {
      setProfiles([]);
    }
  }

  async function handleProcessVideo(event?: FormEvent) {
    event?.preventDefault();
    if (!videoLink.trim() && !isDragActive) return;
    setError("");
    setView("processing");
    setProgress(5);
    setProgressMessage("Downloading video audio...");

    let currentProgress = 5;
    const visualInterval = window.setInterval(() => {
      currentProgress += Math.random() * 5;
      if (currentProgress < 30) setProgressMessage("Downloading video audio...");
      else if (currentProgress < 64) setProgressMessage("Transcribing audio...");
      else setProgressMessage("Preparing editable script...");
      if (currentProgress < 95) setProgress(currentProgress);
    }, 900);

    try {
      const response = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoLink.trim() }),
      });
      const data = await readJson(response, "Transcription failed");
      window.clearInterval(visualInterval);
      setProgress(100);
      setProgressMessage("Transcript ready");
      window.setTimeout(() => seedTranscript(data.text || "No transcription generated."), 450);
    } catch (err) {
      window.clearInterval(visualInterval);
      setError(err instanceof Error ? err.message : "Transcription failed");
      setView("input");
    }
  }

  async function handleRewrite() {
    if (!editableContent.trim()) return;
    setIsRewriting(true);
    setError("");
    try {
      const rewritten = await rewriteScriptWithDeepSeek(editableContent);
      const metrics = calculateMetrics(rewritten);
      const newVersion: ScriptVersion = {
        id: `version_${Date.now()}`,
        title: `Rewrite ${versions.length}`,
        content: rewritten,
        timestamp: new Date(),
        ...metrics,
      };
      setVersions((current) => [...current, newVersion]);
      setActiveVersionId(newVersion.id);
      setEditableContent(rewritten);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rewrite script.");
    } finally {
      setIsRewriting(false);
    }
  }

  async function handleGenerateAudio() {
    if (!activeVersion?.content.trim() || !selectedVoice) return;
    const versionId = activeVersion.id;
    const versionTitle = activeVersion.title;
    const voiceName = selectedVoice.name;
    setGeneratingAudio(true);
    setError("");
    try {
      const response = await fetch("/api/voicebox/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedVoice.id,
          text: activeVersion.content,
          language,
          engine: selectedVoice.defaultEngine || engine,
          modelSize: engine === "qwen-0.6b" ? "0.6B" : "1.7B",
          waitForCompletion: false,
        }),
      });
      const data = await readJson(response, "Speech generation failed");
      const generation = data.generation || {};
      const generationId = String(generation.id || Date.now());
      const rawStatus = String(generation.status || "").toLowerCase();
      const isPending = Boolean(data.pending) || rawStatus === "queued" || rawStatus === "pending" || rawStatus === "processing";
      const item: AudioItem = {
        id: generationId,
        text: versionTitle,
        profileName: voiceName,
        createdAt: new Date().toISOString(),
        duration: generation.duration,
        audioUrl: isPending ? undefined : data.audioUrl,
        status: isPending ? "pending" : "completed",
      };
      setHistory((current) => [item, ...current].slice(0, 16));
      setSelectedAudioId(item.id);
      setEditorTab("history");
      if (isPending && generation.id) {
        void pollVoiceboxGeneration(generationId, versionId, data.audioUrl);
      } else {
        setAutoplayAudioId(item.id);
        setVersions((current) => current.map((version) => version.id === versionId ? { ...version, isAudioGenerated: true, audioUrl: item.audioUrl, audioId: item.id } : version));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speech generation failed");
    } finally {
      setGeneratingAudio(false);
    }
  }

  async function pollVoiceboxGeneration(id: string, versionId: string, fallbackAudioUrl?: string) {
    const startedAt = Date.now();
    const timeoutMs = 10 * 60 * 1000;
    while (Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 2500));
      try {
        const response = await fetch(`/api/voicebox/history/${encodeURIComponent(id)}`, { cache: "no-store" });
        const data = await readJson(response, "Speech generation status unavailable");
        const generation = data.generation || {};
        const status = String(generation.status || "").toLowerCase();
        if (status === "failed" || status === "cancelled") {
          const message = generation.error || "Speech generation failed.";
          setHistory((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error: message } : item));
          setError(message);
          return;
        }
        if (status === "completed") {
          const audioUrl = data.audioUrl || fallbackAudioUrl || `/api/voicebox/audio/${encodeURIComponent(id)}`;
          setHistory((current) => current.map((item) => item.id === id ? { ...item, status: "completed", duration: generation.duration || item.duration, audioUrl } : item));
          setVersions((current) => current.map((version) => version.id === versionId ? { ...version, isAudioGenerated: true, audioUrl, audioId: id } : version));
          setSelectedAudioId(id);
          setAutoplayAudioId(id);
          return;
        }
      } catch {
        // Keep polling while Voicebox is still writing long chunked generations.
      }
    }
    setHistory((current) => current.map((item) => item.id === id ? { ...item, status: "failed", error: "Speech generation is still running. Try again from history in a moment." } : item));
    setError("Speech generation is still running. Try again from history in a moment.");
  }

  function updateCurrentVersionContent(nextContent: string) {
    setEditableContent(nextContent);
    const metrics = calculateMetrics(nextContent);
    setVersions((current) => current.map((version) => version.id === activeVersionId ? { ...version, content: nextContent, ...metrics } : version));
  }

  function downloadText(version: ScriptVersion) {
    const blob = new Blob([version.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Script_${version.title.replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="rewriter-shell workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-white text-[#111827]">
      <header className="workspace-floating-header flex min-h-12 items-center justify-between px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={onBack} className="grid h-9 w-9 place-items-center rounded-lg text-[#6B7280] transition hover:bg-[#F3F4F6] hover:text-[#111827]" aria-label="Back">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <FileText className="h-4 w-4 text-[#6B7280]" />
          <h1 className="truncate text-sm font-semibold tracking-tight">AI Rewriter</h1>
          {phaseCount ? <span className="rounded-full bg-[#F3F4F6] px-2 py-1 text-[11px] font-semibold text-[#6B7280]">{phaseCount} source phases</span> : null}
        </div>
      </header>

      {error ? (
        <div className="mx-4 mt-3 rounded-lg border border-[#f9dc0b]/40 bg-[#fff9d6] px-4 py-3 text-sm font-semibold text-[#5F5300]">
          {error}
        </div>
      ) : null}

      <AnimatePresence mode="wait">
        {view === "input" ? (
          <motion.div key="input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid min-h-0 flex-1 place-items-center p-6">
            <div className="w-full max-w-3xl space-y-8">
              <form onSubmit={(event) => void handleProcessVideo(event)} className="rounded-xl border border-[#E5E7EB] bg-[#FAFAFB] p-2">
                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                  <input
                    value={videoLink}
                    onChange={(event) => setVideoLink(event.target.value)}
                    className="h-12 min-w-0 rounded-lg border border-transparent bg-white px-4 text-sm font-medium outline-none focus:border-[#111827]"
                    placeholder="Paste TikTok, YouTube, or direct video URL"
                  />
                  <button type="submit" disabled={!videoLink.trim()} className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#111827] px-4 text-sm font-bold text-white transition hover:bg-[#f9dc0b] hover:text-[#111827] disabled:opacity-40">
                    <ExternalLink className="h-4 w-4" />
                    Process
                  </button>
                </div>
              </form>
              <div
                className={cn("grid min-h-64 cursor-pointer place-items-center rounded-xl border border-dashed p-8 text-center transition", isDragActive ? "border-[#f9dc0b] bg-[#fff9d6]" : "border-[#DADDE3] bg-white hover:border-[#111827]")}
                onDragOver={(event) => { event.preventDefault(); setIsDragActive(true); }}
                onDragLeave={() => setIsDragActive(false)}
                onDrop={(event) => { event.preventDefault(); setIsDragActive(false); void handleProcessVideo(); }}
              >
                <div>
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f9dc0b] text-[#111827]"><Upload className="h-6 w-6" /></span>
                  <p className="mt-4 text-sm font-bold">{isDragActive ? "Drop video here" : "Drag and drop a video file"}</p>
                  <p className="mt-1 text-xs font-medium text-[#6B7280]">MP4, MOV, WebM, or direct video link</p>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}

        {view === "processing" ? (
          <motion.div key="processing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="grid min-h-0 flex-1 place-items-center p-6">
            <div className="w-full max-w-md rounded-xl border border-[#E5E7EB] bg-white p-8 text-center shadow-sm">
              <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-full border border-[#E5E7EB]">
                <Zap className="h-8 w-8 text-[#f9dc0b]" />
                <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r="38" stroke="currentColor" strokeWidth="4" fill="none" className="text-[#f9dc0b]" strokeDasharray="238" strokeDashoffset={238 - (progress / 100) * 238} strokeLinecap="round" />
                </svg>
              </div>
              <h2 className="mt-6 text-lg font-bold">{progressMessage}</h2>
              <p className="mt-2 font-mono text-xs font-semibold text-[#6B7280]">{Math.round(progress)}% Complete</p>
            </div>
          </motion.div>
        ) : null}

        {view === "editor" ? (
          <motion.div key="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex min-h-0 flex-1 flex-col">
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_360px]">
              <main className="min-h-0 border-b border-[#E5E7EB] lg:border-b-0 lg:border-r">
                <div className="flex h-full min-h-[540px] flex-col p-4 sm:p-6">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-[#6B7280]">{activeVersion?.wordCount || 0} words / {activeVersion?.spokenTime || "0m 0s"}</div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void handleGenerateAudio()} disabled={generatingAudio || !activeVersion?.content.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#DADDE3] bg-white px-4 text-xs font-bold transition hover:bg-[#F3F4F6] disabled:opacity-45">
                        {generatingAudio ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                        Generate voice
                      </button>
                      <button type="button" onClick={() => void handleRewrite()} disabled={isRewriting || !activeVersion?.content.trim()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#111827] px-4 text-xs font-bold text-white transition hover:bg-[#f9dc0b] hover:text-[#111827] disabled:opacity-45">
                        {isRewriting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        {isRewriting ? "Rewriting" : "Rewrite"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={editableContent}
                    onChange={(event) => updateCurrentVersionContent(event.target.value)}
                    className="min-h-0 flex-1 resize-none rounded-lg border border-[#E5E7EB] bg-white p-5 text-base font-medium leading-8 text-[#111827] outline-none focus:border-[#111827]"
                    placeholder="Your rewritten script will appear here."
                  />
                </div>
              </main>

              <aside className="min-h-0 overflow-y-auto bg-white p-4">
                <div className="mb-4 flex gap-1 overflow-x-auto border-b border-[#E5E7EB] pb-2">
                  {(["script", "settings", "history", "downloads"] as EditorTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEditorTab(tab)}
                      className={cn("h-9 shrink-0 rounded-lg px-3 text-sm font-semibold capitalize transition", editorTab === tab ? "bg-[#111827] text-white" : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]")}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
                {editorTab === "script" ? (
                  <ScriptVersionsPanel
                    versions={versions}
                    activeVersionId={activeVersionId}
                    onSelect={(version) => {
                      setActiveVersionId(version.id);
                      setEditableContent(version.content);
                    }}
                  />
                ) : editorTab === "settings" ? (
                  <SettingsPanel
                    voices={voices}
                    selectedVoiceId={selectedVoice?.id || ""}
                    setSelectedVoiceId={setSelectedVoiceId}
                    engine={engine}
                    setEngine={setEngine}
                    language={language}
                    setLanguage={setLanguage}
                    speed={speed}
                    setSpeed={setSpeed}
                    stability={stability}
                    setStability={setStability}
                    similarity={similarity}
                    setSimilarity={setSimilarity}
                    onRefresh={() => void loadProfiles()}
                  />
                ) : editorTab === "history" ? (
                  <AudioHistory history={history} selectedAudioId={selectedAudioId} onSelect={setSelectedAudioId} />
                ) : (
                  <DownloadsPanel versions={versions} onDownload={downloadText} compact />
                )}
              </aside>
            </div>
            <div className="sticky bottom-0 z-10 border-t border-[#E5E7EB] bg-white px-4 py-3">
              <StickyPlayer item={selectedAudio} autoplay={!!selectedAudio && autoplayAudioId === selectedAudio.id} onAutoplayConsumed={() => setAutoplayAudioId("")} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function ScriptVersionsPanel({ versions, activeVersionId, onSelect }: { versions: ScriptVersion[]; activeVersionId: string; onSelect: (version: ScriptVersion) => void }) {
  return (
    <div className="space-y-3">
      {versions.map((version) => {
        const active = version.id === activeVersionId;
        return (
          <button
            key={version.id}
            type="button"
            onClick={() => onSelect(version)}
            className={cn("w-full rounded-lg border p-3 text-left transition", active ? "border-[#111827] bg-white text-[#111827]" : "border-[#E5E7EB] bg-white text-[#6B7280] hover:border-[#111827]/30")}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-bold">{version.title}</span>
              {version.isAudioGenerated ? <Check className="h-4 w-4 text-[#f9dc0b]" /> : null}
            </div>
            <div className="mt-2 flex gap-3 text-[10px] font-mono font-bold uppercase tracking-widest">
              <span className="inline-flex items-center gap-1"><AlignLeft className="h-3 w-3" />{version.wordCount} W</span>
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{version.spokenTime}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function SettingsPanel(props: {
  voices: VoiceProfile[];
  selectedVoiceId: string;
  setSelectedVoiceId: (value: string) => void;
  engine: string;
  setEngine: (value: string) => void;
  language: string;
  setLanguage: (value: string) => void;
  speed: number;
  setSpeed: (value: number) => void;
  stability: number;
  setStability: (value: number) => void;
  similarity: number;
  setSimilarity: (value: number) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-3">
        <p className="text-sm font-semibold">Settings</p>
        <button type="button" onClick={props.onRefresh} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-[#F3F4F6]" aria-label="Refresh voices"><RotateCcw className="h-4 w-4" /></button>
      </div>
      <Select label="Voice" value={props.selectedVoiceId} onChange={props.setSelectedVoiceId} options={props.voices.map((voice) => [voice.id, voice.name])} />
      <Select label="Engine" value={props.engine} onChange={props.setEngine} options={ENGINES} />
      <Select label="Language" value={props.language} onChange={props.setLanguage} options={[["en", "English"], ["ja", "Japanese"], ["ko", "Korean"], ["es", "Spanish"]]} />
      <Range label="Speed" left="Slower" right="Faster" value={props.speed} onChange={props.setSpeed} />
      <Range label="Stability" left="More variable" right="More stable" value={props.stability} onChange={props.setStability} />
      <Range label="Similarity" left="Low" right="High" value={props.similarity} onChange={props.setSimilarity} />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold underline decoration-dotted underline-offset-4">{label}</span>
      <span className="relative block">
        <select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full appearance-none rounded-lg border border-[#DADDE3] bg-white px-3 pr-9 text-sm font-semibold outline-none focus:border-[#111827]">
          {options.map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[#6B7280]" />
      </span>
    </label>
  );
}

function Range({ label, left, right, value, onChange }: { label: string; left: string; right: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold underline decoration-dotted underline-offset-4">{label}</span>
      <span className="mt-1 flex justify-between text-xs font-medium text-[#6B7280]"><span>{left}</span><span>{right}</span></span>
      <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-1.5 w-full accent-[#111827]" />
    </label>
  );
}

function AudioHistory({ history, selectedAudioId, onSelect }: { history: AudioItem[]; selectedAudioId: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-3">
      {history.length ? history.map((item) => (
        <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={cn("w-full rounded-lg p-3 text-left transition", selectedAudioId === item.id ? "bg-[#F3F4F6]" : "hover:bg-[#FAFAFB]")}>
          <div className="flex items-center justify-between gap-2">
            <p className="truncate text-sm font-semibold">{item.text}</p>
            {item.status === "pending" ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#6B7280]" /> : null}
            {item.status === "failed" ? <span className="shrink-0 rounded-full bg-[#fff9d6] px-2 py-0.5 text-[10px] font-bold text-[#5F5300]">Failed</span> : null}
          </div>
          <p className="mt-1 truncate text-xs font-medium text-[#6B7280]">{item.profileName} - {item.status === "pending" ? "generating" : relativeTime(item.createdAt)}</p>
          {item.error ? <p className="mt-1 line-clamp-2 text-xs font-medium text-[#5F5300]">{item.error}</p> : null}
        </button>
      )) : (
        <p className="rounded-lg border border-dashed border-[#DADDE3] p-6 text-center text-sm font-medium text-[#6B7280]">Generated audio history will appear here.</p>
      )}
    </div>
  );
}

function DownloadsPanel({ versions, onDownload, compact = false }: { versions: ScriptVersion[]; onDownload: (version: ScriptVersion) => void; compact?: boolean }) {
  return (
    <div className={cn("h-full overflow-y-auto", compact ? "" : "p-5")}>
      <div className="grid gap-3">
        {versions.map((version) => (
          <div key={version.id} className="rounded-lg border border-[#E5E7EB] bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{version.title}</p>
                <p className="mt-1 text-xs font-medium text-[#6B7280]">{version.wordCount} words / {version.timestamp.toLocaleString()}</p>
              </div>
              <button type="button" onClick={() => onDownload(version)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#DADDE3] px-3 text-xs font-bold hover:bg-[#F3F4F6]"><Download className="h-4 w-4" />TXT</button>
            </div>
            {version.audioUrl ? <a href={version.audioUrl} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-[#f9dc0b] px-3 text-xs font-bold text-[#111827]"><Volume2 className="h-4 w-4" />Download audio</a> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function StickyPlayer({ item, autoplay, onAutoplayConsumed }: { item: AudioItem | null; autoplay?: boolean; onAutoplayConsumed: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item?.duration || 0);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(item?.duration || 0);
    setPlaying(false);
  }, [item?.id, item?.duration]);

  useEffect(() => {
    if (!autoplay || !item?.audioUrl || !audioRef.current) return;
    audioRef.current.currentTime = 0;
    void audioRef.current.play().then(() => {
      setPlaying(true);
      onAutoplayConsumed();
    }).catch(onAutoplayConsumed);
  }, [autoplay, item?.audioUrl, onAutoplayConsumed]);

  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    const syncPlaybackPosition = () => {
      const audio = audioRef.current;
      if (!audio) return;
      syncAudioDuration(audio);
      setCurrentTime(audio.currentTime || 0);
      if (!audio.paused && !audio.ended) {
        frameId = window.requestAnimationFrame(syncPlaybackPosition);
      }
    };
    frameId = window.requestAnimationFrame(syncPlaybackPosition);
    return () => window.cancelAnimationFrame(frameId);
  }, [playing, item?.id, item?.audioUrl]);

  function seek(next: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration || audio.duration || 0, next));
    setCurrentTime(audio.currentTime);
  }

  function syncAudioDuration(audio: HTMLAudioElement) {
    const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item?.duration || 0;
    if (nextDuration > 0 && Math.abs(nextDuration - duration) > 0.05) {
      setDuration(nextDuration);
    }
  }

  function toggle() {
    const audio = audioRef.current;
    if (!audio || !item?.audioUrl || item.status === "pending") return;
    if (audio.paused) void audio.play().then(() => setPlaying(true));
    else {
      audio.pause();
      setPlaying(false);
    }
  }

  return (
    <div className="grid min-h-16 grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,540px)_minmax(180px,1fr)]">
      {item?.audioUrl ? (
        <audio
          ref={audioRef}
          src={item.audioUrl}
          preload="auto"
          onLoadedMetadata={(event) => syncAudioDuration(event.currentTarget)}
          onDurationChange={(event) => syncAudioDuration(event.currentTarget)}
          onTimeUpdate={(event) => {
            syncAudioDuration(event.currentTarget);
            setCurrentTime(event.currentTarget.currentTime || 0);
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{item?.text || "Ready"}</p>
        <p className="mt-1 truncate text-xs font-medium text-[#6B7280]">
          {item ? `${item.profileName} - ${item.status === "pending" ? "generating audio" : relativeTime(item.createdAt)}` : "Generate voice to preview it here"}
        </p>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-center gap-4">
          <button type="button" onClick={() => seek(currentTime - 10)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#F3F4F6]" aria-label="Back 10 seconds"><SkipBack className="h-4 w-4" /></button>
          <button type="button" onClick={toggle} disabled={!item?.audioUrl || item.status === "pending"} className="grid h-11 w-11 place-items-center rounded-full bg-[#111827] text-white disabled:opacity-45" aria-label={playing ? "Pause" : "Play"}>
            {item?.status === "pending" ? <Loader2 className="h-5 w-5 animate-spin" /> : playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <button type="button" onClick={() => seek(currentTime + 10)} className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#F3F4F6]" aria-label="Forward 10 seconds"><SkipForward className="h-4 w-4" /></button>
        </div>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <span className="font-mono text-xs font-semibold text-[#6B7280]">{formatClock(currentTime)}</span>
          <ScrubBar currentTime={currentTime} duration={duration} disabled={!item?.audioUrl || !duration} onSeek={seek} />
          <span className="text-right font-mono text-xs font-semibold text-[#6B7280]">{formatClock(duration)}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        {item?.audioUrl ? <a href={item.audioUrl} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-[#F3F4F6]" aria-label="Download"><Download className="h-4 w-4" /></a> : null}
      </div>
    </div>
  );
}

function ScrubBar({ currentTime, duration, disabled, onSeek }: { currentTime: number; duration: number; disabled?: boolean; onSeek: (seconds: number) => void }) {
  const thumbSize = 14;
  const thumbRadius = thumbSize / 2;
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeCurrentTime = Math.max(0, Math.min(safeDuration, Number.isFinite(currentTime) ? currentTime : 0));
  const pct = safeDuration ? Math.max(0, Math.min(100, (safeCurrentTime / safeDuration) * 100)) : 0;

  function handleSeek(event: ChangeEvent<HTMLInputElement> | FormEvent<HTMLInputElement>) {
    if (disabled || !safeDuration) return;
    onSeek(Number(event.currentTarget.value));
  }

  return (
    <div className={cn("relative h-5 w-full rounded-full", disabled ? "cursor-default" : "cursor-pointer")} aria-label="Audio progress">
      <span className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#D1D5DB]" style={{ left: thumbRadius, right: thumbRadius }}>
        <span className="absolute left-0 top-0 h-full rounded-full bg-[#111827]" style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#111827] shadow-sm" style={{ left: `${pct}%` }} />
      </span>
      <input
        type="range"
        min={0}
        max={safeDuration || 1}
        step="any"
        value={safeDuration ? safeCurrentTime : 0}
        disabled={disabled || !safeDuration}
        onChange={handleSeek}
        onInput={handleSeek}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
        aria-label="Seek audio"
      />
    </div>
  );
}
