import { ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowUpRight, BarChart3, Bot, Check, Clapperboard, Copy, Database, Globe2, Layers3, Loader2, Search, Sparkles, Target, TrendingUp, Users, WalletCards } from "lucide-react";
import { writeDeepLink } from "../utils/tiktokRoute";
import { writePendingTemplate } from "../utils/promptTemplates";
import { cn } from "../lib/utils";
import { Notice, SearchField, Segmented, Switch, Tabs } from "./ui/controls";

interface PremiumNiche {
  id: string;
  macroNiche: string;
  subNiche: string;
  msn: string;
  facelessFormats: string[];
  targetCountries: string[];
  geoTier: string;
  cpmTier: string;
  rpmRange: string;
  competition: string;
  audienceValue: string;
  trendScore: number;
  monetizationStack: string[];
  creatorFit: string;
  acquisitionQueries: string[];
  channelAngles: string[];
  hookPatterns: string[];
  seedKeywords: string[];
  riskNotes: string;
  sourceRefs: string[];
  trend?: "rising" | "peaking" | "stable" | "cooling";
  exampleChannels?: Array<{ handle: string; name: string; why?: string; subscribers?: number }>;
}

interface VideoFormat {
  id: string;
  name: string;
  category: string;
  summary: string;
  structure: Array<{ beat: string; seconds: string; what: string }>;
  length: string;
  aspect: string;
  faceless: boolean;
  productionLoad: string;
  titlePatterns: string[];
  hookTemplates: string[];
  thumbnailPattern: string;
  bestNiches: string[];
  retentionTips: string[];
  trend: "rising" | "peaking" | "stable" | "cooling";
  trendNote: string;
  monetizationRisk: string;
  riskNote: string;
  examples: Array<{ channel: string; note: string; subscribers?: number }>;
  sourceRefs: string[];
}

function isAgentDiscovered(niche: PremiumNiche): boolean {
  return (niche.sourceRefs || []).some((ref) => String(ref).includes("agent"));
}

interface NicheSubGroup {
  name: string;
  msnCount: number;
  bestScore: number;
  topRpmRange: string;
  msns: PremiumNiche[];
}

interface NicheMacroGroup {
  name: string;
  msnCount: number;
  bestScore: number;
  subNicheCount: number;
  subNiches: NicheSubGroup[];
}

interface NichePayload {
  niches: PremiumNiche[];
  summary?: {
    count: number;
    macroCount: number;
    subNicheCount: number;
    tierOneCount: number;
    sourceRefs: string[];
  };
  warning?: string;
}

