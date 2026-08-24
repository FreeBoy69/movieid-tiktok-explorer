import { ChangeEvent, type DragEvent, FormEvent, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  FileAudio,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";

type StudioTab = "generate" | "voices" | "clone";
type RightRailTab = "settings" | "history";
type VoiceLibraryTab = "explore" | "mine";

type VoiceProfile = {
  id: string;
  name: string;
  description: string;
  language: string;
  voiceType?: string;
  presetEngine?: string;
  presetVoiceId?: string;
  defaultEngine?: string;
  sampleCount?: number;
};

type Generation = {
  id: string;
  profileName: string;
  text: string;
  language: string;
  duration?: number;
  audioUrl?: string;
  createdAt: string;
};

const FALLBACK_VOICES: VoiceProfile[] = [
  { id: "demo-prime", name: "Prime", description: "Narration voice, good for recaps", language: "en", voiceType: "preset", defaultEngine: "kokoro" },
  { id: "demo-story", name: "Storyline", description: "Warm explainer tone", language: "en", voiceType: "preset", defaultEngine: "kokoro" },
  { id: "demo-energy", name: "Momentum", description: "Fast short-form delivery", language: "en", voiceType: "preset", defaultEngine: "kokoro" },
];

const LANGUAGES = [
  ["en", "English"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["pt", "Portuguese"],
  ["it", "Italian"],
  ["sw", "Swahili"],
];

const ENGINES = [
  ["kokoro", "Kokoro"],
  ["qwen", "Qwen3-TTS 1.7B"],
  ["qwen-0.6b", "Qwen3-TTS 0.6B"],
  ["qwen_custom_voice", "Qwen Custom Voice"],
  ["chatterbox_turbo", "Chatterbox Turbo"],
  ["chatterbox", "Chatterbox Multilingual"],
  ["luxtts", "LuxTTS"],
  ["tada", "TADA"],
];
const STUDIO_TABS: Array<{ id: StudioTab; label: string; icon: typeof Volume2 }> = [
  { id: "generate", label: "Generate", icon: Volume2 },
  { id: "voices", label: "Voices", icon: BookOpen },
  { id: "clone", label: "Clone", icon: Mic },
];

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "V";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function relativeTime(value: string) {
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "just now";
  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function formatClock(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0:00";
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isVoiceReady(voice?: VoiceProfile | null) {
  if (!voice) return false;
  return voice.voiceType !== "cloned" || Number(voice.sampleCount || 0) > 0;
}

async function readJson(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || fallback);
  }
  return data;
}

export function TextToSpeechStudio({ theme = "light", initialText = "" }: { theme?: "light" | "dark"; initialText?: string }) {
  const dark = theme === "dark";
  const [activeTab, setActiveTab] = useState<StudioTab>("generate");
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [text, setText] = useState("Jack entered the arena knowing one mistake would end the duel.");
  const [language, setLanguage] = useState("en");
  const [cloneLanguage, setCloneLanguage] = useState("en");
  const [engine, setEngine] = useState("kokoro");
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [history, setHistory] = useState<Generation[]>([]);
  const [selectedGenerationId, setSelectedGenerationId] = useState("");
  const [autoplayGenerationId, setAutoplayGenerationId] = useState("");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneDescription, setCloneDescription] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneDragActive, setCloneDragActive] = useState(false);
  const [voiceNameOverrides, setVoiceNameOverrides] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = window.localStorage.getItem("autoyt-tts-voice-names");
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [savedVoiceIds, setSavedVoiceIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = window.localStorage.getItem("autoyt-tts-voice-library");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  const voices = (profiles.length ? profiles : FALLBACK_VOICES).map((voice) => ({
    ...voice,
    name: voiceNameOverrides[voice.id] || voice.name,
  }));
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) || voices[0];
  const online = profiles.length > 0;

  useEffect(() => {
    void loadProfiles();
  }, []);

  useEffect(() => {
    if (initialText.trim()) {
      setText(initialText.trim());
      setActiveTab("generate");
    }
  }, [initialText]);

  useEffect(() => {
    if (!selectedVoiceId && voices[0]?.id) {
      setSelectedVoiceId(voices[0].id);
      if (voices[0].defaultEngine) setEngine(voices[0].defaultEngine);
    }
  }, [selectedVoiceId, voices]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("autoyt-tts-voice-library", JSON.stringify(savedVoiceIds));
  }, [savedVoiceIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("autoyt-tts-voice-names", JSON.stringify(voiceNameOverrides));
  }, [voiceNameOverrides]);

  async function loadProfiles() {
    setLoadingVoices(true);
    setError("");
    try {
      const response = await fetch("/api/voicebox/profiles");
      const data = await readJson(response, "Voicebox profiles unavailable");
      const nextProfiles = Array.isArray(data.profiles) ? data.profiles : [];
      setProfiles(nextProfiles);
      const preferredVoice = nextProfiles.find(isVoiceReady) || nextProfiles[0];
      if (preferredVoice?.id) {
        setSelectedVoiceId(preferredVoice.id);
        if (preferredVoice.defaultEngine) setEngine(preferredVoice.defaultEngine);
      }
    } catch (err) {
      setProfiles([]);
      const message = err instanceof Error ? err.message : "";
      setError(/fetch failed|network/i.test(message) ? "Voice service is unavailable. Start Voicebox, then refresh voices." : message || "Voice service is unavailable. Start Voicebox, then refresh voices.");
    } finally {
      setLoadingVoices(false);
    }
  }

  async function generateSpeech(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedVoice || !text.trim()) return;
    if (!online) {
      setError("Voicebox is not connected yet. Start Voicebox, then refresh voices.");
      return;
    }
    if (!isVoiceReady(selectedVoice)) {
      setError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
      setActiveTab("clone");
      return;
    }
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/voicebox/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: selectedVoice.id,
          text,
          language,
          engine,
          modelSize: engine === "qwen-0.6b" ? "0.6B" : "1.7B",
        }),
      });
      const data = await readJson(response, "Speech generation failed");
      const generation = data.generation || {};
      const item: Generation = {
        id: String(generation.id || Date.now()),
        profileName: selectedVoice.name,
        text,
        language,
        duration: generation.duration,
        audioUrl: data.audioUrl,
        createdAt: new Date().toISOString(),
      };
      setHistory((current) => [item, ...current].slice(0, 12));
      setSelectedGenerationId(item.id);
      setAutoplayGenerationId(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speech generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function cloneVoice(event: FormEvent) {
    event.preventDefault();
    if (!cloneConsent) {
      setError("Confirm you have permission to use this voice sample.");
      return;
    }
    if (!cloneFile) {
      setError("Add a voice sample first.");
      return;
    }
    setCloning(true);
    setError("");
    setNotice("");
    let createdProfileId = "";
    try {
      const createResponse = await fetch("/api/voicebox/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cloneName || cloneFile.name.replace(/\.[^.]+$/, ""), description: cloneDescription, language, voiceType: "cloned", defaultEngine: "qwen" }),
      });
      const created = await readJson(createResponse, "Voice profile creation failed");
      createdProfileId = String(created.profile?.id || "");
      const audioBase64 = await fileToBase64(cloneFile);
      const sampleResponse = await fetch(`/api/voicebox/profiles/${encodeURIComponent(createdProfileId)}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64,
          filename: cloneFile.name,
          mimeType: cloneFile.type || "audio/wav",
        }),
      });
      await readJson(sampleResponse, "Voice sample upload failed");
      await loadProfiles();
      const refreshedResponse = await fetch("/api/voicebox/profiles");
      const refreshed = await readJson(refreshedResponse, "Voicebox profiles unavailable");
      const savedProfile = Array.isArray(refreshed.profiles) ? refreshed.profiles.find((profile: VoiceProfile) => profile.id === createdProfileId) : null;
      if (!isVoiceReady(savedProfile)) {
        throw new Error("Voice sample was not attached. Use a clearer 10-30 second sample and try cloning again.");
      }
      if (createdProfileId) {
        setSavedVoiceIds((current) => current.includes(createdProfileId) ? current : [...current, createdProfileId]);
        setSelectedVoiceId(createdProfileId);
      }
      setNotice("Voice profile created and saved to your voice library.");
      setCloneFile(null);
      setCloneName("");
      setCloneDescription("");
      setCloneConsent(false);
      setActiveTab("voices");
    } catch (err) {
      if (createdProfileId) {
        void fetch(`/api/voicebox/profiles/${encodeURIComponent(createdProfileId)}`, { method: "DELETE" }).catch(() => undefined);
        setSavedVoiceIds((current) => current.filter((id) => id !== createdProfileId));
      }
      setError(err instanceof Error ? err.message : "Voice cloning failed");
    } finally {
      setCloning(false);
    }
  }

  function saveVoiceToLibrary(voiceId: string) {
    const voice = voices.find((item) => item.id === voiceId);
    if (!isVoiceReady(voice)) {
      setError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
      return;
    }
    setSavedVoiceIds((current) => current.includes(voiceId) ? current : [...current, voiceId]);
  }

  function removeVoiceFromLibrary(voiceId: string) {
    setSavedVoiceIds((current) => current.filter((id) => id !== voiceId));
  }

  async function deleteVoice(voiceId: string) {
    if (!voiceId) return;
    try {
      const response = await fetch(`/api/voicebox/profiles/${encodeURIComponent(voiceId)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error || "Voice deletion failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Voice deletion failed");
      return;
    }
    setProfiles((current) => current.filter((voice) => voice.id !== voiceId));
    setSavedVoiceIds((current) => current.filter((id) => id !== voiceId));
    setVoiceNameOverrides((current) => {
      const next = { ...current };
      delete next[voiceId];
      return next;
    });
    if (selectedVoiceId === voiceId) {
      const nextVoice = voices.find((voice) => voice.id !== voiceId && isVoiceReady(voice)) || voices.find((voice) => voice.id !== voiceId);
      setSelectedVoiceId(nextVoice?.id || "");
      if (nextVoice?.defaultEngine) setEngine(nextVoice.defaultEngine);
    }
  }

  function useVoiceFromLibrary(voiceId: string) {
    const voice = voices.find((item) => item.id === voiceId);
    if (!voice) return;
    if (!isVoiceReady(voice)) {
      setError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
      return;
    }
    setSelectedVoiceId(voice.id);
    if (voice.defaultEngine) setEngine(voice.defaultEngine);
    setActiveTab("generate");
  }

  async function renameVoice(voiceId: string, name: string) {
    const cleanName = name.trim().slice(0, 100);
    if (!voiceId || !cleanName) return;
    setVoiceNameOverrides((current) => ({ ...current, [voiceId]: cleanName }));
    await fetch(`/api/voicebox/profiles/${encodeURIComponent(voiceId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: cleanName }),
    }).catch(() => null);
    setProfiles((current) => current.map((voice) => voice.id === voiceId ? { ...voice, name: cleanName } : voice));
  }

  return (
    <section className={cn("workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden", dark ? "bg-[#151515] text-white" : "bg-[#F9F8F6] text-[#1A1A1A]")}>
      <header className="workspace-floating-header flex min-h-14 flex-wrap items-center gap-x-5 px-3 sm:px-4">
        <div className="flex min-h-11 items-center gap-2.5">
          <Volume2 className="h-4 w-4 text-[#f9dc0b]" aria-hidden />
          <h1 className="text-sm font-bold tracking-tight">Text to Speech</h1>
        </div>
        <nav className={cn("order-3 flex w-full items-center gap-5 border-t sm:order-none sm:w-auto sm:border-t-0", dark ? "border-white/8" : "border-[#1A1A1A]/8")} aria-label="Text to Speech sections">
          {STUDIO_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              aria-pressed={activeTab === id}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 border-b-2 px-1 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 focus-visible:ring-offset-2",
                activeTab === id
                  ? dark ? "border-[#f9dc0b] text-white" : "border-[#f9dc0b] text-[#1A1A1A]"
                  : dark ? "border-transparent text-white/45 hover:text-white" : "border-transparent text-[#1A1A1A]/45 hover:text-[#1A1A1A]",
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
        <button type="button" onClick={() => void loadProfiles()} className={cn("ml-auto inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", dark ? "border-white/12 text-white/70 hover:bg-white/8 hover:text-white" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]/60 hover:text-[#1A1A1A]")} aria-label="Refresh voices">
            {loadingVoices ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          <span className="hidden sm:inline">Refresh voices</span>
        </button>
      </header>

      {notice ? <Status tone="success" dark={dark} message={notice} onClose={() => setNotice("")} /> : null}
      {error ? <Status tone="error" dark={dark} message={error} onClose={() => setError("")} /> : null}

      {activeTab === "generate" ? (
        <GenerateTab
          dark={dark}
          voices={voices}
          online={online}
          selectedVoiceId={selectedVoice?.id || ""}
          setSelectedVoiceId={setSelectedVoiceId}
          text={text}
          setText={setText}
          language={language}
          setLanguage={setLanguage}
          engine={engine}
          setEngine={setEngine}
          generating={generating}
          generateSpeech={generateSpeech}
          history={history}
          selectedGenerationId={selectedGenerationId}
          setSelectedGenerationId={setSelectedGenerationId}
          autoplayGenerationId={autoplayGenerationId}
          clearAutoplayGeneration={() => setAutoplayGenerationId("")}
        />
      ) : activeTab === "voices" ? (
        <VoicesLibraryTab
          dark={dark}
          voices={voices}
          savedVoiceIds={savedVoiceIds}
          selectedVoiceId={selectedVoice?.id || ""}
          onUseVoice={useVoiceFromLibrary}
          onSaveVoice={saveVoiceToLibrary}
          onRemoveVoice={removeVoiceFromLibrary}
          onDeleteVoice={deleteVoice}
          onRenameVoice={renameVoice}
          onCreateVoice={() => setActiveTab("clone")}
        />
      ) : (
        <CloneTab
          dark={dark}
          cloneVoice={cloneVoice}
          cloneFile={cloneFile}
          setCloneFile={setCloneFile}
          cloneName={cloneName}
          setCloneName={setCloneName}
          cloneDescription={cloneDescription}
          setCloneDescription={setCloneDescription}
          cloneConsent={cloneConsent}
          setCloneConsent={setCloneConsent}
          cloneDragActive={cloneDragActive}
          setCloneDragActive={setCloneDragActive}
          cloning={cloning}
          language={cloneLanguage}
          setLanguage={setCloneLanguage}
        />
      )}
    </section>
  );
}

function GenerateTab(props: {
  dark: boolean;
  voices: VoiceProfile[];
  online: boolean;
  selectedVoiceId: string;
  setSelectedVoiceId: (id: string) => void;
  text: string;
  setText: (value: string) => void;
  language: string;
  setLanguage: (value: string) => void;
  engine: string;
  setEngine: (value: string) => void;
  generating: boolean;
  generateSpeech: (event?: FormEvent) => Promise<void>;
  history: Generation[];
  selectedGenerationId: string;
  setSelectedGenerationId: (id: string) => void;
  autoplayGenerationId: string;
  clearAutoplayGeneration: () => void;
}) {
  const { dark, voices, selectedVoiceId } = props;
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>("settings");
  const [historySearch, setHistorySearch] = useState("");
  const selectedGeneration = props.history.find((item) => item.id === props.selectedGenerationId) || props.history[0];
  const historyItems = props.history.filter((item) => {
    const query = historySearch.trim().toLowerCase();
    return !query || item.text.toLowerCase().includes(query) || item.profileName.toLowerCase().includes(query);
  });
  return (
    <form onSubmit={(event) => void props.generateSpeech(event)} className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden">
        <section className={cn("flex min-h-[420px] flex-col border-b p-4 sm:p-6 lg:min-h-0 lg:border-b-0 lg:border-r lg:p-8", dark ? "border-white/10 bg-[#151515]" : "border-[#1A1A1A]/8 bg-[#F9F8F6]")}>
          <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col">
            <div className="mb-3 flex items-end justify-between gap-4">
              <h2 className="font-serif text-xl font-bold">Script</h2>
              <span className={cn("text-xs tabular-nums", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>{props.text.length} / 5,000</span>
            </div>
            <textarea
              value={props.text}
              onChange={(event) => props.setText(event.target.value)}
              placeholder="Write or paste the script you want to turn into speech."
              aria-label="Speech script"
              className={cn("min-h-[300px] flex-1 resize-none rounded-xl border p-4 text-base font-normal leading-7 outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20 sm:p-5 sm:text-lg", dark ? "border-white/10 bg-[#1C1C1C] text-white placeholder:text-white/40" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A] placeholder:text-[#1A1A1A]/38")}
              maxLength={5000}
            />
            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={props.generating || !props.text.trim() || !props.online} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-5 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 disabled:cursor-not-allowed disabled:opacity-45">
                {props.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate speech
              </button>
            </div>
          </div>
        </section>

        <aside className={cn("min-h-0 border-b px-4 py-4 lg:overflow-y-auto lg:border-b-0", dark ? "border-white/10 bg-[#1C1C1C]" : "border-[#1A1A1A]/8 bg-white")}>
          <div className={cn("mb-5 flex gap-5 border-b", dark ? "border-white/10" : "border-[#1A1A1A]/8")}>
            {(["settings", "history"] as RightRailTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightRailTab(tab)}
                aria-pressed={rightRailTab === tab}
                className={cn(
                  "min-h-11 border-b-2 px-1 text-xs font-bold capitalize transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70",
                  rightRailTab === tab
                    ? dark ? "border-[#f9dc0b] text-white" : "border-[#f9dc0b] text-[#1A1A1A]"
                    : dark ? "border-transparent text-white/45 hover:text-white" : "border-transparent text-[#1A1A1A]/45 hover:text-[#1A1A1A]",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {rightRailTab === "settings" ? (
            <div className="space-y-4">
              <label className="block">
                <span className={cn("mb-1.5 block text-[11px] font-bold uppercase tracking-widest", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>Voice</span>
                <div className="relative">
                  <select
                    value={selectedVoiceId}
                    aria-label="Voice"
                    onChange={(event) => {
                      const voice = voices.find((item) => item.id === event.target.value);
                      props.setSelectedVoiceId(event.target.value);
                      if (voice?.defaultEngine) props.setEngine(voice.defaultEngine);
                    }}
                    className={cn("h-11 w-full appearance-none rounded-lg border px-3 pr-9 text-sm font-semibold outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#151515] text-white" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A]")}
                  >
                    {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                  </select>
                  <ChevronDown className={cn("pointer-events-none absolute right-3 top-3.5 h-4 w-4", dark ? "text-white/50" : "text-[#1A1A1A]/45")} />
                </div>
              </label>
              <Select label="Engine" value={props.engine} onChange={props.setEngine} options={ENGINES} dark={dark} compact />
              <Select label="Language" value={props.language} onChange={props.setLanguage} options={LANGUAGES} dark={dark} compact />
            </div>
          ) : (
            <div className="space-y-4">
              <label className="relative block">
                <Search className={cn("pointer-events-none absolute left-3 top-3.5 h-4 w-4", dark ? "text-white/38" : "text-[#1A1A1A]/35")} />
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search this session"
                  aria-label="Search generation history"
                  className={cn("h-11 w-full rounded-lg border pl-9 pr-3 text-sm font-medium outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#151515] text-white placeholder:text-white/35" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A] placeholder:text-[#1A1A1A]/38")}
                />
              </label>
              <div className="space-y-2">
                {historyItems.length ? historyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      props.setSelectedGenerationId(item.id);
                    }}
                    className={cn(
                      "min-h-11 w-full rounded-lg border px-3 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70",
                      props.selectedGenerationId === item.id
                        ? dark ? "border-[#f9dc0b]/60 bg-white/8" : "border-[#f9dc0b]/60 bg-[#fffbea]"
                        : dark ? "border-white/8 hover:bg-white/[0.05]" : "border-[#1A1A1A]/8 bg-white hover:border-[#1A1A1A]/16",
                    )}
                  >
                    <p className="truncate text-sm font-semibold">{item.text}</p>
                    <p className={cn("mt-1 truncate text-xs", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>{item.profileName} · {relativeTime(item.createdAt)}</p>
                  </button>
                )) : (
                  <p className={cn("rounded-xl border border-dashed px-4 py-8 text-center text-sm", dark ? "border-white/10 text-white/45" : "border-[#1A1A1A]/12 text-[#1A1A1A]/45")}>No speech generated in this session.</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      {selectedGeneration ? (
        <div className={cn("sticky bottom-0 z-10 border-t px-4 py-3", dark ? "border-white/10 bg-[#151515]" : "border-[#1A1A1A]/8 bg-white")}>
          <GenerationPlayer item={selectedGeneration} dark={dark} autoplay={props.autoplayGenerationId === selectedGeneration.id} onAutoplayConsumed={props.clearAutoplayGeneration} />
        </div>
      ) : null}
    </form>
  );
}

function GenerationPlayer({ item, dark, autoplay, onAutoplayConsumed }: { item: Generation; dark: boolean; autoplay?: boolean; onAutoplayConsumed?: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.duration || 0);

  useEffect(() => {
    setCurrentTime(0);
    setDuration(item.duration || 0);
    setPlaying(false);
  }, [item.id, item.duration]);

  useEffect(() => {
    if (item.duration || !item.id || item.id.startsWith("preview-")) return;
    let cancelled = false;
    void fetch(`/api/voicebox/history/${encodeURIComponent(item.id)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const nextDuration = Number(data?.generation?.duration || 0);
        if (!cancelled && Number.isFinite(nextDuration) && nextDuration > 0) {
          setDuration(nextDuration);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id, item.duration]);

  useEffect(() => {
    if (!autoplay || !item.audioUrl || !audioRef.current) return;
    const audio = audioRef.current;
    audio.currentTime = 0;
    void audio.play().then(() => {
      setPlaying(true);
      onAutoplayConsumed?.();
    }).catch(() => {
      onAutoplayConsumed?.();
    });
  }, [autoplay, item.audioUrl, onAutoplayConsumed]);

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
  }, [playing, item.id, item.audioUrl]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !item.audioUrl) return;
    if (audio.paused) {
      void audio.play().then(() => setPlaying(true));
    } else {
      audio.pause();
      setPlaying(false);
    }
  }

  function seek(next: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration || audio.duration || 0, next));
    setCurrentTime(audio.currentTime);
  }

  function syncAudioDuration(audio: HTMLAudioElement) {
    const nextDuration = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : item.duration || 0;
    if (nextDuration > 0 && Math.abs(nextDuration - duration) > 0.05) {
      setDuration(nextDuration);
    }
  }

  return (
    <div className="grid min-h-16 grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,0.8fr)_minmax(280px,1.2fr)_44px]">
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
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{item.text}</p>
        <p className={cn("mt-1 truncate text-xs", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>{item.profileName} · {relativeTime(item.createdAt)}</p>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-center gap-4">
          <button type="button" onClick={() => seek(currentTime - 10)} className={cn("grid h-11 w-11 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", dark ? "hover:bg-white/8" : "hover:bg-[#1A1A1A]/5")} aria-label="Back 10 seconds">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" onClick={togglePlay} className="grid h-11 w-11 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <button type="button" onClick={() => seek(currentTime + 10)} className={cn("grid h-11 w-11 place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", dark ? "hover:bg-white/8" : "hover:bg-[#1A1A1A]/5")} aria-label="Forward 10 seconds">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <span className={cn("font-mono text-xs font-semibold", dark ? "text-white/46" : "text-[#1A1A1A]/45")}>{formatClock(currentTime)}</span>
          <PlayerScrubBar dark={dark} currentTime={currentTime} duration={duration} disabled={!item.audioUrl || !duration} onSeek={seek} />
          <span className={cn("text-right font-mono text-xs font-semibold", dark ? "text-white/46" : "text-[#1A1A1A]/45")}>{formatClock(duration)}</span>
        </div>
      </div>
      {item.audioUrl ? <a href={item.audioUrl} download className={cn("grid h-11 w-11 place-items-center justify-self-end rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", dark ? "border-white/12 hover:bg-white/8" : "border-[#1A1A1A]/10 bg-white hover:border-[#1A1A1A]/20")} aria-label="Download audio"><Download className="h-4 w-4" /></a> : <span />}
    </div>
  );
}

function PlayerScrubBar({ dark, currentTime, duration, disabled, onSeek }: { dark: boolean; currentTime: number; duration: number; disabled?: boolean; onSeek: (seconds: number) => void }) {
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
      <span
        className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded-full", dark ? "bg-white/18" : "bg-[#1A1A1A]/12")}
        style={{ left: thumbRadius, right: thumbRadius }}
      >
        <span className="absolute left-0 top-0 h-full rounded-full bg-[#f9dc0b]" style={{ width: `${pct}%` }} />
        <span className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#f9dc0b] shadow-sm" style={{ left: `${pct}%` }} />
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

function languageName(code: string) {
  return LANGUAGES.find(([id]) => id === code)?.[1] || code.toUpperCase();
}

function voiceAvatarClass(index: number) {
  const styles = [
    "bg-[#f9dc0b] text-[#1A1A1A]",
    "bg-[#1A1A1A] text-white",
    "bg-[#E8E3D8] text-[#1A1A1A]",
    "bg-[#fff6b8] text-[#1A1A1A]",
  ];
  return styles[index % styles.length];
}

function voicePreviewText(voice: VoiceProfile) {
  const descriptor = `${voice.name} ${voice.description || ""}`.toLowerCase();
  if (/(upbeat|clear|energy|momentum|fast|social)/i.test(descriptor)) return "Here is a crisp AutoYT preview with bright energy and a clean hook.";
  if (/(warm|story|friendly|casual)/i.test(descriptor)) return "This voice tells the story with calm warmth and steady creator confidence.";
  if (/(dark|suspense|dramatic|deep|intense)/i.test(descriptor)) return "A quiet twist arrives, and the whole scene suddenly feels dangerous.";
  return "This is a short AutoYT voice preview for your next faceless video.";
}

function VoicesLibraryTab({
  dark,
  voices,
  savedVoiceIds,
  selectedVoiceId,
  onUseVoice,
  onSaveVoice,
  onRemoveVoice,
  onDeleteVoice,
  onRenameVoice,
  onCreateVoice,
}: {
  dark: boolean;
  voices: VoiceProfile[];
  savedVoiceIds: string[];
  selectedVoiceId: string;
  onUseVoice: (id: string) => void;
  onSaveVoice: (id: string) => void;
  onRemoveVoice: (id: string) => void;
  onDeleteVoice: (id: string) => Promise<void>;
  onRenameVoice: (id: string, name: string) => Promise<void>;
  onCreateVoice: () => void;
}) {
  const [libraryTab, setLibraryTab] = useState<VoiceLibraryTab>("explore");
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Generation | null>(null);
  const [previewAutoplayId, setPreviewAutoplayId] = useState("");
  const [previewLoadingId, setPreviewLoadingId] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewCache, setPreviewCache] = useState<Record<string, Generation>>({});
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const savedSet = new Set(savedVoiceIds);
  const sourceVoices = libraryTab === "mine" ? voices.filter((voice) => savedSet.has(voice.id)) : voices;
  const filteredVoices = sourceVoices.filter((voice) => {
    const q = query.trim().toLowerCase();
    return !q || `${voice.name} ${voice.description} ${languageName(voice.language)}`.toLowerCase().includes(q);
  });

  async function previewVoice(voice: VoiceProfile) {
    if (!voice.id || previewLoadingId) return;
    if (!isVoiceReady(voice)) {
      setPreviewError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
      return;
    }
    if (previewCache[voice.id]) {
      setPreview(previewCache[voice.id]);
      setPreviewAutoplayId(previewCache[voice.id].id);
      return;
    }
    setPreviewLoadingId(voice.id);
    setPreviewError("");
    try {
      const response = await fetch("/api/voicebox/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId: voice.id,
          text: voicePreviewText(voice),
          language: voice.language || "en",
          engine: voice.defaultEngine || "kokoro",
          waitForCompletion: true,
        }),
      });
      const data = await readJson(response, "Voice preview failed");
      const generation = data.generation || {};
      const item: Generation = {
        id: String(generation.id || `preview-${voice.id}-${Date.now()}`),
        profileName: voice.name,
        text: voice.name,
        language: voice.language || "en",
        duration: generation.duration || 6,
        audioUrl: data.audioUrl,
        createdAt: new Date().toISOString(),
      };
      setPreviewCache((current) => ({ ...current, [voice.id]: item }));
      setPreview(item);
      setPreviewAutoplayId(item.id);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : "Voice preview failed");
    } finally {
      setPreviewLoadingId("");
    }
  }

  async function commitRename(voiceId: string) {
    const next = renameDraft.trim();
    if (!voiceId || !next) {
      setRenamingId("");
      return;
    }
    await onRenameVoice(voiceId, next);
    setPreviewCache((current) => {
      const cached = current[voiceId];
      if (!cached) return current;
      return { ...current, [voiceId]: { ...cached, profileName: next, text: next } };
    });
    setPreview((current) => current && current.id === previewCache[voiceId]?.id ? { ...current, profileName: next, text: next } : current);
    setRenamingId("");
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden p-4 sm:p-6", dark ? "bg-[#151515]" : "bg-[#F9F8F6]")}>
      <div className={cn("flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-center sm:justify-between", dark ? "border-white/10" : "border-[#1A1A1A]/8")}>
        <h2 className="font-serif text-2xl font-bold tracking-tight">Voice library</h2>
        <button type="button" onClick={onCreateVoice} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70">
          <Plus className="h-4 w-4" />
          Create voice
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className={cn("inline-flex shrink-0 rounded-lg border p-0.5", dark ? "border-white/10 bg-[#1C1C1C]" : "border-[#1A1A1A]/8 bg-[#F9F8F6]")}>
            {(["explore", "mine"] as VoiceLibraryTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLibraryTab(tab)}
                aria-pressed={libraryTab === tab}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70",
                  libraryTab === tab
                    ? dark ? "bg-white text-[#1A1A1A]" : "bg-white text-[#1A1A1A] shadow-sm"
                    : dark ? "text-white/50 hover:text-white" : "text-[#1A1A1A]/45 hover:text-[#1A1A1A]",
                )}
              >
                {tab === "explore" ? "Explore" : `Saved ${savedVoiceIds.length}`}
              </button>
            ))}
          </div>

          <label className="relative block min-w-0 flex-1">
            <Search className={cn("pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", dark ? "text-white/38" : "text-[#1A1A1A]/35")} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search voices"
              aria-label="Search voices"
              className={cn("h-11 w-full rounded-lg border pl-9 pr-4 text-sm font-medium outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#1C1C1C] text-white placeholder:text-white/35" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A] placeholder:text-[#1A1A1A]/38")}
            />
          </label>
          <p className={cn("shrink-0 text-xs tabular-nums", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>{filteredVoices.length} {filteredVoices.length === 1 ? "voice" : "voices"}</p>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            {previewError ? <div role="alert" className={cn("mb-3 rounded-lg border px-3 py-2 text-sm", dark ? "border-white/10 bg-white/8 text-white" : "border-[#f9dc0b]/40 bg-[#fff9d6] text-[#5F5300]")}>{previewError}</div> : null}
            {filteredVoices.length ? (
              <div className="space-y-2">
                {filteredVoices.map((voice, index) => {
                  const saved = savedSet.has(voice.id);
                  const selected = selectedVoiceId === voice.id;
                  const ready = isVoiceReady(voice);
                  const canDelete = voice.voiceType === "cloned" && !ready;
                  const voiceType = voice.voiceType === "cloned" ? "Cloned voice" : "Preset voice";
                  const sampleDetail = voice.voiceType === "cloned" ? voice.sampleCount ? `${voice.sampleCount} ${voice.sampleCount === 1 ? "sample" : "samples"}` : "Sample required" : "Ready";
                  return (
                    <article
                      key={voice.id}
                      className={cn(
                        "grid gap-3 rounded-xl border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                        selected
                          ? dark ? "border-[#f9dc0b]/60 bg-white/8" : "border-[#f9dc0b]/70 bg-[#fffbea]"
                          : dark ? "border-white/8 bg-[#1C1C1C]" : "border-[#1A1A1A]/8 bg-white",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full text-xs font-black", voiceAvatarClass(index))} aria-hidden>
                          {initials(voice.name)}
                        </span>
                        <div className="min-w-0">
                          {renamingId === voice.id ? (
                            <input
                              value={renameDraft}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  void commitRename(voice.id);
                                }
                                if (event.key === "Escape") setRenamingId("");
                              }}
                              onBlur={() => void commitRename(voice.id)}
                              className={cn("h-10 w-full rounded-lg border px-2 text-sm font-semibold outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#151515] text-white" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]")}
                              aria-label={`Rename ${voice.name}`}
                              autoFocus
                            />
                          ) : (
                            <p className="truncate text-sm font-semibold">{voice.name}</p>
                          )}
                          <p className={cn("mt-0.5 truncate text-sm", dark ? "text-white/52" : "text-[#1A1A1A]/55")}>{voice.description || "Reusable voice profile"}</p>
                          <p className={cn("mt-1 truncate text-xs", ready ? dark ? "text-white/38" : "text-[#1A1A1A]/40" : "text-[#8a7600]")}>{languageName(voice.language)} · {voiceType} · {sampleDetail}</p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void previewVoice(voice)}
                          disabled={!!previewLoadingId || !ready}
                          className={cn("grid h-11 w-11 place-items-center rounded-lg border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 disabled:cursor-not-allowed disabled:opacity-45", dark ? "border-white/10 hover:bg-white/8" : "border-[#1A1A1A]/10 bg-white hover:border-[#1A1A1A]/20")}
                          aria-label={`Preview ${voice.name}`}
                        >
                          {previewLoadingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (ready) onUseVoice(voice.id);
                            else setPreviewError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
                          }}
                          disabled={!ready}
                          className="h-11 rounded-lg bg-[#f9dc0b] px-3 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Use
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (canDelete) {
                              if (!window.confirm(`Delete “${voice.name}”? This cannot be undone.`)) return;
                              setDeletingId(voice.id);
                              void onDeleteVoice(voice.id).finally(() => setDeletingId(""));
                              return;
                            }
                            saved ? onRemoveVoice(voice.id) : onSaveVoice(voice.id);
                          }}
                          className={cn(
                            "grid h-11 w-11 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70",
                            canDelete
                              ? dark ? "text-[#f9dc0b] hover:bg-white/10" : "text-[#5F5300] hover:bg-[#fff9d6]"
                              : saved ? "bg-[#f9dc0b] text-[#1A1A1A]" : dark ? "text-white/70 hover:bg-white/10" : "text-[#1A1A1A] hover:bg-[#1A1A1A]/5",
                          )}
                          aria-label={canDelete ? `Delete ${voice.name}` : saved ? `Remove ${voice.name} from saved voices` : `Save ${voice.name}`}
                        >
                          {deletingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : canDelete ? <Trash2 className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(voice.id);
                            setRenameDraft(voice.name);
                          }}
                          className={cn("grid h-11 w-11 place-items-center rounded-lg transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70", dark ? "text-white/54 hover:bg-white/10" : "text-[#1A1A1A]/50 hover:bg-[#1A1A1A]/5")}
                          aria-label={`Rename ${voice.name}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={cn("grid min-h-[260px] place-items-center rounded-xl border border-dashed px-6 text-center", dark ? "border-white/10 text-white/48" : "border-[#1A1A1A]/12 text-[#1A1A1A]/45")}>
                <div>
                  <BookOpen className="mx-auto h-8 w-8" />
                  <p className="mt-3 text-sm">{libraryTab === "mine" ? "No saved voices yet." : "No matching voices found."}</p>
                </div>
              </div>
            )}
        </div>
      </div>
      {preview ? (
        <div className={cn("sticky bottom-0 z-10 -mx-4 mt-4 border-t px-4 py-3 sm:-mx-6 sm:px-6", dark ? "border-white/10 bg-[#151515]" : "border-[#1A1A1A]/8 bg-white")}>
          <GenerationPlayer item={preview} dark={dark} autoplay={previewAutoplayId === preview.id} onAutoplayConsumed={() => setPreviewAutoplayId("")} />
        </div>
      ) : null}
    </div>
  );
}

function CloneTab(props: {
  dark: boolean;
  cloneVoice: (event: FormEvent) => Promise<void>;
  cloneFile: File | null;
  setCloneFile: (file: File | null) => void;
  cloneName: string;
  setCloneName: (value: string) => void;
  cloneDescription: string;
  setCloneDescription: (value: string) => void;
  cloneConsent: boolean;
  setCloneConsent: (value: boolean) => void;
  cloneDragActive: boolean;
  setCloneDragActive: (value: boolean) => void;
  cloning: boolean;
  language: string;
  setLanguage: (value: string) => void;
}) {
  const dark = props.dark;
  function acceptDroppedFile(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    props.setCloneDragActive(false);
    const file = Array.from(event.dataTransfer.files || []).find((item) => item.type.startsWith("audio/"));
    if (file) props.setCloneFile(file);
  }

  return (
    <form onSubmit={(event) => void props.cloneVoice(event)} className={cn("min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8", dark ? "bg-[#151515]" : "bg-[#F9F8F6]")}>
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div>
            <h2 className="font-serif text-xl font-bold">Voice sample</h2>
            <p className={cn("mt-2 max-w-lg text-sm leading-6", dark ? "text-white/55" : "text-[#1A1A1A]/55")}>Upload a clear 10–30 second recording with one speaker and little background noise.</p>
          </div>
          <label
            onDragOver={(event) => { event.preventDefault(); props.setCloneDragActive(true); }}
            onDragLeave={() => props.setCloneDragActive(false)}
            onDrop={acceptDroppedFile}
            className={cn(
              "grid min-h-[280px] cursor-pointer place-items-center rounded-xl border border-dashed p-5 text-center transition focus-within:border-[#f9dc0b] focus-within:ring-2 focus-within:ring-[#f9dc0b]/20",
              props.cloneDragActive
                ? "border-[#f9dc0b] bg-[#f9dc0b]/12"
                : dark ? "border-white/16 bg-[#1C1C1C] hover:border-[#f9dc0b]/70" : "border-[#1A1A1A]/14 bg-white hover:border-[#f9dc0b]",
            )}
          >
            <input type="file" accept="audio/*" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => props.setCloneFile(event.target.files?.[0] || null)} />
            <span>
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A]"><Upload className="h-6 w-6" /></span>
              <span className="mt-4 block text-base font-bold">{props.cloneFile ? props.cloneFile.name : props.cloneDragActive ? "Drop the sample here" : "Upload or drop a voice sample"}</span>
              <span className={cn("mt-1 block text-sm", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>WAV, MP3, M4A, or FLAC</span>
            </span>
          </label>
        </div>
        <div className={cn("space-y-4 rounded-xl border p-4 sm:p-5", dark ? "border-white/10 bg-[#1C1C1C]" : "border-[#1A1A1A]/8 bg-white")}>
          <Field label="Name" value={props.cloneName} onChange={props.setCloneName} dark={dark} placeholder="Anime recap narrator" />
          <label className="block">
            <span className={cn("mb-1.5 block text-[11px] font-bold uppercase tracking-widest", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>Description</span>
            <textarea value={props.cloneDescription} onChange={(event) => props.setCloneDescription(event.target.value)} className={cn("min-h-[116px] w-full rounded-lg border p-3 text-sm font-medium outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#151515] text-white placeholder:text-white/28" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A] placeholder:text-[#1A1A1A]/35")} placeholder="Tone, use case, recording notes" />
          </label>
          <Select label="Language" value={props.language} onChange={props.setLanguage} options={LANGUAGES} dark={dark} />
          <label className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm leading-6", dark ? "border-white/10 bg-white/[0.035]" : "border-[#1A1A1A]/8 bg-[#FDFCFA]")}>
            <input type="checkbox" checked={props.cloneConsent} onChange={(event) => props.setCloneConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-[#f9dc0b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70" />
            I own this voice or have explicit permission to create a reusable voice profile from this sample.
          </label>
          <button type="submit" disabled={props.cloning} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] shadow-sm transition hover:bg-[#1A1A1A] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70 disabled:opacity-50">
            {props.cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            Create profile
          </button>
        </div>
      </div>
    </form>
  );
}

function Select({ label, value, onChange, options, dark, compact = false }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; dark: boolean; compact?: boolean }) {
  return (
    <label className="block">
      <span className={cn("mb-1.5 block text-[11px] font-bold uppercase tracking-widest", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cn("h-11 w-full rounded-lg border px-3 text-sm font-semibold outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#151515] text-white" : compact ? "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A]" : "border-[#1A1A1A]/10 bg-white text-[#1A1A1A]")}>
        {options.map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, dark, placeholder }: { label: string; value: string; onChange: (value: string) => void; dark: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className={cn("mb-1.5 block text-[11px] font-bold uppercase tracking-widest", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={cn("h-11 w-full rounded-lg border px-3 text-sm font-semibold outline-none transition focus:border-[#f9dc0b] focus:ring-2 focus:ring-[#f9dc0b]/20", dark ? "border-white/10 bg-[#151515] text-white placeholder:text-white/28" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A] placeholder:text-[#1A1A1A]/35")} />
    </label>
  );
}

function Status({ tone, dark, message, onClose }: { tone: "success" | "error"; dark: boolean; message: string; onClose: () => void }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} aria-live="polite" className={cn("flex items-center gap-3 border-b px-4 py-2 text-sm", tone === "success" ? "border-[#f9dc0b]/40 bg-[#fffbea] text-[#1A1A1A]" : dark ? "border-white/14 bg-white/8 text-white" : "border-[#f9dc0b]/40 bg-[#fffbea] text-[#5F5300]")}>
      {tone === "success" ? <Check className="h-4 w-4 text-[#f9dc0b]" /> : <FileAudio className="h-4 w-4 text-[#f9dc0b]" />}
      <span className="flex-1">{message}</span>
      <button type="button" onClick={onClose} className="grid h-11 w-11 place-items-center rounded-lg transition hover:bg-[#1A1A1A]/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#f9dc0b]/70" aria-label="Dismiss message"><X className="h-4 w-4" /></button>
    </div>
  );
}
