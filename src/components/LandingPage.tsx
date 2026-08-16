import {
  ArrowRight,
  AudioLines,
  CalendarClock,
  Check,
  CheckCircle2,
  Clapperboard,
  Film,
  Layers3,
  Mic2,
  Radar,
  Scissors,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  Youtube,
} from "lucide-react";
import { ReactNode } from "react";
import { AuthSessionPayload } from "../types";
import { BrandLogo } from "./BrandLogo";

const googleSignInPath = "/api/auth/google?mode=signin&next=/channels";

const capabilities = ["Source radar", "Candidate scoring", "Video production", "Release planning"];

export function LandingPage({ auth }: { auth: AuthSessionPayload | null }) {
  const oauthReady = !!auth?.googleConfigured && auth?.dbConfigured !== false;
  const errorParams = new URLSearchParams(window.location.search);
  const authError = window.location.pathname === "/auth/error" ? errorParams.get("message") || "Google sign-in failed" : "";
  const signInHref = oauthReady ? googleSignInPath : "#access";

  return (
    <main className="min-h-dvh overflow-x-clip bg-[#F9F8F6] text-[#171717]">
      <PublicNav signInHref={signInHref} />

      <section className="relative isolate overflow-hidden bg-[#0B0D0C] text-white">
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[43%] border-l border-white/10 lg:block" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-24 w-full border-t border-white/10" aria-hidden="true" />

        <div className="relative mx-auto grid min-h-[760px] max-w-7xl gap-12 px-5 pb-20 pt-32 sm:px-8 md:min-h-[820px] md:grid-cols-[minmax(0,0.9fr)_minmax(480px,1.1fr)] md:items-center md:gap-10 md:px-10 md:pb-28 md:pt-36 lg:px-14">
          <div className="relative z-10 max-w-2xl">
            <p className="inline-flex items-center gap-2 border border-[#f9dc0b] bg-[#f9dc0b] px-3 py-1.5 text-xs font-bold text-[#171717]">
              <Sparkles className="h-3.5 w-3.5" />
              Creator operations, in one place
            </p>
            <h1 className="mt-7 max-w-xl text-balance font-sans text-[clamp(3.25rem,7.2vw,6.8rem)] font-black leading-[0.91]">
              Turn source signals into your next release.
            </h1>
            <p className="mt-7 max-w-lg text-base leading-7 text-white/68 sm:text-lg sm:leading-8">
              AutoYT is the operating system for teams that discover channels, qualify videos, produce variations, and keep releases moving.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={signInHref} className="inline-flex min-h-12 items-center justify-center gap-3 bg-[#f9dc0b] px-5 py-3 text-sm font-black text-[#171717] transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f9dc0b]">
                <Youtube className="h-5 w-5" />
                Open AutoYT
                <ArrowRight className="h-4 w-4" />
              </a>
              <a href="#workflow" className="inline-flex min-h-12 items-center justify-center gap-2 border border-white/30 px-5 py-3 text-sm font-bold text-white transition hover:border-white hover:bg-white hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white">
                See the workflow
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>

            {authError && <p className="mt-5 border border-[#f9dc0b] bg-[#f9dc0b] px-4 py-3 text-sm font-bold text-[#171717]">{authError}</p>}

            <div className="mt-12 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-white/15 pt-5 sm:grid-cols-4">
              {capabilities.map((capability) => (
                <div key={capability} className="flex items-center gap-2 text-xs font-bold text-white/72">
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#f9dc0b]" />
                  {capability}
                </div>
              ))}
            </div>
          </div>

          <HeroControlRoom />
        </div>
      </section>

      <section id="workflow" className="scroll-mt-16 bg-[#F9F8F6] py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-10 lg:px-14">
          <SectionIntro
            eyebrow="The AutoYT loop"
            title="Make better decisions before the upload exists."
            copy="Every agent run carries the channel context forward, so the next release can be more deliberate than the last."
          />

          <div className="mt-12 grid gap-px overflow-hidden border border-[#171717]/15 bg-[#171717]/15 md:grid-cols-3">
            <WorkflowTile number="01" icon={<Radar className="h-5 w-5" />} title="Discover" copy="Map competitors, watch source channels, and collect promising videos around the niche." />
            <WorkflowTile number="02" icon={<WandSparkles className="h-5 w-5" />} title="Decide" copy="Compare candidates against channel history, recency, format, and the rules you set." />
            <WorkflowTile number="03" icon={<Upload className="h-5 w-5" />} title="Release" copy="Prepare edits, voice and soundtrack changes, then send approved work into the publishing plan." />
          </div>
        </div>
      </section>

      <section id="radar" className="scroll-mt-16 bg-[#f9dc0b] py-20 text-[#171717] sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 md:grid-cols-[minmax(0,0.95fr)_minmax(400px,1.05fr)] md:items-center md:px-10 lg:px-14">
          <div>
            <p className="text-xs font-black uppercase">01 / Source radar</p>
            <h2 className="mt-4 max-w-xl text-balance font-sans text-[clamp(2.7rem,5vw,5rem)] font-black leading-[0.93]">Find the channels worth watching.</h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-[#171717]/72 sm:text-lg sm:leading-8">
              Build source pools by niche. AutoYT keeps channel context close to the candidate, so you can inspect the signal rather than chase a feed.
            </p>
            <ul className="mt-8 grid gap-3 text-sm font-bold">
              <li className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5" /> Channel cards link back to the source.</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5" /> Playlist sources can rotate across related channels.</li>
              <li className="flex items-center gap-3"><CheckCircle2 className="h-5 w-5" /> Recent uploads are refreshed before selection.</li>
            </ul>
          </div>
          <RadarBoard />
        </div>
      </section>

      <section id="agents" className="scroll-mt-16 bg-[#151817] py-20 text-white sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 md:grid-cols-[minmax(400px,1.05fr)_minmax(0,0.95fr)] md:items-center md:px-10 lg:px-14">
          <DecisionBoard />
          <div className="md:pl-8">
            <p className="text-xs font-black uppercase text-[#f9dc0b]">02 / Agent decisions</p>
            <h2 className="mt-4 max-w-xl text-balance font-sans text-[clamp(2.7rem,5vw,5rem)] font-black leading-[0.93]">Let the agent test, learn, and rotate.</h2>
            <p className="mt-6 max-w-lg text-base leading-7 text-white/68 sm:text-lg sm:leading-8">
              A channel that slows down should get smarter experiments, not the same source over and over. Agent runs weigh source freshness, recent outcomes, fit, and the safeguards you set.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <Signal icon={<Layers3 className="h-5 w-5" />} title="Source rotation" copy="Keep playlist and channel pools in play." />
              <Signal icon={<CalendarClock className="h-5 w-5" />} title="Run cadence" copy="Set the pace around your release schedule." />
              <Signal icon={<Scissors className="h-5 w-5" />} title="Transcript-aware trims" copy="Aim for a usable story, not a hard cut." />
              <Signal icon={<ShieldCheck className="h-5 w-5" />} title="Clear controls" copy="Review candidates and stop runs cleanly." />
            </div>
          </div>
        </div>
      </section>

      <section id="studio" className="scroll-mt-16 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-10 lg:px-14">
          <div className="grid gap-12 md:grid-cols-[minmax(0,0.88fr)_minmax(440px,1.12fr)] md:items-center">
            <div>
              <p className="text-xs font-black uppercase text-[#171717]/52">03 / Production studio</p>
              <h2 className="mt-4 max-w-xl text-balance font-sans text-[clamp(2.7rem,5vw,5rem)] font-black leading-[0.93]">Finish a release without losing the thread.</h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-[#171717]/64 sm:text-lg sm:leading-8">
                Move from a qualified candidate into a version your channel can use. Keep the original, the edit choices, and the release plan together.
              </p>
              <p className="mt-7 border-t border-[#171717]/18 pt-4 text-sm font-bold leading-6 text-[#171717]/70">
                Use voice and soundtrack tools only with material you own or have permission to use.
              </p>
            </div>
            <StudioBoard />
          </div>
        </div>
      </section>

      <section id="access" className="scroll-mt-16 bg-[#f9dc0b] px-5 py-20 text-[#171717] sm:px-8 sm:py-24 md:px-10 lg:px-14">
        <div className="mx-auto max-w-7xl border-y border-[#171717]/25 py-10 sm:py-14">
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-xs font-black uppercase">AutoYT workspace</p>
              <h2 className="mt-4 max-w-3xl text-balance font-sans text-[clamp(2.8rem,5.8vw,5.7rem)] font-black leading-[0.9]">The next release starts with a better system.</h2>
            </div>
            <a href={signInHref} className="inline-flex min-h-12 items-center justify-center gap-3 bg-[#171717] px-5 py-3 text-sm font-black text-white transition hover:bg-white hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#171717] sm:px-6">
              <Youtube className="h-5 w-5" />
              Continue with Google
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
          {!oauthReady && (
            <p className="mt-8 max-w-3xl border border-[#171717]/30 bg-white/45 px-4 py-3 text-sm font-bold leading-6">
              Google OAuth is not configured yet. Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, and `APP_URL` to enable workspace access.
            </p>
          )}
        </div>
      </section>

      <PublicFooter signInHref={signInHref} />
    </main>
  );
}

function PublicNav({ signInHref }: { signInHref: string }) {
  return (
    <header className="absolute inset-x-0 top-0 z-50">
      <nav className="mx-auto flex min-h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8 md:px-10 lg:px-14">
        <a href="/" className="flex h-10 items-center" aria-label="AutoYT home">
          <BrandLogo variant="horizontal" theme="dark" className="h-8 w-[7.5rem]" imageClassName="max-h-full max-w-full" />
        </a>
        <div className="hidden items-center gap-6 text-xs font-bold text-white/68 lg:flex">
          <a href="#radar" className="transition hover:text-[#f9dc0b]">Radar</a>
          <a href="#agents" className="transition hover:text-[#f9dc0b]">Agents</a>
          <a href="#studio" className="transition hover:text-[#f9dc0b]">Studio</a>
          <a href="/privacy" className="transition hover:text-[#f9dc0b]">Privacy</a>
        </div>
        <a href={signInHref} className="inline-flex min-h-10 items-center justify-center gap-2 border border-[#f9dc0b] bg-[#f9dc0b] px-3 py-2 text-xs font-black text-[#171717] transition hover:bg-white hover:border-white sm:px-4">
          Sign in
          <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </nav>
    </header>
  );
}

function SectionIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)] md:items-end">
      <div>
        <p className="text-xs font-black uppercase text-[#171717]/52">{eyebrow}</p>
        <h2 className="mt-4 max-w-3xl text-balance font-sans text-[clamp(2.5rem,5vw,5.4rem)] font-black leading-[0.92]">{title}</h2>
      </div>
      <p className="max-w-md text-base leading-7 text-[#171717]/62">{copy}</p>
    </div>
  );
}