function compact(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function buildHierarchy(niches: PremiumNiche[]): NicheMacroGroup[] {
  const macroMap = new Map<string, NicheMacroGroup>();
  niches.forEach((niche) => {
    const macroName = niche.macroNiche || "Unsorted";
    const subName = niche.subNiche || "General";
    const macro = macroMap.get(macroName) || {
      name: macroName,
      msnCount: 0,
      bestScore: 0,
      subNicheCount: 0,
      subNiches: [],
    };
    let sub = macro.subNiches.find((candidate) => candidate.name === subName);
    if (!sub) {
      sub = {
        name: subName,
        msnCount: 0,
        bestScore: 0,
        topRpmRange: niche.rpmRange || "",
        msns: [],
      };
      macro.subNiches.push(sub);
    }
    sub.msns.push(niche);
    sub.msnCount += 1;
    if ((niche.trendScore || 0) >= sub.bestScore) {
      sub.bestScore = niche.trendScore || 0;
      sub.topRpmRange = niche.rpmRange || sub.topRpmRange;
    }
    macro.msnCount += 1;
    macro.bestScore = Math.max(macro.bestScore, niche.trendScore || 0);
    macro.subNicheCount = macro.subNiches.length;
    macroMap.set(macroName, macro);
  });

  return Array.from(macroMap.values())
    .map((macro) => ({
      ...macro,
      subNiches: macro.subNiches
        .map((sub) => ({ ...sub, msns: [...sub.msns].sort((a, b) => b.trendScore - a.trendScore) }))
        .sort((a, b) => b.bestScore - a.bestScore || a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => b.bestScore - a.bestScore || a.name.localeCompare(b.name));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function nichePath(...parts: string[]): string[] {
  return parts.filter(Boolean);
}

export function NicheLibrary({ initialPath = [] }: { initialPath?: string[] }) {
  // /niches/formats[/<id>] is the format library; everything else is the niche taxonomy.
  if (initialPath?.[0] === "formats") return <FormatLibrary formatId={initialPath[1] || ""} />;
  return <NicheTaxonomy initialPath={initialPath} />;
}

/** Niches and formats are two views of one library. */
function LibraryTabs({ value }: { value: "niches" | "formats" }) {
  return (
    <Tabs
      label="Library"
      className="is-pill"
      value={value}
      onChange={(next) => writeDeepLink({ view: "niches", nichePath: next === "formats" ? ["formats"] : [] })}
      options={[
        { value: "niches", label: "Niches" },
        { value: "formats", label: "Formats" },
      ]}
    />
  );
}

function NicheTaxonomy({ initialPath = [] }: { initialPath?: string[] }) {
  const [data, setData] = useState<NichePayload>({ niches: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const path = initialPath || [];

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/niches");
        const payload = (await response.json()) as NichePayload;
        if (!response.ok) throw new Error((payload as any).error || "Could not load niche library");
        if (!mounted) return;
        setData(payload);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : "Could not load niche library");
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const hierarchy = useMemo(() => buildHierarchy(data.niches), [data.niches]);
  const topSlug = path[0] || "";
  const subSlug = path[1] || "";
  const msnSlug = path[2] || "";
  const top = hierarchy.find((group) => slugify(group.name) === topSlug) || null;
  const sub = top?.subNiches.find((group) => slugify(group.name) === subSlug) || null;
  const msn = sub?.msns.find((niche) => niche.id === msnSlug || slugify(niche.msn) === msnSlug) || null;
  const avgScore = Math.round(data.niches.reduce((sum, niche) => sum + (niche.trendScore || 0), 0) / Math.max(1, data.niches.length));

  if (loading) return <LoadingState label="Loading niche database" />;
  if (error) return <ErrorState message={error} onBack={() => writeDeepLink({ view: "niches" })} />;
  if (path.length >= 3) {
    if (!msn) return <ErrorState message="This MSN could not be found." onBack={() => writeDeepLink({ view: "niches", nichePath: top && sub ? nichePath(slugify(top.name), slugify(sub.name)) : [] })} />;
    return <NicheDetailPage niche={msn} topSlug={slugify(msn.macroNiche)} subSlug={slugify(msn.subNiche)} />;
  }
  if (path.length === 2) {
    if (!top || !sub) return <ErrorState message="This sub-niche could not be found." onBack={() => writeDeepLink({ view: "niches" })} />;
    return <MsnIndexPage top={top} sub={sub} />;
  }
  if (path.length === 1) {
    if (!top) return <ErrorState message="This niche could not be found." onBack={() => writeDeepLink({ view: "niches" })} />;
    return <SubNicheIndexPage top={top} />;
  }
  return (
    <TopNicheIndexPage
      hierarchy={hierarchy}
      summary={{
        niches: data.summary?.macroCount || hierarchy.length,
        subNiches: data.summary?.subNicheCount || hierarchy.reduce((sum, group) => sum + group.subNicheCount, 0),
        msns: data.summary?.count || data.niches.length,
        avgScore,
      }}
      warning={data.warning}
    />
  );
}

function TopNicheIndexPage({ hierarchy, summary, warning }: { hierarchy: NicheMacroGroup[]; summary: { niches: number; subNiches: number; msns: number; avgScore: number }; warning?: string }) {
  return (
    <div className="space-y-5">
      <LibraryTabs value="niches" />
      <PageHeader
        eyebrow="Niche library"
        title="Niches growing on YouTube now."
        description="Researched October 2026. Pick a category, then a sub-niche, to see specific niches with real example channels, RPM, risks and hooks."
        metrics={[
          ["Niches", compact(summary.niches)],
          ["Sub-niches", compact(summary.subNiches)],
          ["MSNs", compact(summary.msns)],
          ["Avg score", String(summary.avgScore)],
        ]}
      />
      {warning ? <WarningBar message={warning} /> : null}
      <DataTable
        columns="grid-cols-[minmax(240px,1.4fr)_110px_90px_110px_130px]"
        headers={["Top-level niche", "Sub-niches", "MSNs", "Best score", "CPM range"]}
      >
        {hierarchy.map((group) => (
          <button
            key={group.name}
            type="button"
            onClick={() => writeDeepLink({ view: "niches", nichePath: nichePath(slugify(group.name)) })}
            className="grid w-full min-w-[680px] grid-cols-[minmax(240px,1.4fr)_110px_90px_110px_130px] gap-3 border-b border-[var(--ui-line)] px-4 py-4 text-left transition last:border-b-0 hover:bg-[var(--ui-bg)]"
          >
            <span className="min-w-0">
              <p className="m-0 text-sm font-black text-[var(--ui-text)]">{group.name}</p>
              <span className="mt-1 block truncate text-xs font-semibold text-[var(--ui-text)]/45">{group.subNiches.slice(0, 3).map((sub) => sub.name).join(", ")}</span>
            </span>
            <CellMono>{group.subNicheCount}</CellMono>
            <CellMono>{group.msnCount}</CellMono>
            <span><ScorePill score={group.bestScore} /></span>
            <CellMuted>{unique(group.subNiches.flatMap((sub) => sub.msns.map((niche) => niche.cpmTier))).slice(0, 2).join(", ")}</CellMuted>
          </button>
        ))}
      </DataTable>
    </div>
  );
}

function SubNicheIndexPage({ top }: { top: NicheMacroGroup }) {
  return (
    <div className="space-y-5">
      <BackButton label="Back to niches" path={[]} />
      <PageHeader
        eyebrow="Sub-niches"
        title={top.name}
        description="Choose one sub-niche to see the MSN opportunities inside it."
        metrics={[
          ["Sub-niches", compact(top.subNicheCount)],
          ["MSNs", compact(top.msnCount)],
          ["Best score", String(top.bestScore)],
        ]}
      />
      <DataTable
        columns="grid-cols-[minmax(260px,1.35fr)_100px_110px_minmax(260px,1fr)]"
        headers={["Sub-niche", "MSNs", "Best score", "Strongest current MSN"]}
      >
        {top.subNiches.map((sub) => (
          <button
            key={sub.name}
            type="button"
            onClick={() => writeDeepLink({ view: "niches", nichePath: nichePath(slugify(top.name), slugify(sub.name)) })}
            className="grid w-full min-w-[730px] grid-cols-[minmax(260px,1.35fr)_100px_110px_minmax(260px,1fr)] gap-3 border-b border-[var(--ui-line)] px-4 py-4 text-left transition last:border-b-0 hover:bg-[var(--ui-bg)]"
          >
            <span className="min-w-0">
              <p className="m-0 text-sm font-black text-[var(--ui-text)]">{sub.name}</p>
              <span className="mt-1 block text-xs font-semibold text-[var(--ui-text)]/45">{sub.topRpmRange}</span>
            </span>
            <CellMono>{sub.msnCount}</CellMono>
            <span><ScorePill score={sub.bestScore} /></span>
            <CellMuted>{sub.msns[0]?.msn || ""}</CellMuted>
          </button>
        ))}
      </DataTable>
    </div>
  );
}

function MsnIndexPage({ top, sub }: { top: NicheMacroGroup; sub: NicheSubGroup }) {
  return (
    <div className="space-y-5">
      <BackButton label={`Back to ${top.name}`} path={[slugify(top.name)]} />
      <PageHeader
        eyebrow="MSN opportunities"
        title={sub.name}
        description="Pick one MSN to open its full research page, hooks, formats, monetization and risk notes."
        metrics={[
          ["MSNs", compact(sub.msnCount)],
          ["Best score", String(sub.bestScore)],
          ["RPM", sub.topRpmRange || "Mixed"],
          ["Agent-found", compact(sub.msns.filter(isAgentDiscovered).length)],
        ]}
      />
      <DataTable
        columns="grid-cols-[minmax(300px,1.5fr)_150px_150px_90px]"
        headers={["Micro-sub-niche", "Market", "RPM", "Score"]}
      >
        {sub.msns.map((niche) => (
          <button
            key={niche.id}
            type="button"
            onClick={() => writeDeepLink({ view: "niches", nichePath: nichePath(slugify(top.name), slugify(sub.name), niche.id) })}
            className="grid w-full min-w-[690px] grid-cols-[minmax(300px,1.5fr)_150px_150px_90px] gap-3 border-b border-[var(--ui-line)] px-4 py-4 text-left transition last:border-b-0 hover:bg-[var(--ui-bg)]"
          >
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-2 text-sm font-black leading-snug text-[var(--ui-text)]">
                {niche.msn}
                {isAgentDiscovered(niche) ? <span className="rounded-full bg-[var(--ui-accent)] px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-[var(--ui-accent-ink)]">Agent-found</span> : null}
                {niche.trend ? <TrendPill trend={niche.trend} /> : null}
              </span>
              <p className="m-0 mt-1 truncate text-xs font-semibold text-[var(--ui-text)]/45">{niche.audienceValue}</p>
            </span>
            <CellMuted>{niche.geoTier}</CellMuted>
            <CellMuted>{niche.rpmRange}</CellMuted>
            <span className="text-right"><ScorePill score={niche.trendScore} /></span>
          </button>
        ))}
      </DataTable>
    </div>
  );
}

function NicheDetailPage({ niche, topSlug, subSlug }: { niche: PremiumNiche; topSlug: string; subSlug: string }) {
  return (
    <section className="workspace-floating-shell relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--ui-panel)]">
      <header className="workspace-floating-header flex min-h-12 flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <BackButton label={`Back to ${niche.subNiche}`} path={[topSlug, subSlug]} compact />
          <Database className="h-4 w-4 text-[var(--ui-text)]/45" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-[var(--ui-accent)]/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--ui-accent-text)]">{niche.cpmTier} CPM</span>
          <span className="rounded-full bg-[var(--ui-accent)] px-3 py-1 font-mono text-xs font-black text-[var(--ui-accent-ink)]">{niche.trendScore}/100</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 md:p-6">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {isAgentDiscovered(niche) ? <span className="rounded-full border border-[var(--ui-accent)] bg-[var(--ui-accent)]/35 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]">Discovered by agents</span> : null}
            {niche.trend ? <TrendPill trend={niche.trend} /> : null}
          </div>
          <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-accent-text)]">{niche.macroNiche} / {niche.subNiche}</p>
          <h1 className="mt-3 max-w-4xl text-2xl font-black leading-tight text-[var(--ui-text)] sm:text-3xl">{niche.msn}</h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[var(--ui-text)]/58">{niche.audienceValue}</p>
        </div>

        <div className="p-4 md:p-5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
            <DetailMetric icon={<Globe2 className="h-4 w-4" />} label="Markets" value={niche.geoTier} />
            <DetailMetric icon={<WalletCards className="h-4 w-4" />} label="RPM" value={niche.rpmRange} />
            <DetailMetric icon={<BarChart3 className="h-4 w-4" />} label="Competition" value={niche.competition} />
            <DetailMetric icon={<Bot className="h-4 w-4" />} label="Formats" value={`${niche.facelessFormats.length}`} />
          </div>
        </div>

        <div className="grid gap-4 p-4 lg:grid-cols-2 md:p-5">
          <Panel title="Target countries">
            <PillBlock items={niche.targetCountries} />
          </Panel>
          <Panel title="Monetization stack">
            <PillBlock items={niche.monetizationStack} />
          </Panel>
          <Panel title="Channel angles">
            <ListBlock icon={<Sparkles className="h-4 w-4" />} items={niche.channelAngles} />
          </Panel>
          <Panel title="Hook patterns">
            <ListBlock icon={<Target className="h-4 w-4" />} items={niche.hookPatterns} />
          </Panel>
          <Panel title="Faceless formats">
            <ListBlock icon={<Layers3 className="h-4 w-4" />} items={niche.facelessFormats} />
          </Panel>
          <Panel title="Search seeds">
            <div className="space-y-1.5">
              {niche.acquisitionQueries.map((query) => (
                <button
                  key={query}
                  type="button"
                  title="Find channels for this search in the Niche Finder"
                  onClick={() => writeDeepLink({ view: "discover", discoveryQuery: query })}
                  className="flex w-full items-center gap-2 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 py-2 text-left text-xs font-semibold leading-5 text-[var(--ui-text)]/62 transition hover:border-[var(--ui-line-strong)] hover:text-[var(--ui-text)]"
                >
                  <Search className="h-4 w-4 shrink-0 text-[var(--ui-accent-text)]" />
                  <p className="m-0 min-w-0 flex-1">{query}</p>
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
                </button>
              ))}
            </div>
          </Panel>
          {niche.exampleChannels?.length ? (
            <Panel title="Channels doing it now">
              <ChannelLinks channels={niche.exampleChannels.map((c) => ({ handle: c.handle, label: c.name || c.handle, note: c.why, subscribers: c.subscribers }))} />
            </Panel>
          ) : null}
          <div className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/35">Creator fit</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--ui-text)]/62">{niche.creatorFit}</p>
          </div>
          <div className="rounded-2xl border border-[var(--ui-accent)]/12 bg-[var(--ui-accent)]/5 p-5 shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ui-accent-text)]">Risk note</p>
            <p className="mt-3 text-sm font-semibold leading-6 text-[var(--ui-text)]/62">{niche.riskNotes}</p>
          </div>
          <Sources refs={niche.sourceRefs} />
        </div>
      </div>
    </section>
  );
}

function PageHeader({ eyebrow, title, description, metrics }: { eyebrow: string; title: string; description: string; metrics: [string, string][] }) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--ui-accent)]/15 bg-[var(--ui-accent)]/8 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-[var(--ui-accent-text)]">
          <Database className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
        <h1 className="max-w-3xl font-serif text-2xl font-bold leading-tight tracking-tight text-[var(--ui-text)] md:text-3xl">{title}</h1>
        <p className="mt-2 max-w-2xl text-xs font-semibold leading-5 text-[var(--ui-text)]/55">{description}</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:min-w-[420px] md:grid-cols-4">
        {metrics.map(([label, value]) => <HeroMetric key={label} label={label} value={value} />)}
      </div>
    </header>
  );
}

