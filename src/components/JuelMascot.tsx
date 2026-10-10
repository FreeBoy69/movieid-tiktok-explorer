// Juel as a character: the yellow triangle with two big eyes. One SVG whose parts (body, eyes, pupils,
// mouth, arms, feet) are separate groups, so every pose is drawn from the same pieces and animated with
// CSS (JuelMascot.css). Poses suit what Juel is doing: waving hello, thinking while it works, talking
// while a reply streams, pointing during a tour, cheering when something is done, and so on.
import { useEffect, useId, useRef, useState } from "react";
import "./JuelMascot.css";

export type JuelPose =
  | "idle"
  | "wave"
  | "point"
  | "think"
  | "talk"
  | "cheer"
  | "thumbs"
  | "work"
  | "oops"
  | "listen"
  | "sleep";

export const JUEL_POSES: Array<{ pose: JuelPose; label: string; when: string }> = [
  { pose: "idle", label: "Idle", when: "Waiting, blinking now and then" },
  { pose: "wave", label: "Wave", when: "Hello, and the start of a tour" },
  { pose: "point", label: "Point", when: "Showing a part of the page during a tour" },
  { pose: "think", label: "Think", when: "Working out a reply" },
  { pose: "talk", label: "Talk", when: "Writing a reply" },
  { pose: "work", label: "Work", when: "Running a long task" },
  { pose: "cheer", label: "Cheer", when: "Something finished well" },
  { pose: "thumbs", label: "Thumbs up", when: "Done, or the end of a tour" },
  { pose: "oops", label: "Oops", when: "Something went wrong" },
  { pose: "listen", label: "Listen", when: "Voice input is on" },
  { pose: "sleep", label: "Sleep", when: "Away for a while" },
];

// ---------- Mood: what every Juel on screen is doing ----------
// The panel sets it (thinking while it works, talking while the reply streams), and the header's Juel follows.
let currentMood: JuelPose = "idle";
export function setJuelMood(pose: JuelPose) {
  if (pose === currentMood) return;
  currentMood = pose;
  window.dispatchEvent(new CustomEvent("juel:mood", { detail: pose }));
}
/** The current mood, or `fallback` while Juel is idle. */
export function useJuelMood(fallback: JuelPose = "idle"): JuelPose {
  const [mood, setMood] = useState<JuelPose>(currentMood);
  useEffect(() => {
    const onMood = (event: Event) => setMood((event as CustomEvent<JuelPose>).detail);
    window.addEventListener("juel:mood", onMood);
    return () => window.removeEventListener("juel:mood", onMood);
  }, []);
  return mood === "idle" ? fallback : mood;
}

// ---------- Drawing ----------
const INK = "var(--jm-ink)";
type Pt = [number, number];

/** A polygon with rounded corners (radius r), as an SVG path. */
function roundedPolygon(points: Pt[], radii: number[]): string {
  const n = points.length;
  const toward = (from: Pt, to: Pt, r: number): Pt => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const len = Math.hypot(dx, dy);
    return [from[0] + (dx / len) * r, from[1] + (dy / len) * r];
  };
  const f = (p: Pt) => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
  return (
    points
      .map((p, i) => {
        const a = toward(p, points[(i - 1 + n) % n], radii[i]);
        const b = toward(p, points[(i + 1) % n], radii[i]);
        return `${i ? "L" : "M"}${f(a)} Q${f(p)} ${f(b)}`;
      })
      .join(" ") + " Z"
  );
}

// The body: a triangle pointing right, like a play button.
const TL: Pt = [44, 38];
const TIP: Pt = [208, 112];
const BL: Pt = [76, 186];
const BODY = roundedPolygon([TL, TIP, BL], [20, 14, 20]);

// Where the limbs join the body.
const SHOULDER_L: Pt = [61, 124];
const SHOULDER_R: Pt = [178, 99];

type HandShape = "open" | "fist" | "point" | "thumb";
/** A cartoon hand drawn at the origin, fingers up; placed and turned with `transform`. */
function Hand({ shape, transform }: { shape: HandShape; transform: string }) {
  return (
    <g transform={transform} className="jm-hand">
      <circle r="9.5" fill={INK} />
      {shape === "open" ? (
        <g stroke={INK} strokeWidth="6.5" strokeLinecap="round">
          <line x1="-4" y1="-4" x2="-9" y2="-17" />
          <line x1="0" y1="-5" x2="-1" y2="-20" />
          <line x1="4" y1="-4" x2="7" y2="-18" />
          <line x1="7" y1="-1" x2="15" y2="-10" />
          <line x1="-8" y1="2" x2="-15" y2="-3" />
        </g>
      ) : shape === "point" ? (
        <g stroke={INK} strokeWidth="6.5" strokeLinecap="round">
          <line x1="0" y1="-5" x2="0" y2="-22" />
          <line x1="-8" y1="1" x2="-14" y2="-4" />
        </g>
      ) : shape === "thumb" ? (
        <g stroke={INK} strokeWidth="7" strokeLinecap="round">
          <line x1="-2" y1="-6" x2="-3" y2="-21" />
        </g>
      ) : null}
    </g>
  );
}

