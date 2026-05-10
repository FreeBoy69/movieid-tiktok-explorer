import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clapperboard,
  FileText,
  Film,
  Layers3,
  LockKeyhole,
  PlayCircle,
  Radar,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  Users,
  WandSparkles,
  Youtube,
  Zap,
} from "lucide-react";
import { ReactNode } from "react";
import { AuthSessionPayload } from "../types";
import { BrandLogo } from "./BrandLogo";

const googleSignInPath = "/api/auth/google?mode=signin&next=/channels";

export function LandingPage({ auth }: { auth: AuthSessionPayload | null }) {
  const oauthReady = !!auth?.googleConfigured && auth?.dbConfigured !== false;
  const errorParams = new URLSearchParams(window.location.search);
  const authError = window.location.pathname === "/auth/error" ? errorParams.get("message") || "Google sign-in failed" : "";
  const signInHref = oauthReady ? googleSignInPath : "#signin";

  return (
    <main className="min-h-screen bg-[#F9F8F6] text-[#1A1A1A]">
      <PublicNav signInHref={signInHref} />

      <section className="relative overflow-hidden border-b border-[#1A1A1A]/6">
        <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_30%_0%,rgba(255,222,50,0.28),transparent_36%),radial-gradient(circle_at_78%_8%,rgba(255,0,51,0.12),transparent_30%)]" />
        <div className="relative mx-auto grid min-h-[calc(100vh-72px)] max-w-7xl gap-10 px-5 py-12 md:grid-cols-[minmax(0,1fr)_520px] md:px-10 md:py-16 lg:px-14">
          <div className="flex flex-col justify-center">
            <div className="mb-6 inline-flex w-fit items-center gap-2 rounded-full border border-[#FF0033]/16 bg-white/75 px-3 py-1.5 text-xs font-bold text-[#CC0029] shadow-sm">
              <Sparkles className="h-3.5 w-3.5" />
              AI video intelligence for faceless channels and recap systems
            </div>
            <h1 className="max-w-4xl font-serif text-5xl font-bold leading-[0.95] tracking-tight md:text-7xl">
              Identify clips, find niches, connect YouTube.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-[#1A1A1A]/64">
              AutoYT brings TikTok discovery, movie identification, YouTube outlier research, channel analytics, and publishing preparation into one private creator workspace.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={signInHref} className="inline-flex h-12 items-center justify-center gap-3 rounded-xl bg-[#FFDE32] px-6 text-sm font-bold text-[#1A1A1A] shadow-xl shadow-[#FFDE32]/25 transition hover:bg-[#FF0033] hover:text-white">
                <Youtube className="h-5 w-5" />
                Continue with Google
              </a>
              <a href="#workflow" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-6 text-sm font-bold text-[#1A1A1A]/70 shadow-sm transition hover:border-[#FF0033]/30 hover:text-[#FF0033]">
                See workflow
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            {authError && <p className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{authError}</p>}

            <div className="mt-10 grid max-w-2xl grid-cols-3 gap-3">
              <ProofPoint value="5K" label="TikTok scan depth" />
              <ProofPoint value="Multi" label="YouTube accounts" />
              <ProofPoint value="Private" label="Server sessions" />
            </div>
          </div>

          <HeroWorkspace signInHref={signInHref} />
        </div>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-5 py-16 md:px-10 lg:px-14">
        <SectionHeading eyebrow="Creator operating system" title="Everything before the edit starts here." copy="AutoYT helps you decide what to make, identify what a clip is, and keep your channel research connected to the accounts you manage." />
        <div className="mt-9 grid gap-4 md:grid-cols-3">
          <Feature icon={<Radar />} label="YouTube niche radar" detail="Search keywords, scan viral surfaces, score outliers, and save opportunity lists for repeatable research." />
          <Feature icon={<PlayCircle />} label="TikTok explorer" detail="Open profiles, collections, saved playlists, and single posts with URL-persistent navigation." />
          <Feature icon={<Film />} label="Movie identification" detail="Analyze recap clips against transcript, story, visual evidence, and TMDB metadata." />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <Feature icon={<BarChart3 />} label="Channel analytics" detail="Connect Google, switch YouTube accounts, and review channel stats plus recent uploads." />
          <Feature icon={<WandSparkles />} label="AI rewriting" detail="Turn transcript research into structured rewrite drafts and content phases." />
          <Feature icon={<ShieldCheck />} label="Verification-ready auth" detail="Google OAuth, server-side sessions, privacy disclosures, and account deletion paths." />
        </div>
      </section>

      <section id="workflow" className="border-y border-[#1A1A1A]/6 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-10 lg:px-14">
          <SectionHeading eyebrow="Workflow automation" title="From discovery to publishing prep." copy="A cleaner path for creators who move between trends, clips, scripts, and channel dashboards all day." />
          <div className="mt-10 grid gap-4 lg:grid-cols-4">
            <WorkflowStep number="01" icon={<Radar />} title="Scan the market" copy="Search YouTube niches, spot outliers, and compare velocity before you commit to an angle." />
            <WorkflowStep number="02" icon={<Clapperboard />} title="Analyze source clips" copy="Process TikTok posts and movie clips to extract story, transcript, evidence, and metadata." />
            <WorkflowStep number="03" icon={<RefreshCw />} title="Rewrite for production" copy="Move validated transcript material into structured rewriting and repeatable phases." />
            <WorkflowStep number="04" icon={<UploadCloud />} title="Prepare to publish" copy="Switch connected channels, inspect uploads, and open YouTube publishing tools when it is time to post." />
          </div>
        </div>
      </section>

      <section id="ai" className="mx-auto max-w-7xl px-5 py-16 md:px-10 lg:px-14">
        <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
          <div>
            <SectionHeading eyebrow="Analysis engine" title="AI that reads the useful signals, not just the thumbnail." copy="AutoYT keeps long analysis pages organized into clear tabs and separates evidence, niche fit, transcript, story, visuals, and post context." />
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Signal icon={<FileText />} label="Transcript clues" />
              <Signal icon={<Layers3 />} label="Story structure" />
              <Signal icon={<Film />} label="Movie evidence" />
              <Signal icon={<Zap />} label="Outlier momentum" />
            </div>
          </div>
          <AnalysisMockup />
        </div>
      </section>

      <section id="teams" className="border-y border-[#1A1A1A]/6 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-16 md:px-10 lg:px-14">
          <SectionHeading eyebrow="For creators and teams" title="Scale research without losing the thread." copy="Use one workspace for saved TikTok playlists, YouTube opportunity boards, connected channels, and repeatable script workflows." />
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            <TeamCard icon={<Users />} title="Multi-account creators" copy="Connect more than one YouTube account and switch channels without leaving the research board." />
            <TeamCard icon={<LockKeyhole />} title="Private research ops" copy="Sessions are stored server-side, and connected data is used only to power your workspace." />
            <TeamCard icon={<CheckCircle2 />} title="Verification ready" copy="Public privacy and terms pages explain Google and YouTube data usage for review." />
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-5 py-16 md:px-10">
        <SectionHeading eyebrow="Questions" title="What people ask before connecting." copy="Short answers for Google review, creators, and collaborators checking how the app works." centered />
        <div className="mt-9 space-y-3">
          <Faq question="What does AutoYT do?" answer="AutoYT helps creators research YouTube niches, analyze TikTok and movie recap clips, connect YouTube accounts, and prepare publishing workflows from one dashboard." />
          <Faq question="Why does AutoYT ask for YouTube access?" answer="The app uses YouTube permissions to read channel profile details, channel statistics, and recent uploads for accounts you connect. AutoYT does not request upload permission unless a real API publishing feature is added." />
          <Faq question="Can I connect multiple YouTube accounts?" answer="Yes. After signing in with Google, you can add another account and switch between connected channels inside the workspace." />
          <Faq question="Can I remove my account data?" answer="Yes. You can sign out, disconnect accounts, and request deletion through the contact email listed in the privacy policy." />
        </div>
      </section>

      <section id="signin" className="mx-auto max-w-7xl px-5 pb-16 md:px-10 lg:px-14">
        <div className="overflow-hidden rounded-3xl border border-[#1A1A1A]/8 bg-[#1A1A1A] p-6 text-[#F9F8F6] shadow-2xl shadow-[#1A1A1A]/10 md:p-10">
          <div className="grid gap-8 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#FFDE32]">Start private beta</p>
              <h2 className="mt-3 max-w-2xl font-serif text-4xl font-bold leading-tight md:text-5xl">Build your creator research workspace.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#F9F8F6]/64">Sign in with Google to connect YouTube accounts and unlock channel analytics. TikTok and movie workflows stay inside the same app.</p>
            </div>
            <a href={signInHref} className="inline-flex h-12 items-center justify-center gap-3 rounded-xl bg-[#FFDE32] px-6 text-sm font-bold text-[#1A1A1A] shadow-lg shadow-[#FFDE32]/20 transition hover:bg-[#FF0033] hover:text-white">
              <Youtube className="h-5 w-5" />
              Continue with Google
            </a>
          </div>
          {!oauthReady && (
            <p className="mt-5 rounded-xl border border-[#FFDE32]/30 bg-[#FFDE32]/12 px-4 py-3 text-xs font-semibold leading-5 text-[#FFDE32]">
              Google OAuth is not configured yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET, and APP_URL=https://autoyt.cc.
            </p>
          )}
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}

function PublicNav({ signInHref }: { signInHref: string }) {
  return (
    <header className="sticky top-0 z-50 px-3 pt-3 md:px-5">
      <nav className="mx-auto flex h-[68px] max-w-7xl items-center justify-between rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6]/90 px-3 shadow-[0_18px_45px_rgba(26,26,26,0.08)] backdrop-blur-xl md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/" className="flex items-center" aria-label="AutoYT home">
            <BrandLogo className="h-14 w-16 md:h-12 md:w-44" imageClassName="max-h-full max-w-full" />
          </a>
          <span className="hidden rounded-full border border-[#FF0033]/16 bg-[#FF0033]/7 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#CC0029] lg:inline-flex">
            Private beta
          </span>
        </div>

        <div className="hidden items-center rounded-full border border-[#1A1A1A]/8 bg-white/82 p-1 text-xs font-bold text-[#1A1A1A]/58 shadow-sm md:flex">
          <a href="/#product" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#FF0033]">Product</a>
          <a href="/#workflow" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#FF0033]">Workflow</a>
          <a href="/#ai" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#FF0033]">AI analysis</a>
          <a href="/#faq" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#FF0033]">FAQ</a>
        </div>

        <div className="flex items-center gap-2">
          <a href="/privacy" className="hidden rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A]/45 transition hover:text-[#FF0033] sm:inline-flex">
            Privacy
          </a>
          <a href={signInHref} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-xs font-bold text-[#1A1A1A] shadow-sm shadow-[#FFDE32]/25 transition hover:bg-[#FF0033] hover:text-white">
            Sign in
            <ArrowRight className="hidden h-3.5 w-3.5 sm:block" />
          </a>
        </div>
      </nav>
    </header>
  );
}

function HeroWorkspace({ signInHref }: { signInHref: string }) {
  return (
    <div className="flex items-center">
      <div className="w-full rounded-[2rem] border border-[#1A1A1A]/8 bg-white p-3 shadow-2xl shadow-[#1A1A1A]/10">
        <div className="rounded-[1.35rem] bg-[#F9F8F6] p-4">
          <div className="flex items-center justify-between border-b border-[#1A1A1A]/8 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#FF0033]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#FFDE32]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#1A1A1A]/18" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Live workspace</p>
          </div>

          <div className="grid gap-3 py-4 sm:grid-cols-[150px_1fr]">
            <div className="space-y-2">
              {["YouTube Radar", "TikTok Explorer", "Movie ID"].map((item, index) => (
                <div key={item} className={`rounded-xl px-3 py-2 text-xs font-bold ${index === 0 ? "bg-[#1A1A1A] text-white" : "bg-white text-[#1A1A1A]/55"}`}>{item}</div>
              ))}
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#FF0033]">Outlier scan</p>
                  <h3 className="mt-2 font-serif text-2xl font-bold leading-tight">Faceless movie recaps</h3>
                </div>
                <div className="rounded-full bg-[#FFDE32] px-3 py-1.5 text-xs font-bold">86 score</div>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <MiniMetric label="Views/hr" value="12.4K" />
                <MiniMetric label="Recent views" value="2.8M" />
                <MiniMetric label="Channels" value="214" />
              </div>
              <div className="mt-5 space-y-2">
                {["Small channels overperforming", "High recap demand", "Repeatable story formats"].map((item) => (
                  <div key={item} className="flex items-center gap-2 rounded-lg bg-[#F9F8F6] px-3 py-2 text-xs font-semibold text-[#1A1A1A]/62">
                    <CheckCircle2 className="h-3.5 w-3.5 text-[#FF0033]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <a href={signInHref} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] text-sm font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">
            Open workspace
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, copy, centered = false }: { eyebrow: string; title: string; copy: string; centered?: boolean }) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">{eyebrow}</p>
      <h2 className="mt-3 font-serif text-4xl font-bold leading-tight tracking-tight md:text-5xl">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-[#1A1A1A]/58 md:text-base">{copy}</p>
    </div>
  );
}

function ProofPoint({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white px-4 py-3 shadow-sm">
      <p className="text-lg font-bold text-[#1A1A1A]">{value}</p>
      <p className="mt-1 text-[11px] font-semibold leading-4 text-[#1A1A1A]/45">{label}</p>
    </div>
  );
}

function Feature({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-5 shadow-sm transition hover:border-[#FF0033]/25 hover:shadow-md">
      <div className="mb-5 grid h-11 w-11 place-items-center rounded-xl bg-[#FF0033]/8 text-[#FF0033]">{icon}</div>
      <p className="text-base font-bold">{label}</p>
      <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">{detail}</p>
    </div>
  );
}

function WorkflowStep({ number, icon, title, copy }: { number: string; icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs font-bold text-[#1A1A1A]/30">{number}</span>
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[#FF0033] shadow-sm">{icon}</span>
      </div>
      <h3 className="mt-8 text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">{copy}</p>
    </div>
  );
}

function Signal({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white px-4 py-3 text-sm font-bold shadow-sm">
      <span className="text-[#FF0033]">{icon}</span>
      {label}
    </div>
  );
}

function AnalysisMockup() {
  return (
    <div className="rounded-[2rem] border border-[#1A1A1A]/8 bg-white p-4 shadow-2xl shadow-[#1A1A1A]/8">
      <div className="flex gap-2 overflow-x-auto border-b border-[#1A1A1A]/8 pb-3">
        {["Post", "Movie ID", "Transcript", "Story", "Visuals", "Niche"].map((tab, index) => (
          <span key={tab} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold ${index === 1 ? "bg-[#1A1A1A] text-white" : "bg-[#F9F8F6] text-[#1A1A1A]/45"}`}>{tab}</span>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[160px_1fr]">
        <div className="aspect-[9/16] rounded-2xl bg-[linear-gradient(160deg,#1A1A1A,#3A3430)] p-3">
          <div className="flex h-full flex-col justify-end rounded-xl border border-white/10 p-3 text-white">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#FFDE32]">Clean clip</p>
            <p className="mt-1 text-xs text-white/70">Ready for analysis</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl bg-[#F9F8F6] p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Likely match</p>
            <h3 className="mt-2 font-serif text-3xl font-bold">Rubikon</h3>
            <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">Evidence from transcript, visual style, and TMDB data appears in separated tabs.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniMetric label="Confidence" value="95%" />
            <MiniMetric label="Evidence" value="8" />
            <MiniMetric label="Niches" value="34" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamCard({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-5">
      <div className="mb-6 grid h-11 w-11 place-items-center rounded-xl bg-white text-[#FF0033] shadow-sm">{icon}</div>
      <h3 className="text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">{copy}</p>
    </div>
  );
}

function Faq({ question, answer }: { question: string; answer: string }) {
  return (
    <details className="group rounded-xl border border-[#1A1A1A]/8 bg-white px-5 py-4 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-bold">
        {question}
        <span className="text-[#FF0033] transition group-open:rotate-45">+</span>
      </summary>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-[#1A1A1A]/56">{answer}</p>
    </details>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white px-3 py-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function PublicFooter() {
  return (
    <footer className="border-t border-[#1A1A1A]/6 bg-[#F9F8F6]">
      <div className="mx-auto max-w-7xl px-5 py-12 md:px-10 lg:px-14">
        <div className="overflow-hidden rounded-[2rem] border border-[#1A1A1A]/8 bg-white shadow-[0_24px_80px_rgba(26,26,26,0.08)]">
          <div className="grid gap-8 border-b border-[#1A1A1A]/6 p-6 md:grid-cols-[1.05fr_0.95fr] md:p-8">
            <div>
              <BrandLogo variant="horizontal" className="h-12 w-44" imageClassName="max-h-full max-w-full" />
              <p className="mt-5 max-w-xl text-sm leading-7 text-[#1A1A1A]/58">
                Private creator intelligence for video research, channel analytics, clip identification, and publishing preparation.
              </p>
            </div>
            <div className="rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-[#FF0033]">Google review ready</p>
              <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/58">Public privacy and terms pages are available, with YouTube API data use and deletion instructions documented.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="/privacy" className="rounded-xl bg-[#FFDE32] px-3 py-2 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#FF0033] hover:text-white">Privacy Policy</a>
                <a href="/terms" className="rounded-xl border border-[#1A1A1A]/10 bg-white px-3 py-2 text-xs font-bold text-[#1A1A1A]/60 transition hover:border-[#FF0033]/30 hover:text-[#FF0033]">Terms</a>
              </div>
            </div>
          </div>

          <div className="grid gap-8 p-6 md:grid-cols-4 md:p-8">
            <FooterColumn
              title="Product"
              links={[
                ["Movie ID", "/#product"],
                ["TikTok Explorer", "/#product"],
                ["YouTube Radar", "/#product"],
                ["AI Rewriter", "/#workflow"],
              ]}
            />
            <FooterColumn
              title="Workflow"
              links={[
                ["Niche discovery", "/#workflow"],
                ["Clip analysis", "/#ai"],
                ["Channel analytics", "/#teams"],
                ["Account switching", "/#teams"],
              ]}
            />
            <FooterColumn
              title="Company"
              links={[
                ["FAQ", "/#faq"],
                ["Contact", "mailto:evanslockwood69@gmail.com"],
                ["Privacy", "/privacy"],
                ["Terms", "/terms"],
              ]}
            />
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">Access</p>
              <a href={googleSignInPath} className="mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#FFDE32] px-4 text-sm font-bold text-[#1A1A1A] shadow-sm shadow-[#FFDE32]/25 transition hover:bg-[#FF0033] hover:text-white">
                Connect Google
                <Youtube className="h-4 w-4" />
              </a>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#1A1A1A]/45">
                <span className="h-2 w-2 rounded-full bg-[#FF0033]" />
                OAuth enabled for YouTube workflows
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-1 py-5 text-xs font-medium text-[#1A1A1A]/38 md:flex-row md:items-center md:justify-between">
          <p>Copyright 2026 AutoYT. All rights reserved.</p>
          <p>Not affiliated with TikTok, Google, YouTube, or TMDB.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-widest text-[#1A1A1A]/35">{title}</p>
      <div className="mt-4 grid gap-2.5 text-sm font-semibold text-[#1A1A1A]/55">
        {links.map(([label, href]) => (
          <a key={label} href={href} className="transition hover:text-[#FF0033]">
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
