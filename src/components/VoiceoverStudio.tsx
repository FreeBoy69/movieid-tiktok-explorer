import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, AudioLines, Check, Download, ExternalLink, FileText, Film, Loader2, Mic, Pause, Play, Plus, RefreshCw, Search, Square, WandSparkles, Sparkles, SlidersHorizontal, LibraryBig, Subtitles, UserRound } from "lucide-react";
import { writeDeepLink } from "../utils/tiktokRoute";
import { NARRATION_STYLES } from "../utils/narrationStyle.js";
import { DEFAULT_SUBTITLES, normalizeSubtitleSettings, subtitleRegion } from "../utils/voiceoverSubtitles.js";
import { inferMusicMood, pixabayMusicSearchUrl } from "../utils/royaltyFreeMusic.js";
import { buildInitialScenes } from "../utils/voiceoverTimeline.js";
import { DEFAULT_AVATAR_REMAKE, normalizeAvatarRemake } from "../utils/avatarRemake.js";
import { SubtitleSettingsPanel, type SubtitleSettings } from "./SubtitleSettingsPanel";
import { VoiceoverAvatarPanel, type AvatarRemakeSettings } from "./VoiceoverAvatarPanel";
import { VoiceoverTimeline } from "./VoiceoverTimeline";
import "./VoiceoverStudio.css";