function WorkflowTile({ number, icon, title, copy }: { number: string; icon: ReactNode; title: string; copy: string }) {
  return (
    <article className="min-h-64 bg-white p-6 sm:p-8">
      <div className="flex items-start justify-between">
        <p className="text-sm font-black text-[#171717]/42">{number}</p>
        <span className="grid h-10 w-10 place-items-center bg-[#f9dc0b] text-[#171717]">{icon}</span>
      </div>
      <h3 className="mt-16 text-2xl font-black leading-none">{title}</h3>
      <p className="mt-4 max-w-sm text-sm leading-6 text-[#171717]/60">{copy}</p>
    </article>
  );
}

function HeroControlRoom() {
  return (
    <div className="relative min-w-0 self-center border border-white/15 bg-[#151817] p-3 shadow-2xl shadow-black/30 sm:p-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 text-[10px] font-bold text-white/48">
        <span className="flex items-center gap-2"><span className="h-2 w-2 bg-[#f9dc0b]" /> AUTOYT / CONTROL ROOM</span>
        <span>ILLUSTRATIVE</span>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[138px_minmax(0,1fr)]">
        <aside className="hidden border border-white/10 bg-[#0B0D0C] p-3 lg:block">
          <p className="text-[10px] font-black uppercase text-white/38">Workspaces</p>
          {[
            ["Source Radar", true],
            ["Candidate Queue", false],
            ["Production", false],
            ["Release Plan", false],
          ].map(([label, active]) => (
            <div key={String(label)} className={`mt-2 flex items-center gap-2 px-2 py-2 text-[11px] font-bold ${active ? "bg-[#f9dc0b] text-[#171717]" : "text-white/55"}`}>
              <span className={`h-1.5 w-1.5 ${active ? "bg-[#171717]" : "bg-white/35"}`} />
              {String(label)}
            </div>
          ))}
        </aside>
        <div className="min-w-0">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px]">
            <div className="border border-white/10 bg-[#0B0D0C] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase text-[#f9dc0b]">Radar signal</p>
                  <h3 className="mt-2 text-lg font-black leading-tight">Animated storytelling formats</h3>
                </div>
                <span className="shrink-0 border border-[#f9dc0b]/45 px-2 py-1 text-[10px] font-black text-[#f9dc0b]">ACTIVE</span>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2">
                <Metric label="Channels" value="24" />
                <Metric label="Candidates" value="17" />
                <Metric label="Fresh" value="8" />
              </div>
            </div>
            <div className="flex min-h-36 flex-col justify-between border border-white/10 bg-[#f9dc0b] p-4 text-[#171717]">
              <p className="text-[10px] font-black uppercase">Next action</p>
              <p className="text-base font-black leading-tight">Review fresh candidates before tonight’s run.</p>
              <span className="inline-flex items-center gap-2 text-xs font-black">Open queue <ArrowRight className="h-3.5 w-3.5" /></span>
            </div>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="border border-white/10 bg-[#0B0D0C] p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] font-black uppercase text-white/38">Qualified candidates</p>
                <span className="text-[10px] font-bold text-white/42">SORTED BY FIT</span>
              </div>
              <div className="mt-3 space-y-2">
                <CandidateRow title="One-minute story arc" source="Frame Lab" state="Ready" />
                <CandidateRow title="Character reveal hook" source="Orbit Archive" state="Review" />
                <CandidateRow title="Loopable ending format" source="Motion Diary" state="Queued" />
              </div>
            </div>
            <div className="border border-white/10 bg-[#0B0D0C] p-4">
              <p className="text-[10px] font-black uppercase text-white/38">Run health</p>
              <div className="mt-4 flex h-20 items-end gap-2" aria-label="Illustrative run health chart">
                {[32, 58, 46, 74, 52, 88, 66].map((height, index) => <span key={index} style={{ height: `${height}%` }} className="min-w-0 flex-1 bg-[#f9dc0b]" />)}
              </div>
              <p className="mt-3 text-xs font-bold text-white/65">Learning from outcomes.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-white/10 p-2.5">
      <p className="text-[9px] font-black uppercase text-white/38">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>
  );
}

