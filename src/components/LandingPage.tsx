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
import { Canvas, useFrame } from "@react-three/fiber";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as THREE from "three";
import { AuthSessionPayload } from "../types";
import { BrandLogo } from "./BrandLogo";

const googleSignInPath = "/api/auth/google?mode=signin&next=/channels";

const capabilities = ["Source radar", "Candidate scoring", "Video production", "Release planning"];

if (typeof window !== "undefined") {
  gsap.registerPlugin(ScrollTrigger);
}

export function LandingPage({ auth }: { auth: AuthSessionPayload | null }) {
  const landingRef = useRef<HTMLElement>(null);
  const sceneProgressRef = useRef(0);
  const oauthReady = !!auth?.googleConfigured && auth?.dbConfigured !== false;
  const errorParams = new URLSearchParams(window.location.search);
  const authError = window.location.pathname === "/auth/error" ? errorParams.get("message") || "Google sign-in failed" : "";
  const signInHref = oauthReady ? googleSignInPath : "#access";

  useLandingMotion(landingRef, sceneProgressRef);

  return (
    <main ref={landingRef} className="landing-page min-h-dvh overflow-x-clip bg-[#F9F8F6] text-[#171717]">
      <PublicNav signInHref={signInHref} />

      <section data-hero-shell className="relative isolate overflow-hidden bg-[#090b0a] text-white">
        <div className="pointer-events-none absolute inset-y-0 left-[51%] hidden w-px bg-white/10 md:block" aria-hidden="true" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-px w-full bg-white/10" aria-hidden="true" />

        <div className="relative mx-auto grid min-h-[760px] max-w-7xl gap-10 px-5 pb-20 pt-28 sm:px-8 md:min-h-[800px] md:grid-cols-[minmax(0,0.87fr)_minmax(420px,1.13fr)] md:items-center md:gap-6 md:px-10 md:pb-24 md:pt-28 lg:px-14">
          <div className="relative z-10 max-w-2xl">
            <h1 aria-label="Run every release with intent." className="landing-display max-w-lg text-5xl font-bold leading-[0.91] sm:text-6xl md:text-[4.7rem] lg:text-[4.9rem]">
              <span data-hero-word aria-hidden="true" className="block">Run every</span>
              <span data-hero-word aria-hidden="true" className="block text-[#f9dc0b]">release</span>
              <span data-hero-word aria-hidden="true" className="block">with intent.</span>
            </h1>
            <p data-hero-copy className="mt-7 max-w-md text-base leading-7 text-white/64 sm:text-lg sm:leading-8">
              AutoYT turns source discovery, candidate decisions, production, and scheduling into one repeatable release system.
            </p>

            <div data-hero-actions className="mt-8 flex flex-col gap-3 sm:flex-row">
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

            <div data-hero-capabilities className="mt-10 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-white/15 pt-5 sm:grid-cols-4">
              {capabilities.map((capability) => (
                <div key={capability} className="flex items-center gap-2 text-xs font-bold text-white/72">
                  <Check className="h-3.5 w-3.5 shrink-0 text-[#f9dc0b]" />
                  {capability}
                </div>
              ))}
            </div>
          </div>

          <HeroFlightDeck sceneProgressRef={sceneProgressRef} />
        </div>

        <SignalMarquee />
      </section>

      <section id="workflow" data-workflow-section className="scroll-mt-16 bg-[#F9F8F6] py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-10 lg:px-14">
          <SectionIntro
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

      <section id="radar" data-radar-section className="scroll-mt-16 bg-[#f9dc0b] py-20 text-[#171717] sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 md:grid-cols-[minmax(0,0.95fr)_minmax(400px,1.05fr)] md:items-center md:px-10 lg:px-14">
          <div data-radar-copy>
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

      <section id="agents" data-agents-section className="scroll-mt-16 bg-[#151817] py-20 text-white sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 md:grid-cols-[minmax(400px,1.05fr)_minmax(0,0.95fr)] md:items-center md:px-10 lg:px-14">
          <DecisionBoard />
          <div data-agents-copy className="md:pl-8">
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

      <section id="studio" data-studio-section className="scroll-mt-16 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 md:px-10 lg:px-14">
          <div className="grid gap-12 md:grid-cols-[minmax(0,0.88fr)_minmax(440px,1.12fr)] md:items-center">
            <div data-studio-copy>
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

      <section id="access" data-access-section className="scroll-mt-16 bg-[#f9dc0b] px-5 py-20 text-[#171717] sm:px-8 sm:py-24 md:px-10 lg:px-14">
        <div data-access-frame className="mx-auto max-w-7xl border-y border-[#171717]/25 py-10 sm:py-14">
          <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div>
              <p className="text-xs font-black uppercase">AutoYT workspace</p>
              <h2 data-access-heading className="mt-4 max-w-3xl text-balance font-sans text-[clamp(2.8rem,5.8vw,5.7rem)] font-black leading-[0.9]">The next release starts with a better system.</h2>
            </div>
            <a data-access-cta href={signInHref} className="inline-flex min-h-12 items-center justify-center gap-3 bg-[#171717] px-5 py-3 text-sm font-black text-white transition hover:bg-white hover:text-[#171717] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#171717] sm:px-6">
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

function SectionIntro({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.55fr)] md:items-end">
      <div>
        <h2 className="landing-display max-w-3xl text-4xl font-bold leading-[0.92] sm:text-5xl lg:text-6xl">{title}</h2>
      </div>
      <p className="max-w-md text-base leading-7 text-[#171717]/62">{copy}</p>
    </div>
  );
}