type Agent = { id: string; name: string; youtubeAccountId?: string };
type Upload = { id: string; title: string; movieTitle?: string; thumbnailUrl?: string; youtubeUrl?: string; sourceUrl?: string };
type Voice = { id: string; name: string; voiceType: string; sampleCount: number; language?: string };
type Media = { url: string; label?: string };
type Style = { id: string; name: string; guide: string; sourceUrl?: string; presetId?: string; samples?: Array<{ title: string; url: string; excerpt?: string }> };
type Result = {
  mode: string; script?: string; source?: Media; narration?: Media; file?: Media; files?: Media[];
  profile?: Voice; sourceDurationSeconds?: number; stemEngine?: string;
  rewrite?: { requested: boolean; passed: boolean; originalScript: string; rewrittenScript: string; narrationStyle?: Style | null };
  style?: Style;
  subtitles?: { settings: SubtitleSettings; cueCount: number; srt?: Media };
  subtitleStyle?: Partial<SubtitleSettings> & { sampleCount: number };
  remake?: AvatarRemakeSettings & { provider?: string; durationSeconds?: number };
  avatar?: Media;
  renderJobId?: string;
  timing?: { passed: boolean; sourceDurationSeconds: number; outputDurationSeconds: number; durationDeltaSeconds: number; sceneCount: number };
};
type Job = { id: string; status: string; progress: number; message: string; error?: string; result?: Result; etaAt?: string | number };
type Mode = "style" | "voiceover" | "avatar" | "soundtrack" | "stems" | "subtitles";
type TimelineScene = {
  id: string;
  start: number;
  end: number;
  label?: string;
  sourceStart?: number;
  sourceEnd?: number;
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
type MusicTrack = { id: string; title: string; creator: string; provider: string; url: string; landingUrl: string; license: string; licenseUrl: string; attribution: string; durationSeconds: number | null; tags: string[] };
type PreviewFormat = "portrait" | "landscape" | "square";

function previewFormat(width: number, height: number): PreviewFormat {
  const ratio = width / Math.max(1, height);
  return ratio < 0.85 ? "portrait" : ratio > 1.2 ? "landscape" : "square";
}

/** Compact dock player for rendered narration and stems: one transport, a track switcher, and a seekable timeline. */
function OutputPlayer({ tracks, title }: { tracks: Track[]; title: string }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [trackId, setTrackId] = useState(tracks[0]?.id || "");
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(0);
  const track = tracks.find((item) => item.id === trackId) || tracks[0];

  useEffect(() => { if (!tracks.some((item) => item.id === trackId)) setTrackId(tracks[0]?.id || ""); }, [tracks, trackId]);
  useEffect(() => { setPlaying(false); setTime(0); setLength(0); }, [track?.url]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = audio.current;
      if (!el) return;
      setTime(el.currentTime || 0);
      if (!el.paused && !el.ended) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, track?.url]);

  function syncLength(el: HTMLAudioElement) {
    if (Number.isFinite(el.duration) && el.duration > 0) setLength(el.duration);
  }
  function toggle() {
    const el = audio.current;
    if (!el || !track) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }
  function seek(next: number) {
    const el = audio.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(length || el.duration || 0, next));
    setTime(el.currentTime);
  }
  function chooseTrack(id: string) {
    if (id === trackId) return;
    audio.current?.pause();
    setTrackId(id);
  }

  const pct = length ? Math.max(0, Math.min(100, (time / length) * 100)) : 0;
  return <div className="voice-player" aria-label="Audio output player">
    <audio ref={audio} src={track?.url} preload="metadata" onLoadedMetadata={(e) => syncLength(e.currentTarget)} onDurationChange={(e) => syncLength(e.currentTarget)} onTimeUpdate={(e) => setTime(e.currentTarget.currentTime || 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <button type="button" className="voice-player-play" onClick={toggle} disabled={!track} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button>
    <div className="voice-player-info">
      <strong>{title}</strong>
      {tracks.length > 1
        ? <div className="voice-player-tracks" role="tablist" aria-label="Audio track">{tracks.map((item) => <button type="button" role="tab" aria-selected={item.id === track?.id} key={item.id} onClick={() => chooseTrack(item.id)}>{item.label}</button>)}</div>
        : <span>{track?.meta || track?.label}</span>}
    </div>
    <div className="voice-player-scrub">
      <span>{duration(time)}</span>
      <input type="range" min={0} max={length || 0} step={0.01} value={Math.min(time, length || 0)} disabled={!length} aria-label="Seek" aria-valuetext={`${duration(time)} of ${duration(length)}`} style={{ "--p": `${pct}%` } as CSSProperties} onChange={(e) => seek(Number(e.target.value))} />
      <span>{duration(length)}</span>
    </div>
    {track ? <a className="voice-icon voice-player-download" href={track.url} download aria-label="Download this track" title="Download this track"><Download size={16} /></a> : null}
  </div>;
}

function RoyaltyFreeMusicPanel({ transcript, selectedId, onSelect, onImport, disabled }: { transcript: string; selectedId?: string; onSelect: (track: MusicTrack) => void; onImport: (file: File) => void; disabled: boolean }) {
  const [library, setLibrary] = useState("openverse");
  const searchRequest = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mood, setMood] = useState(() => inferMusicMood(transcript));
  const [searched, setSearched] = useState(false);

  async function searchMusic(nextQuery = query || mood.query) {
    searchRequest.current?.abort();
    const controller = new AbortController();
    searchRequest.current = controller;
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ q: nextQuery });
      const data = await api<{ tracks: MusicTrack[] }>(`/api/automation/voice/music/search?${params.toString()}`, undefined, controller.signal);
      if (!controller.signal.aborted) { setTracks(data.tracks || []); setSearched(true); setQuery(nextQuery); }
    } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }

  useEffect(() => {
    const nextMood = inferMusicMood(transcript);
    setMood(nextMood); setQuery(nextMood.query);
    const timer = window.setTimeout(() => { if (library === "openverse") void searchMusic(nextMood.query); }, 450);
    return () => { window.clearTimeout(timer); searchRequest.current?.abort(); };
    // Debounce script edits so the provider sees one deliberate query, not one request per keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transcript]);

  return <div className="voice-music-panel">
    <div className="voice-music-intro"><div className="voice-music-icon"><AudioLines size={22} /></div><div><h2>Audio library</h2></div></div>
    <label className="voice-library-picker"><span>Library</span><select aria-label="Audio library provider" value={library} disabled={disabled} onChange={e => { searchRequest.current?.abort(); setLibrary(e.target.value); setError(""); setLoading(false); if (e.target.value === "openverse") void searchMusic(query); }}><option value="openverse">Openverse · CC0 / CC BY</option><option value="pixabay">Pixabay Music</option><option value="upload">Your audio</option></select></label>
    {library !== "upload" && <>
    <div className="voice-music-search">
      <label><span>Search mood or style</span><div className="voice-music-input"><Search size={15} /><input value={query} disabled={disabled} aria-label="Search royalty-free music" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && library === "openverse") void searchMusic(); }} />{library === "openverse" && <button type="button" onClick={() => void searchMusic()} disabled={disabled || loading || !query.trim()} aria-label="Search music"><Search size={15} /></button>}</div></label>
      <div className="voice-mood-row" aria-label="Suggested moods">{["upbeat", "calm", "dramatic", "sad", "inspiring"].map((item) => <button type="button" key={item} disabled={disabled} aria-pressed={mood.id === item} className={mood.id === item ? "is-selected" : ""} onClick={() => { const next = `${item} instrumental`; setMood({ ...inferMusicMood(item), id: item, query: next }); setQuery(next); if (library === "openverse") void searchMusic(next); }}>{item}</button>)}</div>
    </div>
    {library === "pixabay" && <div className="voice-provider-import"><a className="voice-button" href={pixabayMusicSearchUrl(query)} target="_blank" rel="noreferrer"><ExternalLink size={15} />Search Pixabay</a><p>Download your chosen track on Pixabay, then import it here.</p></div>}
    </>}
    {error && <div className="voice-music-error" role="alert">{error}<button type="button" onClick={() => void searchMusic()}><RefreshCw size={14} />Retry</button></div>}
    {library === "openverse" && (loading ? <div className="voice-music-loading"><Loader2 className="voice-spin" size={17} />Finding music...</div> : tracks.length ? <div className="voice-music-results" aria-label="Royalty-free music results">{tracks.map((track) => <article className={`voice-music-result ${selectedId === track.id ? "is-selected" : ""}`} key={track.id}><div className="voice-music-result-main"><strong>{track.title}</strong><span>{track.creator} · {track.provider} · {track.license}</span><small>{track.attribution}</small></div><div className="voice-music-result-actions"><audio controls preload="none" src={track.url} aria-label={`Preview ${track.title}`} onPlay={e => { e.currentTarget.closest(".voice-music-results")?.querySelectorAll("audio").forEach(audio => { if (audio !== e.currentTarget) audio.pause(); }); }} /><button type="button" className="voice-button voice-primary voice-button-small" disabled={disabled} onClick={() => onSelect(track)}>{selectedId === track.id ? <><Check size={14} />Selected</> : "Use track"}</button><a href={track.landingUrl} target="_blank" rel="noreferrer" aria-label={`Open ${track.title} source`}><ExternalLink size={15} /></a></div></article>)}</div> : searched ? <div className="voice-music-empty">No CC0 or CC BY tracks matched. Try a broader mood or import a downloaded file.</div> : null)}
    <div className="voice-music-import"><input type="file" accept="audio/*" aria-label="Import soundtrack" disabled={disabled} onChange={(e) => { const file = e.target.files?.[0]; if (file) onImport(file); }} /><span>{library === "openverse" ? "CC BY tracks require credit in your published description." : "Audio file, up to 60 MB"}</span></div>
  </div>;
}

