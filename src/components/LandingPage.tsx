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
    <main className="min-h-dvh overflow-x-clip bg-[#F9F8F6] text-[#1A1A1A]">
      <PublicNav signInHref={signInHref} />

      <section className="relative overflow-hidden border-b border-[#1A1A1A]/6">
        <div className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(circle_at_30%_0%,rgba(255,222,50,0.28),transparent_36%),radial-gradient(circle_at_78%_8%,rgba(255,0,51,0.12),transparent_30%)]" />
        <div className="relative mx-auto grid min-h-[calc(100dvh-72px)] max-w-7xl gap-8 px-4 py-10 sm:px-5 md:grid-cols-[minmax(0,1fr)_minmax(320px,520px)] md:gap-10 md:px-10 md:py-16 lg:px-14">
          <div className="flex flex-col justify-center">
            <div className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full border border-[#f9dc0b]/16 bg-white/75 px-3 py-1.5 text-xs font-bold leading-5 text-[#6a5b00] shadow-sm md:mb-6">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              <span className="min-w-0">AI growth tools for YouTube creators</span>
            </div>
            <h1 className="max-w-4xl text-balance font-serif text-[clamp(2.75rem,16vw,4.65rem)] font-bold leading-[0.95] tracking-tight md:text-[clamp(4.5rem,7vw,6.6rem)]">
              Get More Views & Subscribers on YouTube
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-7 text-[#1A1A1A]/64 sm:text-lg sm:leading-8 md:mt-7">
              Grow faster with tailored AI tools that bring you more views, subscribers, and revenue.
            </p>

            <div className="mt-8 grid gap-3 sm:inline-grid sm:grid-flow-col sm:auto-cols-max md:mt-9">
              <a href={signInHref} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-[#f9dc0b] px-5 py-3 text-center text-sm font-bold leading-5 text-[#1A1A1A] shadow-xl shadow-[#f9dc0b]/25 transition hover:bg-[#1A1A1A] hover:text-white sm:px-6">
                <Youtube className="h-5 w-5 shrink-0" />
                <span>Sign Up for Free with Google</span>
              </a>
              <a href="#workflow" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#1A1A1A]/10 bg-white px-5 py-3 text-center text-sm font-bold leading-5 text-[#1A1A1A]/70 shadow-sm transition hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A] sm:px-6">
                See YouTube tools
                <ArrowRight className="h-4 w-4 shrink-0" />
              </a>
            </div>

            {authError && <p className="mt-4 rounded-xl border border-[#f9dc0b]/18 bg-[#fff9d6] px-4 py-3 text-sm font-semibold text-[#6a5b00]">{authError}</p>}

            <div className="mt-9 grid max-w-2xl grid-cols-1 gap-3 min-[430px]:grid-cols-3 md:mt-10">
              <ProofPoint value="More" label="Views from better topics" />
              <ProofPoint value="More" label="Subscribers from stronger videos" />
              <ProofPoint value="More" label="Revenue from smarter growth" />
            </div>
          </div>

          <HeroWorkspace signInHref={signInHref} />
        </div>
      </section>

      <section id="product" className="mx-auto max-w-7xl px-4 py-14 sm:px-5 md:px-10 md:py-16 lg:px-14">
        <SectionHeading eyebrow="One app for everything YouTube" title="Plan, optimize, and grow from one workspace." copy="AutoYT gives creators AI-powered research, ideas, optimization, analytics, and publishing preparation built around YouTube growth." />
        <div className="mt-9 grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-4">
          <Feature icon={<Radar />} label="Find winning keywords" detail="Search YouTube opportunities, compare demand, and spot topics with room to grow." />
          <Feature icon={<PlayCircle />} label="Find viral ideas" detail="Turn audience signals, channel patterns, and video momentum into better ideas before you record." />
          <Feature icon={<Clapperboard />} label="Optimize videos" detail="Improve titles, descriptions, hooks, and metadata so each upload has a clearer path to viewers." />
        </div>
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-4">
          <Feature icon={<BarChart3 />} label="Track channel growth" detail="Connect Google, review YouTube performance, and understand what is moving the channel forward." />
          <Feature icon={<WandSparkles />} label="Write with AI" detail="Create stronger outlines, scripts, hooks, and rewrite drafts tuned for YouTube retention." />
          <Feature icon={<ShieldCheck />} label="Grow with confidence" detail="Keep account access clear, private, and documented with Google and YouTube data controls." />
        </div>
      </section>

      <section id="workflow" className="border-y border-[#1A1A1A]/6 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-5 md:px-10 md:py-16 lg:px-14">
          <SectionHeading eyebrow="Creator workflow" title="A faster path from idea to upload." copy="Research what people want, shape the video, optimize the package, and measure the outcome without losing context." />
          <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-4">
            <WorkflowStep number="01" icon={<Radar />} title="Discover ideas" copy="Find topics, keywords, and video angles with real audience demand." />
            <WorkflowStep number="02" icon={<Clapperboard />} title="Shape the video" copy="Build stronger hooks, structure, titles, descriptions, and thumbnail direction." />
            <WorkflowStep number="03" icon={<RefreshCw />} title="Optimize for growth" copy="Use AI suggestions and channel context to improve each upload package." />
            <WorkflowStep number="04" icon={<UploadCloud />} title="Measure results" copy="Review YouTube performance and use what worked to plan the next video." />
          </div>
        </div>
      </section>

      <section id="ai" className="mx-auto max-w-7xl px-4 py-14 sm:px-5 md:px-10 md:py-16 lg:px-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:items-center">
          <div>
            <SectionHeading eyebrow="AI creator assistant" title="Your next upload should start with better signals." copy="AutoYT helps turn YouTube research, channel performance, and content ideas into clear next steps for growth." />
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Signal icon={<FileText />} label="Keyword opportunities" />
              <Signal icon={<Layers3 />} label="Video structure" />
              <Signal icon={<Youtube />} label="Channel signals" />
              <Signal icon={<Zap />} label="Outlier momentum" />
            </div>
          </div>
          <AnalysisMockup />
        </div>
      </section>

      <section id="teams" className="border-y border-[#1A1A1A]/6 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-14 sm:px-5 md:px-10 md:py-16 lg:px-14">
          <SectionHeading eyebrow="For creators and teams" title="Grow your YouTube channel with less guesswork." copy="Use one workspace for YouTube opportunity research, connected channel analytics, AI writing, and repeatable upload workflows." />
          <div className="mt-10 grid grid-cols-[repeat(auto-fit,minmax(min(100%,17rem),1fr))] gap-4">
            <TeamCard icon={<Users />} title="Multi-account creators" copy="Connect more than one YouTube account and switch channels without leaving the research board." />
            <TeamCard icon={<LockKeyhole />} title="Private research ops" copy="Sessions are stored server-side, and connected data is used only to power your workspace." />
            <TeamCard icon={<CheckCircle2 />} title="Verification ready" copy="Public privacy and terms pages explain Google and YouTube data usage for review." />
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl px-4 py-14 sm:px-5 md:px-10 md:py-16">
        <SectionHeading eyebrow="Questions" title="What people ask before connecting." copy="Short answers for Google review, creators, and collaborators checking how the app works." centered />
        <div className="mt-9 space-y-3">
          <Faq question="What does AutoYT do?" answer="AutoYT helps creators research YouTube ideas, optimize videos, connect YouTube accounts, track growth signals, and prepare better uploads from one dashboard." />
          <Faq question="Why does AutoYT ask for YouTube access?" answer="The app uses YouTube permissions to read channel profile details, channel statistics, and recent uploads for accounts you connect. AutoYT does not request upload permission unless a real API publishing feature is added." />
          <Faq question="Can I connect multiple YouTube accounts?" answer="Yes. After signing in with Google, you can add another account and switch between connected channels inside the workspace." />
          <Faq question="Can I remove my account data?" answer="Yes. You can sign out, disconnect accounts, and request deletion through the contact email listed in the privacy policy." />
        </div>
      </section>

      <section id="signin" className="mx-auto max-w-7xl px-4 pb-14 sm:px-5 md:px-10 md:pb-16 lg:px-14">
        <div className="overflow-hidden rounded-2xl border border-[#1A1A1A]/8 bg-[#1A1A1A] p-5 text-[#F9F8F6] shadow-2xl shadow-[#1A1A1A]/10 sm:rounded-3xl sm:p-6 md:p-10">
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">Start private beta</p>
              <h2 className="mt-3 max-w-2xl text-balance font-serif text-[clamp(2.1rem,10vw,3.25rem)] font-bold leading-tight">Build your creator research workspace.</h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-[#F9F8F6]/64">Sign in with Google to connect YouTube accounts, unlock channel analytics, and start building a smarter growth workflow.</p>
            </div>
            <a href={signInHref} className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl bg-[#f9dc0b] px-5 py-3 text-center text-sm font-bold leading-5 text-[#1A1A1A] shadow-lg shadow-[#f9dc0b]/20 transition hover:bg-[#1A1A1A] hover:text-white sm:px-6">
              <Youtube className="h-5 w-5 shrink-0" />
              Continue with Google
            </a>
          </div>
          {!oauthReady && (
            <p className="mt-5 rounded-xl border border-[#f9dc0b]/30 bg-[#f9dc0b]/12 px-4 py-3 text-xs font-semibold leading-5 text-[#f9dc0b]">
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
    <header className="sticky top-0 z-50 px-2 pt-2 sm:px-3 sm:pt-3 md:px-5">
      <nav className="mx-auto flex min-h-[64px] max-w-7xl items-center justify-between gap-2 rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6]/90 px-2 py-2 shadow-[0_18px_45px_rgba(26,26,26,0.08)] backdrop-blur-xl sm:min-h-[68px] sm:px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <a href="/" className="flex items-center" aria-label="AutoYT home">
            <BrandLogo className="h-14 w-16 sm:h-[4.2rem] sm:w-[4.8rem] md:h-[2.1rem] md:w-[7.7rem]" imageClassName="max-h-full max-w-full" />
          </a>
          <span className="hidden rounded-full border border-[#f9dc0b]/16 bg-[#f9dc0b]/7 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-[#6a5b00] lg:inline-flex">
            Private beta
          </span>
        </div>

        <div className="hidden items-center rounded-full border border-[#1A1A1A]/8 bg-white/82 p-1 text-xs font-bold text-[#1A1A1A]/58 shadow-sm md:flex">
          <a href="/#product" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#1A1A1A]">Product</a>
          <a href="/#workflow" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#1A1A1A]">Workflow</a>
          <a href="/#ai" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#1A1A1A]">AI analysis</a>
          <a href="/#faq" className="rounded-full px-3.5 py-2 transition hover:bg-[#F9F8F6] hover:text-[#1A1A1A]">FAQ</a>
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <a href="/privacy" className="hidden rounded-xl px-3 py-2 text-xs font-bold text-[#1A1A1A]/45 transition hover:text-[#1A1A1A] sm:inline-flex">
            Privacy
          </a>
          <a href={signInHref} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-3 py-2 text-center text-xs font-bold leading-4 text-[#1A1A1A] shadow-sm shadow-[#f9dc0b]/25 transition hover:bg-[#1A1A1A] hover:text-white sm:h-10 sm:min-h-10 sm:px-4">
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
    <div className="flex min-w-0 items-center">
      <div className="w-full min-w-0 rounded-[1.5rem] border border-[#1A1A1A]/8 bg-white p-2 shadow-2xl shadow-[#1A1A1A]/10 sm:rounded-[2rem] sm:p-3">
        <div className="rounded-[1.1rem] bg-[#F9F8F6] p-3 sm:rounded-[1.35rem] sm:p-4">
          <div className="flex items-center justify-between border-b border-[#1A1A1A]/8 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#f9dc0b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#f9dc0b]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#1A1A1A]/18" />
            </div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#1A1A1A]/35">Live workspace</p>
          </div>

          <div className="grid gap-3 py-4 sm:grid-cols-[minmax(120px,150px)_minmax(0,1fr)]">
            <div className="space-y-2">
            {["Keyword Ideas", "Video Optimizer", "Channel Analytics"].map((item, index) => (
                <div key={item} className={`rounded-xl px-3 py-2 text-xs font-bold ${index === 0 ? "bg-[#1A1A1A] text-white" : "bg-white text-[#1A1A1A]/55"}`}>{item}</div>
              ))}
            </div>
            <div className="min-w-0 rounded-2xl bg-white p-3 shadow-sm sm:p-4">
              <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#f9dc0b]">Growth scan</p>
                  <h3 className="mt-2 text-balance font-serif text-[clamp(1.4rem,7vw,1.7rem)] font-bold leading-tight">High-retention YouTube ideas</h3>
                </div>
                <div className="w-fit rounded-full bg-[#f9dc0b] px-3 py-1.5 text-xs font-bold">86 score</div>
              </div>
              <div className="mt-5 grid gap-2 min-[430px]:grid-cols-3 sm:grid-cols-1 lg:grid-cols-3">
                <MiniMetric label="Views/hr" value="12.4K" />
                <MiniMetric label="Recent views" value="2.8M" />
                <MiniMetric label="Channels" value="214" />
              </div>
              <div className="mt-5 space-y-2">
                {["Small channels overperforming", "High search demand", "Repeatable video formats"].map((item) => (
                  <div key={item} className="flex items-center gap-2 rounded-lg bg-[#F9F8F6] px-3 py-2 text-xs font-semibold leading-5 text-[#1A1A1A]/62">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#f9dc0b]" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <a href={signInHref} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 py-2 text-center text-sm font-bold leading-5 text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">
            Start growing
            <ArrowRight className="h-4 w-4 shrink-0" />
          </a>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({ eyebrow, title, copy, centered = false }: { eyebrow: string; title: string; copy: string; centered?: boolean }) {
  return (
    <div className={centered ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">{eyebrow}</p>
      <h2 className="mt-3 text-balance font-serif text-[clamp(2.15rem,9vw,3.25rem)] font-bold leading-tight tracking-tight">{title}</h2>
      <p className="mt-4 text-sm leading-7 text-[#1A1A1A]/58 md:text-base">{copy}</p>
    </div>
  );
}

function ProofPoint({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[#1A1A1A]/8 bg-white px-4 py-3 shadow-sm">
      <p className="text-lg font-bold text-[#1A1A1A]">{value}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-[#1A1A1A]/45 min-[430px]:text-[11px] min-[430px]:leading-4">{label}</p>
    </div>
  );
}

function Feature({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-white p-5 shadow-sm transition hover:border-[#1A1A1A]/25 hover:shadow-md">
      <div className="mb-5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#f9dc0b]/8 text-[#f9dc0b]">{icon}</div>
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
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[#f9dc0b] shadow-sm">{icon}</span>
      </div>
      <h3 className="mt-8 text-base font-bold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">{copy}</p>
    </div>
  );
}

function Signal({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex min-h-12 items-center gap-3 rounded-xl border border-[#1A1A1A]/8 bg-white px-4 py-3 text-sm font-bold leading-5 shadow-sm">
      <span className="shrink-0 text-[#f9dc0b]">{icon}</span>
      {label}
    </div>
  );
}

function AnalysisMockup() {
  return (
    <div className="min-w-0 rounded-[1.5rem] border border-[#1A1A1A]/8 bg-white p-3 shadow-2xl shadow-[#1A1A1A]/8 sm:rounded-[2rem] sm:p-4">
      <div className="flex gap-2 overflow-x-auto overscroll-x-contain border-b border-[#1A1A1A]/8 pb-3 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {["Ideas", "Keywords", "Script", "Title", "Thumbnail", "Analytics"].map((tab, index) => (
          <span key={tab} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold ${index === 1 ? "bg-[#1A1A1A] text-white" : "bg-[#F9F8F6] text-[#1A1A1A]/45"}`}>{tab}</span>
        ))}
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(120px,160px)_minmax(0,1fr)]">
        <div className="aspect-[9/16] max-h-[360px] rounded-2xl bg-[linear-gradient(160deg,#1A1A1A,#3A3430)] p-3 max-md:mx-auto max-md:w-full max-md:max-w-[180px]">
          <div className="flex h-full flex-col justify-end rounded-xl border border-white/10 p-3 text-white">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#f9dc0b]">Next upload</p>
            <p className="mt-1 text-xs text-white/70">Ready to optimize</p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="rounded-xl bg-[#F9F8F6] p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">AI recommendation</p>
            <h3 className="mt-2 text-balance font-serif text-[clamp(1.8rem,8vw,2rem)] font-bold leading-tight">Publish with a stronger hook</h3>
            <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/55">Keywords, title direction, script structure, and channel context stay organized in one workspace.</p>
          </div>
          <div className="grid gap-2 min-[430px]:grid-cols-3">
            <MiniMetric label="Growth score" value="95%" />
            <MiniMetric label="Ideas" value="18" />
            <MiniMetric label="Keywords" value="34" />
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamCard({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-5">
      <div className="mb-6 grid h-11 w-11 place-items-center rounded-xl bg-white text-[#f9dc0b] shadow-sm">{icon}</div>
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
        <span className="text-[#f9dc0b] transition group-open:rotate-45">+</span>
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
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-5 md:px-10 md:py-12 lg:px-14">
        <div className="overflow-hidden rounded-2xl border border-[#1A1A1A]/8 bg-white shadow-[0_24px_80px_rgba(26,26,26,0.08)] sm:rounded-[2rem]">
          <div className="grid gap-6 border-b border-[#1A1A1A]/6 p-5 sm:p-6 md:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] md:gap-8 md:p-8">
            <div>
              <BrandLogo variant="horizontal" className="h-[2.1rem] w-[7.7rem]" imageClassName="max-h-full max-w-full" />
              <p className="mt-5 max-w-xl text-sm leading-7 text-[#1A1A1A]/58">
                Our mission is to help every YouTube creator find better ideas, optimize faster, and grow with practical AI tools built for more views, subscribers, and revenue.
              </p>
            </div>
            <div className="rounded-2xl border border-[#1A1A1A]/8 bg-[#F9F8F6] p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-[#f9dc0b]">Google review ready</p>
              <p className="mt-2 text-sm leading-6 text-[#1A1A1A]/58">Public privacy and terms pages are available, with YouTube API data use and deletion instructions documented.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href="/privacy" className="rounded-xl bg-[#f9dc0b] px-3 py-2 text-xs font-bold text-[#1A1A1A] transition hover:bg-[#1A1A1A] hover:text-white">Privacy Policy</a>
                <a href="/terms" className="rounded-xl border border-[#1A1A1A]/10 bg-white px-3 py-2 text-xs font-bold text-[#1A1A1A]/60 transition hover:border-[#1A1A1A]/30 hover:text-[#1A1A1A]">Terms</a>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-7 p-5 sm:p-6 md:gap-8 md:p-8">
            <FooterColumn
              title="Product"
              links={[
                ["Features", "/#product"],
                ["Keyword Ideas", "/#product"],
                ["Video Optimizer", "/#product"],
                ["AI Writer", "/#workflow"],
              ]}
            />
            <FooterColumn
              title="Workflow"
              links={[
                ["Idea discovery", "/#workflow"],
                ["Video optimization", "/#ai"],
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
              <a href={googleSignInPath} className="mt-4 inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#f9dc0b] px-4 py-2 text-center text-sm font-bold leading-5 text-[#1A1A1A] shadow-sm shadow-[#f9dc0b]/25 transition hover:bg-[#1A1A1A] hover:text-white">
                Connect Google
                <Youtube className="h-4 w-4" />
              </a>
              <div className="mt-4 flex items-center gap-2 text-xs font-semibold text-[#1A1A1A]/45">
                <span className="h-2 w-2 rounded-full bg-[#f9dc0b]" />
                OAuth enabled for YouTube workflows
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 px-1 py-5 text-xs font-medium text-[#1A1A1A]/38 md:flex-row md:items-center md:justify-between">
          <p>Copyright 2026 AutoYT. All rights reserved.</p>
          <p>AutoYT is not affiliated with Google or YouTube.</p>
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
          <a key={label} href={href} className="transition hover:text-[#1A1A1A]">
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
