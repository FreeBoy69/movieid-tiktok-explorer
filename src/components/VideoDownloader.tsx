import { FormEvent, useMemo, useState } from "react";
import {
  AudioLines,
  Check,
  Download,
  Film,
  Link2,
  Loader2,
  Music2,
  Video,
} from "lucide-react";
import { cn } from "../lib/utils";

type DownloadMode = "video" | "audio" | "combined";

type MediaFormat = {
  id: string;
  label: string;
  extension: string;
  height?: number;
  fps?: number;
  bitrate?: number;
  size?: number;
  hasVideo: boolean;
  hasAudio: boolean;
};

type MediaInfo = {
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  formats: MediaFormat[];
};

const MODES: Array<{ id: DownloadMode; label: string; icon: typeof Video }> = [
  { id: "combined", label: "Video + audio", icon: Film },
  { id: "video", label: "Video only", icon: Video },
  { id: "audio", label: "Audio only", icon: Music2 },
];

function formatBytes(value?: number) {
  if (!value || value < 1) return "Size varies";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index > 1 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds: number) {
  if (!seconds) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = Math.floor(seconds % 60);
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function filenameFromDisposition(value: string | null, fallback: string) {
  const utf8 = value?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const plain = value?.match(/filename="?([^";]+)"?/i)?.[1];
  try {
    return decodeURIComponent(utf8 || plain || fallback);
  } catch {
    return fallback;
  }
}