/** An arm: a soft curve from the shoulder, ending in a hand. */
function Arm({ from, mid, to, hand, angle, className }: { from: Pt; mid: Pt; to: Pt; hand: HandShape; angle: number; className: string }) {
  return (
    <g className={className}>
      <path d={`M${from[0]} ${from[1]} Q${mid[0]} ${mid[1]} ${to[0]} ${to[1]}`} fill="none" stroke={INK} strokeWidth="7" strokeLinecap="round" />
      <Hand shape={hand} transform={`translate(${to[0]} ${to[1]}) rotate(${angle})`} />
    </g>
  );
}

type ArmSpec = { mid: Pt; to: Pt; hand: HandShape; angle: number };
const DOWN_L: ArmSpec = { mid: [34, 140], to: [40, 171], hand: "open", angle: 190 };
const DOWN_R: ArmSpec = { mid: [204, 116], to: [200, 152], hand: "open", angle: 170 };
const ARMS: Record<JuelPose, { left: ArmSpec; right: ArmSpec }> = {
  idle: { left: DOWN_L, right: DOWN_R },
  wave: { left: DOWN_L, right: { mid: [200, 82], to: [196, 54], hand: "open", angle: 12 } },
  point: { left: DOWN_L, right: { mid: [204, 92], to: [226, 80], hand: "point", angle: 64 } },
  think: { left: DOWN_L, right: { mid: [176, 138], to: [150, 140], hand: "fist", angle: 0 } },
  talk: { left: DOWN_L, right: { mid: [206, 104], to: [214, 84], hand: "open", angle: 30 } },
  work: { left: { mid: [40, 150], to: [64, 170], hand: "fist", angle: 0 }, right: { mid: [200, 126], to: [180, 150], hand: "fist", angle: 0 } },
  cheer: { left: { mid: [32, 104], to: [30, 70], hand: "open", angle: -18 }, right: { mid: [200, 78], to: [210, 48], hand: "open", angle: 18 } },
  thumbs: { left: DOWN_L, right: { mid: [210, 112], to: [214, 92], hand: "thumb", angle: 0 } },
  oops: { left: { mid: [30, 118], to: [26, 96], hand: "open", angle: -24 }, right: { mid: [208, 96], to: [222, 78], hand: "open", angle: 24 } },
  listen: { left: DOWN_L, right: { mid: [204, 110], to: [212, 90], hand: "open", angle: 40 } },
  sleep: { left: DOWN_L, right: DOWN_R },
};

