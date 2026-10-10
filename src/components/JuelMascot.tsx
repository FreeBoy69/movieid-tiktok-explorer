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
  | "sleep"
  // Animation presets: loops (dance, wiggle, float) and one-shot moves (the rest) that play once and
  // hand back to the pose Juel was in (see playJuel).
  | "dance"
  | "wiggle"
  | "float"
  | "flip"
  | "spin"
  | "jump"
  | "nod"
  | "shake"
  | "tada"
  | "peek"
  // Speaking out loud in live mode: the mouth follows the audio (the --jm-mouth variable, 0 to 1).
  | "speak"
  | JuelEmotion;

/** Emotions, like emoji: a face (eyes, mouth, brows), touches (tears, hearts, blush) and a motion each. */
export type JuelEmotion =
  | "happy" | "laugh" | "love" | "wink" | "starstruck" | "cool" | "proud" | "party" | "silly" | "kiss"
  | "surprised" | "shocked" | "mindblown" | "confused" | "skeptical" | "eyeroll" | "bored"
  | "sad" | "cry" | "embarrassed" | "shy" | "nervous" | "scared"
  | "angry" | "furious" | "sick" | "dizzy" | "ko" | "facepalm";

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

/** Animation presets: moves Juel can play on cue. One-shots last `ms`, then he goes back to his pose. */
export const JUEL_PRESETS: Array<{ pose: JuelPose; label: string; when: string; ms: number }> = [
  { pose: "dance", label: "Dance", when: "A little dance on the beat (128 BPM)", ms: 0 },
  { pose: "wiggle", label: "Wiggle", when: "Pleased with himself", ms: 0 },
  { pose: "float", label: "Float", when: "Hovering, waiting for you", ms: 0 },
  { pose: "flip", label: "Flip", when: "A backflip, for a big win", ms: 1100 },
  { pose: "spin", label: "Spin", when: "Turns around on the spot", ms: 900 },
  { pose: "jump", label: "Jump", when: "A quick hop of surprise", ms: 700 },
  { pose: "nod", label: "Nod", when: "Yes, got it", ms: 900 },
  { pose: "shake", label: "Head shake", when: "No, or that didn't work", ms: 900 },
  { pose: "tada", label: "Ta-da", when: "Here it is", ms: 1300 },
  { pose: "peek", label: "Peek", when: "Popping up to say hello", ms: 1100 },
  { pose: "speak", label: "Speak", when: "Talking out loud; his mouth follows the voice", ms: 0 },
];
/** Every emotion with the emoji it matches. */
export const JUEL_EMOTIONS: Array<{ pose: JuelEmotion; label: string; emoji: string }> = [
  { pose: "happy", label: "Happy", emoji: "😊" },
  { pose: "laugh", label: "Laughing", emoji: "😂" },
  { pose: "love", label: "In love", emoji: "😍" },
  { pose: "wink", label: "Wink", emoji: "😉" },
  { pose: "starstruck", label: "Starstruck", emoji: "🤩" },
  { pose: "cool", label: "Cool", emoji: "😎" },
  { pose: "proud", label: "Proud", emoji: "😤" },
  { pose: "party", label: "Party", emoji: "🥳" },
  { pose: "silly", label: "Silly", emoji: "😜" },
  { pose: "kiss", label: "Kiss", emoji: "😘" },
  { pose: "surprised", label: "Surprised", emoji: "😮" },
  { pose: "shocked", label: "Shocked", emoji: "😱" },
  { pose: "mindblown", label: "Mind blown", emoji: "🤯" },
  { pose: "confused", label: "Confused", emoji: "😕" },
  { pose: "skeptical", label: "Skeptical", emoji: "🤨" },
  { pose: "eyeroll", label: "Eye roll", emoji: "🙄" },
  { pose: "bored", label: "Bored", emoji: "😑" },
  { pose: "sad", label: "Sad", emoji: "😢" },
  { pose: "cry", label: "Crying", emoji: "😭" },
  { pose: "embarrassed", label: "Embarrassed", emoji: "😳" },
  { pose: "shy", label: "Shy", emoji: "☺️" },
  { pose: "nervous", label: "Nervous", emoji: "😬" },
  { pose: "scared", label: "Scared", emoji: "😨" },
  { pose: "angry", label: "Angry", emoji: "😠" },
  { pose: "furious", label: "Furious", emoji: "😡" },
  { pose: "sick", label: "Sick", emoji: "🤢" },
  { pose: "dizzy", label: "Dizzy", emoji: "😵‍💫" },
  { pose: "ko", label: "Knocked out", emoji: "😵" },
  { pose: "facepalm", label: "Facepalm", emoji: "🤦" },
];