export function VideoDownloader({ theme }: { theme: "light" | "dark" }) {
  const dark = theme === "dark";
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [mode, setMode] = useState<DownloadMode>("combined");
  const [formatId, setFormatId] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const formats = useMemo(() => {
    if (!info) return [];
    if (mode === "audio") return info.formats.filter((format) => format.hasAudio);
    return info.formats.filter((format) => format.hasVideo);
  }, [info, mode]);

  async function inspect(event: FormEvent) {
    event.preventDefault();
    if (!url.trim() || inspecting) return;
    setInspecting(true);
    setError("");
    setInfo(null);
    try {
      const response = await fetch("/api/downloader/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not inspect this link.");
      setInfo(data);
      const firstVideo = data.formats?.find((format: MediaFormat) => format.hasVideo);
      setFormatId(firstVideo?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not inspect this link.");
    } finally {
      setInspecting(false);
    }
  }

  function selectMode(next: DownloadMode) {
    setMode(next);
    if (!info) return;
    const candidates = next === "audio"
      ? info.formats.filter((format) => format.hasAudio)
      : info.formats.filter((format) => format.hasVideo);
    setFormatId(candidates[0]?.id || "");
  }

  async function downloadMedia() {
    if (!info || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const response = await fetch("/api/downloader/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), mode, formatId, formatHasAudio: info.formats.find((format) => format.id === formatId)?.hasAudio === true }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Download failed.");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = filenameFromDisposition(response.headers.get("content-disposition"), mode === "audio" ? "audio.mp3" : "video.mp4");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className={cn("h-full min-h-0 overflow-y-auto", dark ? "bg-[#070A12] text-[#F8F5E8]" : "bg-[#F9F8F6] text-[#1A1A1A]")}>
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 md:py-12">
        <header className="max-w-2xl">
          <h1 className="font-serif text-3xl font-bold tracking-[-0.035em] sm:text-4xl">Video downloader</h1>
        </header>

        <form onSubmit={inspect} className={cn("mt-7 flex gap-2 rounded-xl border p-2", dark ? "border-white/12 bg-[#151916]" : "border-[#1A1A1A]/10 bg-white")}>
          <div className="relative min-w-0 flex-1">
            <Link2 className={cn("pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2", dark ? "text-white/42" : "text-[#1A1A1A]/40")} />
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="Paste a video URL" aria-label="Video URL" className={cn("h-12 w-full rounded-lg border-0 bg-transparent pl-10 pr-3 text-sm font-semibold outline-none placeholder:font-medium focus-visible:ring-2 focus-visible:ring-[#f9dc0b]", dark ? "text-white placeholder:text-white/35" : "text-[#1A1A1A] placeholder:text-[#1A1A1A]/35")} />
          </div>
          <button type="submit" disabled={!url.trim() || inspecting} className="inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#f9dc0b] px-4 text-xs font-black text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white disabled:opacity-45 sm:px-6">
            {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="hidden sm:inline">Detect quality</span>
          </button>
        </form>

        {error ? <p role="alert" className="mt-3 text-sm font-semibold text-red-600 dark:text-red-400">{error}</p> : null}

        {info ? (
          <div className={cn("mt-6 overflow-hidden rounded-2xl border", dark ? "border-white/12 bg-[#11150F]" : "border-[#1A1A1A]/10 bg-white")}>
            <div className={cn("grid gap-4 p-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:p-5", dark ? "border-white/10" : "border-[#1A1A1A]/8")}>
              <div className="aspect-video overflow-hidden rounded-xl bg-[#1A1A1A]">
                {info.thumbnail ? <img src={info.thumbnail} alt="" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-[#f9dc0b]"><Film className="h-8 w-8" /></div>}
              </div>
              <div className="min-w-0 self-center">
                <h2 className="line-clamp-2 text-base font-black sm:text-lg">{info.title}</h2>
                <p className={cn("mt-2 text-xs font-semibold", dark ? "text-white/48" : "text-[#1A1A1A]/48")}>{[info.uploader, formatDuration(info.duration)].filter(Boolean).join(" · ")}</p>
              </div>
            </div>

            <div className={cn("border-t p-4 sm:p-5", dark ? "border-white/10" : "border-[#1A1A1A]/8")}>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map(({ id, label, icon: Icon }) => (
                  <button key={id} type="button" onClick={() => selectMode(id)} className={cn("flex min-h-12 items-center justify-center gap-2 rounded-lg border px-2 text-center text-[11px] font-black transition sm:text-xs", mode === id ? "border-[#f9dc0b] bg-[#f9dc0b] text-[#1A1A1A]" : dark ? "border-white/12 text-white/60 hover:border-white/28" : "border-[#1A1A1A]/10 text-[#1A1A1A]/60 hover:border-[#1A1A1A]/28")}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {formats.map((format) => (
                  <button key={format.id} type="button" onClick={() => setFormatId(format.id)} className={cn("flex min-h-14 items-center gap-3 rounded-xl border px-3 text-left transition", formatId === format.id ? "border-[#f9dc0b] bg-[#f9dc0b]/10" : dark ? "border-white/10 hover:border-white/25" : "border-[#1A1A1A]/9 hover:border-[#1A1A1A]/25")}>
                    <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full border", formatId === format.id ? "border-[#f9dc0b] bg-[#f9dc0b] text-[#1A1A1A]" : dark ? "border-white/18" : "border-[#1A1A1A]/16")}>
                      {formatId === format.id ? <Check className="h-3.5 w-3.5" /> : mode === "audio" ? <AudioLines className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-black">{mode === "audio" ? `${format.label} audio` : format.label}</span>
                      <span className={cn("mt-0.5 block text-[10px] font-bold uppercase tracking-wide", dark ? "text-white/38" : "text-[#1A1A1A]/38")}>{format.extension} · {formatBytes(format.size)}</span>
                    </span>
                  </button>
                ))}
              </div>

              <button type="button" onClick={downloadMedia} disabled={!formatId || downloading} className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#1A1A1A] px-5 text-xs font-black text-white transition hover:bg-[#f9dc0b] hover:text-[#1A1A1A] disabled:opacity-45 dark:bg-[#f9dc0b] dark:text-[#1A1A1A] dark:hover:bg-white">
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {downloading ? "Preparing download" : `Download ${mode === "audio" ? "audio" : "video"}`}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
