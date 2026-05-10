import { ReactNode, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Bot, Database, Globe2, Layers3, Loader2, Search, Sparkles, Target, WalletCards } from "lucide-react";
import { writeDeepLink } from "../utils/tiktokRoute";

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
      <PageHeader
        eyebrow="Niche database"
        title="Top-level niche map."
        description="Start from a broad faceless niche, then drill into sub-niches and MSN opportunities on separate pages."
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
            className="grid w-full min-w-[680px] grid-cols-[minmax(240px,1.4fr)_110px_90px_110px_130px] gap-3 border-b border-[#1A1A1A]/6 px-4 py-4 text-left transition last:border-b-0 hover:bg-[#F9F8F6]"
          >
            <span className="min-w-0">
              <span className="block text-sm font-black text-[#1A1A1A]">{group.name}</span>
              <span className="mt-1 block truncate text-xs font-semibold text-[#1A1A1A]/45">{group.subNiches.slice(0, 3).map((sub) => sub.name).join(", ")}</span>
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
            className="grid w-full min-w-[730px] grid-cols-[minmax(260px,1.35fr)_100px_110px_minmax(260px,1fr)] gap-3 border-b border-[#1A1A1A]/6 px-4 py-4 text-left transition last:border-b-0 hover:bg-[#F9F8F6]"
          >
            <span className="min-w-0">
              <span className="block text-sm font-black text-[#1A1A1A]">{sub.name}</span>
              <span className="mt-1 block text-xs font-semibold text-[#1A1A1A]/45">{sub.topRpmRange}</span>
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
            className="grid w-full min-w-[690px] grid-cols-[minmax(300px,1.5fr)_150px_150px_90px] gap-3 border-b border-[#1A1A1A]/6 px-4 py-4 text-left transition last:border-b-0 hover:bg-[#F9F8F6]"
          >
            <span className="min-w-0">
              <span className="block text-sm font-black leading-snug text-[#1A1A1A]">{niche.msn}</span>
              <span className="mt-1 block truncate text-xs font-semibold text-[#1A1A1A]/45">{niche.audienceValue}</span>
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
    <div className="space-y-5">
      <BackButton label={`Back to ${niche.subNiche}`} path={[topSlug, subSlug]} />

      <section className="overflow-hidden rounded-3xl border border-[#1A1A1A]/8 bg-white shadow-sm">
        <div className="bg-[#FDFCFA] p-6 md:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#FF0033]/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#FF0033]">{niche.cpmTier} CPM</span>
            <span className="rounded-full bg-[#FFDE32] px-3 py-1 font-mono text-xs font-black text-[#1A1A1A]">{niche.trendScore}/100</span>
            <span className="rounded-full border border-[#1A1A1A]/8 bg-white px-3 py-1 text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/45">{niche.competition} competition</span>
          </div>
          <p className="text-xs font-black uppercase tracking-widest text-[#FF0033]">{niche.macroNiche} / {niche.subNiche}</p>
          <h1 className="mt-3 max-w-4xl font-serif text-3xl font-bold leading-tight text-[#1A1A1A] sm:text-4xl md:text-5xl">{niche.msn}</h1>
          <p className="mt-4 max-w-3xl text-base font-semibold leading-7 text-[#1A1A1A]/58">{niche.audienceValue}</p>
        </div>

        <div className="p-5 md:p-6">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
            <DetailMetric icon={<Globe2 className="h-4 w-4" />} label="Markets" value={niche.geoTier} />
            <DetailMetric icon={<WalletCards className="h-4 w-4" />} label="RPM" value={niche.rpmRange} />
            <DetailMetric icon={<BarChart3 className="h-4 w-4" />} label="Competition" value={niche.competition} />
            <DetailMetric icon={<Bot className="h-4 w-4" />} label="Formats" value={`${niche.facelessFormats.length}`} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
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
          <ListBlock icon={<Search className="h-4 w-4" />} items={niche.acquisitionQueries} />
        </Panel>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/35">Creator fit</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#1A1A1A]/62">{niche.creatorFit}</p>
        </div>
        <div className="rounded-2xl border border-[#FF0033]/12 bg-[#FF0033]/5 p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-[#FF0033]">Risk note</p>
          <p className="mt-3 text-sm font-semibold leading-6 text-[#1A1A1A]/62">{niche.riskNotes}</p>
        </div>
      </section>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, metrics }: { eyebrow: string; title: string; description: string; metrics: [string, string][] }) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-[#FF0033]/15 bg-[#FF0033]/8 px-3 py-1 text-xs font-black uppercase tracking-widest text-[#FF0033]">
          <Database className="h-3.5 w-3.5" />
          {eyebrow}
        </div>
        <h1 className="max-w-3xl font-serif text-3xl font-bold leading-tight tracking-tight text-[#1A1A1A] md:text-4xl">{title}</h1>
        <p className="mt-3 max-w-2xl text-sm font-semibold leading-6 text-[#1A1A1A]/55">{description}</p>
      </div>
      <div className="grid w-full grid-cols-2 gap-2 md:w-auto md:min-w-[420px] md:grid-cols-4">
        {metrics.map(([label, value]) => <HeroMetric key={label} label={label} value={value} />)}
      </div>
    </header>
  );
}

