// Juel's guided tours: the page dims, a spotlight moves to each part being explained, and Juel stands on a
// small card beside it, pointing. A page with a tour offers it once ("Want a quick tour?"); the Juel panel
// can start it any time. Steps find their element by selector and are skipped when it isn't on screen.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { JuelMascot, type JuelPose } from "./JuelMascot";
import { readDeepLink } from "../utils/tiktokRoute";
import "./JuelMascot.css";

type TourStep = { target?: string; title: string; body: string; pose?: JuelPose };
type Tour = { id: string; label: string; matches: () => boolean; steps: TourStep[] };

const onPath = (test: (link: ReturnType<typeof readDeepLink>) => boolean) => () => {
  try {
    return test(readDeepLink());
  } catch {
    return false;
  }
};

export const TOURS: Tour[] = [
  {
    id: "welcome",
    label: "AutoYT",
    matches: () => window.location.pathname === "/",
    steps: [
      { title: "Hi, I'm Juel", body: "I'll show you around in a few quick stops. Press Esc to leave any time.", pose: "wave" },
      { target: ".sl-box", title: "Start with an idea", body: "Describe an image or a video here and press send. Switch between Image and Video, and pick a model, right in the box." },
      { target: ".ah-nav", title: "Every studio, one bar", body: "Create Video, Create Drama, the Image, Video and Audio studios, Agents and Tools all live up here." },
      { target: ".ah-search", title: "Jump anywhere", body: "Search every studio and tool by name. Press ⌘K from any page." },
      { target: ".juel-trigger", title: "And me, any time", body: "Ask me to find a niche, write a script, make a video or post it. I show what each paid step costs before I run it." },
      { target: ".ah-account", title: "Your account", body: "Credits, plan, connected channels and settings are in here." },
      { title: "That's the tour", body: "Ask me for help whenever you're stuck, and every page with a tour can show it again from my panel.", pose: "thumbs" },
    ],
  },
  {
    id: "niche-finder",
    label: "Niche Finder",
    matches: onPath((link) => link.view === "discover"),
    steps: [
      { title: "Finding your niche", body: "This page shows channels that are finding an audience right now. Here's how to read it.", pose: "wave" },
      { target: ".maker-searchbar", title: "Search or browse", body: "Type a niche or paste a channel link. Leave it empty and shuffle to browse channels across faceless niches." },
      { target: ".maker-active-filters", title: "Your filters", body: "Faceless, long form, English and typical views over 5K are on to start. Remove any chip, or open Advanced filters for more." },
      { target: ".maker-niche-presets", title: "Presets", body: "Sleep and Story set the filters for two niches that keep growing." },
      { target: ".maker-sort", title: "Sort it your way", body: "Newest channels first is the default: they show what's working now. Sort by typical views or consistency instead." },
      { target: ".maker-channel-card", title: "A channel at a glance", body: "Subscribers, typical views, videos, how long it's been posting, and its newest and best video. Hover Faceless to see why." },
      { target: ".maker-channel-card-actions", title: "Go deeper", body: "Similar channels finds more like it. Copy style turns its format into a style you can make videos with.", pose: "thumbs" },
    ],
  },
  {
    id: "create-video",
    label: "Create Video",
    matches: onPath((link) => link.view === "projects" && Boolean(link.projectId)),
    steps: [
      { title: "Making a video", body: "A video is made in steps, from the title to the export. I'll show you the flow.", pose: "wave" },
      { target: ".maker-stagebar", title: "One step at a time", body: "Title, script, description, voiceover, soundtrack, visuals, thumbnail and export. A tick means a step is done." },
      { target: ".maker-gen-head", title: "Generate, then edit", body: "Each step has its own Generate button. What it makes is yours to edit before you move on." },
      { target: ".juel-trigger", title: "Stuck on a step?", body: "Ask me to write a hook, change the voice or regenerate a scene. I can work on this project with you.", pose: "thumbs" },
    ],
  },
  {
    id: "movie-recap",
    label: "Movie to Recap",
    matches: onPath((link) => link.view === "tool" && link.toolId === "movie-recap"),
    steps: [
      { title: "A film, retold in your voice", body: "Give me a full film and I'll watch it, write a recap, narrate it and cut it together.", pose: "wave" },
      { target: ".mt-field:has(#mr-source-label)", title: "The film", body: "Paste a link from a file host or upload the file (up to 1.5 GB). One film or episode, 5 minutes to 4 hours." },
      { target: ".mr-formats", title: "Long recap, Short, or both", body: "Choose the formats and their length. You'll review the script on a storyboard before anything is rendered." },
      { target: ".mt-primary", title: "Start", body: "Watching and writing takes a while for a full film. You can leave the page: the recap keeps going on its own.", pose: "thumbs" },
    ],
  },
];

const seenKey = (id: string) => `juel:tour:${id}`;
const seen = (id: string) => {
  try {
    return Boolean(window.localStorage.getItem(seenKey(id)));
  } catch {
    return true; // storage blocked: never nag
  }
};
const markSeen = (id: string, how: "done" | "skipped" | "declined") => {
  try {
    window.localStorage.setItem(seenKey(id), how);
  } catch {}
};

/** Starts a tour by id, or the tour for the current page. */
export function startJuelTour(id?: string) {
  window.dispatchEvent(new CustomEvent("juel:tour", { detail: id || "" }));
}
/** The tour for the current page, if it has one. */
export function pageTour(): Tour | null {
  return TOURS.find((tour) => tour.matches()) || null;
}

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 8;

