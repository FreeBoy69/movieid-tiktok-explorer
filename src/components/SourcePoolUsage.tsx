import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";
import { poolSourceIdentity } from "../utils/automationSourcePool.js";

export type PoolSource = { url: string; title: string; primary?: boolean };
export type PoolUsage = PoolSource & {
  key: string; total: number; used: number; remaining: number; percent: number;
  posts: number; status: string; lastScannedAt?: number | null;
};
export type DeepScan = {
  id?: string;
  url: string;
  status: string;
  message?: string;
  progress?: number;
  videoCount?: number;
};

function deepScanMatches(scan: DeepScan | undefined, url: string) {
  if (!scan?.url || !url) return false;
  return poolSourceIdentity(scan.url) === poolSourceIdentity(url);
}

function hasActiveDeepScan(scans: DeepScan[] | undefined) {
  return (scans || []).some((scan) => ["queued", "running"].includes(String(scan.status || "")));
}

export function SourceUsageRow({ source, usage, issue, deepScan, dark = false, onRemove }: {
  source: PoolSource; usage?: PoolUsage; issue?: boolean; deepScan?: DeepScan | null; dark?: boolean; onRemove?: (url: string) => void;
}) {
  const secondary = dark ? "text-[#F8F5E8]/70" : "text-[#1A1A1A]/70";
  const scanning = deepScan && ["queued", "running"].includes(String(deepScan.status || ""));
  const status = scanning
    ? (deepScan.message || `Scanning full catalog${deepScan.videoCount ? ` · ${Number(deepScan.videoCount).toLocaleString()} so far` : ""}`)
    : issue ? (usage?.total ? "Cached · refresh failed" : "Scan failed")
      : !usage ? "Save to track usage" : usage.status === "exhausted" ? "Known videos exhausted"
        : usage.status === "niche_mismatch" ? "Outside niche" : usage.status === "not_scanned" ? "Awaiting scan" : !usage.posts ? "Awaiting turn" : "Ready";
  const percent = Math.max(0, Math.min(100, Number(usage?.percent) || 0));
  const scanProgress = Math.max(8, Math.round(Number(deepScan?.progress) || 8));
  const label = usage?.total ? `${usage.used.toLocaleString()} / ${usage.total.toLocaleString()} known videos used` : scanning ? "Quick load ready · full scan in background" : "No scanned videos";
  return <div className="min-w-0 py-3">
    <div className="flex min-w-0 items-center gap-2">
      <p className="min-w-0 flex-1 truncate text-sm font-bold" title={source.title}>{source.title}</p>
      {source.primary && <span className={`shrink-0 text-xs ${secondary}`}>Primary</span>}
      <a href={source.url} target="_blank" rel="noreferrer" aria-label={`Open ${source.title}`} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-[#f9dc0b]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><ExternalLink className="h-4 w-4" /></a>
      {!source.primary && onRemove && <button type="button" aria-label={`Remove ${source.title}`} onClick={() => onRemove(source.url)} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg hover:bg-[#f9dc0b]/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><Trash2 className="h-4 w-4" /></button>}
    </div>
    <div className={`mb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs tabular-nums ${secondary}`}>
      <span>{label}</span><span>{usage?.total ? `${percent}%` : scanning ? `${scanProgress}%` : "—"}</span>
    </div>
    <div role="progressbar" aria-label={`${source.title} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={scanning ? scanProgress : usage?.total ? percent : undefined} aria-valuetext={label} className={`h-1.5 overflow-hidden rounded-full ${dark ? "bg-[#F8F5E8]/15" : "bg-[#1A1A1A]/10"}`}>
      <div className={`h-full origin-left rounded-full bg-[#f9dc0b] ${scanning ? "animate-pulse" : ""}`} style={{ width: `${scanning ? scanProgress : percent}%` }} />
    </div>
    <div className={`mt-2 flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs tabular-nums ${secondary}`}>
      <span title={usage?.lastScannedAt ? `Last scan: ${new Date(usage.lastScannedAt).toLocaleString()}` : undefined}>{status}</span>
      {usage && <span>{usage.total ? `${usage.remaining.toLocaleString()} remaining · ` : ""}{usage.posts.toLocaleString()} posts</span>}
    </div>
  </div>;
}

export function SourcePoolUsage({ agentId, sources, dark, active, revision, tagged = false, onRemove }: {
  agentId?: string; sources: PoolSource[]; dark: boolean; active: boolean; revision: string; tagged?: boolean; onRemove: (url: string) => void;
}) {
  const [data, setData] = useState<{ agentId: string; sources: PoolUsage[]; scanIssues: { url: string }[]; deepScans: DeepScan[] } | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const activeScanRef = useRef(false);
  useEffect(() => {
    if (!agentId || !active) return;
    const controller = new AbortController();
    let fetching = false;
    let timer: number | null = null;
    async function load() {
      if (fetching) return;
      fetching = true;
      setLoading(true);
      try {
        const response = await fetch(`/api/automation/agents/${encodeURIComponent(agentId!)}/source-pool`, { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load usage");
        if (!controller.signal.aborted) {
          const next = {
            agentId: agentId!,
            sources: Array.isArray(result.sources) ? result.sources : [],
            scanIssues: Array.isArray(result.scanIssues) ? result.scanIssues : [],
            deepScans: Array.isArray(result.deepScans) ? result.deepScans : [],
          };
          activeScanRef.current = hasActiveDeepScan(next.deepScans);
          setData(next);
          setError("");
        }
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Could not load usage");
      } finally {
        fetching = false;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void load();
    }, activeScanRef.current ? 4000 : 30000);
    const syncTimer = window.setInterval(() => {
      if (!timer) return;
      const desired = activeScanRef.current ? 4000 : 30000;
      // Restart interval when scan activity changes so progress updates stay snappy.
      window.clearInterval(timer);
      timer = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        void load();
      }, desired);
    }, 5000);
    return () => {
      controller.abort();
      if (timer) window.clearInterval(timer);
      window.clearInterval(syncTimer);
    };
  }, [agentId, active, refresh, revision]);
  const current = data?.agentId === agentId ? data : null;
  const visible = tagged ? [...new Map([...(current?.sources || []), ...sources].map((s) => [poolSourceIdentity(s.url), s])).values()] : sources;
  const scanning = hasActiveDeepScan(current?.deepScans);
  return <div className={`mt-3 min-w-0 ${dark ? "text-[#F8F5E8]" : "text-[#1A1A1A]"}`}>
    <div className="flex items-center justify-between gap-3 text-xs">
      <span role="status">{error || (loading && !current ? "Loading usage…" : scanning ? "Full catalog scanning in background" : "Source usage")}</span>
      {agentId && <button type="button" onClick={() => setRefresh((n) => n + 1)} disabled={loading} aria-label="Refresh source usage" className="inline-flex h-9 w-9 items-center justify-center rounded-lg hover:bg-[#f9dc0b]/20 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"><RefreshCw className="h-4 w-4" /></button>}
    </div>
    {visible.map((source) => <SourceUsageRow key={poolSourceIdentity(source.url)} source={source}
      usage={current?.sources.find((row) => row.key === poolSourceIdentity(source.url))}
      issue={current?.scanIssues.some((row) => poolSourceIdentity(row.url) === poolSourceIdentity(source.url))}
      deepScan={current?.deepScans.find((scan) => deepScanMatches(scan, source.url)) || null}
      dark={dark} onRemove={source.primary || tagged && !sources.some((s) => s.url === source.url) ? undefined : onRemove} />)}
  </div>;
}
