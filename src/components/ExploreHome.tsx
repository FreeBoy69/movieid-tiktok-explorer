// Explore: the home page. A rotating hero, quick-start tiles, then one
// horizontally scrolling row per header group, so every tool in the header's
// mega menus appears here with its own AI-generated thumbnail.
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import { NAV_GROUPS, type NavEntry, type NavTarget } from "../utils/appNavigation";
import "./ExploreHome.css";

const thumb = (id: string) => `/assets/explore/${id}.webp`;

type Slide = { id: string; kicker: string; title: string; body: string; cta: string; target: NavTarget };
const SLIDES: Slide[] = [
  { id: "hero-create", kicker: "Create Video", title: "From one title to a finished video", body: "AutoYT writes the script, voices it, storyboards every scene and renders the cut.", cta: "Start a video", target: { view: "create" } },
  { id: "hero-cinema", kicker: "Cinema Studio", title: "Shoot with a real camera rig", body: "Pick the body, lens, focal length and aperture, then describe the scene.", cta: "Open Cinema Studio", target: { view: "studio", studioTab: "cinema" } },
  { id: "hero-image", kicker: "Image Studio", title: "Any image you can describe", body: "Text to image, image to image, and edits from your own references.", cta: "Make an image", target: { view: "studio", studioTab: "image" } },
  { id: "hero-agents", kicker: "Agents", title: "Let agents run the channel", body: "Agents find sources, make the clips and publish on your schedule.", cta: "Meet the agents", target: { view: "automation" } },
];
const QUICK = ["create", "image", "video", "tts", "cinema", "discover"];
const BADGES: Record<string, "New" | "Hot"> = {
  create: "Hot",
  cinema: "Hot",
  marketing: "Hot",
  "vibe-motion": "New",
  "ai-influencer": "New",
  clipping: "New",
  workflows: "New",
  "design-agent": "New",
};
const GROUP_COPY: Record<string, { title: string; body: string }> = {
  image: { title: "Image", body: "Generate, edit and direct stills" },
  video: { title: "Video", body: "From a script or a still to a finished cut" },
  audio: { title: "Voice & music", body: "Narration, cloned voices and original scores" },
  research: { title: "Research", body: "Find what works before you make it" },
  tools: { title: "Utilities", body: "Downloads, rewrites, prompts and your library" },
  agents: { title: "Agents", body: "Automations that plan, make and publish" },
  channels: { title: "Channels", body: "Manage and grow what you publish" },
};
const ENTRIES = NAV_GROUPS.flatMap((group) => group.columns.flatMap((column) => column.entries));
const SLIDE_MS = 6500;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// Adds .is-in once an element scrolls into view, for the fade-and-rise reveal.
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      el.classList.add("is-in");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-in");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return ref;
}

