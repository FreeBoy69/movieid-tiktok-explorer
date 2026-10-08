import { useEffect, useRef, useState } from "react";
import { ArrowLeft, AudioLines, Download, ExternalLink, FileText, Film, Loader2, Mic, Plus, RefreshCw, Square, WandSparkles, Sparkles, SlidersHorizontal, LibraryBig, Subtitles, UserRound } from "lucide-react";
import { writeDeepLink } from "../utils/tiktokRoute";
import { NARRATION_STYLES } from "../utils/narrationStyle.js";
import { DEFAULT_SUBTITLES, normalizeSubtitleSettings, subtitleRegion } from "../utils/voiceoverSubtitles.js";
import { buildInitialScenes } from "../utils/voiceoverTimeline.js";
import { DEFAULT_AVATAR_REMAKE, normalizeAvatarRemake } from "../utils/avatarRemake.js";
import { SubtitleSettingsPanel, type SubtitleSettings } from "./SubtitleSettingsPanel";
import { VoiceoverAvatarPanel, type AvatarRemakeSettings } from "./VoiceoverAvatarPanel";
import { VoiceoverTimeline } from "./VoiceoverTimeline";
import { SourcePicker } from "./SourcePicker";
import "./VoiceoverStudio.css";
import { AudioPlayer } from "./AudioPlayer";
import { MusicLibrary, type LibraryTrack } from "./MusicLibrary";
import { useErrorToast } from "../utils/toast";
import { isVoiceReady, loadVoiceProfiles } from "../utils/voiceProfiles";
import { VoicePicker } from "./VoicePicker";
import type { VoiceProfile } from "../utils/voiceProfiles";

type Agent = { id: string; name: string; youtubeAccountId?: string; channelTitle?: string; channelThumbnailUrl?: string };
type Upload = { id: string; title: string; movieTitle?: string; thumbnailUrl?: string; youtubeUrl?: string; sourceUrl?: string };
type Voice = { id: string; name: string; voiceType: string; sampleCount: number; language?: string };
type Media = { url: string; label?: string };
type Style = { id: string; name: string; guide: string; sourceUrl?: string; presetId?: string; samples?: Array<{ title: string; url: string; excerpt?: string }> };
type Result = {
  scenes?: TimelineScene[];
  sceneClassification?: string;
  mode: string; script?: string; source?: Media; narration?: Media; file?: Media; files?: Media[];
  profile?: Voice; sourceDurationSeconds?: number; stemEngine?: string;
  rewrite?: { requested: boolean; passed: boolean; originalScript: string; rewrittenScript: string; narrationStyle?: Style | null };
  style?: Style;
  subtitles?: { settings: SubtitleSettings; cueCount: number; srt?: Media };
  subtitleStyle?: Partial<SubtitleSettings> & { sampleCount: number };
  remake?: AvatarRemakeSettings & { provider?: string; durationSeconds?: number; sceneCount?: number };
  avatar?: Media;
  renderJobId?: string;
  timing?: { passed: boolean; sourceDurationSeconds: number; outputDurationSeconds: number; durationDeltaSeconds: number; sceneCount: number };
};
type Job = { id: string; status: string; progress: number; message: string; error?: string; result?: Result; etaAt?: string | number; action?: string };
type Mode = "style" | "voiceover" | "avatar" | "soundtrack" | "stems" | "subtitles";
type TimelineScene = {
  id: string;
  start: number;
  end: number;
  label?: string;
  sourceStart?: number;
  sourceEnd?: number;
  role?: "talking-head" | "broll" | "split";
  replaceAvatar?: boolean;
  presenterSide?: "top" | "bottom" | "left" | "right";
  splitAt?: number;
};

async function api<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const data = await response.json().catch(() => ({ error: "The server returned an unreadable response. Try again." }));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

