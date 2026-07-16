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
  RotateCcw,
  Plus,
  RefreshCw,
  Search,
  Share2,
  SkipBack,
  SkipForward,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
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

const PROMPT_CHIPS = [
  "Narrate a story",
  "Tell a silly joke",
  "Record an advertisement",
  "Speak in different languages",
  "Direct a dramatic movie scene",
  "Hear from a video game character",
  "Introduce your podcast",
  "Guide a meditation class",
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
  const [engine, setEngine] = useState("kokoro");
  const [speed, setSpeed] = useState(60);
  const [stability, setStability] = useState(50);
  const [similarity, setSimilarity] = useState(74);
  const [styleExaggeration, setStyleExaggeration] = useState(0);
  const [speakerBoost, setSpeakerBoost] = useState(true);
  const [outputFormat, setOutputFormat] = useState("mp3-44100");
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

  const shellClass = cn(
    "rounded-[24px] border p-3 shadow-sm sm:p-4 lg:p-5",
    dark ? "border-white/10 bg-[#0C1018] text-white" : "border-[#1A1A1A]/8 bg-white text-[#1A1A1A]",
  );

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
      setError(err instanceof Error ? err.message : "Voicebox is not reachable");
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
          engine: selectedVoice.defaultEngine || engine,
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
    await fetch(`/api/voicebox/profiles/${encodeURIComponent(voiceId)}`, { method: "DELETE" }).catch(() => null);
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
    <section className={cn("workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden", dark ? "bg-[#0B0E14] text-white" : "bg-white text-[#111827]")}>
      <header className="workspace-floating-header flex min-h-12 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Volume2 className={cn("h-4 w-4", dark ? "text-white/70" : "text-[#6B7280]")} />
          <h1 className="text-sm font-semibold tracking-tight">Text to Speech</h1>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          {STUDIO_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold transition",
                activeTab === id
                  ? dark ? "bg-white text-[#111827]" : "bg-[#111827] text-white"
                  : dark ? "text-white/62 hover:bg-white/8 hover:text-white" : "text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#111827]",
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
          <button onClick={() => void loadProfiles()} className={cn("inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold transition", dark ? "border-white/12 hover:bg-white/8" : "border-[#E5E7EB] hover:bg-[#F3F4F6]")}>
            {loadingVoices ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>
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
          speed={speed}
          setSpeed={setSpeed}
          stability={stability}
          setStability={setStability}
          similarity={similarity}
          setSimilarity={setSimilarity}
          styleExaggeration={styleExaggeration}
          setStyleExaggeration={setStyleExaggeration}
          speakerBoost={speakerBoost}
          setSpeakerBoost={setSpeakerBoost}
          outputFormat={outputFormat}
          setOutputFormat={setOutputFormat}
          generating={generating}
          generateSpeech={generateSpeech}
          openVoices={() => setActiveTab("voices")}
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
          shellClass={shellClass}
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
          language={language}
          setLanguage={setLanguage}
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
  speed: number;
  setSpeed: (value: number) => void;
  stability: number;
  setStability: (value: number) => void;
  similarity: number;
  setSimilarity: (value: number) => void;
  styleExaggeration: number;
  setStyleExaggeration: (value: number) => void;
  speakerBoost: boolean;
  setSpeakerBoost: (value: boolean) => void;
  outputFormat: string;
  setOutputFormat: (value: string) => void;
  generating: boolean;
  generateSpeech: (event?: FormEvent) => Promise<void>;
  openVoices: () => void;
  history: Generation[];
  selectedGenerationId: string;
  setSelectedGenerationId: (id: string) => void;
  autoplayGenerationId: string;
  clearAutoplayGeneration: () => void;
}) {
  const { dark, voices, selectedVoiceId } = props;
  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) || voices[0];
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>("settings");
  const [historySearch, setHistorySearch] = useState("");
  const selectedGeneration = props.history.find((item) => item.id === props.selectedGenerationId) || props.history[0];
  const historyItems = props.history.filter((item) => {
    const query = historySearch.trim().toLowerCase();
    return !query || item.text.toLowerCase().includes(query) || item.profileName.toLowerCase().includes(query);
  });
  return (
    <form onSubmit={(event) => void props.generateSpeech(event)} className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className={cn("flex min-h-0 flex-col border-b p-6 lg:border-b-0 lg:border-r lg:p-10", dark ? "border-white/10 bg-[#0B0E14]" : "border-[#E5E7EB] bg-white")}>
          <textarea
            value={props.text}
            onChange={(event) => props.setText(event.target.value)}
            placeholder="Start typing here or paste any text you want to turn into lifelike speech..."
            className={cn("min-h-[260px] flex-1 resize-none border-0 bg-transparent text-[18px] font-medium leading-8 outline-none placeholder:text-[#6B7280] sm:text-xl", dark ? "text-white placeholder:text-white/44" : "text-[#111827]")}
            maxLength={5000}
          />

          {!props.text.trim() ? (
            <div className="mt-6">
              <p className={cn("mb-3 text-sm font-medium", dark ? "text-white/58" : "text-[#6B7280]")}>Get started with</p>
              <div className="flex flex-wrap gap-2">
                {PROMPT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => props.setText(chip === "Direct a dramatic movie scene" ? "Direct a dramatic movie scene where the hero realizes the weakest skill is actually his biggest advantage." : chip)}
                    className={cn("inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition", dark ? "border-white/12 text-white/82 hover:bg-white/8" : "border-[#DADDE3] text-[#111827] hover:bg-[#F3F4F6]")}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className={cn("mt-6 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between", dark ? "border-white/10" : "border-[#E5E7EB]")}>
            <div className={cn("text-sm font-medium", dark ? "text-white/54" : "text-[#6B7280]")}>
              {props.online ? `${voices.length} voices ready` : "Voicebox offline"}
              <span className="mx-2">/</span>
              {props.text.length} / 5,000
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={props.openVoices} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold transition", dark ? "border-white/12 hover:bg-white/8" : "border-[#DADDE3] hover:bg-[#F3F4F6]")}>
                <BookOpen className="h-4 w-4" />
                Voices library
              </button>
              <button type="submit" disabled={props.generating || !props.text.trim() || !props.online} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-bold transition disabled:opacity-50", dark ? "bg-[#f9dc0b] text-[#111827] hover:bg-white" : "bg-[#111827] text-white hover:bg-[#f9dc0b] hover:text-[#111827]")}>
                {props.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {selectedGeneration ? "Regenerate speech" : "Generate speech"}
              </button>
            </div>
          </div>
        </div>

        <aside className={cn("min-h-0 overflow-y-auto px-5 py-4", dark ? "bg-[#10141D]" : "bg-[#FAFAFB]")}>
          <div className={cn("mb-5 flex gap-4 border-b", dark ? "border-white/10" : "border-[#E5E7EB]")}>
            {(["settings", "history"] as RightRailTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setRightRailTab(tab)}
                className={cn(
                  "border-b py-2 text-sm font-semibold capitalize transition",
                  rightRailTab === tab
                    ? dark ? "border-white text-white" : "border-[#111827] text-[#111827]"
                    : dark ? "border-transparent text-white/52 hover:text-white" : "border-transparent text-[#6B7280] hover:text-[#111827]",
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          {rightRailTab === "settings" ? (
            <div className="space-y-5">
              <div className={cn("border-b pb-3", dark ? "border-white/10" : "border-[#E5E7EB]")}>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold underline decoration-dotted underline-offset-4">Voice</p>
                  <span className={cn("grid h-7 w-7 place-items-center rounded-full text-[11px] font-black", dark ? "bg-[#f9dc0b] text-[#111827]" : "bg-[#111827] text-white")}>{initials(selectedVoice?.name || "V")}</span>
                </div>
                <div className="relative">
                  <select
                    value={selectedVoiceId}
                    onChange={(event) => {
                      const voice = voices.find((item) => item.id === event.target.value);
                      props.setSelectedVoiceId(event.target.value);
                      if (voice?.defaultEngine) props.setEngine(voice.defaultEngine);
                    }}
                    className={cn("h-10 w-full appearance-none rounded-lg border px-3 pr-9 text-sm font-semibold outline-none", dark ? "border-white/10 bg-[#0B0E14] text-white" : "border-[#DADDE3] bg-white text-[#111827]")}
                  >
                    {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                  </select>
                  <ChevronDown className={cn("pointer-events-none absolute right-3 top-3 h-4 w-4", dark ? "text-white/50" : "text-[#6B7280]")} />
                </div>
                <div className="mt-2">
                  <Select label="Engine" value={props.engine} onChange={props.setEngine} options={ENGINES} dark={dark} compact />
                </div>
              </div>

              <SliderControl dark={dark} label="Speed" left="Slower" right="Faster" value={props.speed} onChange={props.setSpeed} />
              <SliderControl dark={dark} label="Stability" left="More variable" right="More stable" value={props.stability} onChange={props.setStability} />
              <SliderControl dark={dark} label="Similarity" left="Low" right="High" value={props.similarity} onChange={props.setSimilarity} />
              <SliderControl dark={dark} label="Style Exaggeration" left="None" right="Exaggerated" value={props.styleExaggeration} onChange={props.setStyleExaggeration} />
              <ToggleControl dark={dark} label="Language Override" value={false} disabled />
              <Select label="Language" value={props.language} onChange={props.setLanguage} options={LANGUAGES} dark={dark} compact />
              <Select label="Output Format" value={props.outputFormat} onChange={props.setOutputFormat} options={[["mp3-44100", "MP3 44.1 kHz (128kbps)"], ["wav-44100", "WAV 44.1 kHz"], ["wav-16000", "WAV 16 kHz"]]} dark={dark} compact />
              <div className="flex flex-wrap items-center justify-between gap-4">
                <ToggleControl dark={dark} label="Speaker boost" value={props.speakerBoost} onChange={props.setSpeakerBoost} />
                <button type="button" onClick={() => {
                  props.setSpeed(60);
                  props.setStability(50);
                  props.setSimilarity(74);
                  props.setStyleExaggeration(0);
                  props.setSpeakerBoost(true);
                }} className={cn("inline-flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-semibold", dark ? "text-white/70 hover:bg-white/8" : "text-[#374151] hover:bg-[#F3F4F6]")}>
                  <RotateCcw className="h-4 w-4" />
                  Reset values
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <label className="relative block">
                <Search className={cn("pointer-events-none absolute left-3 top-3 h-4 w-4", dark ? "text-white/38" : "text-[#6B7280]")} />
                <input
                  value={historySearch}
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Search history..."
                  className={cn("h-10 w-full rounded-lg border pl-9 pr-3 text-sm font-medium outline-none", dark ? "border-white/10 bg-[#0B0E14] text-white placeholder:text-white/35" : "border-[#DADDE3] bg-white text-[#111827] placeholder:text-[#6B7280]")}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {["Voice", "Model", "Date"].map((filter) => (
                  <button key={filter} type="button" className={cn("h-7 rounded-lg border px-2 text-xs font-semibold", dark ? "border-white/10 text-white/70" : "border-[#DADDE3] text-[#111827]")}>+ {filter}</button>
                ))}
              </div>
              <div className="pt-2 text-center">
                <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", dark ? "bg-white/8 text-white/60" : "bg-[#F3F4F6] text-[#374151]")}>Today</span>
              </div>
              <div className="space-y-2">
                {historyItems.length ? historyItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      props.setSelectedGenerationId(item.id);
                    }}
                    className={cn(
                      "w-full rounded-xl px-3 py-3 text-left transition",
                      props.selectedGenerationId === item.id
                        ? dark ? "bg-white/10" : "bg-[#F3F4F6]"
                        : dark ? "hover:bg-white/[0.05]" : "hover:bg-[#F7F7F8]",
                    )}
                  >
                    <p className="truncate text-sm font-semibold">{item.text}</p>
                    <p className={cn("mt-1 truncate text-xs font-medium", dark ? "text-white/45" : "text-[#6B7280]")}>{item.profileName} - {relativeTime(item.createdAt)}</p>
                  </button>
                )) : (
                  <p className={cn("rounded-xl border border-dashed px-4 py-8 text-center text-sm font-medium", dark ? "border-white/10 text-white/45" : "border-[#DADDE3] text-[#6B7280]")}>Generated speech history will appear here.</p>
                )}
              </div>
            </div>
          )}
        </aside>
      </div>

      <div className={cn("sticky bottom-0 z-10 border-t px-4 py-3", dark ? "border-white/10 bg-[#0B0E14]" : "border-[#E5E7EB] bg-white")}>
        {selectedGeneration ? (
          <GenerationPlayer item={selectedGeneration} dark={dark} autoplay={props.autoplayGenerationId === selectedGeneration.id} onAutoplayConsumed={props.clearAutoplayGeneration} />
        ) : (
          <EmptyPlayer dark={dark} selectedVoice={selectedVoice} />
        )}
      </div>
    </form>
  );
}

function SliderControl({ dark, label, left, right, value, onChange }: { dark: boolean; label: string; left: string; right: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold underline decoration-dotted underline-offset-4">{label}</span>
      <span className={cn("mt-1.5 flex items-center justify-between text-xs font-medium", dark ? "text-white/48" : "text-[#6B7280]")}>
        <span>{left}</span>
        <span>{right}</span>
      </span>
      <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} className={cn("mt-0.5 h-1.5 w-full", dark ? "accent-[#f9dc0b]" : "accent-[#111827]")} />
    </label>
  );
}

function ToggleControl({ dark, label, value, onChange, disabled = false }: { dark: boolean; label: string; value: boolean; onChange?: (value: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={() => onChange?.(!value)} className={cn("inline-flex items-center gap-3 text-sm font-semibold", disabled ? "opacity-50" : "")}>
      <span className={cn("relative h-6 w-11 rounded-full transition", value ? dark ? "bg-[#f9dc0b]" : "bg-[#111827]" : dark ? "bg-white/14" : "bg-[#E5E7EB]")}>
        <span className={cn("absolute top-1 h-4 w-4 rounded-full bg-white transition", value ? "left-6" : "left-1")} />
      </span>
      <span className={cn("underline decoration-dotted underline-offset-4", dark ? "text-white" : "text-[#111827]")}>{label}</span>
    </button>
  );
}

function EmptyPlayer({ dark, selectedVoice }: { dark: boolean; selectedVoice?: VoiceProfile }) {
  return (
    <div className="grid min-h-16 grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,520px)_minmax(180px,1fr)]">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">Ready</p>
        <p className={cn("mt-1 truncate text-xs font-medium", dark ? "text-white/50" : "text-[#6B7280]")}>{selectedVoice?.name || "Select a voice"}</p>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-center gap-4">
          <SkipBack className={cn("h-4 w-4", dark ? "text-white/45" : "text-[#6B7280]")} />
          <button type="button" className={cn("grid h-11 w-11 place-items-center rounded-full", dark ? "bg-white text-[#111827]" : "bg-[#111827] text-white")}>
            <Play className="h-5 w-5 fill-current" />
          </button>
          <SkipForward className={cn("h-4 w-4", dark ? "text-white/45" : "text-[#6B7280]")} />
        </div>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <span className={cn("font-mono text-xs font-semibold", dark ? "text-white/46" : "text-[#6B7280]")}>0:00</span>
          <PlayerScrubBar dark={dark} currentTime={0} duration={0} disabled onSeek={() => undefined} />
          <span className={cn("text-right font-mono text-xs font-semibold", dark ? "text-white/46" : "text-[#6B7280]")}>0:00</span>
        </div>
      </div>
      <div aria-hidden="true" />
    </div>
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
    <div className="grid min-h-16 grid-cols-1 items-center gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(360px,540px)_minmax(220px,1fr)]">
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
        <p className={cn("mt-1 truncate text-xs font-medium", dark ? "text-white/50" : "text-[#6B7280]")}>{item.profileName} - {relativeTime(item.createdAt)}</p>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-center gap-4">
          <button type="button" onClick={() => seek(currentTime - 10)} className={cn("grid h-8 w-8 place-items-center rounded-full", dark ? "hover:bg-white/8" : "hover:bg-[#F3F4F6]")} aria-label="Back 10 seconds">
            <SkipBack className="h-4 w-4" />
          </button>
          <button type="button" onClick={togglePlay} className={cn("grid h-11 w-11 place-items-center rounded-full", dark ? "bg-white text-[#111827]" : "bg-[#111827] text-white")} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>
          <button type="button" onClick={() => seek(currentTime + 10)} className={cn("grid h-8 w-8 place-items-center rounded-full", dark ? "hover:bg-white/8" : "hover:bg-[#F3F4F6]")} aria-label="Forward 10 seconds">
            <SkipForward className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <span className={cn("font-mono text-xs font-semibold", dark ? "text-white/46" : "text-[#6B7280]")}>{formatClock(currentTime)}</span>
          <PlayerScrubBar dark={dark} currentTime={currentTime} duration={duration} disabled={!item.audioUrl || !duration} onSeek={seek} />
          <span className={cn("text-right font-mono text-xs font-semibold", dark ? "text-white/46" : "text-[#6B7280]")}>{formatClock(duration)}</span>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className={cn("grid h-9 w-9 place-items-center rounded-lg", dark ? "hover:bg-white/8" : "hover:bg-[#F3F4F6]")} aria-label="Like"><ThumbsUp className="h-4 w-4" /></button>
        <button type="button" className={cn("grid h-9 w-9 place-items-center rounded-lg", dark ? "hover:bg-white/8" : "hover:bg-[#F3F4F6]")} aria-label="Dislike"><ThumbsDown className="h-4 w-4" /></button>
        <button type="button" className={cn("inline-flex h-10 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-semibold", dark ? "border-white/12 hover:bg-white/8" : "border-[#DADDE3] hover:bg-[#F3F4F6]")}><Share2 className="h-4 w-4" />Share</button>
        {item.audioUrl ? <a href={item.audioUrl} className={cn("grid h-10 w-10 place-items-center rounded-lg", dark ? "hover:bg-white/8" : "hover:bg-[#F3F4F6]")} aria-label="Download"><Download className="h-4 w-4" /></a> : null}
        <ChevronDown className={cn("h-4 w-4", dark ? "text-white/55" : "text-[#111827]")} />
      </div>
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
        className={cn("absolute top-1/2 h-1 -translate-y-1/2 rounded-full", dark ? "bg-white/18" : "bg-[#D1D5DB]")}
        style={{ left: thumbRadius, right: thumbRadius }}
      >
        <span className={cn("absolute left-0 top-0 h-full rounded-full", dark ? "bg-white" : "bg-[#111827]")} style={{ width: `${pct}%` }} />
        <span className={cn("absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm", dark ? "bg-white" : "bg-[#111827]")} style={{ left: `${pct}%` }} />
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
    "from-yellow-200 via-[#f9dc0b] to-lime-500",
    "from-[#fff9d6] via-[#f9dc0b] to-[#b69300]",
    "from-lime-200 via-[#f9dc0b] to-[#1A1A1A]",
    "from-[#F9F8F6] via-[#f9dc0b] to-lime-600",
    "from-yellow-100 via-lime-300 to-[#f9dc0b]",
  ];
  return styles[index % styles.length];
}

function voiceStat(index: number, small = false) {
  const values = small ? ["5.4K", "9.8K", "18K", "42K", "86K"] : ["1M", "805.4K", "3.2M", "216K", "592K"];
  return values[index % values.length];
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
    <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden px-5 py-5 sm:px-7", dark ? "bg-[#0B0E14]" : "bg-white")}>
      <div className="flex flex-col gap-4 border-b pb-4 sm:flex-row sm:items-end sm:justify-between" style={{ borderColor: dark ? "rgba(255,255,255,.1)" : "#E5E7EB" }}>
        <div>
          <div className={cn("mb-2 flex items-center gap-2 text-sm font-semibold", dark ? "text-white/58" : "text-[#6B7280]")}>
            <BookOpen className="h-4 w-4" />
            Voices
            <ChevronDown className="h-3.5 w-3.5" />
            {libraryTab === "mine" ? "My Voices" : "Explore"}
          </div>
          <h2 className="text-2xl font-black tracking-tight">Voices</h2>
        </div>
        <button type="button" onClick={onCreateVoice} className={cn("inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black transition", dark ? "bg-white text-[#111827] hover:bg-[#f9dc0b]" : "bg-[#111827] text-white hover:bg-[#f9dc0b] hover:text-[#111827]")}>
          <Plus className="h-4 w-4" />
          Create Voice
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-4">
        <div className="flex flex-col gap-4">
          <div className="flex gap-3">
            {(["explore", "mine"] as VoiceLibraryTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setLibraryTab(tab)}
                className={cn(
                  "inline-flex h-10 items-center gap-2 border-b px-2 text-sm font-semibold transition",
                  libraryTab === tab
                    ? dark ? "border-white text-white" : "border-[#111827] text-[#111827]"
                    : dark ? "border-transparent text-white/52 hover:text-white" : "border-transparent text-[#6B7280] hover:text-[#111827]",
                )}
              >
                {tab === "explore" ? <Volume2 className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                {tab === "explore" ? "Explore" : "My Voices"}
                {tab === "mine" ? <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", dark ? "bg-white/10" : "bg-[#F3F4F6]")}>{savedVoiceIds.length}</span> : null}
              </button>
            ))}
          </div>

          <label className="relative block">
            <Search className={cn("pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2", dark ? "text-white/38" : "text-[#9CA3AF]")} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search collection..."
              className={cn("h-12 w-full rounded-xl border pl-12 pr-4 text-sm font-medium outline-none", dark ? "border-white/10 bg-[#10141D] text-white placeholder:text-white/35 focus:border-[#f9dc0b]/70" : "border-[#DADDE3] bg-white text-[#111827] placeholder:text-[#6B7280] focus:border-[#111827]")}
            />
          </label>
        </div>

        <div className="mt-6 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xl font-black">{libraryTab === "mine" ? "My saved voices" : "Popular voices"}</h3>
            <p className={cn("text-xs font-semibold", dark ? "text-white/45" : "text-[#6B7280]")}>{filteredVoices.length} voices</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {previewError ? <div className={cn("mb-3 rounded-xl border px-3 py-2 text-sm font-semibold", dark ? "border-white/10 bg-white/8 text-white" : "border-[#f9dc0b]/40 bg-[#fff9d6] text-[#5F5300]")}>{previewError}</div> : null}
            {filteredVoices.length ? (
              <div className="divide-y" style={{ borderColor: dark ? "rgba(255,255,255,.08)" : "#EEF0F3" }}>
                {filteredVoices.map((voice, index) => {
                  const saved = savedSet.has(voice.id);
                  const selected = selectedVoiceId === voice.id;
                  const ready = isVoiceReady(voice);
                  const canDelete = voice.voiceType === "cloned" && !ready;
                  return (
                    <div
                      key={voice.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => void previewVoice(voice)}
                      onKeyDown={(event) => event.key === "Enter" && void previewVoice(voice)}
                      className={cn(
                        "grid min-h-14 cursor-pointer grid-cols-[minmax(0,1.6fr)_120px_100px_90px_110px_156px] items-center gap-4 rounded-xl px-3 py-2 transition max-xl:grid-cols-[minmax(0,1fr)_110px_90px_132px] max-lg:grid-cols-[minmax(0,1fr)_132px] max-sm:px-1",
                        selected ? dark ? "bg-white/10" : "bg-[#F3F4F6]" : dark ? "hover:bg-white/[0.055]" : "hover:bg-[#F7F7F8]",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className={cn("relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br text-xs font-black text-white shadow-sm", voiceAvatarClass(index))}>
                          {initials(voice.name)}
                          {saved ? <Check className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full bg-[#f9dc0b] p-0.5 text-[#111827]" /> : null}
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
                              className={cn("h-8 w-full rounded-lg border px-2 text-sm font-semibold outline-none", dark ? "border-white/10 bg-[#0B0E14] text-white" : "border-[#DADDE3] bg-white text-[#111827]")}
                              autoFocus
                            />
                          ) : (
                            <p className="truncate text-sm font-semibold">{voice.name}</p>
                          )}
                          <p className={cn("truncate text-sm", dark ? "text-white/48" : "text-[#6B7280]")}>{voice.description || "Reusable AutoYT voice profile"}</p>
                        </div>
                      </div>

                      <div className={cn("flex items-center gap-2 text-sm font-medium max-lg:hidden", dark ? "text-white/72" : "text-[#111827]")}>
                        <span className="font-mono text-xs font-black">US</span>
                        {languageName(voice.language)}
                      </div>
                      <p className={cn("text-sm max-xl:hidden", dark ? "text-white/46" : "text-[#6B7280]")}>American</p>
                      <p className={cn("text-sm font-semibold max-xl:hidden", ready ? dark ? "text-white/58" : "text-[#374151]" : dark ? "text-[#f9dc0b]" : "text-[#5F5300]")}>
                        {voice.voiceType === "cloned" ? voice.sampleCount ? `${voice.sampleCount} samples` : "Needs sample" : index % 2 ? "180d" : "2y"}
                      </p>
                      <p className={cn("text-sm font-semibold max-lg:hidden", dark ? "text-white/58" : "text-[#374151]")}>{voiceStat(index, index % 2 === 1)}</p>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (ready) onUseVoice(voice.id);
                            else setPreviewError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
                          }}
                          className={cn("h-9 rounded-lg px-3 text-xs font-black transition max-sm:px-2", !ready ? "cursor-not-allowed opacity-45" : selected ? "bg-[#f9dc0b] text-[#111827]" : dark ? "text-white/72 hover:bg-white/10 hover:text-white" : "text-[#111827] hover:bg-[#F3F4F6]")}
                          title={ready ? "Use voice" : "Add a sample before using this cloned voice"}
                        >
                          Use
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (canDelete) {
                              setDeletingId(voice.id);
                              void onDeleteVoice(voice.id).finally(() => setDeletingId(""));
                              return;
                            }
                            saved ? onRemoveVoice(voice.id) : onSaveVoice(voice.id);
                          }}
                          className={cn(
                            "grid h-9 w-9 place-items-center rounded-lg transition",
                            canDelete
                              ? dark ? "text-[#f9dc0b] hover:bg-white/10" : "text-[#5F5300] hover:bg-[#fff9d6]"
                              : saved ? "bg-[#f9dc0b] text-[#111827]" : dark ? "text-white/70 hover:bg-white/10" : "text-[#111827] hover:bg-[#F3F4F6]",
                          )}
                          title={canDelete ? "Delete unusable cloned voice" : saved ? "Remove from My Voices" : "Add to My Voices"}
                        >
                          {deletingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : canDelete ? <Trash2 className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setRenamingId(voice.id);
                            setRenameDraft(voice.name);
                          }}
                          className={cn("grid h-9 w-9 place-items-center rounded-lg transition", dark ? "text-white/54 hover:bg-white/10" : "text-[#6B7280] hover:bg-[#F3F4F6]")}
                          title="Rename voice"
                        >
                          {previewLoadingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Pencil className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={cn("grid min-h-[260px] place-items-center rounded-2xl border border-dashed px-6 text-center", dark ? "border-white/10 text-white/48" : "border-[#DADDE3] text-[#6B7280]")}>
                <div>
                  <BookOpen className="mx-auto h-8 w-8" />
                  <p className="mt-3 text-sm font-semibold">{libraryTab === "mine" ? "No saved voices yet. Add voices from Explore." : "No matching voices found."}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={cn("sticky bottom-0 z-10 -mx-5 mt-4 border-t px-5 py-3 sm:-mx-7 sm:px-7", dark ? "border-white/10 bg-[#0B0E14]" : "border-[#E5E7EB] bg-white")}>
        {preview ? (
          <GenerationPlayer item={preview} dark={dark} autoplay={previewAutoplayId === preview.id} onAutoplayConsumed={() => setPreviewAutoplayId("")} />
        ) : (
          <EmptyPlayer dark={dark} selectedVoice={voices.find((voice) => voice.id === selectedVoiceId) || voices[0]} />
        )}
      </div>
    </div>
  );
}

function CloneTab(props: {
  dark: boolean;
  shellClass: string;
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
    <form onSubmit={(event) => void props.cloneVoice(event)} className={cn(props.shellClass, "grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)]")}>
      <div className="space-y-4">
        <div>
          <h2 className="text-2xl font-black">Clone voice</h2>
          <p className={cn("mt-2 text-sm font-semibold leading-6", dark ? "text-white/58" : "text-[#1A1A1A]/58")}>Use a clean 10 to 30 second sample. AutoYT detects the spoken reference text with local Whisper in the background.</p>
        </div>
        <label
          onDragOver={(event) => { event.preventDefault(); props.setCloneDragActive(true); }}
          onDragLeave={() => props.setCloneDragActive(false)}
          onDrop={acceptDroppedFile}
          className={cn(
            "grid min-h-[260px] cursor-pointer place-items-center rounded-2xl border border-dashed p-5 text-center transition",
            props.cloneDragActive
              ? "border-[#f9dc0b] bg-[#f9dc0b]/15"
              : dark ? "border-white/16 bg-black/18 hover:border-[#f9dc0b]/70" : "border-[#1A1A1A]/14 bg-[#F9F8F6] hover:border-[#f9dc0b]",
          )}
        >
          <input type="file" accept="audio/*" className="hidden" onChange={(event: ChangeEvent<HTMLInputElement>) => props.setCloneFile(event.target.files?.[0] || null)} />
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[#f9dc0b] text-[#1A1A1A]"><Upload className="h-6 w-6" /></span>
          <span className="mt-4 block text-base font-black">{props.cloneFile ? props.cloneFile.name : props.cloneDragActive ? "Drop sample to clone voice" : "Upload or drop voice sample"}</span>
          <span className={cn("mt-1 block text-sm font-semibold", dark ? "text-white/45" : "text-[#1A1A1A]/45")}>WAV, MP3, M4A, or FLAC</span>
          <span className={cn("mt-3 block max-w-sm text-xs font-semibold leading-5", dark ? "text-white/38" : "text-[#1A1A1A]/42")}>No exact text needed. The server normalizes the sample and runs faster-whisper before creating the voice profile.</span>
        </label>
      </div>
      <div className="space-y-4">
        <Field label="Name" value={props.cloneName} onChange={props.setCloneName} dark={dark} placeholder="Anime recap narrator" />
        <label className="block">
          <span className="mb-2 block text-sm font-black">Description</span>
          <textarea value={props.cloneDescription} onChange={(event) => props.setCloneDescription(event.target.value)} className={cn("min-h-[116px] w-full rounded-2xl border p-4 text-sm font-semibold outline-none", dark ? "border-white/10 bg-black/18 text-white placeholder:text-white/28 focus:border-[#f9dc0b]/70" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A] focus:border-[#f9dc0b]")} placeholder="Tone, use case, recording notes" />
        </label>
        <Select label="Language" value={props.language} onChange={props.setLanguage} options={LANGUAGES} dark={dark} />
        <label className={cn("flex items-start gap-3 rounded-2xl border p-4 text-sm font-semibold leading-6", dark ? "border-white/10 bg-white/[0.035]" : "border-[#1A1A1A]/8 bg-[#FDFCFA]")}>
          <input type="checkbox" checked={props.cloneConsent} onChange={(event) => props.setCloneConsent(event.target.checked)} className="mt-1 h-4 w-4 accent-[#f9dc0b]" />
          I own this voice or have explicit permission to create a reusable voice profile from this sample.
        </label>
        <button disabled={props.cloning} className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 text-sm font-black text-[#1A1A1A] disabled:opacity-50">
          {props.cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
          Create profile
        </button>
      </div>
    </form>
  );
}

function Select({ label, value, onChange, options, dark, compact = false }: { label: string; value: string; onChange: (value: string) => void; options: string[][]; dark: boolean; compact?: boolean }) {
  return (
    <label className="block">
      <span className={cn("block font-semibold", compact ? "mb-1.5 text-sm" : "mb-2 text-xs uppercase tracking-widest text-[#f9dc0b]")}>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={cn(compact ? "h-10 rounded-lg text-sm font-semibold" : "h-11 rounded-xl text-sm font-black", "w-full border px-3 outline-none", dark ? "border-white/10 bg-[#111723] text-white focus:border-[#f9dc0b]/70" : "border-[#DADDE3] bg-white text-[#1A1A1A] focus:border-[#111827]")}>
        {options.map(([id, optionLabel]) => <option key={id} value={id}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, dark, placeholder }: { label: string; value: string; onChange: (value: string) => void; dark: boolean; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className={cn("h-12 w-full rounded-xl border px-4 text-sm font-semibold outline-none", dark ? "border-white/10 bg-black/18 text-white placeholder:text-white/28 focus:border-[#f9dc0b]/70" : "border-[#1A1A1A]/10 bg-[#F9F8F6] text-[#1A1A1A] focus:border-[#f9dc0b]")} />
    </label>
  );
}

function Status({ tone, dark, message, onClose }: { tone: "success" | "error"; dark: boolean; message: string; onClose: () => void }) {
  return (
    <div className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-bold", tone === "success" ? "border-[#f9dc0b]/40 bg-[#f9dc0b]/12 text-[#1A1A1A]" : dark ? "border-white/14 bg-white/8 text-white" : "border-[#1A1A1A]/12 bg-white text-[#1A1A1A]")}>
      {tone === "success" ? <Check className="h-4 w-4 text-[#f9dc0b]" /> : <FileAudio className="h-4 w-4 text-[#f9dc0b]" />}
      <span className={cn("flex-1", dark && tone === "success" ? "text-white" : "")}>{message}</span>
      <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-[#1A1A1A]/8"><X className="h-4 w-4" /></button>
    </div>
  );
}
