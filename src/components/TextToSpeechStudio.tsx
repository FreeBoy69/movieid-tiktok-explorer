import React, { ChangeEvent, type DragEvent, FormEvent, useEffect, useRef, useState } from "react";
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
  Repeat,
  RotateCcw,
  RotateCw,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useErrorToast } from "../utils/toast";
import { isVoiceReady, VOICE_NAME_OVERRIDES_KEY, VOICE_PROFILES_ROUTE } from "../utils/voiceProfiles";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, useStudioPricing } from "./studio/studioPricing";
import "./AudioStudio.css";

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

export type Generation = {
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
  useErrorToast(error, () => setError(""));
  const [history, setHistory] = useState<Generation[]>([]);
  const [selectedGenerationId, setSelectedGenerationId] = useState("");
  const [autoplayGenerationId, setAutoplayGenerationId] = useState("");
  const [cloneFile, setCloneFile] = useState<File | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneDescription, setCloneDescription] = useState("");
  const [cloneConsent, setCloneConsent] = useState(false);
  const [cloneDenoise, setCloneDenoise] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [cloneDragActive, setCloneDragActive] = useState(false);
  const [voiceNameOverrides, setVoiceNameOverrides] = useState<Record<string, string>>(() => {
    if (typeof window === "undefined") return {};
    try {
      const stored = window.localStorage.getItem(VOICE_NAME_OVERRIDES_KEY);
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
    window.localStorage.setItem(VOICE_NAME_OVERRIDES_KEY, JSON.stringify(voiceNameOverrides));
  }, [voiceNameOverrides]);

  async function loadProfiles() {
    setLoadingVoices(true);
    setError("");
    try {
      const response = await fetch(VOICE_PROFILES_ROUTE);
      const data = await readJson(response, "Voices are unavailable");
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
      setError(/fetch failed|network/i.test(message) ? "Voice service is unavailable. Refresh voices in a moment." : message || "Voice service is unavailable. Refresh voices in a moment.");
    } finally {
      setLoadingVoices(false);
    }
  }

  async function generateSpeech(event?: FormEvent) {
    event?.preventDefault();
    if (!selectedVoice || !text.trim()) return;
    if (!online) {
      setError("Voice service is not connected yet. Refresh voices in a moment.");
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
      const createResponse = await fetch(VOICE_PROFILES_ROUTE, {
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
          removeNoise: cloneDenoise,
        }),
      });
      await readJson(sampleResponse, "Voice sample upload failed");
      await loadProfiles();
      const refreshedResponse = await fetch(VOICE_PROFILES_ROUTE);
      const refreshed = await readJson(refreshedResponse, "Voices are unavailable");
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
    <section className={cn("cs-audio-workspace as-root", dark ? "text-white" : "text-[#1A1A1A]")}>
      <header className="as-head">
        <div className="as-title">
          <span className="as-mark"><Volume2 className="h-5 w-5" aria-hidden /></span>
          <div><h1>Audio Studio</h1><p>Turn a script into a natural voice track.</p></div>
        </div>
        <div className="as-head-actions">
          <div className="as-tabs" role="tablist" aria-label="Audio Studio sections">
            {STUDIO_TABS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)} className="as-tab">
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => void loadProfiles()} className="as-icon" aria-label="Refresh voices" title="Refresh voices">
            {loadingVoices ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>

            {notice ? <Status tone="success" dark={dark} message={notice} onClose={() => setNotice("")} /> : null}

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
          cloneDenoise={cloneDenoise}
          setCloneDenoise={setCloneDenoise}
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
  const pricing = useStudioPricing();
  const estimatedCredits = fallbackCreditEstimate("speech", pricing, Math.max(1, Math.ceil(props.text.trim().length / 1000)));
  const [rightRailTab, setRightRailTab] = useState<RightRailTab>("settings");
  const [historySearch, setHistorySearch] = useState("");
  const selectedGeneration = props.history.find((item) => item.id === props.selectedGenerationId) || props.history[0];
  const historyItems = props.history.filter((item) => {
    const query = historySearch.trim().toLowerCase();
    return !query || item.text.toLowerCase().includes(query) || item.profileName.toLowerCase().includes(query);
  });
  const words = props.text.trim() ? props.text.trim().split(/\s+/).length : 0;
  // Hosted voices pick their own model, so the engine menu only shows for studio voices.
  const hosted = selectedVoiceId.startsWith("openrouter:");
  const blockedReason = !props.online ? "No voices loaded yet. Refresh voices." : !selectedVoiceId ? "Choose a voice first." : !props.text.trim() ? "" : "";
  return (
    <form onSubmit={(event) => void props.generateSpeech(event)} className="as-generate">
      <section className="as-write">
        <textarea
          value={props.text}
          onChange={(event) => props.setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void props.generateSpeech();
          }}
          placeholder="Write or paste the script you want to hear."
          aria-label="Speech script"
          className="as-script"
          maxLength={5000}
        />
        {selectedGeneration ? (
          <div className="as-player">
            <GenerationPlayer item={selectedGeneration} dark={dark} autoplay={props.autoplayGenerationId === selectedGeneration.id} onAutoplayConsumed={props.clearAutoplayGeneration} />
          </div>
        ) : null}
        <footer className="as-write-foot">
          <span className="as-count">{words.toLocaleString()} {words === 1 ? "word" : "words"} · {props.text.length.toLocaleString()} / 5,000</span>
          {blockedReason ? <span className="as-blocked" role="status">{blockedReason}</span> : <span className="as-cost" title={CREDIT_ESTIMATE_TITLE}>{creditEstimateLabel(estimatedCredits)}</span>}
          <button type="submit" disabled={props.generating || !props.text.trim() || !props.online} className="as-primary">
            {props.generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {props.generating ? "Generating" : "Generate speech"}
          </button>
        </footer>
      </section>

      <aside className="as-rail" aria-label="Voice settings and history">
        <div className="as-seg" role="tablist" aria-label="Panel">
          {(["settings", "history"] as RightRailTab[]).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={rightRailTab === tab} onClick={() => setRightRailTab(tab)}>
              {tab === "settings" ? "Settings" : `History${props.history.length ? ` · ${props.history.length}` : ""}`}
            </button>
          ))}
        </div>
        {rightRailTab === "settings" ? (
          <div className="as-rail-body">
            <label className="as-field">
              <span>Voice</span>
              <div className="as-voice-pick">
                <span className="as-sphere is-sm" style={{ background: voiceSphere(selectedVoiceId) }} aria-hidden />
                <select
                  value={selectedVoiceId}
                  aria-label="Voice"
                  onChange={(event) => {
                    const voice = voices.find((item) => item.id === event.target.value);
                    props.setSelectedVoiceId(event.target.value);
                    if (voice?.defaultEngine) props.setEngine(voice.defaultEngine);
                  }}
                >
                  {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                </select>
                <ChevronDown className="as-chevron" aria-hidden />
              </div>
            </label>
            {hosted ? null : <Select label="Engine" value={props.engine} onChange={props.setEngine} options={ENGINES} dark={dark} compact />}
            <Select label="Language" value={props.language} onChange={props.setLanguage} options={LANGUAGES} dark={dark} compact />
            {!props.online ? <p className="as-note is-warn">The voice service isn't connected. Refresh voices in a moment.</p> : null}
          </div>
        ) : (
          <div className="as-rail-body">
            <label className="as-search">
              <Search className="h-4 w-4" aria-hidden />
              <input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Search this session" aria-label="Search generation history" />
            </label>
            {historyItems.length ? historyItems.map((item) => (
              <button key={item.id} type="button" onClick={() => props.setSelectedGenerationId(item.id)} className="as-history" aria-current={props.selectedGenerationId === item.id ? "true" : undefined}>
                <strong>{item.text}</strong>
                <small>{item.profileName} · {relativeTime(item.createdAt)}</small>
              </button>
            )) : <p className="as-note">No speech generated in this session.</p>}
          </div>
        )}
      </aside>
    </form>
  );
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const WAVE_BARS = 160;

// Peaks for the timeline, decoded from the real audio. Falls back to a flat
// bar when the browser can't decode it (or the file is still loading).
function useWaveform(url?: string) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    setPeaks(null);
    if (!url || typeof window === "undefined" || !("AudioContext" in window)) return;
    let cancelled = false;
    const controller = new AbortController();
    void fetch(url, { signal: controller.signal })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error("audio"))))
      .then(async (buffer) => {
        const context = new AudioContext();
        try {
          const audio = await context.decodeAudioData(buffer);
          const data = audio.getChannelData(0);
          const step = Math.max(1, Math.floor(data.length / WAVE_BARS));
          const out: number[] = [];
          for (let i = 0; i < WAVE_BARS; i++) {
            let peak = 0;
            for (let j = i * step; j < Math.min(data.length, (i + 1) * step); j += 8) peak = Math.max(peak, Math.abs(data[j]));
            out.push(peak);
          }
          const max = Math.max(0.01, ...out);
          if (!cancelled) setPeaks(out.map((value) => Math.max(0.06, value / max)));
        } finally {
          void context.close();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url]);
  return peaks;
}