function WorkflowTile({ number, icon, title, copy }: { number: string; icon: ReactNode; title: string; copy: string }) {
  return (
    <article data-workflow-tile className="min-h-64 bg-white p-6 sm:p-8">
      <div className="flex items-start justify-between">
        <p className="text-sm font-black text-[#171717]/42">{number}</p>
        <span className="grid h-10 w-10 place-items-center bg-[#f9dc0b] text-[#171717]">{icon}</span>
      </div>
      <h3 className="mt-16 text-2xl font-black leading-none">{title}</h3>
      <p className="mt-4 max-w-sm text-sm leading-6 text-[#171717]/60">{copy}</p>
    </article>
  );
}

function HeroFlightDeck({ sceneProgressRef }: { sceneProgressRef: { current: number } }) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const [sceneActive, setSceneActive] = useState(true);
  const [motionAllowed, setMotionAllowed] = useState(true);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setMotionAllowed(!reduceMotion.matches);
    const observer = new IntersectionObserver(([entry]) => setSceneActive(entry?.isIntersecting ?? false), { threshold: 0.08 });
    const handleVisibility = () => setSceneActive(!document.hidden);

    updateMotionPreference();
    reduceMotion.addEventListener("change", updateMotionPreference);
    document.addEventListener("visibilitychange", handleVisibility);
    if (sceneRef.current) observer.observe(sceneRef.current);

    return () => {
      reduceMotion.removeEventListener("change", updateMotionPreference);
      document.removeEventListener("visibilitychange", handleVisibility);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={sceneRef} data-hero-scene className="relative isolate min-h-[430px] self-center overflow-hidden border border-white/15 bg-[#111412] sm:min-h-[500px] md:min-h-[530px]">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <FlightDeckCanvas sceneProgressRef={sceneProgressRef} motionAllowed={motionAllowed && sceneActive} />
      </div>

      <div data-flight-card className="absolute left-4 top-4 border border-white/15 bg-[#090b0a]/88 px-3 py-2 backdrop-blur-sm sm:left-7 sm:top-7">
        <p className="text-[9px] font-black uppercase text-white/42">Signal detected</p>
        <p className="mt-1 text-xs font-bold text-white">Narrated anime edits</p>
      </div>
      <div data-flight-card className="absolute bottom-5 left-4 border border-[#f9dc0b] bg-[#f9dc0b] px-3 py-2 text-[#171717] sm:bottom-8 sm:left-8">
        <p className="text-[9px] font-black uppercase">Candidate status</p>
        <p className="mt-1 text-xs font-black">Qualified for review</p>
      </div>
      <div data-flight-card className="absolute right-4 top-1/2 border border-white/15 bg-[#090b0a]/88 px-3 py-2 backdrop-blur-sm sm:right-7">
        <p className="text-[9px] font-black uppercase text-white/42">Release window</p>
        <p className="mt-1 text-xs font-bold text-white">Tonight, 19:00</p>
      </div>

      <div data-flight-core className="absolute inset-x-8 top-1/2 -translate-y-1/2 border border-white/15 bg-[#090b0a]/72 p-4 backdrop-blur-sm sm:inset-x-12 sm:p-5">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <span className="inline-flex items-center gap-2 text-[10px] font-black uppercase text-[#f9dc0b]"><Sparkles className="h-3.5 w-3.5" /> Release flight deck</span>
          <span className="text-[10px] font-bold text-white/42">03 STEPS</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[10px] font-black">
          <div className="border border-white/10 bg-white/5 p-2.5 text-white/62"><span className="block text-white">1. Source</span><span className="mt-2 block text-[#f9dc0b]">Radar</span></div>
          <div className="border border-white/10 bg-white/5 p-2.5 text-white/62"><span className="block text-white">2. Decision</span><span className="mt-2 block text-[#f9dc0b]">Review</span></div>
          <div className="border border-white/10 bg-white/5 p-2.5 text-white/62"><span className="block text-white">3. Release</span><span className="mt-2 block text-[#f9dc0b]">Schedule</span></div>
        </div>
      </div>
    </div>
  );
}