/** A reaction to something said: an emotion (or a move) for the words, or null. */
export function reactionTo(text: string, by: "user" | "juel"): JuelPose | null {
  const t = String(text || "").toLowerCase();
  if (by === "user") {
    if (/\bdance\b/.test(t)) return "dance";
    if (/\b(backflip|do a flip|flip)\b/.test(t)) return "flip";
    if (/\b(thank|thanks|thx|ty|love (it|you|this)|you('| a)re the best|awesome|amazing|great job|well done)\b/.test(t)) return "love";
    if (/\b(lol|lmao|haha+|hehe|rofl|funny)\b|😂|🤣/.test(t)) return "laugh";
    if (/\b(wtf|ugh|annoy\w*|hate|stupid|useless|broken|terrible|awful)\b|😡|😠/.test(t)) return "nervous";
    if (/\b(wow|whoa|omg|no way|insane)\b|😮|🤯/.test(t)) return "starstruck";
    if (/\b(sad|depressed|bad day|upset)\b|😢|😭/.test(t)) return "sad";
    if (/^(hi|hello|hey|yo|good (morning|afternoon|evening))\b/.test(t)) return "wave";
    return null;
  }
  if (/\b(sorry|apolog|couldn't|could not|can't|cannot|failed|unable)\b/.test(t)) return "sad";
  if (/\b(posted|published|is live|is ready|all set|done!|finished)\b/.test(t)) return "party";
  if (/\b(great|nice|perfect|congrat)\w*/.test(t)) return "happy";
  return null;
}

const ONE_SHOT: Partial<Record<JuelPose, number>> = Object.fromEntries(JUEL_PRESETS.filter((p) => p.ms).map((p) => [p.pose, p.ms]));

// ---------- Mood: what every Juel on screen is doing ----------
// The panel sets it (thinking while it works, talking while the reply streams), and the header's Juel follows.
let currentMood: JuelPose = "idle";
export function setJuelMood(pose: JuelPose) {
  if (pose === currentMood) return;
  currentMood = pose;
  window.dispatchEvent(new CustomEvent("juel:mood", { detail: pose }));
}
/** Plays an animation preset on every Juel on screen. A one-shot (flip, jump, nod...) goes back to the
 *  mood Juel was in when it ends; a loop (dance) runs for `ms`, or until the mood changes. */
let acting = 0;
export function playJuel(pose: JuelPose, ms = ONE_SHOT[pose] || 3500) {
  const previous = currentMood === pose ? "idle" : currentMood;
  setJuelMood(pose);
  window.clearTimeout(acting);
  acting = window.setTimeout(() => {
    if (currentMood === pose) setJuelMood(previous);
  }, ms);
}
/** A brief reaction (to a toast, a message) that never interrupts what Juel is busy with. */
export function reactJuel(pose: JuelPose, ms = 2400) {
  if (currentMood === "idle" || (ONE_SHOT as Record<string, number>)[currentMood] || (FACES as Record<string, unknown>)[currentMood]) playJuel(pose, ms);
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
const ARMS: Record<Exclude<JuelPose, JuelEmotion>, { left: ArmSpec; right: ArmSpec }> = {
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
  dance: { left: { mid: [30, 108], to: [28, 80], hand: "open", angle: -20 }, right: { mid: [206, 120], to: [206, 150], hand: "open", angle: 160 } },
  wiggle: { left: { mid: [40, 150], to: [64, 168], hand: "fist", angle: 0 }, right: { mid: [200, 126], to: [180, 150], hand: "fist", angle: 0 } },
  float: { left: { mid: [34, 128], to: [22, 132], hand: "open", angle: -80 }, right: { mid: [204, 108], to: [226, 116], hand: "open", angle: 80 } },
  flip: { left: { mid: [30, 104], to: [30, 70], hand: "open", angle: -18 }, right: { mid: [200, 78], to: [210, 48], hand: "open", angle: 18 } },
  spin: { left: DOWN_L, right: DOWN_R },
  jump: { left: { mid: [30, 118], to: [26, 96], hand: "open", angle: -24 }, right: { mid: [208, 96], to: [222, 78], hand: "open", angle: 24 } },
  nod: { left: DOWN_L, right: DOWN_R },
  shake: { left: DOWN_L, right: DOWN_R },
  tada: { left: { mid: [34, 128], to: [18, 118], hand: "open", angle: -70 }, right: { mid: [204, 96], to: [228, 80], hand: "open", angle: 60 } },
  peek: { left: DOWN_L, right: { mid: [200, 82], to: [196, 54], hand: "open", angle: 12 } },
  speak: { left: DOWN_L, right: { mid: [206, 104], to: [214, 84], hand: "open", angle: 30 } },
};

type EyeKind = "open" | "closed" | "happy" | "tight" | "heart" | "star" | "wide" | "x" | "spiral" | "half";
/** An eye: white with a soft shade, a pupil that looks around, and a glint; or one of the emoji eyes. */
function Eye({ cx, cy, r, look, closed, className, kind = "open", side = "front" }: { cx: number; cy: number; r: number; look: Pt; closed: boolean; className: string; kind?: EyeKind; side?: "front" | "back" }) {
  const sw = r > 20 ? 5 : 4.5;
  const white = (
    <>
      <circle cx={cx} cy={cy} r={r} fill="var(--jm-white)" />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={INK} strokeWidth={sw} />
    </>
  );
  const line = (d: string, extra: Record<string, unknown> = {}) => <path d={d} fill="none" stroke={INK} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" {...extra} />;
  if (kind === "happy") return <g className={className}>{white}{line(`M${cx - r * 0.6} ${cy + r * 0.2} Q${cx} ${cy - r * 0.6} ${cx + r * 0.6} ${cy + r * 0.2}`)}</g>;
  if (kind === "tight") {
    const d = side === "front" ? `M${cx - r * 0.5} ${cy - r * 0.42} L${cx + r * 0.42} ${cy} L${cx - r * 0.5} ${cy + r * 0.42}` : `M${cx + r * 0.5} ${cy - r * 0.42} L${cx - r * 0.42} ${cy} L${cx + r * 0.5} ${cy + r * 0.42}`;
    return <g className={className}>{white}{line(d)}</g>;
  }
  if (kind === "x")
    return <g className={className}>{white}{line(`M${cx - r * 0.45} ${cy - r * 0.45} L${cx + r * 0.45} ${cy + r * 0.45} M${cx + r * 0.45} ${cy - r * 0.45} L${cx - r * 0.45} ${cy + r * 0.45}`)}</g>;
  if (kind === "spiral") {
    const pts: string[] = [];
    for (let a = 0; a <= Math.PI * 5; a += 0.3) pts.push(`${(cx + Math.cos(a) * (a / (Math.PI * 5)) * r * 0.72).toFixed(1)} ${(cy + Math.sin(a) * (a / (Math.PI * 5)) * r * 0.72).toFixed(1)}`);
    return <g className={className}>{white}<g className="jm-spiral" style={{ transformOrigin: `${cx}px ${cy}px` }}>{line(`M${pts.join(" L")}`, { strokeWidth: 3.5 })}</g></g>;
  }
  if (kind === "heart" || kind === "star") {
    const x = cx + look[0] * r * 0.15;
    const y = cy + look[1] * r * 0.15;
    const k = r * 0.62;
    const shape =
      kind === "heart"
        ? `M${x} ${y + k * 0.85} C${x - k * 1.25} ${y + k * 0.05}, ${x - k * 0.7} ${y - k * 0.95}, ${x} ${y - k * 0.32} C${x + k * 0.7} ${y - k * 0.95}, ${x + k * 1.25} ${y + k * 0.05}, ${x} ${y + k * 0.85} Z`
        : Array.from({ length: 10 }, (_, i) => {
            const a = -Math.PI / 2 + (i * Math.PI) / 5;
            const rr = i % 2 ? k * 0.45 : k;
            return `${i ? "L" : "M"}${(x + Math.cos(a) * rr).toFixed(1)} ${(y + Math.sin(a) * rr).toFixed(1)}`;
          }).join(" ") + " Z";
    return (
      <g className={`${className} jm-eye-icon`} style={{ transformOrigin: `${cx}px ${cy}px` }}>
        {white}
        <path d={shape} fill={kind === "heart" ? "var(--jm-heart)" : "var(--jm-star)"} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      </g>
    );
  }
  if (closed || kind === "closed")
    // Shut: the eye keeps its shape; a lid line curves across it.
    return (
      <g className={className}>
        <circle cx={cx} cy={cy} r={r} fill="var(--jm-white)" stroke={INK} strokeWidth={r > 20 ? 5 : 4.5} />
        <path d={`M${cx - r * 0.62} ${cy + r * 0.05} Q${cx} ${cy + r * 0.55} ${cx + r * 0.62} ${cy + r * 0.05}`} fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />
      </g>
    );
  const pr = kind === "wide" ? r * 0.27 : r * 0.48;
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
      {kind === "half" ? (
        // A heavy upper lid: bored, sick, skeptical.
        <>
          <path d={`M${cx - r - 1} ${cy - r * 0.05} A${r + 1} ${r + 1} 0 0 1 ${cx + r + 1} ${cy - r * 0.05} Z`} fill="var(--jm-body)" />
          {line(`M${cx - r} ${cy - r * 0.05} L${cx + r} ${cy - r * 0.05}`)}
          <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={INK} strokeWidth={sw} />
        </>
      ) : null}
    </g>
  );
}

// ---------- Emotions ----------
type MouthKind = "smile" | "grin" | "laugh" | "frown" | "wail" | "o" | "gasp" | "wavy" | "flat" | "smirk" | "kiss" | "tongue" | "grimace" | "tiny";
type BrowKind = "angry" | "sad" | "raised" | "oneup";
type Touch = "tearsJoy" | "tear" | "stream" | "blush" | "vein" | "sweat" | "hearts" | "heart" | "question" | "exclaim" | "orbit" | "boom" | "steam" | "puffs" | "party" | "sparks" | "shades";
type Face = { eyes: EyeKind | [EyeKind, EyeKind]; mouth: MouthKind; brows?: BrowKind; touches?: Touch[]; arms?: { left: ArmSpec; right: ArmSpec }; look?: Pt; tint?: "red" | "green" };

const UP_L: ArmSpec = { mid: [32, 104], to: [30, 70], hand: "open", angle: -18 };
const UP_R: ArmSpec = { mid: [200, 78], to: [210, 48], hand: "open", angle: 18 };
const FIST_L: ArmSpec = { mid: [40, 150], to: [60, 172], hand: "fist", angle: 0 };
const FIST_R: ArmSpec = { mid: [204, 128], to: [186, 156], hand: "fist", angle: 0 };
const CHEEK_L: ArmSpec = { mid: [36, 128], to: [56, 112], hand: "open", angle: 40 };
const CHEEK_R: ArmSpec = { mid: [204, 120], to: [178, 118], hand: "open", angle: -40 };
const FACES: Record<JuelEmotion, Face> = {
  happy: { eyes: "happy", mouth: "smile", touches: ["blush"] },
  laugh: { eyes: "tight", mouth: "laugh", touches: ["tearsJoy"], arms: { left: FIST_L, right: { mid: [196, 132], to: [162, 150], hand: "fist", angle: 0 } } },
  love: { eyes: "heart", mouth: "smile", touches: ["hearts", "blush"] },
  wink: { eyes: ["happy", "open"], mouth: "smirk", look: [0.3, -0.2], arms: { left: DOWN_L, right: { mid: [210, 112], to: [214, 92], hand: "thumb", angle: 0 } } },
  starstruck: { eyes: "star", mouth: "grin", touches: ["sparks"], arms: { left: UP_L, right: UP_R } },
  cool: { eyes: "open", mouth: "smirk", touches: ["shades"], arms: { left: DOWN_L, right: { mid: [210, 112], to: [214, 92], hand: "thumb", angle: 0 } } },
  proud: { eyes: "happy", mouth: "smirk", touches: ["puffs"], arms: { left: FIST_L, right: FIST_R } },
  party: { eyes: "happy", mouth: "grin", touches: ["party"], arms: { left: UP_L, right: UP_R } },
  silly: { eyes: ["happy", "open"], mouth: "tongue", look: [0.4, -0.4] },
  kiss: { eyes: ["happy", "happy"], mouth: "kiss", touches: ["heart", "blush"] },
  surprised: { eyes: "wide", mouth: "o", brows: "raised", touches: ["exclaim"], look: [0, -0.1] },
  shocked: { eyes: "wide", mouth: "gasp", brows: "raised", touches: ["sweat"], arms: { left: CHEEK_L, right: CHEEK_R } },
  mindblown: { eyes: "wide", mouth: "gasp", brows: "raised", touches: ["boom"], arms: { left: UP_L, right: UP_R } },
  confused: { eyes: "open", mouth: "wavy", brows: "oneup", touches: ["question"], look: [-0.4, -0.6], arms: { left: DOWN_L, right: { mid: [196, 70], to: [176, 50], hand: "fist", angle: -30 } } },
  skeptical: { eyes: ["half", "open"], mouth: "flat", brows: "oneup", look: [0.5, 0] },
  eyeroll: { eyes: "half", mouth: "flat", look: [0.1, -1] },
  bored: { eyes: "half", mouth: "flat", look: [0, 0.3] },
  sad: { eyes: "half", mouth: "frown", brows: "sad", touches: ["tear"], look: [0, 0.7] },
  cry: { eyes: "tight", mouth: "wail", brows: "sad", touches: ["stream"] },
  embarrassed: { eyes: "wide", mouth: "tiny", brows: "sad", touches: ["blush", "sweat"], look: [-0.5, 0.3] },
  shy: { eyes: "happy", mouth: "tiny", touches: ["blush"], arms: { left: { mid: [40, 150], to: [74, 166], hand: "fist", angle: 0 }, right: { mid: [196, 132], to: [170, 152], hand: "fist", angle: 0 } } },
  nervous: { eyes: "open", mouth: "grimace", brows: "sad", touches: ["sweat"], look: [-0.6, 0] },
  scared: { eyes: "wide", mouth: "grimace", brows: "sad", touches: ["sweat"], arms: { left: CHEEK_L, right: CHEEK_R } },
  angry: { eyes: "open", mouth: "frown", brows: "angry", touches: ["vein"], arms: { left: FIST_L, right: FIST_R }, look: [0.2, 0] },
  furious: { eyes: "wide", mouth: "grimace", brows: "angry", touches: ["vein", "steam"], arms: { left: FIST_L, right: FIST_R }, tint: "red" },
  sick: { eyes: "half", mouth: "wavy", touches: ["sweat"], tint: "green", look: [0, 0.5] },
  dizzy: { eyes: "spiral", mouth: "wavy", touches: ["orbit"] },
  ko: { eyes: "x", mouth: "o", touches: ["orbit"] },
  facepalm: { eyes: ["closed", "closed"], mouth: "flat", arms: { left: DOWN_L, right: { mid: [170, 128], to: [100, 104], hand: "open", angle: -64 } } },
};
const faceOf = (pose: JuelPose): Face | null => (FACES as Record<string, Face>)[pose] || null;

function EmotionMouth({ kind }: { kind: MouthKind }) {
  const tongue = "var(--jm-tongue)";
  const stroke = (d: string) => <path d={d} fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />;
  switch (kind) {
    case "smile":
      return (
        <g>
          <path d="M116 114 Q132 121 150 108 Q147 130 129 129 Q116 127 116 114 Z" fill={INK} />
          <path d="M122 125 Q132 119 143 122 Q138 129 129 128 Q124 127 122 125 Z" fill={tongue} />
        </g>
      );
    case "grin":
      return (
        <g>
          <path d="M112 110 Q133 120 156 103 Q153 134 130 134 Q112 131 112 110 Z" fill={INK} />
          <path d="M120 128 Q132 120 146 124 Q140 133 130 133 Q123 131 120 128 Z" fill={tongue} />
        </g>
      );
    case "laugh":
      return (
        <g className="jm-mouth-laugh" style={{ transformOrigin: "134px 122px" }}>
          <path d="M106 106 Q133 120 162 98 Q160 144 130 143 Q106 139 106 106 Z" fill={INK} />
          <path d="M110 108 Q133 120 158 101 L157 108 Q134 125 111 115 Z" fill="var(--jm-white)" />
          <path d="M116 134 Q132 124 150 128 Q143 142 130 142 Q121 140 116 134 Z" fill={tongue} />
        </g>
      );
    case "frown":
      return stroke("M120 127 Q133 113 147 125");
    case "wail":
      return (
        <g>
          <path d="M114 136 Q116 108 133 108 Q150 108 152 134 Q133 128 114 136 Z" fill={INK} />
          <ellipse cx="133" cy="128" rx="9" ry="4" fill={tongue} />
        </g>
      );
    case "o":
      return <ellipse cx="133" cy="121" rx="6.5" ry="7.5" fill={INK} />;
    case "gasp":
      return (
        <g>
          <ellipse cx="133" cy="123" rx="10" ry="13" fill={INK} />
          <ellipse cx="133" cy="131" rx="6" ry="3.5" fill={tongue} />
        </g>
      );
    case "wavy":
      return stroke("M118 124 Q124 116 130 123 Q136 130 142 122 Q146 117 150 122");
    case "flat":
      return stroke("M121 121 L146 120");
    case "smirk":
      return stroke("M118 122 Q134 126 149 111");
    case "kiss":
      return stroke("M129 111 Q140 114 133 119 Q140 124 129 127");
    case "tongue":
      return (
        <g>
          <path d="M127 121 Q126 138 135 138 Q145 138 144 120 Z" fill={tongue} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
          {stroke("M115 115 Q133 127 152 110")}
        </g>
      );
    case "grimace":
      return (
        <g>
          <rect x="114" y="111" width="38" height="17" rx="7" fill="var(--jm-white)" stroke={INK} strokeWidth="4" />
          <path d="M114 119.5 H152 M123.5 111 V128 M133 111 V128 M142.5 111 V128" stroke={INK} strokeWidth="2.5" />
        </g>
      );
    case "tiny":
      return stroke("M126 120 Q133 125 140 120");
  }
}

function Brows({ kind }: { kind: BrowKind }) {
  const d = {
    // The front brow overlaps the top of its eye: the body's outline runs just above it.
    angry: ["M72 69 L110 82", "M120 40 L148 30"],
    sad: ["M72 82 L110 70", "M120 30 L148 40"],
    raised: ["M74 74 Q92 62 110 72", "M121 35 Q134 25 147 33"],
    oneup: ["M74 78 L110 77", "M119 30 Q133 18 148 28"],
  }[kind];
  return (
    <g className="jm-brows" fill="none" stroke={INK} strokeWidth="5.5" strokeLinecap="round">
      <path d={d[0]} />
      <path d={d[1]} />
    </g>
  );
}

const drop = (x: number, y: number, s: number, key?: string) => (
  <path key={key} d={`M${x} ${y - s} Q${x + s * 0.75} ${y + s * 0.15} ${x} ${y + s * 0.6} Q${x - s * 0.75} ${y + s * 0.15} ${x} ${y - s} Z`} fill="var(--jm-sweat)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
);
const heartPath = (x: number, y: number, k: number) => `M${x} ${y + k * 0.85} C${x - k * 1.25} ${y + k * 0.05}, ${x - k * 0.7} ${y - k * 0.95}, ${x} ${y - k * 0.32} C${x + k * 0.7} ${y - k * 0.95}, ${x + k * 1.25} ${y + k * 0.05}, ${x} ${y + k * 0.85} Z`;
const sparkPath = (x: number, y: number, s: number) => `M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z`;

/** Touches on the face itself (blush, tears, sweat, the anger mark, sunglasses): shown even in the bust. */
function FaceTouches({ touches }: { touches: Touch[] }) {
  return (
    <g className="jm-touches">
      {touches.includes("blush") ? (
        <g className="jm-blush" fill="var(--jm-blush)">
          <ellipse cx="70" cy="132" rx="10" ry="5.5" />
          <ellipse cx="160" cy="126" rx="9" ry="5" />
        </g>
      ) : null}
      {touches.includes("tear") ? <g className="jm-tear">{drop(102, 134, 7)}</g> : null}
      {touches.includes("stream") ? (
        <g className="jm-stream" fill="none" stroke="var(--jm-sweat)" strokeWidth="7" strokeLinecap="round">
          <path d="M84 126 Q80 150 86 176" />
          <path d="M142 80 Q148 92 146 104" />
        </g>
      ) : null}
      {touches.includes("tearsJoy") ? (
        <g className="jm-joy">
          {drop(60, 98, 7, "a")}
          {drop(160, 54, 6, "b")}
        </g>
      ) : null}
      {touches.includes("sweat") ? <g className="jm-sweat-drop">{drop(166, 60, 7)}</g> : null}
      {touches.includes("vein") ? (
        <g className="jm-vein" fill="none" stroke="var(--jm-angry)" strokeWidth="4" strokeLinecap="round">
          <path d="M150 70 Q156 76 162 70" />
          <path d="M150 84 Q156 78 162 84" />
          <path d="M148 72 Q154 77 148 82" />
          <path d="M164 72 Q158 77 164 82" />
        </g>
      ) : null}
      {touches.includes("shades") ? (
        <g className="jm-shades">
          <path d="M66 88 Q66 82 72 82 H112 Q118 82 117 88 L114 106 Q113 114 105 114 H80 Q70 114 68 106 Z" fill={INK} />
          <path d="M114 58 Q114 52 120 52 H148 Q154 52 153 58 L151 72 Q150 78 144 78 H124 Q117 78 116 72 Z" fill={INK} />
          <path d="M117 88 Q118 72 116 64" fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round" />
          <path d="M76 90 L86 90 M122 58 L130 58" stroke="var(--jm-white)" strokeWidth="3" strokeLinecap="round" opacity="0.7" />
        </g>
      ) : null}
    </g>
  );
}

/** Touches around Juel (hearts, ?, !, stars, steam, a party hat): the full figure only. */
function AroundTouches({ touches }: { touches: Touch[] }) {
  return (
    <g className="jm-around">
      {touches.includes("hearts") ? (
        <g className="jm-hearts" fill="var(--jm-heart)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round">
          <path d={heartPath(200, 46, 11)} />
          <path d={heartPath(222, 22, 8)} />
          <path d={heartPath(30, 50, 9)} />
        </g>
      ) : null}
      {touches.includes("heart") ? <path className="jm-kiss-heart" d={heartPath(168, 100, 8)} fill="var(--jm-heart)" stroke={INK} strokeWidth="2.5" /> : null}
      {touches.includes("question") ? (
        <g className="jm-question" fill="none" stroke={INK} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M184 22 Q184 8 197 8 Q210 8 210 20 Q210 30 198 33 L198 42" />
          <circle cx="198" cy="54" r="3.5" fill={INK} />
        </g>
      ) : null}
      {touches.includes("exclaim") ? (
        <g className="jm-exclaim" stroke={INK} strokeWidth="7" strokeLinecap="round">
          <path d="M200 8 L198 36" />
          <circle cx="197" cy="50" r="4" fill={INK} strokeWidth="0" />
        </g>
      ) : null}
      {touches.includes("orbit") ? (
        <g className="jm-orbit" style={{ transformOrigin: "120px 34px" }}>
          {[0, 120, 240].map((a) => (
            <path key={a} d={sparkPath(120 + Math.cos((a * Math.PI) / 180) * 46, 34 + Math.sin((a * Math.PI) / 180) * 12, 8)} fill="var(--jm-star)" stroke={INK} strokeWidth="2" />
          ))}
        </g>
      ) : null}
      {touches.includes("boom") ? (
        <g className="jm-boom" stroke={INK} strokeWidth="3">
          <circle cx="120" cy="22" r="16" fill="var(--jm-boom)" />
          <circle cx="98" cy="28" r="12" fill="var(--jm-boom)" />
          <circle cx="142" cy="26" r="13" fill="var(--jm-boom)" />
          <circle cx="112" cy="8" r="10" fill="var(--jm-body)" />
          <circle cx="134" cy="10" r="9" fill="var(--jm-body)" />
        </g>
      ) : null}
      {touches.includes("steam") ? (
        <g className="jm-steam" fill="var(--jm-soft)">
          <circle cx="46" cy="22" r="9" />
          <circle cx="36" cy="12" r="6" />
          <circle cx="210" cy="78" r="9" />
          <circle cx="222" cy="68" r="6" />
        </g>
      ) : null}
      {touches.includes("puffs") ? (
        <g className="jm-puffs" fill="var(--jm-soft)">
          <circle cx="30" cy="118" r="8" />
          <circle cx="18" cy="110" r="5.5" />
          <circle cx="222" cy="100" r="7" />
        </g>
      ) : null}
      {touches.includes("sparks") ? (
        <g className="jm-sparks">
          {[[18, 40, 11], [226, 132, 9], [110, 14, 8]].map(([x, y, k]) => (
            <path key={`${x}`} className="jm-spark" d={sparkPath(x, y, k)} fill="var(--jm-body)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
          ))}
        </g>
      ) : null}
      {touches.includes("party") ? (
        <g className="jm-party">
          <path d="M48 44 L70 2 L86 52 Z" fill="var(--jm-hat)" stroke={INK} strokeWidth="3.5" strokeLinejoin="round" />
          <path d="M56 30 L80 36 M62 18 L76 22" stroke="var(--jm-white)" strokeWidth="4" strokeLinecap="round" />
          <circle cx="70" cy="3" r="5" fill="var(--jm-white)" stroke={INK} strokeWidth="2.5" />
          <g className="jm-confetti">
            {[[18, 70, "#ef4b5c", 20], [212, 30, "#4b8cef", -30], [226, 96, "#3fbf7f", 45], [20, 130, "#f9b70b", -15], [180, 14, "#ef4b5c", 60], [104, 6, "#3fbf7f", 10]].map(([x, y, c, a]) => (
              <rect key={`${x}-${y}`} x={Number(x) - 4} y={Number(y) - 2} width="8" height="4" rx="1" fill={String(c)} transform={`rotate(${a} ${x} ${y})`} />
            ))}
          </g>
        </g>
      ) : null}
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
  if (pose === "speak")
    // Opens with the voice: --jm-mouth (0 to 1) scales a round mouth from a line to wide open.
    return (
      <g className="jm-mouth-speak" style={{ transformOrigin: "133px 119px" }}>
        <ellipse cx="133" cy="119" rx="11" ry="9" fill={INK} />
        <ellipse cx="133" cy="124" rx="7" ry="3.5" fill={tongue} />
      </g>
    );
  if (pose === "shake") return <path d="M120 121 Q133 116 146 121" fill="none" stroke={INK} strokeWidth="4.5" strokeLinecap="round" />;
  if (pose === "jump") return <ellipse cx="133" cy="120" rx="7" ry="8" fill={INK} />;
  if (pose === "cheer" || pose === "thumbs" || pose === "dance" || pose === "flip" || pose === "tada" || pose === "wiggle")
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
  if (pose === "dance")
    return (
      <g className="jm-extra jm-notes" fill="var(--jm-soft)" stroke="var(--jm-soft)" strokeWidth="3" strokeLinecap="round">
        <path d="M206 44 V22 L220 18 V38" fill="none" />
        <ellipse cx="202" cy="45" rx="5" ry="4" />
        <ellipse cx="216" cy="39" rx="5" ry="4" />
        <path d="M30 40 V22" fill="none" />
        <ellipse cx="26" cy="41" rx="5" ry="4" />
      </g>
    );
  if (pose === "float")
    return <ellipse className="jm-extra jm-float-shadow" cx="120" cy="232" rx="46" ry="5" fill="var(--jm-soft)" opacity="0.35" />;
  if (pose === "cheer" || pose === "thumbs" || pose === "tada" || pose === "flip") {
    const star = (x: number, y: number, s: number, key: string) => (
      <path key={key} className="jm-spark" d={`M${x} ${y - s} Q${x + s * 0.18} ${y - s * 0.18} ${x + s} ${y} Q${x + s * 0.18} ${y + s * 0.18} ${x} ${y + s} Q${x - s * 0.18} ${y + s * 0.18} ${x - s} ${y} Q${x - s * 0.18} ${y - s * 0.18} ${x} ${y - s} Z`} fill="var(--jm-body)" stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    );
    return <g className="jm-extra jm-sparks">{pose === "cheer" || pose === "tada" || pose === "flip" ? [star(18, 40, 11, "a"), star(226, 132, 9, "b"), star(110, 14, 8, "c")] : [star(230, 60, 9, "a"), star(22, 70, 8, "b")]}</g>;
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

/** Poses where a hand touches the face (chin, eyes, cheeks, belly) and so is drawn over the body. */
const HAND_IN_FRONT = new Set<JuelPose>(["think", "facepalm", "shocked", "scared", "laugh"]);

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

const LOOK: Partial<Record<JuelPose, Pt>> = { think: [-0.5, -0.8], oops: [0, 0.5], listen: [-0.7, -0.1], point: [0.8, -0.3], cheer: [0.2, -0.5], thumbs: [0.4, -0.2], wave: [0.35, -0.35], dance: [0.3, -0.4], float: [0, -0.6], flip: [0, -0.8], tada: [0.3, -0.4], jump: [0, -0.7], peek: [-0.4, -0.3], speak: [-0.4, 0] };

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

  const face = faceOf(pose);
  const eyes = pointer || look || face?.look || LOOK[pose] || [0.25, -0.25];
  const closed = pose === "sleep";
  const arms = face ? face.arms || { left: DOWN_L, right: DOWN_R } : ARMS[pose as keyof typeof ARMS] || { left: DOWN_L, right: DOWN_R };
  const [frontEye, backEye]: [EyeKind, EyeKind] = face ? (Array.isArray(face.eyes) ? face.eyes : [face.eyes, face.eyes]) : ["open", "open"];
  const tint = face?.tint ? { ["--jm-body" as string]: face.tint === "red" ? "#ff7b4a" : "#b9d35b", ["--jm-body-shade" as string]: face.tint === "red" ? "#e2502a" : "#93b23c", ["--jm-body-light" as string]: face.tint === "red" ? "#ffb08e" : "#dcee9c" } : undefined;
  // The bust is just the body, eyes and mouth: at icon sizes the arms and feet are noise.
  const viewBox = framing === "bust" ? "36 34 178 158" : "0 0 240 240";
  const width = framing === "bust" ? (size * 178) / 158 : size;
  return (
    <svg
      ref={root}
      className={`jm${swap ? " is-swap" : ""}${face ? " is-emotion" : ""} ${className}`.trim()}
      data-pose={pose}
      style={tint}
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
        {framing === "full" ? (face ? <AroundTouches touches={face.touches || []} /> : <Extras pose={pose} />) : null}
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
          {/* Arms come out from behind the body, as in the drawing; only a hand on the face goes in front. */}
          {framing === "full" ? <Arm className="jm-arm-l" from={SHOULDER_L} {...arms.left} /> : null}
          {framing === "full" && !HAND_IN_FRONT.has(pose) ? <Arm className="jm-arm-r" from={SHOULDER_R} {...arms.right} /> : null}
          {/* The second eye peeks over the top edge, behind the body. */}
          <Eye className="jm-eye-back" cx={133} cy={63} r={19} look={eyes} closed={closed} kind={backEye} side="back" />
          <path d={BODY} fill="var(--jm-body)" />
          <g clipPath={`url(#jm-body-${uid})`}>
            {/* Shade along the left and bottom edges, a highlight along the top: the drawing's soft bevel. */}
            <path d={`M${TL[0]} ${TL[1]} L${BL[0]} ${BL[1]} L${TIP[0]} ${TIP[1]}`} fill="none" stroke="var(--jm-body-shade)" strokeWidth="20" strokeLinejoin="round" />
            <path d={`M${TL[0] + 8} ${TL[1] + 6} L${TIP[0] - 10} ${TIP[1] - 3}`} fill="none" stroke="var(--jm-body-light)" strokeWidth="7" strokeLinecap="round" />
          </g>
          <path d={BODY} fill="none" stroke={INK} strokeWidth="6" strokeLinejoin="round" />
          <Eye className="jm-eye-front" cx={92} cy={101} r={26} look={eyes} closed={closed} kind={frontEye} side="front" />
          {face ? <EmotionMouth kind={face.mouth} /> : <Mouth pose={pose} />}
          {face?.brows ? <Brows kind={face.brows} /> : null}
          {face?.touches?.length ? <FaceTouches touches={face.touches} /> : null}
          {framing === "full" && HAND_IN_FRONT.has(pose) ? <Arm className="jm-arm-r" from={SHOULDER_R} {...arms.right} /> : null}
        </g>
      </g>
    </svg>
  );
}