function DataTable({ columns, headers, children }: { columns: string; headers: string[]; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] shadow-sm">
      <div className={`hidden min-w-[680px] ${columns} gap-3 border-b border-[var(--ui-line)] bg-[var(--ui-panel)] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/38 sm:grid`}>
        {headers.map((header, index) => <span key={header} className={index === headers.length - 1 ? "text-right" : ""}>{header}</span>)}
      </div>
      <div className="overflow-x-auto overscroll-x-contain">{children}</div>
    </section>
  );
}

function BackButton({ label, path, compact = false }: { label: string; path: string[]; compact?: boolean }) {
  return (
    <button type="button" onClick={() => writeDeepLink({ view: "niches", nichePath: path })} className={cn("inline-flex max-w-full items-center gap-2 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] text-xs font-black text-[var(--ui-text)]/70 shadow-sm transition hover:border-[var(--ui-line-strong)] hover:text-[var(--ui-text)]", compact ? "h-9 px-3" : "min-h-10 px-4 py-2")}>
      <ArrowLeft className="h-4 w-4" />
      <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
    </button>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] shadow-sm">
      <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--ui-text)]/50">
        <Loader2 className="h-4 w-4 ui-spin text-[var(--ui-accent-text)]" />
        {label}
      </span>
    </div>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="ui-btn">
        <ArrowLeft className="h-4 w-4" />
        Back to niches
      </button>
      <div className="rounded-2xl border border-[var(--ui-accent)]/18 bg-[var(--ui-accent-soft)] p-6">
        <p className="text-sm font-bold text-[var(--ui-accent-text)]">{message}</p>
      </div>
    </div>
  );
}