function CandidateRow({ title, source, state }: { title: string; source: string; state: string }) {
  return (
    <div className="flex items-center gap-3 border border-white/10 p-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center bg-white/10 text-[#f9dc0b]"><Film className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-bold text-white">{title}</p>
        <p className="mt-0.5 text-[10px] font-medium text-white/45">{source}</p>
      </div>
      <span className="text-[10px] font-black text-[#f9dc0b]">{state}</span>
    </div>
  );
}

function RadarBoard() {
  return (
    <div className="border border-[#171717]/25 bg-[#171717] p-3 text-white shadow-2xl shadow-[#171717]/20 sm:p-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-white/58"><Radar className="h-4 w-4 text-[#f9dc0b]" /> Channel discovery</span>
        <span className="bg-[#f9dc0b] px-2 py-1 text-[10px] font-black text-[#171717]">NICHE MATCH</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <ChannelCard initials="FL" name="Frame Lab" tag="Story animation" />
        <ChannelCard initials="OA" name="Orbit Archive" tag="Animated explainers" />
        <ChannelCard initials="MD" name="Motion Diary" tag="Visual shorts" />
        <ChannelCard initials="SP" name="Scene Pieces" tag="Character edits" />
      </div>
      <div className="mt-3 border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase text-white/40">Source pool</p>
            <p className="mt-1 text-sm font-black">Animation collection</p>
          </div>
          <span className="text-xs font-black text-[#f9dc0b]">4 channels</span>
        </div>
        <div className="mt-4 flex gap-1.5" aria-label="Illustrative source health meter">
          {[true, true, true, true, false, false, false, false].map((active, index) => <span key={index} className={`h-2 flex-1 ${active ? "bg-[#f9dc0b]" : "bg-white/15"}`} />)}
        </div>
      </div>
    </div>
  );
}