function duration(value: number) {
  const seconds = Math.max(0, Math.round(value || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

type Track = { id: string; label: string; url: string; meta?: string };
type PreviewFormat = "portrait" | "landscape" | "square";

function previewFormat(width: number, height: number): PreviewFormat {
  const ratio = width / Math.max(1, height);
  return ratio < 0.85 ? "portrait" : ratio > 1.2 ? "landscape" : "square";
}

/** Dock player for rendered narration and stems: the shared audio player with a track switcher. */
function OutputPlayer({ tracks, title }: { tracks: Track[]; title: string }) {
  const [trackId, setTrackId] = useState(tracks[0]?.id || "");
  const track = tracks.find((item) => item.id === trackId) || tracks[0];
  useEffect(() => { if (!tracks.some((item) => item.id === trackId)) setTrackId(tracks[0]?.id || ""); }, [tracks, trackId]);
  if (!track) return null;
  const switcher = tracks.length > 1
    ? <span className="voice-player-tracks" role="tablist" aria-label="Audio track">{tracks.map((item) => <button type="button" role="tab" aria-selected={item.id === track.id} key={item.id} onClick={() => setTrackId(item.id)}>{item.label}</button>)}</span>
    : track.meta || track.label;
  return <AudioPlayer key={track.url} className="voice-output" src={track.url} title={title} meta={switcher} download skip volume />;
}

export function VoiceoverStudio({ theme, agentId, uploadId, accountId, embedded = false, lockAgent = false, title = "Voiceover Studio", onSourceChange, onProjectOutput }: { theme: "light" | "dark"; agentId?: string; uploadId?: string; accountId?: string; embedded?: boolean; lockAgent?: boolean; title?: string; onSourceChange?: (source: { agentId?: string; uploadId?: string }) => void; onProjectOutput?: (output: { jobId: string; agentId?: string; uploadId?: string }) => void }) {
  function selectSource(source: { slug?: string; uploadId?: string }, replace = false) {
    if (embedded) onSourceChange?.({ agentId: source.slug, uploadId: source.uploadId });
    else writeDeepLink({ view: "voiceover", ...source }, replace);
  }
  const [agents, setAgents] = useState<Agent[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [selectedStyleId, setSelectedStyleId] = useState("original");
  const [styleChannelUrl, setStyleChannelUrl] = useState("");
  const [styleLearning, setStyleLearning] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [stemEngine, setStemEngine] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [source, setSource] = useState<Media | null>(null);
  const [preparedJobId, setPreparedJobId] = useState("");
  const [script, setScript] = useState("");
  const [profileId, setProfileId] = useState("");
  const [mode, setMode] = useState<Mode>("voiceover");
  const [subtitles, setSubtitles] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLES });
  const [subtitleEstimate, setSubtitleEstimate] = useState("");
  const [renderJobId, setRenderJobId] = useState("");
  const [avatarRemake, setAvatarRemake] = useState<AvatarRemakeSettings>(() => normalizeAvatarRemake(DEFAULT_AVATAR_REMAKE) as AvatarRemakeSettings);
  const [avatarFace, setAvatarFace] = useState<File | null>(null);
  const [avatarProviders, setAvatarProviders] = useState<Record<string, { available: boolean; label: string; env?: string }>>({});
  const [previewBox, setPreviewBox] = useState({ width: 0, height: 0, left: 0, top: 0, scale: 1, naturalWidth: 720, naturalHeight: 1280 });
  const [videoFormat, setVideoFormat] = useState<PreviewFormat>("landscape");
  const [rewrite, setRewrite] = useState(true);
  const [keepBackground, setKeepBackground] = useState(false);
  const [backgroundVolume, setBackgroundVolume] = useState(0.3);
  const [preserveDialogue, setPreserveDialogue] = useState(true);
  const [rights, setRights] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [soundtrack, setSoundtrack] = useState<File | null>(null);
  const [musicTrack, setMusicTrack] = useState<LibraryTrack | null>(null);
  const [playback, setPlayback] = useState<"source" | "result">("source");
  const [scenes, setScenes] = useState<TimelineScene[]>([]);
  const [detectedScenes, setDetectedScenes] = useState<{ id: string; scenes: TimelineScene[] } | null>(null);
  const [sourceJobId, setSourceJobId] = useState("");
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const resume = useRef({ time: 0, playing: false });
  const selection = useRef(uploadId);
  const committedProjectJob = useRef("");
  selection.current = uploadId;
  const selected = uploads.find((item) => item.id === uploadId);
  const running = submitting || job?.status === "queued" || job?.status === "running";
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const outputVideo = result?.file?.url;
  const mediaUrl = playback === "result" ? outputVideo : source?.url;

  useEffect(() => {
    const video = player.current;
    if (!video) return;
    const measure = () => {
      const width = video.videoWidth || 720, height = video.videoHeight || 1280;
      const scale = Math.min(video.clientWidth / width, video.clientHeight / height);
      setPreviewBox({ width: width * scale, height: height * scale, left: video.offsetLeft + (video.clientWidth - width * scale) / 2, top: video.offsetTop + (video.clientHeight - height * scale) / 2, scale, naturalWidth: width, naturalHeight: height });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(video); video.addEventListener("loadedmetadata", measure); measure();
    return () => { observer.disconnect(); video.removeEventListener("loadedmetadata", measure); };
  }, [mediaUrl]);

  async function refreshVoices() {
    const data = await api<{ online: boolean; profiles: Voice[]; stemEngine: string; avatarProviders?: Record<string, { available: boolean; label: string; env?: string }>; error?: string }>("/api/automation/voice/status");
    setOnline(data.online);
    setStemEngine(data.stemEngine);
    // Same list, names, and readiness rule as Text to Speech and Create Video.
    const shared = await loadVoiceProfiles();
    setVoices((shared.profiles.length ? shared.profiles : data.profiles).filter(isVoiceReady) as Voice[]);
    if (data.avatarProviders) setAvatarProviders(data.avatarProviders);
    if (!data.online) setError(data.error || "Voice engine is offline. Reconnect it and retry.");
  }

  async function refreshStyles() {
    const data = await api<{ styles: Style[] }>("/api/automation/voice/narration-styles");
    setStyles(data.styles || []);
  }

  useEffect(() => { void Promise.all([refreshVoices(), refreshStyles()]).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void api<{ agents: Agent[] }>("/api/automation/agents", undefined, controller.signal).then((data) => {
      setAgents(data.agents);
      if (!agentId) {
        const first = data.agents.find((agent) => agent.youtubeAccountId === accountId) || data.agents[0];
        if (first) selectSource({ slug: first.id }, true);
        else setLoading(false);
      }
    }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [agentId, accountId]);

  useEffect(() => {
    if (!agentId) return;
    const controller = new AbortController();
    setLoading(true);
    setUploads([]);
    void api<{ uploads: Upload[] }>(`/api/automation/agents/${encodeURIComponent(agentId)}`, undefined, controller.signal).then((data) => {
      setUploads(data.uploads);
      setLoading(false);
      if (!uploadId && data.uploads[0]) selectSource({ slug: agentId, uploadId: data.uploads[0].id }, true);
    }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [agentId]);

  function acceptJob(next: Job) {
    setJob(next);
    if (next.status === "error") setError(next.error || next.message);
    if (next.status !== "done" || !next.result) return;
    const data = next.result;
    if (data.source) { setSource(data.source); setSourceJobId(next.id); }
    if (data.scenes?.length) {
      setDetectedScenes({ id: next.id, scenes: data.scenes });
      if (data.mode === "scene-detection") return;
    }
    if (data.mode === "subtitle-style" && data.subtitleStyle) {
      setSubtitles((current) => normalizeSubtitleSettings({ ...current, ...data.subtitleStyle }));
      setSubtitleEstimate("Original subtitle area detected.");
      if (data.renderJobId && !renderJobId) {
        const target = selection.current;
        void api<{ job: Job }>(`/api/automation/voice/jobs/${encodeURIComponent(data.renderJobId)}`).then(({ job: previous }) => { if (selection.current === target) acceptJob(previous); }).catch((e) => setError(e.message));
      }
      return;
    }
    if (data.file && data.narration) setRenderJobId(next.id);
    if (data.subtitles?.settings) setSubtitles(data.subtitles.settings);
    if (data.remake) setAvatarRemake(normalizeAvatarRemake(data.remake) as AvatarRemakeSettings);
    if (data.mode === "transcript") {
      setPreparedJobId(next.id);
      setScript(data.script || "");
    } else if (data.mode === "style" && data.style) {
      setStyles((items) => [data.style!, ...items.filter((item) => item.id !== data.style!.id)]);
      setSelectedStyleId(data.style.id);
      setStyleLearning(false);
      setJob(next);
    } else if (data.mode === "rewrite") {
      setResult(data);
      setScript(data.script || "");
      setPreparedJobId(next.id);
      setRewrite(false);
    } else if (data.profile && !data.file) {
      setProfileId(data.profile.id);
      void refreshVoices().catch((e) => setError(e.message));
    } else {
      setResult(data);
      if (data.file) setPlayback("result");
      if (data.script) setScript(data.script);
    }
  }

  useEffect(() => {
    if (
      !embedded ||
      !onProjectOutput ||
      !job?.id ||
      job.status !== "done" ||
      committedProjectJob.current === job.id
    )
      return;
    committedProjectJob.current = job.id;
    onProjectOutput({ jobId: job.id, agentId, uploadId });
  }, [agentId, embedded, job?.id, job?.status, onProjectOutput, uploadId]);

  useEffect(() => {
    setJob(null); setResult(null); setSource(null); setScript(""); setPreparedJobId(""); setError("");
    setRenderJobId(""); setSubtitles({ ...DEFAULT_SUBTITLES }); setSubtitleEstimate(""); setSoundtrack(null); setMusicTrack(null); setVideoFormat("landscape");
    setAvatarRemake(normalizeAvatarRemake(DEFAULT_AVATAR_REMAKE) as AvatarRemakeSettings); setAvatarFace(null);
    setPlayback("source");
    setScenes([]); setSelectedSceneId(""); setPlayhead(0); setTimelinePlaying(false);
    setDetectedScenes(null); setSourceJobId("");
    if (!uploadId) return;
    const controller = new AbortController();
    void api<{ job: Job | null }>(`/api/automation/uploads/${encodeURIComponent(uploadId)}/voice/jobs/latest`, undefined, controller.signal)
      .then(async ({ job: latest }) => {
        if (!latest || controller.signal.aborted) return;
        if (!latest.result?.file) {
          const history = await api<{ jobs: Job[] }>(`/api/automation/uploads/${encodeURIComponent(uploadId)}/voice/jobs`, undefined, controller.signal);
          if (controller.signal.aborted) return;
          const previous = [...(history.jobs || [])].reverse().find((item) => item.status === "done" && item.result?.file && item.result?.narration);
          if (previous) acceptJob(previous);
        }
        acceptJob(latest);
      })
      .catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [uploadId]);

  useEffect(() => {
    if (!job || !["queued", "running"].includes(job.status)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const data = await api<{ job: Job }>(`/api/automation/voice/jobs/${encodeURIComponent(job.id)}`, undefined, controller.signal);
        if (!controller.signal.aborted) acceptJob(data.job);
      } catch (e) {
        if (!controller.signal.aborted) setError(`${(e as Error).message} Reconnecting to the render...`);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2200);
    };
    timer = setTimeout(poll, 1200);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [job?.id, job?.status]);

  async function run(action: "prepare" | "process" | "clone" | "style" | "rewrite" | "subtitle-style" | "detect-scenes") {
    if (!uploadId || running) return;
    const target = uploadId;
    setSubmitting(true); setError(""); setJob(null);
    if (action === "subtitle-style") { setPlayback("source"); setSubtitleEstimate(""); }
    if (action === "style") setStyleLearning(true);
    if (action === "process" && mode !== "subtitles" && mode !== "avatar") { setResult(null); setPlayback("source"); }
    try {
      let soundtrackBase64: string | undefined;
      if (action === "process" && mode === "soundtrack" && soundtrack) {
        if (soundtrack.size > 60 * 1024 * 1024) throw new Error("Choose an audio file smaller than 60 MB.");
        soundtrackBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Could not read this audio file."));
          reader.readAsDataURL(soundtrack);
        });
      }
      let avatarFaceBase64: string | undefined;
      let avatarFaceExtension: string | undefined;
      if (action === "process" && mode === "avatar") {
        if (!avatarFace) throw new Error("Upload a client face photo first.");
        if (avatarFace.size > 12 * 1024 * 1024) throw new Error("Choose a face photo smaller than 12 MB.");
        avatarFaceBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("Could not read this face photo."));
          reader.readAsDataURL(avatarFace);
        });
        avatarFaceExtension = `.${avatarFace.name.split(".").pop() || "jpg"}`;
      }
      const { job: next } = await api<{ job: Job }>(`/api/automation/uploads/${encodeURIComponent(target)}/voice/jobs`, {
        action, mode: ["style", "rewrite", "detect-scenes"].includes(action) ? "voiceover" : mode, profileId, profileName: `${selected?.title || "Source"} narrator`, script, preparedJobId: (["detect-scenes", "subtitle-style"].includes(action) ? sourceJobId || preparedJobId : preparedJobId) || undefined,
        subtitles, renderJobId: renderJobId || undefined,
        scenes, avatarRemake: { ...avatarRemake, faceName: avatarFace?.name || avatarRemake.faceName },
        avatarFaceBase64, avatarFaceExtension,
        styleChannelUrl: action === "style" ? styleChannelUrl : undefined,
        narrationStyle: action === "style" ? undefined : selectedNarrationStyle,
        rewrite, preserveBackground: keepBackground, backgroundVolume, preserveCharacterVoices: false, preserveDialogue,
        requireSourceVoiceClone: false, useUploadedVideo: Boolean(selected?.youtubeUrl), rightsConfirmed: rights, voiceConsentConfirmed: voiceConsent,
        soundtrackBase64, soundtrackUrl: musicTrack?.url, soundtrackProvider: musicTrack?.provider, soundtrackLandingUrl: musicTrack?.landingUrl, soundtrackExtension: soundtrack ? `.${soundtrack.name.split(".").pop()}` : ".mp3", soundtrackVolume: backgroundVolume,
      });
      if (selection.current === target) acceptJob(next);
    } catch (e) { if (selection.current === target) setError((e as Error).message); }
    finally { setSubmitting(false); if (action === "style") setStyleLearning(false); }
  }

  async function importSource() {
    if (!agentId || !sourceUrl || !rights) return;
    setSubmitting(true); setError("");
    try {
      const { upload } = await api<{ upload: Upload }>(`/api/automation/agents/${encodeURIComponent(agentId)}/voice/sources`, { sourceUrl, rightsConfirmed: rights });
      setUploads((items) => [upload, ...items]); setShowImport(false); setSourceUrl("");
      selectSource({ slug: agentId, uploadId: upload.id });
    } catch (e) { setError((e as Error).message); }
    finally { setSubmitting(false); }
  }

  function compare(next: "source" | "result") {
    if (next === playback) return;
    resume.current = { time: player.current?.currentTime || 0, playing: Boolean(player.current && !player.current.paused) };
    setPlayback(next);
  }

  function openTool(next: Mode) {
    setMode(next);
    requestAnimationFrame(() => {
      inspector.current?.scrollTo({ top: 0 });
      if (window.matchMedia("(max-width: 1100px)").matches) inspector.current?.scrollIntoView({ block: "nearest" });
    });
  }

  function seedScenes(durationSeconds: number) {
    if (detectedScenes) return;
    const next = buildInitialScenes(durationSeconds);
    setScenes(next);
    setSelectedSceneId(next[0]?.id || "");
  }

  function seekTimeline(time: number) {
    const video = player.current;
    setPlayhead(time);
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      video.currentTime = Math.max(0, Math.min(video.duration, time));
    }
  }

  function toggleTimelinePlay() {
    const video = player.current;
    if (!video || !mediaUrl) return;
    if (video.paused) void video.play().then(() => setTimelinePlaying(true)).catch(() => setTimelinePlaying(false));
    else { video.pause(); setTimelinePlaying(false); }
  }

  useEffect(() => {
    if (!result?.timing?.sourceDurationSeconds && !result?.sourceDurationSeconds) return;
    const duration = Number(result.timing?.sourceDurationSeconds || result.sourceDurationSeconds || 0);
    if (duration > 0 && scenes.length === 0) seedScenes(duration);
  }, [result?.timing?.sourceDurationSeconds, result?.sourceDurationSeconds, result?.timing?.sceneCount, scenes.length]);

  const selectedNarrationStyle = [...NARRATION_STYLES, ...styles].find((style) => style.id === selectedStyleId) || NARRATION_STYLES[0];
  const railTools = [
    { id: "style" as const, label: "Style", icon: Sparkles },
    { id: "voiceover" as const, label: "Voice", icon: Mic },
    { id: "avatar" as const, label: "Avatar", icon: UserRound },
    { id: "subtitles" as const, label: "Captions", icon: Subtitles },
    { id: "soundtrack" as const, label: "Audio", icon: AudioLines },
    { id: "stems" as const, label: "Stems", icon: SlidersHorizontal },
  ];
  const eta = job?.etaAt ? Math.max(0, (new Date(job.etaAt).getTime() - Date.now()) / 1000) : 0;
  const tracks: Track[] = [
    ...(result?.narration ? [{ id: "narration", label: "Narration", url: result.narration.url, meta: result.profile?.name ? `Isolated narration · ${result.profile.name}` : "Isolated narration" }] : []),
    ...(result?.files || []).map((file, index) => ({ id: `stem-${index}`, label: file.label || `Track ${index + 1}`, url: file.url, meta: result?.stemEngine })),
  ];
  const canRender = mode !== "style" && !running && !!uploadId && rights
    && (mode !== "voiceover" || (online && profileId && voiceConsent))
    && (mode !== "soundtrack" || soundtrack || musicTrack)
    && (mode !== "subtitles" || !!renderJobId)
    && (mode !== "avatar" || (!!renderJobId && !!avatarFace && voiceConsent && Boolean(avatarProviders[avatarRemake.provider]?.available ?? avatarRemake.provider === "preview")));
  const previewRegion = subtitleRegion({ width: previewBox.naturalWidth, height: previewBox.naturalHeight }, subtitles);
  const hasNarration = Boolean(renderJobId && (result?.narration || result?.file));
  const renderLabel = mode === "stems" ? "Separate audio" : mode === "subtitles" ? "Apply subtitles" : mode === "avatar" ? "Render remake" : "Render video";

  return <div className="voice-workspace voice-studio-app" data-theme={theme}>
    <header className="vs-topbar">
      <div className="vs-topbar-left">
        {!embedded && <button className="voice-icon" title="Back to tools" aria-label="Back to tools" onClick={() => writeDeepLink({ view: "tools" })}><ArrowLeft size={18} /></button>}
        <strong className="vs-product">{title}</strong>
        <div className="vs-project-pickers">
          {lockAgent ? null : <SourcePicker compact theme={theme} label="Channel or agent" placeholder="Channel" value={agentId || ""} disabled={submitting} onChange={value => selectSource({ slug: value })} options={agents.map(agent => ({ value: agent.id, label: agent.channelTitle || agent.name, imageUrl: agent.channelThumbnailUrl }))} />}
          <SourcePicker compact theme={theme} label="Source video" placeholder={loading ? "Loading..." : "Video"} value={uploadId || ""} disabled={loading || submitting} onChange={value => selectSource({ slug: agentId, uploadId: value })} options={uploads.map(upload => ({ value: upload.id, label: upload.title || upload.movieTitle || upload.id, imageUrl: upload.thumbnailUrl, kind: "video" }))} />
          <button className={`voice-icon voice-import ${showImport ? "is-open" : ""}`} aria-label="Import video link" title="Import video link" aria-expanded={showImport} onClick={() => setShowImport(!showImport)}><Plus size={18} /></button>
        </div>
      </div>
      <div className="vs-topbar-center">
        <div className="voice-segmented" aria-label="Preview version">
          <button aria-pressed={playback === "source"} onClick={() => compare("source")} disabled={!source}>Original</button>
          <button aria-pressed={playback === "result"} onClick={() => compare("result")} disabled={!outputVideo}>Result</button>
        </div>
        {selected?.youtubeUrl && <a className="voice-icon" href={selected.youtubeUrl} target="_blank" rel="noreferrer" title="Open original upload" aria-label="Open original upload"><ExternalLink size={16} /></a>}
      </div>
      <div className="vs-topbar-right">
        <span className={`voice-engine ${online ? "is-online" : ""}`}><span />{online === null ? "Connecting" : online ? "Ready" : "Offline"}</span>
        <button className="voice-icon" title="Refresh voices" aria-label="Refresh voices" onClick={() => void refreshVoices().catch((e) => setError(e.message))}><RefreshCw size={16} /></button>
        {running && job && <button className="voice-button" onClick={() => void api<{ job: Job }>(`/api/automation/voice/jobs/${job.id}/stop`, {}).then(({ job: next }) => acceptJob(next)).catch((e) => setError(e.message))}><Square size={15} />Stop</button>}
        {outputVideo && <a className="voice-button" download href={outputVideo}><Download size={16} />Export</a>}
        <button className="voice-button voice-primary" disabled={!canRender} onClick={() => void run("process")}><WandSparkles size={16} />{renderLabel}</button>
      </div>
    </header>

    {showImport && <form className="voice-import-form vs-import" onSubmit={(e) => { e.preventDefault(); void importSource(); }}><input type="url" aria-label="Video URL" placeholder="https://youtube.com/watch?v=..." value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required /><button className="voice-button" disabled={!rights || !agentId || submitting}>Import video</button></form>}
    {running && <div className="vs-progress-line" role="status" aria-live="polite"><progress value={job?.progress || 0} max="100" /><span>{job?.message || "Working"} · {Math.round(job?.progress || 0)}%{eta > 0 ? ` · ~${duration(eta)} left` : ""}</span></div>}

    <div className="vs-main">
      <section className="vs-canvas" aria-label="Video canvas">
        <div className={`vs-canvas-stage vs-canvas-stage-${videoFormat}`} data-video-format={videoFormat}>
          {mediaUrl ? <video
            ref={player}
            src={mediaUrl}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              const el = e.currentTarget;
              el.currentTime = Math.min(resume.current.time, el.duration || 0);
              if (resume.current.playing) void el.play().catch(() => {});
              resume.current = { time: 0, playing: false };
              setVideoFormat(previewFormat(el.videoWidth || 16, el.videoHeight || 9));
              if (el.duration > 0 && scenes.length === 0) seedScenes(el.duration);
            }}
            onTimeUpdate={(e) => setPlayhead(e.currentTarget.currentTime || 0)}
            onPlay={() => setTimelinePlaying(true)}
            onPause={() => setTimelinePlaying(false)}
            onEnded={() => setTimelinePlaying(false)}
            onError={() => setError("This preview is unavailable or expired. Analyze the video again to refresh it.")}
          /> : <div className="voice-stage-empty">
            {selected?.thumbnailUrl ? <img src={selected.thumbnailUrl} alt={selected.title} /> : <span className="voice-stage-glyph"><Film size={28} strokeWidth={1.5} /></span>}
            <strong>{selected ? "Ready to edit" : "Select a video"}</strong>
            <p>{selected ? "Analyze to build the timeline and transcript, then edit in this full studio." : "Pick a channel video above, or import a link."}</p>
            {selected && <button className="voice-button voice-primary" disabled={running || !rights} onClick={() => void run("prepare")}>{running ? <Loader2 className="voice-spin" size={16} /> : <AudioLines size={16} />}Analyze video</button>}
            {selected && !rights && !running && <small>Confirm edit permission in the inspector first.</small>}
          </div>}
          {mode === "subtitles" && subtitles.enabled && (!subtitles.autoPlacement || subtitleEstimate) && playback === "source" && mediaUrl && <div className="voice-subtitle-preview" aria-label="Subtitle placement preview" style={{ width: previewBox.width, height: previewRegion.bandHeight * previewBox.scale, left: previewBox.left, top: previewBox.top + previewRegion.y * previewBox.scale, background: subtitles.treatment === "strip" ? "#000" : "#0006", backdropFilter: subtitles.treatment === "blur" ? "blur(12px)" : undefined }}><span style={{ color: subtitles.color, fontFamily: subtitles.font, fontWeight: subtitles.bold ? 700 : 400, fontStyle: subtitles.italic ? "italic" : "normal", fontSize: previewRegion.fontSize * previewBox.scale, WebkitTextStroke: `${subtitles.outline * previewBox.scale}px #000` }}>{script.split(/\s+/).slice(0, 6).join(" ") || "Your updated voiceover captions"}</span></div>}
        </div>
        <div className="vs-canvas-footer">
          <div>
            <h2 className="voice-video-title">{selected?.title || selected?.movieTitle || "Untitled project"}</h2>
            <div className="voice-quality-row">
              <span className={`voice-chip ${playback === "result" ? "is-accent" : ""}`}>{mediaUrl ? (playback === "result" ? "Result preview" : "Source preview") : "No media"}</span>
              {result?.timing && <span className={`voice-chip ${result.timing.passed ? "is-passed" : "is-warn"}`}>{scenes.length || result.timing.sceneCount || 1} scenes</span>}
              {mediaUrl && <span className="voice-chip is-format">{videoFormat === "portrait" ? "9:16 portrait" : videoFormat === "landscape" ? "16:9 landscape" : "1:1 square"}</span>}
              {result?.remake && <span className="voice-chip is-accent">{result.remake.layout}{avatarProviders[result.remake.provider || ""]?.label ? ` · ${avatarProviders[result.remake.provider || ""].label}` : ""}</span>}
            </div>
          </div>
          {tracks.length > 0 ? <OutputPlayer tracks={tracks} title={selected?.title || selected?.movieTitle || "Rendered audio"} /> : null}
        </div>
      </section>

      <aside className="vs-inspector" aria-label="Studio inspector">
        <div className="vs-inspector-panel" ref={inspector}>
          {mode === "avatar" ? <VoiceoverAvatarPanel
            value={avatarRemake}
            onChange={setAvatarRemake}
            faceFile={avatarFace}
            onFaceFile={(file) => {
              setAvatarFace(file);
              if (file) setAvatarRemake((current) => ({ ...current, faceName: file.name }));
            }}
            voices={voices}
            profileId={profileId}
            onProfileId={setProfileId}
            providers={avatarProviders}
            hasNarration={hasNarration}
            subtitles={subtitles}
            onSubtitles={setSubtitles}
            disabled={running}
          /> : mode === "subtitles" ? <>
            <SubtitleSettingsPanel value={subtitles} onChange={setSubtitles} running={running} canEstimate={!!uploadId} onEstimate={() => void run("subtitle-style")} estimated={subtitleEstimate} srtUrl={result?.subtitles?.srt?.url} />
            {!renderJobId && <p className="voice-notice">Render voiceover first to burn captions.</p>}
          </> : mode === "style" ? <div className="vs-tool">
            <header className="vs-tool-head"><h2><Sparkles size={16} />Style</h2></header>
            <div className="voice-style-grid">
              {NARRATION_STYLES.map((style) => (
                <button type="button" key={style.id} className={`voice-style-choice ${selectedStyleId === style.id ? "is-selected" : ""}`} onClick={() => setSelectedStyleId(style.id)}>
                  <strong>{style.name}</strong>
                  <span>{style.guide}</span>
                </button>
              ))}
              {styles.map((style) => (
                <button type="button" key={style.id} className={`voice-style-choice ${selectedStyleId === style.id ? "is-selected" : ""}`} onClick={() => setSelectedStyleId(style.id)}>
                  <strong>{style.name}</strong>
                  <span>{style.guide}</span>
                </button>
              ))}
            </div>
            <div className="voice-style-import">
              <label>
                <span>Learn from channel</span>
                <input type="url" aria-label="Reference channel URL" value={styleChannelUrl} onChange={(e) => setStyleChannelUrl(e.target.value)} placeholder="youtube.com/@channel" disabled={styleLearning || running} />
              </label>
              <button type="button" className="voice-button voice-primary" disabled={!styleChannelUrl || styleLearning || running || !uploadId} onClick={() => void run("style")}>
                <LibraryBig size={16} />{styleLearning ? "Learning…" : "Learn"}
              </button>
            </div>
          </div> : mode === "voiceover" ? <div className="vs-tool">
            <header className="vs-tool-head">
              <h2><FileText size={16} />Script</h2>
              <button className="voice-button voice-text-button" disabled={!uploadId || !rights || running} onClick={() => void run("prepare")}>
                {script ? <RefreshCw size={14} /> : <AudioLines size={14} />}{script ? "Re-analyze" : "Transcribe"}
              </button>
            </header>
            <textarea className="voice-script" aria-label="Narration script" value={script} onChange={(e) => setScript(e.target.value)} disabled={running} placeholder="Narration…" spellCheck />
            <div className="voice-script-meta">
              <span>{words.toLocaleString()} words</span>
              <label><input type="checkbox" checked={rewrite} onChange={(e) => setRewrite(e.target.checked)} disabled={running} />Rewrite</label>
            </div>
            <div className="voice-active-style">
              <Sparkles size={14} />
              <span>{selectedNarrationStyle.name}</span>
              <button type="button" onClick={() => openTool("style")}>Change</button>
            </div>
            {rewrite && (
              <button type="button" className="voice-button voice-rewrite-button" disabled={!script.trim() || !uploadId || !rights || running} onClick={() => void run("rewrite")}>
                <Sparkles size={15} />Preview rewrite
              </button>
            )}
            <div className="voice-settings">
              <label className="voice-voice-select">
                <span>Voice</span>
                <VoicePicker voices={voices as VoiceProfile[]} value={profileId} onChange={setProfileId} disabled={running || !online} placeholder="Choose voice" />
              </label>
              <button className="voice-button voice-clone" title="Clone narrator from this video" disabled={running || !online || !uploadId || !rights || !voiceConsent} onClick={() => void run("clone")}>
                <Mic size={15} />Clone
              </button>
            </div>
            <div className="voice-mix-setting">
              <label><input type="checkbox" checked={keepBackground} disabled={running} onChange={(e) => setKeepBackground(e.target.checked)} />Keep background</label>
              {keepBackground && (
                <label className="voice-volume">
                  <input type="range" min="0" max="1" step="0.05" aria-label="Background volume" value={backgroundVolume} disabled={running} onChange={(e) => setBackgroundVolume(Number(e.target.value))} />
                  <output>{Math.round(backgroundVolume * 100)}%</output>
                </label>
              )}
            </div>
          </div> : mode === "soundtrack" ? (
            <MusicLibrary
              title="Audio"
              seed={script}
              selectedId={musicTrack?.id}
              disabled={running}
              meta={musicTrack ? musicTrack.title : soundtrack?.name || ""}
              onUse={(track) => { setMusicTrack(track); setSoundtrack(null); }}
              onImport={(file) => { setSoundtrack(file); setMusicTrack(null); }}
            >
              <label className="ml-range">
                <span>Level</span>
                <input type="range" min="0" max="1" step="0.05" aria-label="Music level" value={backgroundVolume} disabled={running} onChange={(e) => setBackgroundVolume(Number(e.target.value))} />
                <output>{Math.round(backgroundVolume * 100)}%</output>
              </label>
              <label className="ml-check">
                <input type="checkbox" checked={preserveDialogue} onChange={(e) => setPreserveDialogue(e.target.checked)} disabled={running} />
                Keep dialogue
              </label>
            </MusicLibrary>
          ) : (
            <div className="vs-tool">
              <header className="vs-tool-head"><h2><SlidersHorizontal size={16} />Stems</h2></header>
              <p className="vs-tool-blurb">Export vocals and accompaniment as WAV.</p>
              <span className="voice-chip">{stemEngine || "Checking engine…"}</span>
            </div>
          )}

          <div className="voice-consents vs-consents">
            <label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />Permission to edit this video</label>
            {(mode === "voiceover" || mode === "avatar") && <label><input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />Permission to use this voice</label>}
          </div>
          {result?.rewrite?.originalScript && <details className="voice-script-comparison"><summary>Compare scripts</summary><div><section><h3>Original</h3><p>{result.rewrite.originalScript}</p></section><section><h3>Rendered</h3><p>{result.rewrite.rewrittenScript}</p></section></div></details>}
        </div>
        <nav className="vs-rail" role="tablist" aria-label="Studio tools">
          {railTools.map(({ id, label: tabLabel, icon: Icon }) => (
            <button role="tab" aria-selected={mode === id} key={id} type="button" onClick={() => { openTool(id); if (id === "subtitles" && source) compare("source"); }} disabled={running}>
              <Icon size={18} strokeWidth={1.75} />
              <span>{tabLabel}</span>
              {id === "style" && selectedStyleId !== "original" ? <i aria-label="Style selected" /> : null}
            </button>
          ))}
        </nav>
      </aside>
    </div>

    <div className="vs-timeline-shell">
      <VoiceoverTimeline
        key={uploadId}
        scenes={scenes}
        playhead={playhead}
        playing={timelinePlaying}
        selectedId={selectedSceneId}
        disabled={running}
        detectedScenes={detectedScenes}
        detecting={running && job?.action === "detect-scenes"}
        canAutoSplit={Boolean(uploadId)}
        onAutoSplit={() => void run("detect-scenes")}
        avatarActive={Boolean(avatarFace || result?.remake)}
        thumbnailUrl={selected?.thumbnailUrl}
        narrationLabel={result?.narration ? result.profile?.name || "Rendered narration" : undefined}
        musicLabel={musicTrack?.title || soundtrack?.name}
        onOpenMusic={() => openTool("soundtrack")}
        onOpenAvatar={() => { setAvatarRemake(value => ({ ...value, layout: "split" })); openTool("avatar"); }}
        onOpenNarration={() => openTool("voiceover")}
        onScenesChange={(next) => { setScenes(next); if (!next.some((scene) => scene.id === selectedSceneId)) setSelectedSceneId(next[0]?.id || ""); }}
        onSelect={setSelectedSceneId}
        onSeek={seekTimeline}
        onTogglePlay={toggleTimelinePlay}
      />
    </div>
  </div>;
}
