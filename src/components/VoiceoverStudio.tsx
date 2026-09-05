import { useEffect, useRef, useState } from "react";
import { ArrowLeft, AudioLines, Check, Download, ExternalLink, FileText, Film, Loader2, Mic, Plus, RefreshCw, Square, WandSparkles } from "lucide-react";
import { writeDeepLink } from "../utils/tiktokRoute";
import "./VoiceoverStudio.css";

type Agent = { id: string; name: string; youtubeAccountId?: string };
type Upload = { id: string; title: string; movieTitle?: string; thumbnailUrl?: string; youtubeUrl?: string; sourceUrl?: string };
type Voice = { id: string; name: string; voiceType: string; sampleCount: number; language?: string };
type Media = { url: string; label?: string };
type Result = {
  mode: string; script?: string; source?: Media; narration?: Media; file?: Media; files?: Media[];
  profile?: Voice; sourceDurationSeconds?: number; stemEngine?: string;
  timing?: { passed: boolean; sourceDurationSeconds: number; outputDurationSeconds: number; durationDeltaSeconds: number; sceneCount: number };
};
type Job = { id: string; status: string; progress: number; message: string; error?: string; result?: Result; etaAt?: string | number };
type Mode = "voiceover" | "soundtrack" | "stems";

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

export function VoiceoverStudio({ theme, agentId, uploadId, accountId }: { theme: "light" | "dark"; agentId?: string; uploadId?: string; accountId?: string }) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [voices, setVoices] = useState<Voice[]>([]);
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
  const [rewrite, setRewrite] = useState(true);
  const [keepBackground, setKeepBackground] = useState(false);
  const [backgroundVolume, setBackgroundVolume] = useState(0.3);
  const [rights, setRights] = useState(false);
  const [voiceConsent, setVoiceConsent] = useState(false);
  const [sourceUrl, setSourceUrl] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [soundtrack, setSoundtrack] = useState<File | null>(null);
  const [playback, setPlayback] = useState<"source" | "result">("source");
  const [currentTime, setCurrentTime] = useState(0);
  const [mediaDuration, setMediaDuration] = useState(0);
  const player = useRef<HTMLVideoElement>(null);
  const resume = useRef({ time: 0, playing: false });
  const selection = useRef(uploadId);
  selection.current = uploadId;
  const selected = uploads.find((item) => item.id === uploadId);
  const running = submitting || job?.status === "queued" || job?.status === "running";
  const words = script.trim().split(/\s+/).filter(Boolean).length;
  const outputVideo = result?.file?.url;
  const mediaUrl = playback === "result" ? outputVideo : source?.url;

  async function refreshVoices() {
    const data = await api<{ online: boolean; profiles: Voice[]; stemEngine: string; error?: string }>("/api/automation/voice/status");
    setOnline(data.online);
    setStemEngine(data.stemEngine);
    setVoices(data.profiles.filter((voice) => voice.voiceType !== "cloned" || voice.sampleCount > 0));
    if (!data.online) setError(data.error || "Voice engine is offline. Reconnect it and retry.");
  }

  useEffect(() => { void refreshVoices().catch((e) => setError(e.message)); }, []);
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
    if (data.mode === "transcript") {
      setPreparedJobId(next.id);
      setScript(data.script || "");
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
    setPlayback("source"); setCurrentTime(0); setMediaDuration(0);
    if (!uploadId) return;
    const controller = new AbortController();
    void api<{ job: Job | null }>(`/api/automation/uploads/${encodeURIComponent(uploadId)}/voice/jobs/latest`, undefined, controller.signal)
      .then(({ job: latest }) => { if (latest) acceptJob(latest); })
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

  async function run(action: "prepare" | "process" | "clone") {
    if (!uploadId || running) return;
    const target = uploadId;
    setSubmitting(true); setError("");
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
      const { job: next } = await api<{ job: Job }>(`/api/automation/uploads/${encodeURIComponent(target)}/voice/jobs`, {
        action, mode, profileId, profileName: `${selected?.title || "Source"} narrator`, script, preparedJobId: preparedJobId || undefined,
        rewrite, preserveBackground: keepBackground, backgroundVolume, preserveCharacterVoices: false, preserveDialogue: true,
        requireSourceVoiceClone: false, useUploadedVideo: Boolean(selected?.youtubeUrl), rightsConfirmed: rights, voiceConsentConfirmed: voiceConsent,
        soundtrackBase64, soundtrackExtension: soundtrack ? `.${soundtrack.name.split(".").pop()}` : undefined,
      });
      if (selection.current === target) acceptJob(next);
    } catch (e) { if (selection.current === target) setError((e as Error).message); }
    finally { setSubmitting(false); }
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

  const eta = job?.etaAt ? Math.max(0, (new Date(job.etaAt).getTime() - Date.now()) / 1000) : 0;
  const canRender = !running && !!uploadId && rights && (mode !== "voiceover" || (online && profileId && voiceConsent)) && (mode !== "soundtrack" || soundtrack);
  return <div className="voice-workspace" data-theme={theme}>
    <header className="voice-heading">
      <div className="voice-heading-title"><button className="voice-icon" title="Back to tools" aria-label="Back to tools" onClick={() => writeDeepLink({ view: "tools" })}><ArrowLeft size={18} /></button><h1>Voiceover Studio</h1></div>
      <div className="voice-heading-actions"><span className={`voice-engine ${online ? "is-online" : ""}`}><span />{online === null ? "Connecting" : online ? "Voice engine ready" : "Voice engine offline"}</span><button className="voice-icon" title="Refresh voices" aria-label="Refresh voices" onClick={() => void refreshVoices().catch((e) => setError(e.message))}><RefreshCw size={16} /></button></div>
    </header>

    <div className="voice-source-bar">
      <label><span>Channel / agent</span><select aria-label="Channel or agent" value={agentId || ""} disabled={submitting} onChange={(e) => writeDeepLink({ view: "voiceover", slug: e.target.value })}><option value="" disabled>Select a channel</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
      <label className="voice-upload-picker"><span>Video</span><select aria-label="Source video" value={uploadId || ""} disabled={loading || submitting} onChange={(e) => writeDeepLink({ view: "voiceover", slug: agentId, uploadId: e.target.value })}><option value="">{loading ? "Loading uploads..." : "Select an upload"}</option>{uploads.map((upload) => <option key={upload.id} value={upload.id}>{upload.title || upload.movieTitle || upload.id}</option>)}</select></label>
      <button className="voice-icon voice-import" aria-label="Import video link" title="Import video link" aria-expanded={showImport} onClick={() => setShowImport(!showImport)}><Plus size={19} /></button>
    </div>
    {showImport && <form className="voice-import-form" onSubmit={(e) => { e.preventDefault(); void importSource(); }}><input type="url" aria-label="Video URL" placeholder="https://youtube.com/watch?v=..." value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} required /><button className="voice-button" disabled={!rights || !agentId || submitting}>Import video</button></form>}
    {error && <div className="voice-error" role="alert"><span>{error}</span><button className="voice-icon" aria-label="Dismiss error" onClick={() => setError("")}> <Check size={16} /></button></div>}

    <div className="voice-editing-grid">
      <section className="voice-preview-column" aria-label="Video preview">
        <div className="voice-stage-top"><div className="voice-segmented" aria-label="Preview version"><button aria-pressed={playback === "source"} onClick={() => compare("source")} disabled={!source}>Original</button><button aria-pressed={playback === "result"} onClick={() => compare("result")} disabled={!outputVideo}>Revoiced</button></div>{selected?.youtubeUrl && <a className="voice-icon" href={selected.youtubeUrl} target="_blank" rel="noreferrer" title="Open original upload" aria-label="Open original upload"><ExternalLink size={16} /></a>}</div>
        <div className="voice-stage">
          {mediaUrl ? <video ref={player} src={mediaUrl} controls playsInline preload="metadata" onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => { setMediaDuration(e.currentTarget.duration); e.currentTarget.currentTime = Math.min(resume.current.time, e.currentTarget.duration); if (resume.current.playing) void e.currentTarget.play().catch(() => {}); resume.current = { time: 0, playing: false }; }} onError={() => setError("This preview is unavailable or expired. Analyze the video again to refresh it.")} /> : <div className="voice-stage-empty">{selected?.thumbnailUrl ? <img src={selected.thumbnailUrl} alt={selected.title} /> : <Film size={36} strokeWidth={1.25} />}<strong>{selected ? "Ready for a new voice" : "Select a video"}</strong>{selected && <button className="voice-button voice-primary" disabled={running || !rights} onClick={() => void run("prepare")}>{running ? <Loader2 className="voice-spin" size={16} /> : <AudioLines size={16} />}Analyze video</button>}</div>}
        </div>
        <div className="voice-timebar"><span>{duration(currentTime)} / {duration(mediaDuration)}</span><span>{playback === "result" ? "New voiceover" : "Original audio"}</span></div>
        <h2 className="voice-video-title">{selected?.title || selected?.movieTitle || "No video selected"}</h2>
        {result?.timing && <div className={`voice-quality ${result.timing.passed ? "is-passed" : ""}`}><Check size={16} /><span>{result.timing.passed ? "Timing checks passed" : "Timing needs review"}</span><span>{result.timing.sceneCount || 1} scenes</span><span>{result.timing.durationDeltaSeconds.toFixed(3)}s difference</span></div>}
        {result?.narration && <div className="voice-narration"><h3>Isolated narration</h3><audio controls src={result.narration.url} preload="metadata" /></div>}
        {!!result?.files?.length && <div className="voice-stem-files">{result.files.map((file) => <div key={file.url}><h3>{file.label}</h3><audio controls src={file.url} preload="metadata" /><a href={file.url} download className="voice-button"><Download size={15} />Download</a></div>)}</div>}
      </section>

      <section className="voice-editor-column" aria-label="Voiceover editor">
        <div className="voice-mode-tabs" role="tablist" aria-label="Audio operation">{([{ id: "voiceover", label: "Voiceover", icon: Mic }, { id: "soundtrack", label: "Soundtrack", icon: AudioLines }, { id: "stems", label: "Stems", icon: Film }] as const).map(({ id, label, icon: Icon }) => <button role="tab" aria-selected={mode === id} key={id} onClick={() => setMode(id)} disabled={running}><Icon size={16} />{label}</button>)}</div>
        {mode === "voiceover" ? <>
          <div className="voice-script-toolbar"><h2><FileText size={16} />Script</h2><button className="voice-button voice-text-button" disabled={!uploadId || !rights || running} onClick={() => void run("prepare")}>{script ? <RefreshCw size={14} /> : <AudioLines size={14} />}{script ? "Re-analyze" : "Transcribe"}</button></div>
          <textarea className="voice-script" aria-label="Narration script" value={script} onChange={(e) => setScript(e.target.value)} disabled={running} placeholder="Transcript or your rewritten narration..." spellCheck />
          <div className="voice-script-meta"><span>{words.toLocaleString()} words</span><label><input type="checkbox" checked={rewrite} onChange={(e) => setRewrite(e.target.checked)} disabled={running} />Rewrite before rendering</label></div>
          <div className="voice-settings"><label className="voice-voice-select"><span>Narrator</span><select aria-label="Narrator voice" value={profileId} onChange={(e) => setProfileId(e.target.value)} disabled={running || !online}><option value="">Choose a voice</option>{voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}</select></label><button className="voice-icon" title="Clone source voice" aria-label="Clone source voice" disabled={running || !online || !uploadId || !rights || !voiceConsent} onClick={() => void run("clone")}><Plus size={18} /></button></div>
          <div className="voice-mix-setting"><label><input type="checkbox" checked={keepBackground} disabled={running} onChange={(e) => setKeepBackground(e.target.checked)} />Keep separated background</label>{keepBackground && <label className="voice-volume"><input type="range" min="0" max="1" step="0.05" aria-label="Background volume" value={backgroundVolume} disabled={running} onChange={(e) => setBackgroundVolume(Number(e.target.value))} /><output>{Math.round(backgroundVolume * 100)}%</output></label>}</div>
          {keepBackground && !stemEngine.includes("Demucs") && <p className="voice-notice">Center extraction may remove music or leave voice residue. AI separation is not configured.</p>}
        </> : mode === "soundtrack" ? <div className="voice-audio-upload"><AudioLines size={32} strokeWidth={1.5} /><h2>Replacement soundtrack</h2><input type="file" accept="audio/*" aria-label="Replacement soundtrack" disabled={running} onChange={(e) => setSoundtrack(e.target.files?.[0] || null)} /><span>{soundtrack ? soundtrack.name : "Audio file, up to 60 MB"}</span></div> : <div className="voice-audio-upload"><AudioLines size={32} strokeWidth={1.5} /><h2>Dialogue &amp; background</h2><span>{stemEngine || "Checking separation engine"}</span><span>WAV export</span></div>}
        <div className="voice-consents"><label><input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />I have permission to edit this video.</label>{mode === "voiceover" && <label><input type="checkbox" checked={voiceConsent} onChange={(e) => setVoiceConsent(e.target.checked)} />I have permission to use the selected voice.</label>}</div>
      </section>
    </div>

    <footer className="voice-render-bar">
      <div className="voice-render-status" role="status" aria-live="polite">{running ? <><Loader2 className="voice-spin" size={18} /><div><strong>{job?.message || "Starting render"}</strong><span>{Math.round(job?.progress || 0)}%{eta > 0 ? ` / about ${duration(eta)} remaining` : ""}</span></div></> : <><AudioLines size={20} /><div><strong>{result?.file ? "Export ready" : "Voiceover workspace"}</strong><span>{result?.stemEngine || (selected ? "Draft / not published" : "Choose a source to begin")}</span></div></>}</div>
      <div className="voice-render-actions">{running && job && <button className="voice-button" onClick={() => void api<{ job: Job }>(`/api/automation/voice/jobs/${job.id}/stop`, {}).then(({ job: next }) => acceptJob(next)).catch((e) => setError(e.message))}><Square size={15} />Stop</button>}{outputVideo && <a className="voice-button" download href={outputVideo}><Download size={16} />Export MP4</a>}<button className="voice-button voice-primary" disabled={!canRender} onClick={() => void run("process")}><WandSparkles size={17} />{mode === "stems" ? "Separate audio" : "Render video"}</button></div>
      {running && <progress className="voice-progress" value={job?.progress || 0} max="100" aria-label="Render progress" />}
    </footer>
  </div>;
}