function Hero({ onNavigate }: { onNavigate: (target: NavTarget) => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const slide = SLIDES[index];
  const go = useCallback((next: number) => setIndex((next + SLIDES.length) % SLIDES.length), []);

  useEffect(() => {
    if (paused || reducedMotion()) return;
    const timer = window.setTimeout(() => go(index + 1), SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [index, paused, go]);
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return (
    <section
      className="xh-hero"
      aria-roledescription="carousel"
      aria-label="Featured"
      data-paused={paused ? "true" : undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") go(index + 1);
        if (event.key === "ArrowLeft") go(index - 1);
      }}
    >
      {SLIDES.map((item, i) => (
        <div key={item.id} className="xh-slide" data-active={i === index ? "true" : undefined} aria-hidden={i !== index} role="group" aria-roledescription="slide" aria-label={`${i + 1} of ${SLIDES.length}`}>
          <img src={thumb(item.id)} alt="" decoding="async" fetchPriority={i === 0 ? "high" : "low"} />
        </div>
      ))}
      <div className="xh-hero-copy" key={slide.id}>
        <span className="xh-kicker">{slide.kicker}</span>
        <h1>{slide.title}</h1>
        <p>{slide.body}</p>
        <button type="button" className="xh-cta" onClick={() => onNavigate(slide.target)}>
          {slide.cta}
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="xh-dots" role="tablist" aria-label="Choose a featured tool">
        {SLIDES.map((item, i) => (
          <button key={item.id} type="button" role="tab" aria-selected={i === index} aria-label={item.kicker} onClick={() => go(i)} style={{ "--slide-ms": `${SLIDE_MS}ms` } as CSSProperties}>
            <span />
          </button>
        ))}
      </div>
    </section>
  );
}

function Card({ entry, index, onNavigate }: { entry: NavEntry; index: number; onNavigate: (target: NavTarget) => void }) {
  const badge = BADGES[entry.id];
  return (
    <button type="button" className="xh-card" style={{ "--i": Math.min(index, 7) } as CSSProperties} onClick={() => onNavigate(entry.target)}>
      <span className="xh-card-media">
        <img src={thumb(entry.id)} alt="" loading="lazy" decoding="async" />
        {badge ? <em className="xh-badge" data-kind={badge.toLowerCase()}>{badge}</em> : null}
        <span className="xh-card-go" aria-hidden="true">
          <ArrowUpRight size={16} />
        </span>
        <span className="xh-card-icon" aria-hidden="true">{entry.icon}</span>
      </span>
      <strong>{entry.label}</strong>
      <span className="xh-card-text">{entry.description}</span>
    </button>
  );
}

function Row({ id, title, body, entries, onNavigate }: { id: string; title: string; body: string; entries: NavEntry[]; onNavigate: (target: NavTarget) => void }) {
  const section = useReveal<HTMLElement>();
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = useCallback(() => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  }, []);
  useEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);
  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: reducedMotion() ? "auto" : "smooth" });
  };
  const scrolls = !(edges.start && edges.end);

  return (
    <section ref={section} id={`explore-${id}`} className="xh-row xh-reveal" aria-labelledby={`explore-${id}-title`}>
      <header className="xh-row-head">
        <div>
          <h2 id={`explore-${id}-title`}>{title}</h2>
          <p>
            {body} · {entries.length} {entries.length === 1 ? "tool" : "tools"}
          </p>
        </div>
        {scrolls ? (
          <div className="xh-arrows">
            <button type="button" aria-label={`Scroll ${title} left`} disabled={edges.start} onClick={() => page(-1)}>
              <ChevronLeft size={18} />
            </button>
            <button type="button" aria-label={`Scroll ${title} right`} disabled={edges.end} onClick={() => page(1)}>
              <ChevronRight size={18} />
            </button>
          </div>
        ) : null}
      </header>
      <div className="xh-track-wrap" data-start={edges.start ? "true" : undefined} data-end={edges.end ? "true" : undefined}>
        <div className="xh-track" ref={track} onScroll={measure}>
          {entries.map((entry, i) => (
            <Card key={entry.id} entry={entry} index={i} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </section>
  );
}

export function ExploreHome({ theme, onNavigate }: { theme: "light" | "dark"; onNavigate: (target: NavTarget) => void }) {
  const [active, setActive] = useState(NAV_GROUPS[0].id);
  const quick = useReveal<HTMLDivElement>();
  const quickEntries = QUICK.map((id) => ENTRIES.find((entry) => entry.id === id)).filter(Boolean) as NavEntry[];

  // Highlight the chip for the last row whose top has passed under the chip bar.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = NAV_GROUPS[0].id;
      for (const group of NAV_GROUPS) {
        const el = document.getElementById(`explore-${group.id}`);
        if (el && el.getBoundingClientRect().top < window.innerHeight * 0.4) current = group.id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    update();
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  const jump = (id: string) => {
    document.getElementById(`explore-${id}`)?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="xh" data-theme={theme}>
      <Hero onNavigate={onNavigate} />

      <div ref={quick} className="xh-quick xh-reveal" aria-label="Start creating">
        {quickEntries.map((entry, i) => (
          <button key={entry.id} type="button" className="xh-quick-tile" style={{ "--i": i } as CSSProperties} onClick={() => onNavigate(entry.target)}>
            <img src={thumb(entry.id)} alt="" loading="lazy" decoding="async" />
            <span className="xh-quick-icon" aria-hidden="true">{entry.icon}</span>
            <span className="xh-quick-label">{entry.label}</span>
          </button>
        ))}
      </div>

      {NAV_GROUPS.map((group) => (
        <Row
          key={group.id}
          id={group.id}
          title={GROUP_COPY[group.id]?.title || group.label}
          body={GROUP_COPY[group.id]?.body || ""}
          entries={group.columns.flatMap((column) => column.entries)}
          onNavigate={onNavigate}
        />
      ))}
      {/* Sticks to the bottom of the viewport while the rows scroll past. */}
      <nav className="xh-chips" aria-label="Jump to a category">
        <div className="xh-chips-inner">
          {NAV_GROUPS.map((group) => (
            <button key={group.id} type="button" aria-current={active === group.id ? "true" : undefined} onClick={() => jump(group.id)}>
              {GROUP_COPY[group.id]?.title || group.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