function WarningBar({ message }: { message: string }) {
  return <Notice tone="warning" title="Using seed data while the database reconnects">{message}</Notice>;
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-4 py-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/35">{label}</p>
      <p className="mt-1 font-mono text-xl font-black text-[var(--ui-text)]">{value}</p>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  return (
    <span className="inline-flex min-w-10 justify-center rounded-full bg-[var(--ui-text)] px-2 py-1 font-mono text-xs font-black text-[var(--ui-accent)]">
      {score || 0}
    </span>
  );
}

function CellMono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-sm font-black text-[var(--ui-text)]/60">{children}</span>;
}

function CellMuted({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate text-xs font-bold leading-5 text-[var(--ui-text)]/58">{children}</span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 shadow-sm">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/35">{title}</p>
      {children}
    </div>
  );
}

function DetailMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-3">
      <div className="mb-2 text-[var(--ui-accent-text)]">{icon}</div>
      <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/35">{label}</p>
      <p className="mt-1 text-xs font-black leading-5 text-[var(--ui-text)]">{value}</p>
    </div>
  );
}

function PillBlock({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-[var(--ui-line)] bg-[var(--ui-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)]/58">{item}</span>
      ))}
    </div>
  );
}

function ListBlock({ icon, items }: { icon: ReactNode; items: string[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item} className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--ui-text)]/62">
          <span className="mr-2 inline-flex align-[-3px] text-[var(--ui-accent-text)]">{icon}</span>
          {item}
        </div>
      ))}
    </div>
  );
}