export function VoiceoverStudio({ theme, agentId, uploadId, accountId }: { theme: "light" | "dark"; agentId?: string; uploadId?: string; accountId?: string }) {
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
  const [musicTrack, setMusicTrack] = useState<MusicTrack | null>(null);
  const [playback, setPlayback] = useState<"source" | "result">("source");
  const [scenes, setScenes] = useState<TimelineScene[]>([]);
  const [selectedSceneId, setSelectedSceneId] = useState("");
  const [playhead, setPlayhead] = useState(0);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const resume = useRef({ time: 0, playing: false });
  const selection = useRef(uploadId);
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
    setVoices(data.profiles.filter((voice) => voice.voiceType !== "cloned" || voice.sampleCount > 0));
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
        if (first) writeDeepLink({ view: "voiceover", slug: first.id }, true);
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
      if (!uploadId && data.uploads[0]) writeDeepLink({ view: "voiceover", slug: agentId, uploadId: data.uploads[0].id }, true);
    }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setLoading(false); } });
    return () => controller.abort();
  }, [agentId]);

  function acceptJob(next: Job) {
    setJob(next);
    if (next.status === "error") setError(next.error || next.message);
    if (next.status !== "done" || !next.result) return;
    const data = next.result;
    if (data.source) setSource(data.source);
    if (data.mode === "subtitle-style" && data.subtitleStyle) {
      setSubtitles((current) => normalizeSubtitleSettings({ ...current, ...data.subtitleStyle }));
      setSubtitleEstimate(`Estimated from ${data.subtitleStyle.sampleCount} frames. Font family is approximate; review placement.`);
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
    setJob(null); setResult(null); setSource(null); setScript(""); setPreparedJobId(""); setError("");
    setRenderJobId(""); setSubtitles({ ...DEFAULT_SUBTITLES }); setSubtitleEstimate(""); setSoundtrack(null); setMusicTrack(null); setVideoFormat("landscape");
    setAvatarRemake(normalizeAvatarRemake(DEFAULT_AVATAR_REMAKE) as AvatarRemakeSettings); setAvatarFace(null);
    setPlayback("source");
    setScenes([]); setSelectedSceneId(""); setPlayhead(0); setTimelinePlaying(false);
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

  async function run(action: "prepare" | "process" | "clone" | "style" | "rewrite" | "subtitle-style") {
    if (!uploadId || running) return;
    const target = uploadId;
    setSubmitting(true); setError(""); setJob(null);
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
        action, mode: action === "style" || action === "rewrite" ? "voiceover" : mode, profileId, profileName: `${selected?.title || "Source"} narrator`, script, preparedJobId: preparedJobId || undefined,
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
      writeDeepLink({ view: "voiceover", slug: agentId, uploadId: upload.id });
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

  function seedScenes(durationSeconds: number, sceneCount?: number) {
    const next = buildInitialScenes(durationSeconds, { sceneCount: sceneCount || Math.max(1, Math.round(Number(result?.timing?.sceneCount) || 1)) });
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
    if (duration > 0 && scenes.length === 0) seedScenes(duration, result.timing?.sceneCount);
  }, [result?.timing?.sourceDurationSeconds, result?.sourceDurationSeconds, result?.timing?.sceneCount, scenes.length]);

  const selectedNarrationStyle = [...NARRATION_STYLES, ...styles].find((style) => style.id === selectedStyleId) || NARRATION_STYLES[0];
  const railTools = [
    { id: "style" as const, label: "Style", icon: Sparkles },
    { id: "voiceover" as const, label: "Voiceover", icon: Mic },
    { id: "avatar" as const, label: "Split screen", icon: UserRound },
    { id: "subtitles" as const, label: "Captions", icon: Subtitles },
    { id: "soundtrack" as const, label: "Audio library", icon: AudioLines },
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
        <button className="voice-icon" title="Back to tools" aria-label="Back to tools" onClick={() => writeDeepLink({ view: "tools" })}><ArrowLeft size={18} /></button>
        <strong className="vs-product">Voiceover Studio</strong>
        <div className="vs-project-pickers">
          <select aria-label="Channel or agent" value={agentId || ""} disabled={submitting} onChange={(e) => writeDeepLink({ view: "voiceover", slug: e.target.value })}>
            <option value="" disabled>Channel</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <select aria-label="Source video" value={uploadId || ""} disabled={loading || submitting} onChange={(e) => writeDeepLink({ view: "voiceover", slug: agentId, uploadId: e.target.value })}>
            <option value="">{loading ? "Loading…" : "Video"}</option>
            {uploads.map((upload) => <option key={upload.id} value={upload.id}>{upload.title || upload.movieTitle || upload.id}</option>)}
          </select>
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
    {error && <div className="voice-error vs-banner" role="alert"><span>{error}</span><button className="voice-icon" aria-label="Dismiss error" onClick={() => setError("")}><Check size={16} /></button></div>}
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
              if (el.duration > 0 && scenes.length === 0) seedScenes(el.duration, result?.timing?.sceneCount);
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
          {mode === "subtitles" && playback === "source" && mediaUrl && <div className="voice-subtitle-preview" aria-label="Subtitle placement preview" style={{ width: previewBox.width, height: previewRegion.bandHeight * previewBox.scale, left: previewBox.left, top: previewBox.top + previewRegion.y * previewBox.scale, background: subtitles.treatment === "strip" ? "#000" : "#0006", backdropFilter: subtitles.treatment === "blur" ? "blur(12px)" : undefined }}><span style={{ color: subtitles.color, fontFamily: subtitles.font, fontWeight: subtitles.bold ? 700 : 400, fontStyle: subtitles.italic ? "italic" : "normal", fontSize: previewRegion.fontSize * previewBox.scale, WebkitTextStroke: `${subtitles.outline * previewBox.scale}px #000` }}>{script.split(/\s+/).slice(0, 6).join(" ") || "Your updated voiceover captions"}</span></div>}
        </div>
        <div className="vs-canvas-footer">
          <div>
            <h2 className="voice-video-title">{selected?.title || selected?.movieTitle || "Untitled project"}</h2>
            <div className="voice-quality-row">
              <span className={`voice-chip ${playback === "result" ? "is-accent" : ""}`}>{mediaUrl ? (playback === "result" ? "Result preview" : "Source preview") : "No media"}</span>
              {result?.timing && <span className={`voice-chip ${result.timing.passed ? "is-passed" : "is-warn"}`}>{scenes.length || result.timing.sceneCount || 1} scenes</span>}
              {mediaUrl && <span className="voice-chip is-format">{videoFormat === "portrait" ? "9:16 portrait" : videoFormat === "landscape" ? "16:9 landscape" : "1:1 square"}</span>}
              {result?.remake && <span className="voice-chip is-accent">{result.remake.layout} · {result.remake.provider}</span>}
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
            disabled={running}
          /> : mode === "subtitles" ? <><SubtitleSettingsPanel value={subtitles} onChange={setSubtitles} running={running} canEstimate={!!uploadId && rights} onEstimate={() => void run("subtitle-style")} estimated={subtitleEstimate} srtUrl={result?.subtitles?.srt?.url} />{!renderJobId && <p className="voice-notice">Render a voiceover first to apply updated captions.</p>}</> : mode === "style" ? <>
            <div className="voice-panel-heading"><div><h2><Sparkles size={17} />Narration style</h2><p>Set the writing direction before you rewrite or render.</p></div><span className="voice-style-sample">{selectedStyleId === "original" ? "Built-in" : "3 samples"}</span></div>
            <div className="voice-style-grid">{NARRATION_STYLES.map((style) => <button type="button" key={style.id} className={`voice-style-choice ${selectedStyleId === style.id ? "is-selected" : ""}`} onClick={() => setSelectedStyleId(style.id)}><strong>{style.name}</strong><span>{style.guide}</span></button>)}{styles.map((style) => <button type="button" key={style.id} className={`voice-style-choice ${selectedStyleId === style.id ? "is-selected" : ""}`} onClick={() => setSelectedStyleId(style.id)}><strong>{style.name}</strong><span>{style.guide}</span><small>Learned from 3 transcripts</small></button>)}</div>
            <div className="voice-style-import"><label><span>Reference channel</span><input type="url" aria-label="Reference channel URL" value={styleChannelUrl} onChange={(e) => setStyleChannelUrl(e.target.value)} placeholder="https://youtube.com/@channel" disabled={styleLearning || running} /></label><button type="button" className="voice-button voice-primary" disabled={!styleChannelUrl || styleLearning || running || !uploadId} onClick={() => void run("style")}><LibraryBig size={16} />{styleLearning ? "Reading 3 videos..." : "Learn from 3 videos"}</button></div>
            <div className="voice-style-guide"><span>Active guide</span><p>{selectedNarrationStyle.guide}</p>{selectedNarrationStyle.sourceUrl ? <a href={selectedNarrationStyle.sourceUrl} target="_blank" rel="noreferrer">Open reference channel</a> : null}</div>
          </> : mode === "voiceover" ? <>
            <div className="voice-script-toolbar"><h2><FileText size={16} />Script</h2><button className="voice-button voice-text-button" disabled={!uploadId || !rights || running} onClick={() => void run("prepare")}>{script ? <RefreshCw size={14} /> : <AudioLines size={14} />}{script ? "Re-analyze" : "Transcribe"}</button></div>
            <textarea className="voice-script" aria-label="Narration script" value={script} onChange={(e) => setScript(e.target.value)} disabled={running} placeholder="Transcript or your rewritten narration..." spellCheck />
            <div className="voice-script-meta"><span>{words.toLocaleString()} words</span><label><input type="checkbox" checked={rewrite} onChange={(e) => setRewrite(e.target.checked)} disabled={running} />Rewrite before rendering</label></div>
            <div className="voice-active-style"><Sparkles size={14} /><span>{selectedNarrationStyle.name}</span><button type="button" onClick={() => setMode("style")}>Change style</button></div>
            {rewrite && <button type="button" className="voice-button voice-rewrite-button" disabled={!script.trim() || !uploadId || !rights || running} onClick={() => void run("rewrite")}><Sparkles size={15} />Preview rewritten script</button>}
            <div className="voice-settings"><label className="voice-voice-select"><span>Narrator</span><select aria-label="Narrator voice" value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={running || !online}><option value="">Choose a voice</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label><button className="voice-button voice-clone" title="Clone the narrator from this video" disabled={running || !online || !uploadId || !rights || !voiceConsent} onClick={() => void run("clone")}><Mic size={15} />Clone voice</button></div>
            <div className="voice-mix-setting"><label><input type="checkbox" checked={keepBackground} disabled={running} onChange={(e) => setKeepBackground(e.target.checked)} />Keep separated background</label>{keepBackground && <label className="voice-volume"><input type="range" min="0" max="1" step="0.05" aria-label="Background volume" value={backgroundVolume} disabled={running} onChange={(e) => setBackgroundVolume(Number(e.target.value))} /><output>{Math.round(backgroundVolume * 100)}%</output></label>}</div>
            {keepBackground && !stemEngine.includes("Demucs") && <p className="voice-notice">Center extraction may remove music or leave voice residue. AI separation is not configured.</p>}
          </> : mode === "soundtrack" ? <div className="voice-audio-upload voice-audio-upload-wide"><RoyaltyFreeMusicPanel transcript={script} selectedId={musicTrack?.id} disabled={running} onSelect={(track) => { setMusicTrack(track); setSoundtrack(null); }} onImport={(file) => { setSoundtrack(file); setMusicTrack(null); }} /><div className="voice-soundtrack-controls"><span>{musicTrack ? `${musicTrack.title} · ${musicTrack.license}` : soundtrack ? soundtrack.name : "No local track selected"}</span><label className="voice-slider-row"><span>Music level</span><input type="range" min="0" max="1" step="0.05" aria-label="Music level" value={backgroundVolume} disabled={running} onChange={(e) => setBackgroundVolume(Number(e.target.value))} /><output>{Math.round(backgroundVolume * 100)}%</output></label><label><input type="checkbox" checked={preserveDialogue} onChange={(e) => setPreserveDialogue(e.target.checked)} disabled={running} />Keep the saved narration/dialogue</label></div></div> : <div className="voice-audio-upload"><SlidersHorizontal size={32} strokeWidth={1.5} /><h2>Dialogue &amp; background</h2><p>Export isolated tracks for editing or reuse.</p><span>{stemEngine || "Checking separation engine"}</span><span>Two WAV files: vocals and accompaniment</span></div>}

          <div className="voice-consents vs-consents">
            <label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />I have permission to edit this video.</label>
            {(mode === "voiceover" || mode === "avatar") && <label><input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />I have permission to use the selected voice.</label>}
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