function FlightDeckCanvas({ sceneProgressRef, motionAllowed }: { sceneProgressRef: { current: number }; motionAllowed: boolean }) {
  return (
    <Canvas dpr={1.5} camera={{ position: [0, 0, 9], fov: 38 }} gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}>
      <ambientLight intensity={1.6} />
      <pointLight position={[4, 5, 6]} intensity={20} color="#f9dc0b" distance={15} />
      <pointLight position={[-5, -1, 5]} intensity={8} color="#e9eee8" distance={12} />
      <ReleaseConstellation sceneProgressRef={sceneProgressRef} motionAllowed={motionAllowed} />
    </Canvas>
  );
}

function ReleaseConstellation({ sceneProgressRef, motionAllowed }: { sceneProgressRef: { current: number }; motionAllowed: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const satelliteRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const progress = sceneProgressRef.current;
    const drift = motionAllowed ? Math.sin(clock.elapsedTime * 0.7) * 0.08 : 0;
    groupRef.current.rotation.x = -0.34 + progress * 0.38;
    groupRef.current.rotation.y = -0.38 + progress * 0.9;
    groupRef.current.position.y = -0.1 + drift - progress * 0.36;
    groupRef.current.position.x = progress * 0.45;
    if (satelliteRef.current) satelliteRef.current.rotation.z = motionAllowed ? clock.elapsedTime * 0.12 : 0;
  });

  return (
    <group ref={groupRef} position={[0, -0.2, 0]}>
      <mesh position={[0, -1.42, -0.65]} rotation={[-0.56, 0.14, 0.03]}>
        <boxGeometry args={[6.6, 3.55, 0.14]} />
        <meshStandardMaterial color="#111412" roughness={0.74} metalness={0.28} />
      </mesh>
      <mesh position={[0, -0.12, 0]} rotation={[-0.12, -0.08, 0.015]}>
        <boxGeometry args={[4.72, 2.55, 0.14]} />
        <meshStandardMaterial color="#1a1e1b" roughness={0.56} metalness={0.42} />
      </mesh>
      <mesh position={[-1.15, 0.56, 0.13]} rotation={[-0.12, -0.08, 0.015]}>
        <boxGeometry args={[2.1, 0.13, 0.08]} />
        <meshStandardMaterial color="#f9dc0b" emissive="#8f7700" emissiveIntensity={0.5} roughness={0.42} />
      </mesh>
      <mesh position={[-1.25, 0.12, 0.13]} rotation={[-0.12, -0.08, 0.015]}>
        <boxGeometry args={[1.92, 0.1, 0.08]} />
        <meshStandardMaterial color="#f1f3ee" roughness={0.45} />
      </mesh>
      <mesh position={[-1.4, -0.32, 0.13]} rotation={[-0.12, -0.08, 0.015]}>
        <boxGeometry args={[1.58, 0.1, 0.08]} />
        <meshStandardMaterial color="#687069" roughness={0.62} />
      </mesh>
      <mesh position={[1.48, 0.05, 0.16]} rotation={[-0.12, -0.08, 0.015]}>
        <boxGeometry args={[1.16, 1.52, 0.1]} />
        <meshStandardMaterial color="#f9dc0b" emissive="#806a00" emissiveIntensity={0.45} roughness={0.36} metalness={0.2} />
      </mesh>
      <group ref={satelliteRef} position={[-2.7, 1.25, 0.75]} rotation={[0.12, -0.35, 0.1]}>
        <mesh>
          <boxGeometry args={[1.4, 0.76, 0.16]} />
          <meshStandardMaterial color="#e9eee8" roughness={0.38} metalness={0.15} />
        </mesh>
        <mesh position={[0, 0.14, 0.13]}>
          <boxGeometry args={[0.78, 0.08, 0.06]} />
          <meshStandardMaterial color="#171917" roughness={0.5} />
        </mesh>
      </group>
      <group position={[2.45, 1.45, 0.6]} rotation={[0.16, 0.35, -0.1]}>
        <mesh>
          <boxGeometry args={[1.2, 0.7, 0.15]} />
          <meshStandardMaterial color="#f9dc0b" emissive="#806a00" emissiveIntensity={0.4} roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.2, 0.12]}>
          <boxGeometry args={[0.58, 0.08, 0.06]} />
          <meshStandardMaterial color="#171917" roughness={0.5} />
        </mesh>
      </group>
    </group>
  );
}