/* ---------- Shared bits ---------- */
const TREND_LABEL = { rising: "Rising", peaking: "Peaking", stable: "Steady", cooling: "Cooling" } as const;
function TrendPill({ trend }: { trend: keyof typeof TREND_LABEL }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-widest",
        trend === "rising" ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : trend === "cooling" ? "bg-[var(--ui-chip)] text-[var(--ui-text)]/45" : "bg-[var(--ui-chip)] text-[var(--ui-text)]/70",
      )}
    >
      {trend === "rising" ? <TrendingUp className="h-3 w-3" /> : null}
      {TREND_LABEL[trend] || trend}
    </span>
  );
}

function ChannelLinks({ channels }: { channels: Array<{ handle: string; label: string; note?: string; subscribers?: number }> }) {
  return (
    <div className="space-y-1.5">
      {channels.map((channel) => (
        <a
          key={channel.handle}
          href={`https://www.youtube.com/${channel.handle.startsWith("@") ? channel.handle : `@${channel.handle}`}`}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-2 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 py-2 text-xs leading-5 transition hover:border-[var(--ui-line-strong)]"
        >
          <Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ui-accent-text)]" />
          <span className="min-w-0 flex-1">
            <span className="font-black text-[var(--ui-text)]">{channel.label}</span>
            {channel.subscribers ? <span className="font-semibold text-[var(--ui-text)]/45"> · {compact(channel.subscribers)} subscribers</span> : null}
            {channel.note ? <span className="block font-semibold text-[var(--ui-text)]/55">{channel.note}</span> : null}
          </span>
          <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" />
        </a>
      ))}
    </div>
  );
}

