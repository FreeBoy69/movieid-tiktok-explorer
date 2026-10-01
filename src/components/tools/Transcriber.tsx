// Video Transcriber: a link in, the transcript out. YouTube links run as a
// background job the page polls; everything else comes back in one request.
import { type CSSProperties, FormEvent, useEffect, useRef, useState } from "react";
import { AlertCircle, Captions, Check, Copy, Download, Link2, Loader2, Mic, PenLine } from "lucide-react";
import { useErrorToast } from "../../utils/toast";
import { Empty } from "../studio/studioShared";
import { toolEntry, type ToolDef } from "./toolApps";
import { ToolLayout } from "./ToolPage";

type Segment = { start?: number; end?: number; text?: string };
type Result = { text: string; segments: Segment[] | null; url: string };
type Job = { statusUrl: string; progress: number; message: string };

const pad = (n: number, len = 2) => String(n).padStart(len, "0");
export function srtTime(seconds: number) {
  const total = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = Math.floor(total % 60);
  const ms = Math.round((total - Math.floor(total)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}
export function buildSrt(segments: Segment[]) {
  return segments
    .filter((segment) => String(segment.text || "").trim())
    .map((segment, index) => `${index + 1}\n${srtTime(segment.start ?? 0)} --> ${srtTime(segment.end ?? (segment.start ?? 0) + 3)}\n${String(segment.text).trim()}\n`)
    .join("\n");
}
function saveText(name: string, text: string, type = "text/plain") {
  const href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export function Transcriber({ tool }: { tool: ToolDef }) {
  const entry = toolEntry(tool.id);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  useErrorToast(error, () => setError(""));
  const pollTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(pollTimer.current), []);

  async function poll(statusUrl: string, source: string) {
    try {
      const response = await fetch(statusUrl, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read the job.");
      if (data.status === "failed") throw new Error(data.error || "Transcription failed.");
      if (data.status === "done") {
        setResult({ text: String(data.text || ""), segments: Array.isArray(data.segments) ? data.segments : null, url: source });
        setJob(null);
        setBusy(false);
        return;
      }
      setJob({ statusUrl, progress: Number(data.progress) || 0, message: String(data.message || "") });
      pollTimer.current = window.setTimeout(() => void poll(statusUrl, source), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
      setJob(null);
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const source = url.trim();
    if (!source || busy) return;
    setBusy(true);
    setError("");
    setResult(null);
    setJob(null);
    try {
      const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: source }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Transcription failed.");
      if (data.queued && data.statusUrl) {
        setJob({ statusUrl: data.statusUrl, progress: 0, message: "Queued. A worker picks it up in a moment." });
        void poll(data.statusUrl, source);
        return;
      }
      setResult({ text: String(data.text || ""), segments: Array.isArray(data.segments) ? data.segments : null, url: source });
      setBusy(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transcription failed.");
      setBusy(false);
    }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("Copy failed. Select the text and copy it instead.");
    }
  }
  const baseName = () => {
    try {
      const u = new URL(result?.url || "");
      return (u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop() || "transcript").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "transcript";
    } catch {
      return "transcript";
    }
  };
  const count = result ? words(result.text) : 0;

  const panel = (
    <form style={{ display: "contents" }} onSubmit={(event) => void submit(event)}>
      <label className="mt-field">
        <span className="mt-label">Video link</span>
        <div className="relative">
          <Link2 size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 opacity-50" aria-hidden="true" />
          <input className="mt-input" style={{ paddingLeft: 34 }} type="url" inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://www.youtube.com/watch?v=…" disabled={busy} />
        </div>
      </label>
      <button type="submit" className="mt-primary" disabled={!url.trim() || busy}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Captions size={16} />}
        {busy ? "Transcribing" : tool.action}
      </button>
      <p className="mt-note">YouTube runs in the background on a worker, so a long video can take a few minutes. Other links usually finish in under a minute.</p>
    </form>
  );

  return (
    <ToolLayout panel={panel}>
      <div className="mt-stage-head">
        <h2>Transcript</h2>
        <span className="mt-meta">{result ? `${count.toLocaleString()} words · ~${Math.max(1, Math.round(count / 150))} min read` : job ? `${job.progress}%` : "Nothing yet"}</span>
      </div>
      <div className="mt-stage-inner">
        {job ? (
          <div className="mt-progress" role="status" aria-live="polite">
            <div className="mt-progress-bar" data-indeterminate={job.progress <= 0 ? "true" : undefined} style={{ "--p": String(Math.min(100, Math.max(0, job.progress)) / 100) } as CSSProperties}><span /></div>
            <p>{job.message || "Working on it."}</p>
          </div>
        ) : null}
        {busy && !job ? (
          <div className="mt-skeleton" aria-hidden="true"><span /><span /><span /></div>
        ) : null}
        {result ? (
          <>
            <div className="mt-actions">
              <button type="button" className="mt-secondary" onClick={() => void copy()} aria-live="polite">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy"}</button>
              <button type="button" className="mt-secondary" onClick={() => saveText(`${baseName()}.txt`, result.text)}><Download size={15} />Text file</button>
              <button type="button" className="mt-secondary" disabled={!result.segments?.length} title={result.segments?.length ? "Subtitles with timings" : "Timings are only available for videos that ran as a background job"} onClick={() => result.segments && saveText(`${baseName()}.srt`, buildSrt(result.segments), "application/x-subrip")}><Captions size={15} />Subtitles (.srt)</button>
              <button type="button" className="mt-secondary" onClick={() => window.dispatchEvent(new CustomEvent("navToRewriter", { detail: { transcript: result.text, phases: [] } }))}><PenLine size={15} />Rewrite with AI</button>
              <button type="button" className="mt-secondary" onClick={() => window.dispatchEvent(new CustomEvent("navToTts", { detail: { text: result.text.slice(0, 5000) } }))}><Mic size={15} />Read aloud</button>
            </div>
            <textarea className="mt-output" value={result.text} onChange={(event) => setResult({ ...result, text: event.target.value })} aria-label="Transcript" spellCheck={false} />
            {!result.text.trim() ? <p className="mt-error"><AlertCircle size={16} />The video had no speech we could hear.</p> : null}
          </>
        ) : !busy ? (
          <Empty icon={entry?.icon} heading={tool.heading} body={tool.body} />
        ) : null}
      </div>
    </ToolLayout>
  );
}