/** An eye: white with a soft shade, a pupil that looks around, and a glint. */
function Eye({ cx, cy, r, look, closed, className }: { cx: number; cy: number; r: number; look: Pt; closed: boolean; className: string }) {
  if (closed)
    // Shut: the eye keeps its shape; a lid line curves across it.
    return (
      <g className={className}>
        <circle cx={cx} cy={cy} r={r} fill="var(--jm-white)" stroke={INK} strokeWidth={r > 20 ? 5 : 4.5} />
        <path d={`M${cx - r * 0.62} ${cy + r * 0.05} Q${cx} ${cy + r * 0.55} ${cx + r * 0.62} ${cy + r * 0.05}`} fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      </g>
    );
  const pr = r * 0.48;
  const reach = r - pr - 3;
  const px = cx + look[0] * reach;
  const py = cy + look[1] * reach;
  return (
    <g className={`${className} jm-eye`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
      <circle cx={cx} cy={cy} r={r} fill="var(--jm-white)" />
      <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 0 ${cx + r * 0.6} ${cy + r * 0.8} A${r * 0.92} ${r * 0.92} 0 0 1 ${cx - r * 0.86} ${cy - r * 0.2} Z`} fill="var(--jm-eye-shade)" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={INK} strokeWidth={r > 20 ? 5 : 4.5} />
      <g className="jm-pupil">
        <circle cx={px} cy={py} r={pr} fill={INK} />
        <circle cx={px + pr * 0.38} cy={py - pr * 0.38} r={pr * 0.3} fill="var(--jm-white)" />
      </g>
    </g>
  );
}

function Mouth({ pose }: { pose: JuelPose }) {
  const tongue = "var(--jm-tongue)";
  if (pose === "sleep") return <path d="M124 120 Q132 125 140 120" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />;
  if (pose === "oops") return <path d="M118 124 Q124 116 130 123 Q136 130 142 122 Q146 117 150 122" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />;
  if (pose === "think") return <path d="M122 121 Q134 118 144 116" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />;
  if (pose === "listen")
    return <ellipse cx="133" cy="121" rx="6" ry="7.5" fill={INK} />;
  // The open smile from the original drawing; talking switches between it and a small "o".
  const smile = (
    <g className="jm-mouth-open">
      <path d="M116 114 Q132 121 150 108 Q147 130 129 129 Q116 127 116 114 Z" fill={INK} />
      <path d="M122 125 Q132 119 143 122 Q138 129 129 128 Q124 127 122 125 Z" fill={tongue} />
    </g>
  );
  if (pose === "cheer" || pose === "thumbs")
    return (
      <g>
        <path d="M112 110 Q133 120 156 103 Q153 134 130 134 Q112 131 112 110 Z" fill={INK} />
        <path d="M120 128 Q132 120 146 124 Q140 133 130 133 Q123 131 120 128 Z" fill={tongue} />
      </g>
    );
  if (pose === "talk")
    return (
      <g>
        {smile}
        <ellipse className="jm-mouth-o" cx="132" cy="120" rx="7" ry="6" fill={INK} />
      </g>
    );
  return smile;
}

/** Little extras around Juel that tell the pose at a glance. */
function Extras({ pose }: { pose: JuelPose }) {
  if (pose === "wave")
    return (
      <g className="jm-extra jm-wave-lines" fill="none" stroke="var(--jm-soft)" strokeWidth="4" strokeLinecap="round">
        <path d="M214 46 Q222 36 220 24" />
        <path d="M226 54 Q236 44 234 30" />
        <path d="M176 44 Q170 34 174 22" />
      </g>
    );
  if (pose === "think")
    return (
      <g className="jm-extra jm-dots" fill="var(--jm-soft)">
        <circle cx="168" cy="40" r="5" />
        <circle cx="186" cy="28" r="6.5" />
        <circle cx="208" cy="16" r="8" />
      </g>
    );
  if (pose === "cheer" || pose === "thumbs") {
    const star = (x: number, y: number, s: number, key: string) => (
      <path key={key} className="jm-spark" d={`M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z`} fill="var(--jm-body)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    );
    return <g className="jm-extra jm-sparks">{pose === "cheer" ? [star(18, 40, 11, "a"), star(226, 132, 9, "b"), star(110, 14, 8, "c")] : [star(230, 60, 9, "a"), star(22, 70, 8, "b")]}</g>;
  }
  if (pose === "oops")
    return <path className="jm-extra jm-sweat" d="M166 52 Q172 62 166 68 Q160 62 166 52 Z" fill="var(--jm-sweat)" stroke={INK} strokeWidth="2.5" />;
  if (pose === "listen")
    return (
      <g className="jm-extra jm-sound" fill="none" stroke="var(--jm-soft)" strokeWidth="4" strokeLinecap="round">
        <path d="M24 92 Q16 104 24 116" />
        <path d="M12 84 Q0 104 12 124" />
      </g>
    );
  if (pose === "sleep")
    return (
      <g className="jm-extra jm-zzz" fill="none" stroke="var(--jm-soft)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M176 40 h12 l-12 13 h12" />
        <path d="M196 22 h9 l-9 10 h9" />
      </g>
    );
  if (pose === "work")
    return (
      <g className="jm-extra jm-gear" fill="none" strokeWidth="5" strokeLinecap="round" style={{ transformOrigin: "210px 40px" }}>
        <circle cx="210" cy="40" r="12" stroke="var(--jm-soft)" opacity="0.4" />
        <path d="M210 28 A12 12 0 0 1 222 40" stroke="var(--jm-body-shade)" />
      </g>
    );
  return null;
}

export type JuelMascotProps = {
  pose?: JuelPose;
  /** Height in pixels. */
  size?: number;
  /** "full" shows the whole character; "bust" is the body, eyes and mouth alone, for icon sizes like the header. */
  framing?: "full" | "bust";
  /** Mirrors Juel to face (and point) left. */
  flip?: boolean;
  /** Where the eyes look, each axis -1 to 1. Ignored while following the pointer. */
  look?: Pt;
  /** The eyes follow the mouse pointer. */
  followPointer?: boolean;
  /** An accessible name; without one the drawing is decorative. */
  title?: string;
  className?: string;
};

const LOOK: Partial<Record<JuelPose, Pt>> = { think: [-0.5, -0.8], oops: [0, 0.5], listen: [-0.7, -0.1], point: [0.8, -0.3], cheer: [0.2, -0.5], thumbs: [0.4, -0.2], wave: [0.35, -0.35] };

export function JuelMascot({ pose = "idle", size = 120, framing = "full", flip = false, look, followPointer = false, title, className = "" }: JuelMascotProps) {
  const uid = useId().replace(/:/g, "");
  const root = useRef<SVGSVGElement | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  // A short pop whenever the pose changes, so the switch reads as a movement, not a cut.
  const [swap, setSwap] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSwap(true);
    const timer = window.setTimeout(() => setSwap(false), 320);
    return () => window.clearTimeout(timer);
  }, [pose]);
  useEffect(() => {
    if (!followPointer) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = root.current?.getBoundingClientRect();
        if (!box) return;
        const dx = (event.clientX - (box.left + box.width * 0.4)) / 240;
        const dy = (event.clientY - (box.top + box.height * 0.42)) / 240;
        const clampUnit = (v: number) => Math.max(-1, Math.min(1, v));
        setPointer([clampUnit(flip ? -dx : dx), clampUnit(dy)]);
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, [followPointer, flip]);

  const eyes = pointer || look || LOOK[pose] || [0.25, -0.25];
  const closed = pose === "sleep";
  const arms = ARMS[pose];
  // The bust is just the body, eyes and mouth: at icon sizes the arms and feet are noise.
  const viewBox = framing === "bust" ? "36 34 178 158" : "0 0 240 240";
  const width = framing === "bust" ? (size * 178) / 158 : size;
  return (
    <svg
      ref={root}
      className={`jm${swap ? " is-swap" : ""} ${className}`.trim()}
      data-pose={pose}
      viewBox={viewBox}
      width={width}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      <defs>
        <clipPath id={`jm-body-${uid}`}>
          <path d={BODY} />
        </clipPath>
      </defs>
      <g className="jm-figure" style={flip ? { transform: "scaleX(-1)", transformOrigin: "120px 120px" } : undefined}>
        {framing === "full" ? <Extras pose={pose} /> : null}
        {framing === "full" ? (
          <g className="jm-legs">
            <g className="jm-leg-l">
              <path d="M100 168 L95 214" stroke={INK} strokeWidth="7" strokeLinecap="round" />
              <path d="M74 224 Q76 211 92 211 L99 211 Q103 212 103 218 L103 224 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            </g>
            <g className="jm-leg-r" style={{ transformOrigin: "136px 212px" }}>
              <path d="M132 152 L137 214" stroke={INK} strokeWidth="7" strokeLinecap="round" />
              <path d="M130 224 L130 218 Q130 212 135 211 L142 211 Q158 211 160 224 Z" fill={INK} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
            </g>
          </g>
        ) : null}
        <g className="jm-body">
          {framing === "full" ? <Arm className="jm-arm-l" from={SHOULDER_L} {...arms.left} /> : null}
          {/* The second eye peeks over the top edge, behind the body. */}
          <Eye className="jm-eye-back" cx={133} cy={63} r={19} look={eyes} closed={closed} />
          <path d={BODY} fill="var(--jm-body)" />
          <g clipPath={`url(#jm-body-${uid})`}>
            {/* Shade along the left and bottom edges, a highlight along the top: the drawing's soft bevel. */}
            <path d={`M${TL[0]} ${TL[1]} L${BL[0]} ${BL[1]} L${TIP[0]} ${TIP[1]}`} fill="none" stroke="var(--jm-body-shade)" strokeWidth="20" strokeLinejoin="round" />
            <path d={`M${TL[0] + 8} ${TL[1] + 6} L${TIP[0] - 10} ${TIP[1] - 3}`} fill="none" stroke="var(--jm-body-light)" strokeWidth="7" strokeLinecap="round" />
          </g>
          <path d={BODY} fill="none" stroke={INK} strokeWidth="6" strokeLinejoin="round" />
          <Eye className="jm-eye-front" cx={92} cy={101} r={26} look={eyes} closed={closed} />
          <Mouth pose={pose} />
          {framing === "full" ? <Arm className="jm-arm-r" from={SHOULDER_R} {...arms.right} /> : null}
        </g>
      </g>
    </svg>
  );
}