function SignalMarquee() {
  const signals = ["SOURCE RADAR", "CANDIDATE QUEUE", "VOICE STUDIO", "RELEASE PLANNER"];
  const loop = [...signals, ...signals];

  return (
    <div className="relative z-10 overflow-hidden border-t border-white/10 bg-[#f9dc0b] py-3 text-[#171717]" aria-label="AutoYT workflow: source radar, candidate queue, voice studio, release planner.">
      <div data-marquee-viewport className="overflow-hidden">
        <div data-marquee-track className="flex w-max items-center" aria-hidden="true">
          {loop.map((signal, index) => (
            <span key={`${signal}-${index}`} className="inline-flex items-center gap-4 px-4 text-xs font-black sm:px-7 sm:text-sm">
              {signal}
              <span className="h-2 w-2 bg-[#171717]" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function RadarBoard() {
  return (
    <div data-radar-board className="border border-[#171717]/25 bg-[#171717] p-3 text-white shadow-2xl shadow-[#171717]/20 sm:p-4">
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
    <div data-radar-channel className="flex items-center gap-3 border border-white/10 bg-[#0B0D0C] p-3">
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
    <div data-decision-board className="border border-white/15 bg-[#0B0D0C] p-3 shadow-2xl shadow-black/30 sm:p-4">
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
    <div data-agent-signal className="border border-white/12 p-4">
      <span className="text-[#f9dc0b]">{icon}</span>
      <p className="mt-5 text-sm font-black">{title}</p>
      <p className="mt-2 text-xs leading-5 text-white/53">{copy}</p>
    </div>
  );
}

function StudioBoard() {
  return (
    <div data-studio-board className="border border-[#171717]/15 bg-[#F9F8F6] p-3 shadow-2xl shadow-[#171717]/10 sm:p-4">
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
    <div data-studio-row className="flex items-center gap-3 border border-[#171717]/12 bg-white p-3">
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

function useLandingMotion(
  rootRef: { current: HTMLElement | null },
  sceneProgressRef: { current: number },
) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const marqueeRecords: Array<{ tween: gsap.core.Tween; trigger: ScrollTrigger }> = [];
    const context = gsap.context(() => {
      const heroWords = gsap.utils.toArray<HTMLElement>("[data-hero-word]", root);
      const heroScene = root.querySelector<HTMLElement>("[data-hero-scene]");
      const heroShell = root.querySelector<HTMLElement>("[data-hero-shell]");

      gsap.timeline({ defaults: { ease: "power4.out" } })
        .from(heroWords, { yPercent: 115, rotationX: -62, autoAlpha: 0, duration: 0.76, stagger: 0.09 })
        .from("[data-hero-copy]", { y: 28, autoAlpha: 0, duration: 0.5 }, "-=0.28")
        .from("[data-hero-actions]", { y: 18, autoAlpha: 0, duration: 0.42 }, "-=0.28")
        .from("[data-hero-capabilities]", { y: 14, autoAlpha: 0, duration: 0.38 }, "-=0.24")
        .from("[data-flight-card]", { y: 26, autoAlpha: 0, duration: 0.5, stagger: 0.1 }, "-=0.46")
        .from("[data-flight-core]", { scale: 0.94, autoAlpha: 0, duration: 0.6 }, "-=0.58");

      if (heroScene && heroShell) {
        const desktopDepth = window.matchMedia("(min-width: 768px)").matches;
        gsap.to(heroScene, {
          y: desktopDepth ? -88 : -28,
          rotationX: desktopDepth ? 5 : 0,
          rotationY: desktopDepth ? -7 : 0,
          transformPerspective: 1200,
          ease: "none",
          scrollTrigger: {
            trigger: heroShell,
            start: "top top",
            end: "bottom top",
            scrub: 0.9,
            onUpdate: (self) => {
              sceneProgressRef.current = self.progress;
            },
          },
        });
      }

      const workflowSection = root.querySelector<HTMLElement>("[data-workflow-section]");
      if (workflowSection) {
        gsap.from("[data-workflow-tile]", {
          x: -56,
          clipPath: "inset(0 100% 0 0)",
          immediateRender: false,
          duration: 0.72,
          stagger: 0.13,
          ease: "power3.out",
          scrollTrigger: { trigger: workflowSection, start: "top 72%", once: true },
        });
      }

      const radarSection = root.querySelector<HTMLElement>("[data-radar-section]");
      if (radarSection) {
        const radarTimeline = gsap.timeline({ scrollTrigger: { trigger: radarSection, start: "top 68%", once: true } });
        radarTimeline
          .from("[data-radar-board]", { clipPath: "inset(0 100% 0 0)", immediateRender: false, duration: 0.8, ease: "power3.inOut" })
          .from("[data-radar-channel]", { x: -38, autoAlpha: 0, immediateRender: false, duration: 0.36, stagger: 0.08, ease: "power2.out" }, "-=0.34");
      }

      const agentsSection = root.querySelector<HTMLElement>("[data-agents-section]");
      if (agentsSection) {
        const agentTimeline = gsap.timeline({ scrollTrigger: { trigger: agentsSection, start: "top 68%", once: true } });
        agentTimeline
          .from("[data-decision-board]", { rotationY: -22, transformPerspective: 1200, transformOrigin: "left center", autoAlpha: 0, immediateRender: false, duration: 0.74, ease: "power3.out" })
          .from("[data-agent-signal]", { scaleY: 0.2, transformOrigin: "top", immediateRender: false, duration: 0.36, stagger: 0.09, ease: "power2.out" }, "-=0.2")
          .from("[data-agents-copy]", { x: 34, autoAlpha: 0, immediateRender: false, duration: 0.46, ease: "power2.out" }, "-=0.45");
      }

      const studioSection = root.querySelector<HTMLElement>("[data-studio-section]");
      if (studioSection) {
        const studioTimeline = gsap.timeline({ scrollTrigger: { trigger: studioSection, start: "top 68%", once: true } });
        studioTimeline
          .from("[data-studio-board]", { scaleY: 0.76, transformOrigin: "bottom", filter: "blur(8px)", immediateRender: false, duration: 0.72, ease: "power3.out" })
          .from("[data-studio-row]", { x: 68, autoAlpha: 0, immediateRender: false, duration: 0.34, stagger: 0.1, ease: "power2.out" }, "-=0.34")
          .from("[data-studio-copy]", { clipPath: "inset(0 0 100% 0)", immediateRender: false, duration: 0.54, ease: "power3.out" }, "-=0.52");
      }

      const accessSection = root.querySelector<HTMLElement>("[data-access-section]");
      if (accessSection) {
        const accessTimeline = gsap.timeline({ scrollTrigger: { trigger: accessSection, start: "top 72%", once: true } });
        accessTimeline
          .from("[data-access-frame]", { scaleX: 0, transformOrigin: "left", immediateRender: false, duration: 0.62, ease: "power3.inOut" })
          .from("[data-access-heading]", { yPercent: 110, clipPath: "inset(0 0 100% 0)", immediateRender: false, duration: 0.6, ease: "power4.out" }, "-=0.24")
          .from("[data-access-cta]", { rotation: -5, y: 28, autoAlpha: 0, immediateRender: false, duration: 0.4, ease: "power3.out" }, "-=0.32");
      }

      gsap.utils.toArray<HTMLElement>("[data-marquee-track]", root).forEach((track) => {
        const tween = gsap.to(track, { xPercent: -50, duration: 28, ease: "none", repeat: -1 }).pause();
        const trigger = ScrollTrigger.create({
          trigger: track.parentElement,
          start: "top bottom",
          end: "bottom top",
          onToggle: () => syncMarquees(),
        });
        marqueeRecords.push({ tween, trigger });
      });
    }, root);

    function syncMarquees() {
      marqueeRecords.forEach(({ tween, trigger }) => {
        if (!document.hidden && trigger.isActive) tween.play();
        else tween.pause();
      });
    }

    document.addEventListener("visibilitychange", syncMarquees);
    requestAnimationFrame(syncMarquees);

    return () => {
      document.removeEventListener("visibilitychange", syncMarquees);
      context.revert();
    };
  }, [rootRef, sceneProgressRef]);
}