/** The tour runner and the one-time offer. Mounted once (inside the header's Juel button). */
export default function JuelTourHost() {
  const [tour, setTour] = useState<Tour | null>(null);
  const [index, setIndex] = useState(0);
  const [offer, setOffer] = useState<Tour | null>(null);

  const begin = useCallback((next: Tour) => {
    setOffer(null);
    setIndex(0);
    setTour(next);
  }, []);

  // Started from elsewhere (the Juel panel).
  useEffect(() => {
    const onStart = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      const next = id ? TOURS.find((t) => t.id === id) : pageTour();
      if (next) begin(next);
    };
    window.addEventListener("juel:tour", onStart);
    return () => window.removeEventListener("juel:tour", onStart);
  }, [begin]);

  // Offered once per tour, a moment after its page opens.
  useEffect(() => {
    let timer = 0;
    const check = () => {
      window.clearTimeout(timer);
      setOffer(null);
      timer = window.setTimeout(() => {
        const candidate = pageTour();
        if (candidate && !seen(candidate.id) && !document.querySelector(".juel[role='dialog']")) setOffer(candidate);
      }, 2200);
    };
    check();
    window.addEventListener("popstate", check);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("popstate", check);
    };
  }, []);

  if (tour) return <TourRunner tour={tour} index={index} setIndex={setIndex} onEnd={(how) => { markSeen(tour.id, how); setTour(null); }} />;
  if (offer)
    return createPortal(
      <div className="jt-offer" role="dialog" aria-label={`Tour of ${offer.label}`}>
        <JuelMascot pose="wave" size={84} className="jt-offer-mascot" />
        <div className="jt-offer-card">
          <p>
            <strong>Hi, I'm Juel.</strong> Want a quick tour of {offer.label === "AutoYT" ? "AutoYT" : `the ${offer.label}`}?
          </p>
          <div className="jt-actions">
            <button type="button" className="jt-link" onClick={() => { markSeen(offer.id, "declined"); setOffer(null); }}>
              No thanks
            </button>
            <button type="button" className="jt-next" onClick={() => begin(offer)}>
              Show me
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  return null;
}

function TourRunner({ tour, index, setIndex, onEnd }: { tour: Tour; index: number; setIndex: (n: number) => void; onEnd: (how: "done" | "skipped") => void }) {
  // Steps whose element isn't on the page are left out.
  const [steps] = useState(() => tour.steps.filter((step) => !step.target || document.querySelector(step.target)));
  const step = steps[Math.min(index, steps.length - 1)];
  const [rect, setRect] = useState<Rect | null>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const [cardBox, setCardBox] = useState({ width: 340, height: 180 });
  const last = index >= steps.length - 1;

  const measure = useCallback(() => {
    const element = step?.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    if (!element) return setRect(null);
    const box = element.getBoundingClientRect();
    setRect({ top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 });
  }, [step]);

  useLayoutEffect(() => {
    const element = step?.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    element?.scrollIntoView({ block: "center", inline: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    measure();
    // Scrolling into view takes a moment: measure again as it settles.
    const timers = [120, 320, 600].map((ms) => window.setTimeout(measure, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [measure, step]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [measure]);
  useLayoutEffect(() => {
    if (card.current) setCardBox({ width: card.current.offsetWidth, height: card.current.offsetHeight });
    card.current?.focus({ preventScroll: true });
  }, [index, rect === null]);

  const next = useCallback(() => (last ? onEnd("done") : setIndex(index + 1)), [last, index, onEnd, setIndex]);
  const back = useCallback(() => index > 0 && setIndex(index - 1), [index, setIndex]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEnd("skipped");
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onEnd]);

  if (!step) return null;
  // The card goes below the spotlight when there's room, else above, else beside; no target: centred.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const phone = vw < 640;
  const gap = 22;
  let top = (vh - cardBox.height) / 2;
  let left = (vw - cardBox.width) / 2;
  let pointLeft = false;
  if (rect && !phone) {
    if (rect.top + rect.height + gap + cardBox.height < vh - 16) top = rect.top + rect.height + gap + 34;
    else if (rect.top - gap - cardBox.height > 16) top = rect.top - gap - cardBox.height;
    else top = Math.min(vh - cardBox.height - 16, Math.max(16, rect.top));
    left = Math.min(vw - cardBox.width - 16, Math.max(16, rect.left + rect.width / 2 - cardBox.width / 2));
    // Juel stands on the card's left corner; he turns to point at a target to his left.
    pointLeft = rect.left + rect.width / 2 < left + 40;
  }
  const pose: JuelPose = step.pose || (rect ? "point" : "wave");
  return createPortal(
    <div className="jt" role="presentation">
      {rect ? (
        <div className="jt-spot" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
      ) : (
        <div className="jt-dim" />
      )}
      {/* Clicks outside the card don't fall through to the page while the tour runs. */}
      <div className="jt-catch" onClick={(event) => event.stopPropagation()} />
      <div
        ref={card}
        className={`jt-card${phone ? " is-phone" : ""}`}
        style={phone ? undefined : { top, left }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jt-title"
        aria-describedby="jt-body"
        tabIndex={-1}
      >
        <JuelMascot key={pose} pose={pose} size={96} flip={pointLeft} className="jt-mascot" />
        <button type="button" className="jt-close" onClick={() => onEnd("skipped")} aria-label="End the tour">
          <X size={16} />
        </button>
        <h2 id="jt-title">{step.title}</h2>
        <p id="jt-body">{step.body}</p>
        <div className="jt-actions">
          <span className="jt-count">
            {index + 1} of {steps.length}
          </span>
          {index > 0 ? (
            <button type="button" className="jt-back" onClick={back} aria-label="Previous stop">
              <ArrowLeft size={15} />
            </button>
          ) : null}
          <button type="button" className="jt-next" onClick={next}>
            {last ? "Done" : index === 0 ? "Let's go" : "Next"}
            {last ? null : <ArrowRight size={15} />}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