export function GenerationPlayer({ item, autoplay, onAutoplayConsumed }: { item: Generation; dark?: boolean; autoplay?: boolean; onAutoplayConsumed?: () => void }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.duration || 0);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const peaks = useWaveform(item.audioUrl);

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
        if (!cancelled && Number.isFinite(nextDuration) && nextDuration > 0) setDuration(nextDuration);
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
    const sync = () => {
      const audio = audioRef.current;
      if (!audio) return;
      syncAudioDuration(audio);
      setCurrentTime(audio.currentTime || 0);
      if (!audio.paused && !audio.ended) frameId = window.requestAnimationFrame(sync);
    };
    frameId = window.requestAnimationFrame(sync);
    return () => window.cancelAnimationFrame(frameId);
  }, [playing, item.id, item.audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.playbackRate = speed;
    audio.loop = loop;
    audio.volume = volume;
    audio.muted = muted;
  }, [speed, loop, volume, muted, item.audioUrl]);

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio || !item.audioUrl) return;
    if (audio.paused) void audio.play().then(() => setPlaying(true)).catch(() => undefined);
    else {
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
    if (nextDuration > 0 && Math.abs(nextDuration - duration) > 0.05) setDuration(nextDuration);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" && (target as HTMLInputElement).type === "range" && event.key !== " ") return;
    if (event.key === " " || event.key === "k") {
      event.preventDefault();
      togglePlay();
    } else if (event.key === "ArrowLeft" || event.key === "j") {
      event.preventDefault();
      seek(currentTime - 5);
    } else if (event.key === "ArrowRight" || event.key === "l") {
      event.preventDefault();
      seek(currentTime + 5);
    } else if (event.key === "m") {
      setMuted((value) => !value);
    }
  }

  const ready = Boolean(item.audioUrl);
  const nextSpeed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length];
  return (
    <div className="asp" onKeyDown={onKeyDown} aria-label={`Audio player: ${item.profileName}`} role="group">
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
      <PlayerTimeline currentTime={currentTime} duration={duration} peaks={peaks} disabled={!ready || !duration} onSeek={seek} />
      <div className="asp-row">
        <div className="asp-id">
          <span className="as-sphere is-sm" style={{ background: voiceSphere(item.profileName) }} aria-hidden />
          <div className="asp-id-text">
            <strong title={item.text}>{item.text || "Untitled"}</strong>
            <small>{item.profileName} · {relativeTime(item.createdAt)}</small>
          </div>
        </div>

        <div className="asp-transport">
          <button type="button" className="asp-btn" onClick={() => seek(currentTime - 10)} disabled={!ready} aria-label="Back 10 seconds" title="Back 10s (←)">
            <RotateCcw className="h-4 w-4" /><span className="asp-btn-num" aria-hidden>10</span>
          </button>
          <button type="button" className="asp-play" onClick={togglePlay} disabled={!ready} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (space)" : "Play (space)"}>
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 translate-x-px fill-current" />}
          </button>
          <button type="button" className="asp-btn" onClick={() => seek(currentTime + 10)} disabled={!ready} aria-label="Forward 10 seconds" title="Forward 10s (→)">
            <RotateCw className="h-4 w-4" /><span className="asp-btn-num" aria-hidden>10</span>
          </button>
          <span className="asp-clock"><span>{formatClock(currentTime)}</span> / {formatClock(duration)}</span>
        </div>

        <div className="asp-tools">
          <button type="button" className="asp-chip" onClick={() => setSpeed(nextSpeed)} aria-label={`Playback speed ${speed}×, change to ${nextSpeed}×`} title="Playback speed">
            {speed}×
          </button>
          <button type="button" className={cn("asp-btn", loop && "is-on")} onClick={() => setLoop((value) => !value)} aria-pressed={loop} aria-label="Loop" title="Loop">
            <Repeat className="h-4 w-4" />
          </button>
          <div className="asp-volume">
            <button type="button" className="asp-btn" onClick={() => setMuted((value) => !value)} aria-label={muted ? "Unmute" : "Mute"} title={muted ? "Unmute (m)" : "Mute (m)"}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => {
                setVolume(Number(event.target.value));
                setMuted(Number(event.target.value) === 0);
              }}
              aria-label="Volume"
              className="asp-volume-range"
              style={{ "--v": `${(muted ? 0 : volume) * 100}%` } as React.CSSProperties}
            />
          </div>
          {item.audioUrl ? (
            <a href={item.audioUrl} download className="asp-btn" aria-label="Download audio" title="Download">
              <Download className="h-4 w-4" />
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PlayerTimeline({ currentTime, duration, peaks, disabled, onSeek }: { currentTime: number; duration: number; peaks: number[] | null; disabled?: boolean; onSeek: (seconds: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  const safeTime = Math.max(0, Math.min(safeDuration, Number.isFinite(currentTime) ? currentTime : 0));
  const pct = safeDuration ? (safeTime / safeDuration) * 100 : 0;
  return (
    <div
      className={cn("asp-timeline", disabled && "is-disabled")}
      onPointerMove={(event) => {
        if (disabled) return;
        const rect = event.currentTarget.getBoundingClientRect();
        setHover(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
      }}
      onPointerLeave={() => setHover(null)}
      style={{ "--p": `${pct}%` } as React.CSSProperties}
    >
      {peaks ? (
        <div className="asp-wave" aria-hidden>
          {peaks.map((peak, index) => (
            <span key={index} className={(index + 0.5) / peaks.length * 100 <= pct ? "is-played" : undefined} style={{ height: `${Math.round(peak * 100)}%` }} />
          ))}
        </div>
      ) : (
        <div className="asp-track" aria-hidden><span /></div>
      )}
      <span className="asp-head" aria-hidden />
      {hover !== null && safeDuration ? (
        <>
          <span className="asp-hover-line" style={{ left: `${hover * 100}%` }} aria-hidden />
          <span className="asp-hover-time" style={{ left: `clamp(22px, ${hover * 100}%, calc(100% - 22px))` }} aria-hidden>{formatClock(hover * safeDuration)}</span>
        </>
      ) : null}
      <input
        type="range"
        min={0}
        max={safeDuration || 1}
        step="any"
        value={safeDuration ? safeTime : 0}
        disabled={disabled}
        onChange={(event) => onSeek(Number(event.currentTarget.value))}
        aria-label="Seek"
        aria-valuetext={`${formatClock(safeTime)} of ${formatClock(safeDuration)}`}
        className="asp-seek"
      />
    </div>
  );
}

function languageName(code: string) {
  return LANGUAGES.find(([id]) => id === code)?.[1] || code.toUpperCase();
}

// A glossy sphere with a gradient unique to each voice, stable across sessions:
// the voice id is hashed into two hues and a light position.
export function voiceSphere(id: string) {
  let h = 2166136261;
  for (const char of String(id || "voice")) h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
  // Avalanche the bits so similar ids ("v1", "v2") still land far apart on the wheel.
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  const a = h % 360;
  const b = (a + 50 + ((h >>> 9) % 140)) % 360;
  const c = (b + 30 + ((h >>> 17) % 60)) % 360;
  const x = 26 + ((h >>> 5) % 14);
  const y = 22 + ((h >>> 13) % 14);
  return [
    `radial-gradient(circle at ${x}% ${y}%, rgb(255 255 255 / 0.9) 0, rgb(255 255 255 / 0.35) 9%, transparent 30%)`,
    `radial-gradient(circle at 72% 80%, hsl(${c} 90% 58% / 0.85) 0, transparent 55%)`,
    `linear-gradient(150deg, hsl(${a} 88% 62%), hsl(${b} 78% 42%))`,
  ].join(", ");
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
  useErrorToast(previewError, () => setPreviewError(""), { title: "Preview failed" });
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
    <div className="as-library">
      <div className="as-library-bar">
        <div className="as-seg" role="tablist" aria-label="Voice library">
          {(["explore", "mine"] as VoiceLibraryTab[]).map((tab) => (
            <button key={tab} type="button" role="tab" aria-selected={libraryTab === tab} onClick={() => setLibraryTab(tab)}>
              {tab === "explore" ? "All voices" : `Saved · ${savedVoiceIds.length}`}
            </button>
          ))}
        </div>
        <label className="as-search is-grow">
          <Search className="h-4 w-4" aria-hidden />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search voices" aria-label="Search voices" />
        </label>
        <span className="as-count">{filteredVoices.length} {filteredVoices.length === 1 ? "voice" : "voices"}</span>
        <button type="button" onClick={onCreateVoice} className="as-primary"><Plus className="h-4 w-4" />Create voice</button>
      </div>

      <div className="as-library-scroll">
        {filteredVoices.length ? (
          <div className="as-grid">
            {filteredVoices.map((voice) => {
              const saved = savedSet.has(voice.id);
              const selected = selectedVoiceId === voice.id;
              const ready = isVoiceReady(voice);
              const canDelete = voice.voiceType === "cloned" && !ready;
              const voiceType = voice.voiceType === "cloned" ? "Cloned" : "Preset";
              const sampleDetail = voice.voiceType === "cloned" ? voice.sampleCount ? `${voice.sampleCount} ${voice.sampleCount === 1 ? "sample" : "samples"}` : "Needs a sample" : "Ready";
              return (
                <article key={voice.id} className="as-card" aria-current={selected ? "true" : undefined}>
                  <div className="as-card-top">
                    <button type="button" className="as-sphere-btn" onClick={() => void previewVoice(voice)} disabled={!!previewLoadingId || !ready} aria-label={`Preview ${voice.name}`} title="Preview">
                      <span className="as-sphere" style={{ background: voiceSphere(voice.id) }} aria-hidden />
                      <span className="as-sphere-play" aria-hidden>{previewLoadingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}</span>
                    </button>
                    <div className="as-card-actions">
                      <button
                        type="button"
                        className={cn("as-icon is-sm", saved && !canDelete && "is-on")}
                        onClick={() => {
                          if (canDelete) {
                            if (!window.confirm(`Delete “${voice.name}”? This cannot be undone.`)) return;
                            setDeletingId(voice.id);
                            void onDeleteVoice(voice.id).finally(() => setDeletingId(""));
                            return;
                          }
                          saved ? onRemoveVoice(voice.id) : onSaveVoice(voice.id);
                        }}
                        aria-label={canDelete ? `Delete ${voice.name}` : saved ? `Remove ${voice.name} from saved voices` : `Save ${voice.name}`}
                        title={canDelete ? "Delete" : saved ? "Saved" : "Save"}
                      >
                        {deletingId === voice.id ? <Loader2 className="h-4 w-4 animate-spin" /> : canDelete ? <Trash2 className="h-4 w-4" /> : saved ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      </button>
                      <button type="button" className="as-icon is-sm" onClick={() => { setRenamingId(voice.id); setRenameDraft(voice.name); }} aria-label={`Rename ${voice.name}`} title="Rename">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  {renamingId === voice.id ? (
                    <input
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") { event.preventDefault(); void commitRename(voice.id); }
                        if (event.key === "Escape") setRenamingId("");
                      }}
                      onBlur={() => void commitRename(voice.id)}
                      className="as-rename"
                      aria-label={`Rename ${voice.name}`}
                      autoFocus
                    />
                  ) : (
                    <h3 className="as-card-name">{voice.name}</h3>
                  )}
                  <p className="as-card-desc">{voice.description || "Reusable voice profile"}</p>
                  <p className={cn("as-card-meta", !ready && "is-warn")}>{languageName(voice.language)} · {voiceType} · {sampleDetail}</p>
                  <button
                    type="button"
                    className={cn("as-use", selected && "is-on")}
                    onClick={() => {
                      if (ready) onUseVoice(voice.id);
                      else setPreviewError("This cloned voice has no usable sample yet. Re-create it from the Clone tab with a clear audio sample, then try again.");
                    }}
                    disabled={!ready}
                  >
                    {selected ? <><Check className="h-4 w-4" />In use</> : "Use voice"}
                  </button>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="as-empty">
            <BookOpen className="h-8 w-8" aria-hidden />
            <p>{libraryTab === "mine" ? "No saved voices yet. Save one with +." : "No voices match that search."}</p>
          </div>
        )}
      </div>
      {preview ? (
        <div className="as-player is-dock">
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
  cloneDenoise: boolean;
  setCloneDenoise: (value: boolean) => void;
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
    <form onSubmit={(event) => void props.cloneVoice(event)} className="as-clone">
      <div className="as-clone-grid">
        <section className="as-panel">
          <h2>Voice sample</h2>
          <p className="as-sub">A clear 10–30 second recording of one speaker, with little background noise.</p>
          <label
            onDragOver={(event) => { event.preventDefault(); props.setCloneDragActive(true); }}
            onDragLeave={() => props.setCloneDragActive(false)}
            onDrop={acceptDroppedFile}
            className={cn("as-drop", props.cloneDragActive && "is-active", props.cloneFile && "has-file")}
          >
            <input type="file" accept="audio/*" className="sr-only" onChange={(event: ChangeEvent<HTMLInputElement>) => props.setCloneFile(event.target.files?.[0] || null)} />
            <span className="as-drop-icon">{props.cloneFile ? <FileAudio className="h-6 w-6" /> : <Upload className="h-6 w-6" />}</span>
            <strong>{props.cloneFile ? props.cloneFile.name : props.cloneDragActive ? "Drop the sample here" : "Upload or drop a voice sample"}</strong>
            <small>{props.cloneFile ? `${(props.cloneFile.size / 1048576).toFixed(1)} MB · click to replace` : "WAV, MP3, M4A or FLAC"}</small>
          </label>
          <ul className="as-tips">
            <li>Record in a quiet room, close to the mic.</li>
            <li>Speak naturally, the way the voice should sound.</li>
            <li>Avoid music, overlapping voices and echo.</li>
          </ul>
        </section>
        <section className="as-panel">
          <h2>Voice details</h2>
          <Field label="Name" value={props.cloneName} onChange={props.setCloneName} dark={dark} placeholder="Anime recap narrator" />
          <label className="as-field">
            <span>Description</span>
            <textarea value={props.cloneDescription} onChange={(event) => props.setCloneDescription(event.target.value)} className="as-textarea" placeholder="Tone, use case, recording notes" />
          </label>
          <Select label="Language" value={props.language} onChange={props.setLanguage} options={LANGUAGES} dark={dark} />
          <label className="as-check">
            <input type="checkbox" checked={props.cloneDenoise} onChange={(event) => props.setCloneDenoise(event.target.checked)} />
            <span><strong>Remove background noise</strong><small>Filters hum, hiss and room rumble. Leave it off for clean studio recordings.</small></span>
          </label>
          <label className="as-check">
            <input type="checkbox" checked={props.cloneConsent} onChange={(event) => props.setCloneConsent(event.target.checked)} />
            <span><strong>I have the right to clone this voice</strong><small>It's my voice, or the speaker gave explicit permission.</small></span>
          </label>
          <button type="submit" disabled={props.cloning || !props.cloneFile || !props.cloneConsent} className="as-primary is-wide">
            {props.cloning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
            {props.cloning ? "Creating voice" : "Create voice"}
          </button>
        </section>
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