function DataTable({ columns, headers, children }: { columns: string; headers: string[]; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#1A1A1A]/8 bg-white shadow-sm">
      <div className={`hidden min-w-[680px] ${columns} gap-3 border-b border-[#1A1A1A]/8 bg-[#FDFCFA] px-4 py-3 text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/38 sm:grid`}>
        {headers.map((header, index) => <span key={header} className={index === headers.length - 1 ? "text-right" : ""}>{header}</span>)}
      </div>
      <div className="overflow-x-auto overscroll-x-contain">{children}</div>
    </section>
  );
}

function BackButton({ label, path }: { label: string; path: string[] }) {
  return (
    <button type="button" onClick={() => writeDeepLink({ view: "niches", nichePath: path })} className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 py-2 text-xs font-black text-[#1A1A1A]/70 shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
      <ArrowLeft className="h-4 w-4" />
      {label}
    </button>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <div className="grid min-h-[420px] place-items-center rounded-2xl border border-[#1A1A1A]/8 bg-white shadow-sm">
      <span className="inline-flex items-center gap-2 text-sm font-bold text-[#1A1A1A]/50">
        <Loader2 className="h-4 w-4 animate-spin text-[#FF0033]" />
        {label}
      </span>
    </div>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex h-10 items-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-4 text-xs font-black text-[#1A1A1A]/70 shadow-sm transition hover:border-[#FF0033]/25 hover:text-[#FF0033]">
        <ArrowLeft className="h-4 w-4" />
        Back to niches
      </button>
      <div className="rounded-2xl border border-red-100 bg-red-50 p-6">
        <p className="text-sm font-bold text-red-900">{message}</p>
      </div>
    </div>
  );
}

function WarningBar({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
      Using seed data while the database reconnects: {message}
    </div>
  );
}

function HeroMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white px-4 py-3 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 font-mono text-xl font-black text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  return (
    <span className="inline-flex min-w-10 justify-center rounded-full bg-[#1A1A1A] px-2 py-1 font-mono text-xs font-black text-[#FFDE32]">
      {score || 0}
    </span>
  );
}

function CellMono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-sm font-black text-[#1A1A1A]/60">{children}</span>;
}

function CellMuted({ children }: { children: ReactNode }) {
  return <span className="min-w-0 truncate text-xs font-bold leading-5 text-[#1A1A1A]/58">{children}</span>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-5 shadow-sm">
      <p className="mb-3 text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/35">{title}</p>
      {children}
    </div>
  );
}

function DetailMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-[#FDFCFA] p-3">
      <div className="mb-2 text-[#FF0033]">{icon}</div>
      <p className="text-[10px] font-black uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-xs font-black leading-5 text-[#1A1A1A]">{value}</p>
    </div>
  );
}

function PillBlock({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-[#1A1A1A]/8 bg-[#F9F8F6] px-2.5 py-1 text-[11px] font-bold text-[#1A1A1A]/58">{item}</span>
      ))}
    </div>
  );
}

function ListBlock({ icon, items }: { icon: ReactNode; items: string[] }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item} className="rounded-xl border border-[#1A1A1A]/6 bg-[#FDFCFA] px-3 py-2 text-xs font-semibold leading-5 text-[#1A1A1A]/62">
          <span className="mr-2 inline-flex align-[-3px] text-[#FF0033]">{icon}</span>
          {item}
        </div>
      ))}
    </div>
  );
}