function Sources({ refs }: { refs?: string[] }) {
  const links = (refs || []).filter((ref) => /^https?:\/\//.test(ref));
  if (!links.length) return null;
  return (
    <div className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 shadow-sm lg:col-span-2">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/35">Sources</p>
      <ul className="space-y-1">
        {links.map((ref) => (
          <li key={ref} className="truncate text-xs font-semibold">
            <a href={ref} target="_blank" rel="noreferrer" className="text-[var(--ui-text)]/55 underline-offset-2 hover:text-[var(--ui-text)] hover:underline">
              {ref.replace(/^https?:\/\/(www\.)?/, "")}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- Format library ---------- */
const FORMAT_CATEGORIES = ["Long-form narrative", "Long-form explainer", "Lists & rankings", "Sleep & ambient", "Shorts", "Recaps & commentary", "Animation & AI video", "Challenge & experiment", "Podcast & talk", "Live & community"];

// "0-15" -> 15 seconds, "1:30-3:00" -> 90; used only to size the beat bar.
function beatSeconds(range: string) {
  const times = String(range || "")
    .match(/\d+(?::\d+)?/g)
    ?.map((part) => part.split(":").reduce((sum, n) => sum * 60 + Number(n), 0)) || [];
  return times.length >= 2 ? Math.max(1, times[1] - times[0]) : 20;
}

// "600-9000" -> "10:00–2:30:00". Ranges already written as clock times pass through.
function beatTime(range: string) {
  if (!/^\s*\d+\s*-\s*\d+\s*$/.test(String(range || ""))) return range;
  const clock = (total: number) => {
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  };
  const [from, to] = range.split("-").map((part) => Number(part.trim()));
  return `${clock(from)}–${clock(to)}`;
}

function FormatLibrary({ formatId }: { formatId: string }) {
  const [formats, setFormats] = useState<VideoFormat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [facelessOnly, setFacelessOnly] = useState(false);
  const [trend, setTrend] = useState<"all" | "rising">("all");
  useEffect(() => {
    let mounted = true;
    fetch("/api/formats")
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error("Could not load the format library"))))
      .then((data) => mounted && setFormats(data.formats || []))
      .catch((err) => mounted && setError(err instanceof Error ? err.message : "Could not load the format library"))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);
  if (loading) return <LoadingState label="Loading format library" />;
  if (error) return <ErrorState message={error} onBack={() => writeDeepLink({ view: "niches" })} />;
  if (formatId) {
    const format = formats.find((item) => item.id === formatId);
    if (!format) return <ErrorState message="This format could not be found." onBack={() => writeDeepLink({ view: "niches", nichePath: ["formats"] })} />;
    return <FormatDetailPage format={format} />;
  }
  const needle = query.trim().toLowerCase();
  const categories = FORMAT_CATEGORIES.filter((name) => formats.some((format) => format.category === name));
  const visible = formats
    .filter((format) => category === "all" || format.category === category)
    .filter((format) => !facelessOnly || format.faceless)
    .filter((format) => trend === "all" || format.trend === "rising")
    .filter((format) => !needle || [format.name, format.summary, format.category, ...(format.bestNiches || [])].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => ["rising", "peaking", "stable", "cooling"].indexOf(a.trend) - ["rising", "peaking", "stable", "cooling"].indexOf(b.trend));
  return (
    <div className="space-y-5">
      <LibraryTabs value="formats" />
      <PageHeader
        eyebrow="Format library"
        title="Video formats that work now."
        description="Repeatable structures, with beat-by-beat timing, title patterns and channels using them. Researched October 2026."
        metrics={[
          ["Formats", compact(formats.length)],
          ["Rising", compact(formats.filter((format) => format.trend === "rising").length)],
          ["Faceless", compact(formats.filter((format) => format.faceless).length)],
          ["Categories", compact(categories.length)],
        ]}
      />
      <div className="flex flex-wrap items-center gap-3">
        <SearchField value={query} onChange={setQuery} placeholder="Search formats or niches" label="Search formats" className="w-full sm:w-72" />
        <Segmented<"all" | "rising"> label="Momentum" size="sm" value={trend} onChange={setTrend} options={[{ value: "all", label: "All" }, { value: "rising", label: "Rising" }]} />
        <Switch compact checked={facelessOnly} onChange={setFacelessOnly} label="Faceless only" />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Format category">
        {["all", ...categories].map((name) => (
          <button key={name} type="button" className="ui-chip" aria-pressed={category === name} onClick={() => setCategory(name)}>
            {name === "all" ? "All formats" : name}
            <small className="opacity-50">{name === "all" ? formats.length : formats.filter((format) => format.category === name).length}</small>
          </button>
        ))}
      </div>
      {visible.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
          {visible.map((format) => (
            <button
              key={format.id}
              type="button"
              onClick={() => writeDeepLink({ view: "niches", nichePath: ["formats", format.id] })}
              className="flex flex-col gap-3 rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-4 text-left shadow-sm transition hover:-translate-y-px hover:border-[var(--ui-line-strong)]"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/40">{format.category}</span>
                <TrendPill trend={format.trend} />
              </span>
              <span>
                <h3 className="m-0 text-base font-black leading-snug text-[var(--ui-text)]">{format.name}</h3>
                <p className="m-0 mt-1 line-clamp-2 text-xs font-semibold leading-5 text-[var(--ui-text)]/55">{format.summary}</p>
              </span>
              <BeatBar beats={format.structure} />
              <span className="mt-auto flex flex-wrap gap-1.5 text-[11px] font-bold text-[var(--ui-text)]/55">
                <span className="rounded-full bg-[var(--ui-chip)] px-2 py-0.5">{format.length}</span>
                <span className="rounded-full bg-[var(--ui-chip)] px-2 py-0.5">{format.aspect === "both" ? "16:9 + 9:16" : format.aspect}</span>
                {format.faceless ? <span className="rounded-full bg-[var(--ui-chip)] px-2 py-0.5">Faceless</span> : null}
                <span className="rounded-full bg-[var(--ui-chip)] px-2 py-0.5">{format.productionLoad} effort</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="py-10 text-center text-sm font-semibold text-[var(--ui-text)]/50">No formats match. Clear a filter or try another search.</p>
      )}
    </div>
  );
}

/** The format's beats as one bar, each segment sized by its share of the runtime. */
function BeatBar({ beats }: { beats: VideoFormat["structure"] }) {
  if (!beats?.length) return null;
  return (
    <span className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
      {beats.map((beat, index) => (
        <span
          key={`${beat.beat}-${index}`}
          title={beat.beat}
          className={cn("rounded-full", index === 0 ? "bg-[var(--ui-accent)]" : "bg-[var(--ui-text)]/15")}
          style={{ flexGrow: beatSeconds(beat.seconds) }}
        />
      ))}
    </span>
  );
}

function FormatDetailPage({ format }: { format: VideoFormat }) {
  const [copied, setCopied] = useState("");
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text);
    setCopied(text);
    window.setTimeout(() => setCopied(""), 1400);
  };
  // Create Video gets the format as its brief: the structure to follow, the hooks and title patterns.
  const makeVideo = () => {
    writePendingTemplate({
      target: "create",
      title: format.name,
      aspect: format.aspect === "9:16" ? "9:16" : "16:9",
      prompt: [
        `Make a video in the "${format.name}" format: ${format.summary}`,
        `Length: ${format.length}.`,
        `Structure:\n${format.structure.map((beat) => `- ${beat.beat} (${beatTime(beat.seconds)}): ${beat.what}`).join("\n")}`,
        format.hookTemplates?.length ? `Open with a hook like: ${format.hookTemplates[0]}` : "",
        format.titlePatterns?.length ? `Title pattern: ${format.titlePatterns[0]}` : "",
        format.retentionTips?.length ? `Keep viewers watching: ${format.retentionTips.join(" ")}` : "",
      ].filter(Boolean).join("\n\n"),
    });
    writeDeepLink({ view: "create" });
  };
  return (
    <div className="space-y-5">
      <BackButton label="Back to formats" path={["formats"]} />
      <header className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 shadow-sm md:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black uppercase tracking-widest text-[var(--ui-accent-text)]">{format.category}</span>
          <TrendPill trend={format.trend} />
        </div>
        <h1 className="mt-3 max-w-4xl font-serif text-3xl font-bold leading-tight text-[var(--ui-text)]">{format.name}</h1>
        <p className="mt-3 max-w-3xl text-base font-semibold leading-7 text-[var(--ui-text)]/58">{format.summary}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[format.length, format.aspect === "both" ? "16:9 and 9:16" : format.aspect, format.faceless ? "Faceless" : "On camera", `${format.productionLoad} effort`].map((item) => (
            <span key={item} className="rounded-full bg-[var(--ui-chip)] px-3 py-1 text-xs font-bold text-[var(--ui-text)]/70">{item}</span>
          ))}
          <button type="button" className="ui-btn is-primary ml-auto" onClick={makeVideo}>
            <Clapperboard className="h-4 w-4" />
            Make a video in this format
          </button>
        </div>
        {format.trendNote ? <p className="mt-4 max-w-3xl text-xs font-semibold leading-5 text-[var(--ui-text)]/50">{format.trendNote}</p> : null}
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-5 shadow-sm lg:col-span-2">
          <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[var(--ui-text)]/35">Structure</p>
          <BeatBar beats={format.structure} />
          <ol className="mt-4 grid gap-2 md:grid-cols-2">
            {format.structure.map((beat, index) => (
              <li key={`${beat.beat}-${index}`} className="flex gap-3 rounded-xl border border-[var(--ui-line)] p-3">
                <span className="font-mono text-xs font-black text-[var(--ui-accent-text)]">{String(index + 1).padStart(2, "0")}</span>
                <span className="min-w-0">
                  <span className="block text-sm font-black text-[var(--ui-text)]">
                    {beat.beat} <span className="font-mono text-xs font-bold text-[var(--ui-text)]/40">{beatTime(beat.seconds)}</span>
                  </span>
                  <span className="mt-0.5 block text-xs font-semibold leading-5 text-[var(--ui-text)]/60">{beat.what}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <Panel title="Title patterns">
          <CopyList items={format.titlePatterns} copied={copied} onCopy={copy} />
        </Panel>
        <Panel title="Opening hooks">
          <CopyList items={format.hookTemplates} copied={copied} onCopy={copy} />
        </Panel>
        <Panel title="Retention">
          <ListBlock icon={<Target className="h-4 w-4" />} items={format.retentionTips} />
        </Panel>
        <Panel title="Thumbnail">
          <p className="text-sm font-semibold leading-6 text-[var(--ui-text)]/62">{format.thumbnailPattern}</p>
        </Panel>
        <Panel title="Best niches">
          <div className="flex flex-wrap gap-1.5">
            {format.bestNiches.map((niche) => (
              <button
                key={niche}
                type="button"
                title="Find channels in this niche"
                onClick={() => writeDeepLink({ view: "discover", discoveryQuery: niche })}
                className="rounded-full border border-[var(--ui-line)] bg-[var(--ui-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ui-text)]/60 transition hover:border-[var(--ui-line-strong)] hover:text-[var(--ui-text)]"
              >
                {niche}
              </button>
            ))}
          </div>
        </Panel>
        {format.examples?.length ? (
          <Panel title="Channels using it">
            <ChannelLinks channels={format.examples.map((example) => ({ handle: example.channel, label: example.channel, note: example.note, subscribers: example.subscribers }))} />
          </Panel>
        ) : null}
        <div className="rounded-2xl border border-[var(--ui-accent)]/12 bg-[var(--ui-accent)]/5 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-[var(--ui-accent-text)]">Monetization risk: {format.monetizationRisk}</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-[var(--ui-text)]/62">{format.riskNote}</p>
        </div>
        <Sources refs={format.sourceRefs} />
      </div>
    </div>
  );
}

function CopyList({ items, copied, onCopy }: { items: string[]; copied: string; onCopy: (text: string) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onCopy(item)}
          className="flex w-full items-start gap-2 rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 py-2 text-left text-xs font-semibold leading-5 text-[var(--ui-text)]/70 transition hover:border-[var(--ui-line-strong)]"
        >
          <p className="m-0 min-w-0 flex-1">{item}</p>
          {copied === item ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ui-accent-text)]" /> : <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40" />}
        </button>
      ))}
    </div>
  );
}
