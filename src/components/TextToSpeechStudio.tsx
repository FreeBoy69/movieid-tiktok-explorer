import React, { FormEvent, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  FileAudio,
  Loader2,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { toast, useErrorToast } from "../utils/toast";
import { isVoiceReady, VOICE_NAME_OVERRIDES_KEY, VOICE_PROFILES_ROUTE } from "../utils/voiceProfiles";
import { CREDIT_ESTIMATE_TITLE, creditEstimateLabel, fallbackCreditEstimate, useStudioPricing } from "./studio/studioPricing";
import { VoiceCloneForm } from "./studio/VoiceCloneForm";
import "./CreatorStudio.css";
import "./AudioStudio.css";
import { VoicePicker } from "./VoicePicker";
import { AudioPlayer } from "./AudioPlayer";
import { FieldPicker, LanguagePicker, languageName, VOICEBOX_LANGUAGES } from "./LanguagePicker";
import { VOICE_ENGINES } from "../utils/voiceEngines";
import { confirm } from "./ui/Dialog";
import { SearchField, Segmented, Tabs } from "./ui/controls";

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

const STUDIO_TABS: Array<{ id: StudioTab; label: string; icon: typeof Volume2 }> = [
  { id: "generate", label: "Generate", icon: Volume2 },
  { id: "voices", label: "Voices", icon: BookOpen },
  { id: "clone", label: "Clone", icon: Mic },
];

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
  const [loadingVoices, setLoadingVoices] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const [history, setHistory] = useState<Generation[]>([]);
  const [selectedGenerationId, setSelectedGenerationId] = useState("");
  const [autoplayGenerationId, setAutoplayGenerationId] = useState("");
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
          <Tabs
            label="Audio Studio sections"
            className="as-head-tabs"
            value={activeTab}
            onChange={(id) => setActiveTab(id as StudioTab)}
            options={STUDIO_TABS.map(({ id, label, icon: Icon }) => ({ value: id, label, icon: <Icon className="h-3.5 w-3.5" aria-hidden /> }))}
          />
          <button type="button" onClick={() => void loadProfiles()} className="as-icon" aria-label="Refresh voices" title="Refresh voices">
            {loadingVoices ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </header>


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
        <div className="as-clone">
          <VoiceCloneForm
            onCreated={(id, name) => {
              setSavedVoiceIds((current) => (current.includes(id) ? current : [...current, id]));
              setSelectedVoiceId(id);
              void loadProfiles();
              toast.success(`${name || "Your voice"} is ready and saved to your library.`);
              setActiveTab("voices");
            }}
          />
        </div>
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
        <Tabs
          label="Panel"
          className="as-rail-tabs"
          value={rightRailTab}
          onChange={(tab) => setRightRailTab(tab as RightRailTab)}
          options={[
            { value: "settings", label: "Settings" },
            { value: "history", label: `History${props.history.length ? ` · ${props.history.length}` : ""}` },
          ]}
        />
        {rightRailTab === "settings" ? (
          <div className="as-rail-body">
            <label className="as-field">
              <span>Voice</span>
              <VoicePicker
                voices={voices}
                value={selectedVoiceId}
                onChange={(id) => {
                  const voice = voices.find((item) => item.id === id);
                  props.setSelectedVoiceId(id);
                  if (voice?.defaultEngine) props.setEngine(voice.defaultEngine);
                }}
              />
            </label>
            {hosted ? null : (
              <div className="as-field">
                <span>Engine</span>
                <FieldPicker value={props.engine} onChange={props.setEngine} options={VOICE_ENGINES} label="Engine" />
              </div>
            )}
            <div className="as-field">
              <span>Language</span>
              <LanguagePicker value={props.language} onChange={props.setLanguage} only={VOICEBOX_LANGUAGES} />
            </div>
            {!props.online ? <p className="as-note is-warn">The voice service isn't connected. Refresh voices in a moment.</p> : null}
          </div>
        ) : (
          <div className="as-rail-body">
            <SearchField value={historySearch} onChange={setHistorySearch} placeholder="Search this session" label="Search generation history" size="sm" />
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

// The studio's hero player is the shared AudioPlayer with every tool switched on.
export function GenerationPlayer({ item, autoplay, onAutoplayConsumed }: { item: Generation; dark?: boolean; autoplay?: boolean; onAutoplayConsumed?: () => void }) {
  const [duration, setDuration] = useState(item.duration || 0);

  // Streamed files can arrive without a usable length; history knows it.
  useEffect(() => {
    setDuration(item.duration || 0);
    if (item.duration || !item.id || item.id.startsWith("preview-")) return;
    let cancelled = false;
    void fetch(`/api/voicebox/history/${encodeURIComponent(item.id)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        const next = Number(data?.generation?.duration || 0);
        if (!cancelled && Number.isFinite(next) && next > 0) setDuration(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [item.id, item.duration]);

  if (!item.audioUrl) return null;
  return (
    <AudioPlayer
      src={item.audioUrl}
      title={<span title={item.text}>{item.text || "Untitled"}</span>}
      meta={`${item.profileName} · ${relativeTime(item.createdAt)}`}
      label={item.profileName}
      leading={<span className="as-sphere is-sm" style={{ background: voiceSphere(item.profileName) }} aria-hidden />}
      preload="auto"
      durationHint={duration}
      autoPlay={autoplay}
      onAutoPlayed={onAutoplayConsumed}
      skip
      loop
      volume
      download
      className="as-hero-audio"
    />
  );
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
      // The shared preview route: a cloned voice plays its own recording (no generation), and
      // preset or hosted voices play one line the server generated once and keeps.
      const response = await fetch(`/api/voicebox/profiles/${encodeURIComponent(voice.id)}/preview`);
      if (!response.ok) await readJson(response, "Voice preview failed");
      const audioUrl = URL.createObjectURL(await response.blob());
      const item: Generation = {
        id: `preview-${voice.id}`,
        profileName: voice.name,
        text: voice.name,
        language: voice.language || "en",
        duration: 0,
        audioUrl,
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
        <Segmented
          label="Voice library"
          value={libraryTab}
          onChange={(tab) => setLibraryTab(tab as VoiceLibraryTab)}
          options={[
            { value: "explore", label: "All voices" },
            { value: "mine", label: `Saved · ${savedVoiceIds.length}` },
          ]}
        />
        <SearchField value={query} onChange={setQuery} placeholder="Search voices" className="as-grow" />
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
                        onClick={async () => {
                          if (canDelete) {
                            if (!(await confirm({ title: `Delete ${voice.name}?`, body: "The voice and its samples are removed. This can't be undone.", confirmLabel: "Delete voice", danger: true }))) return;
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