function ChannelCard({ initials, name, tag }: { initials: string; name: string; tag: string }) {
  return (
    <div className="flex items-center gap-3 border border-white/10 bg-[#0B0D0C] p-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center bg-[#f9dc0b] text-xs font-black text-[#171717]">{initials}</span>
      <div className="min-w-0">
        <p className="truncate text-sm font-black">{name}</p>
        <p className="mt-0.5 truncate text-[10px] font-medium text-white/50">{tag}</p>
      </div>
    </div>
  );
}

function DecisionBoard() {
  const experiments = [
    ["Fresh source", "Orbit Archive", "Ready"],
    ["New format", "Character reveal", "Testing"],
    ["Hold source", "Recent duplicate", "Paused"],
  ];

  return (
    <div className="border border-white/15 bg-[#0B0D0C] p-3 shadow-2xl shadow-black/30 sm:p-4">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-white/58"><WandSparkles className="h-4 w-4 text-[#f9dc0b]" /> Agent strategy</span>
        <span className="text-[10px] font-bold text-white/42">LAURA / ACTIVE</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_156px]">
        <div className="border border-white/10 p-4">
          <p className="text-[10px] font-black uppercase text-[#f9dc0b]">Run candidate</p>
          <h3 className="mt-2 text-xl font-black leading-tight">Try a related channel, not the same source.</h3>
          <p className="mt-3 text-sm leading-6 text-white/56">A weak source gets placed on hold unless a strong recent result earns another attempt.</p>
          <div className="mt-5 flex items-center gap-3 border-t border-white/10 pt-4">
            <span className="grid h-9 w-9 place-items-center bg-[#f9dc0b] text-[#171717]"><Clapperboard className="h-4 w-4" /></span>
            <div>
              <p className="text-xs font-black">Candidate queue</p>
              <p className="text-[10px] text-white/45">3 experiments ready</p>
            </div>
          </div>
        </div>
        <div className="border border-white/10 bg-[#f9dc0b] p-4 text-[#171717]">
          <p className="text-[10px] font-black uppercase">Decision</p>
          <p className="mt-6 text-2xl font-black leading-none">Rotate source</p>
          <p className="mt-5 text-xs font-bold leading-5 text-[#171717]/70">Playlist context unlocks a different channel with a close niche fit.</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {experiments.map(([label, detail, state]) => (
          <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border border-white/10 px-3 py-3 text-xs">
            <div className="min-w-0"><p className="font-black text-white">{label}</p><p className="mt-1 truncate text-white/45">{detail}</p></div>
            <span className="self-center text-[10px] font-black text-[#f9dc0b]">{state}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Signal({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return (
    <div className="border border-white/12 p-4">
      <span className="text-[#f9dc0b]">{icon}</span>
      <p className="mt-5 text-sm font-black">{title}</p>
      <p className="mt-2 text-xs leading-5 text-white/53">{copy}</p>
    </div>
  );
}

function StudioBoard() {
  return (
    <div className="border border-[#171717]/15 bg-[#F9F8F6] p-3 shadow-2xl shadow-[#171717]/10 sm:p-4">
      <div className="flex items-center justify-between border-b border-[#171717]/10 pb-3">
        <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-[#171717]/48"><Clapperboard className="h-4 w-4 text-[#171717]" /> Compile & publish</span>
        <span className="text-[10px] font-bold text-[#171717]/42">DRAFT</span>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
        <div className="flex aspect-[9/14] min-h-64 flex-col justify-end bg-[#171717] p-3 text-white sm:min-h-0">
          <span className="mb-auto inline-flex w-fit items-center gap-1 bg-[#f9dc0b] px-2 py-1 text-[9px] font-black text-[#171717]"><Film className="h-3 w-3" /> 00:58</span>
          <p className="text-xs font-black">The final turn changes everything</p>
          <p className="mt-1 text-[10px] text-white/52">9:16 / prepared cut</p>
        </div>
        <div className="min-w-0 space-y-3">
          <StudioRow icon={<Scissors className="h-4 w-4" />} title="Smart trim" detail="Target: 60 sec" state="Ready" />
          <StudioRow icon={<Mic2 className="h-4 w-4" />} title="Voice treatment" detail="Authorized voice only" state="Review" />
          <StudioRow icon={<AudioLines className="h-4 w-4" />} title="Soundtrack" detail="Replacement queued" state="Ready" />
          <StudioRow icon={<CalendarClock className="h-4 w-4" />} title="Release plan" detail="Next available slot" state="Planned" />
        </div>
      </div>
    </div>
  );
}

function StudioRow({ icon, title, detail, state }: { icon: ReactNode; title: string; detail: string; state: string }) {
  return (
    <div className="flex items-center gap-3 border border-[#171717]/12 bg-white p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center bg-[#f9dc0b] text-[#171717]">{icon}</span>
      <div className="min-w-0 flex-1"><p className="text-xs font-black">{title}</p><p className="mt-0.5 truncate text-[10px] text-[#171717]/48">{detail}</p></div>
      <span className="text-[10px] font-black text-[#171717]/58">{state}</span>
    </div>
  );
}

function PublicFooter({ signInHref }: { signInHref: string }) {
  return (
    <footer className="bg-[#0B0D0C] text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-5 py-12 sm:px-8 md:grid-cols-[minmax(0,1fr)_auto_auto] md:px-10 lg:px-14">
        <div className="max-w-sm">
          <BrandLogo variant="horizontal" theme="dark" className="h-8 w-[7.5rem]" imageClassName="max-h-full max-w-full" />
          <p className="mt-5 text-sm leading-6 text-white/52">A creator operations workspace for deliberate video research, preparation, and release planning.</p>
        </div>
        <FooterColumn title="Explore" links={[["Source Radar", "#radar"], ["Automation agents", "#agents"], ["Production studio", "#studio"], ["Open workspace", signInHref]]} />
        <FooterColumn title="Trust" links={[["Privacy policy", "/privacy"], ["Terms", "/terms"], ["Contact", "mailto:evanslockwood69@gmail.com"]]} />
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-5 text-xs font-medium text-white/35 sm:px-8 md:flex-row md:justify-between md:px-10 lg:px-14">
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
      <p className="text-xs font-black uppercase text-white/42">{title}</p>
      <div className="mt-4 grid gap-3 text-sm font-bold text-white/62">
        {links.map(([label, href]) => <a key={label} href={href} className="transition hover:text-[#f9dc0b]">{label}</a>)}
      </div>
    </div>
  );
}
