// Video-wide looks and scene transitions for Create Video renders. A look is
// one ffmpeg filter chain laid over every scene (the way a faceless channel
// keeps one texture and grade across a whole video) plus the palette its
// motion graphics use, so cards and footage read as one piece.

export const VIDEO_LOOKS = [
  {
    id: "none",
    name: "Natural",
    detail: "The footage as it is",
    swatch: "linear-gradient(135deg,#3a3f47,#15171b)",
    filter: "",
    theme: { bg: "#0c0d10", ink: "#ffffff", muted: "rgba(255,255,255,.72)", accent: "#f9dc0b", display: "Anton", body: "Inter" },
  },
  {
    id: "paper",
    name: "Paper texture",
    detail: "Warm, grainy, archival. History and nostalgia",
    swatch: "linear-gradient(135deg,#efe3c8,#b89c6c)",
    filter: "eq=saturation=0.82:contrast=1.04,colorbalance=rs=0.07:gs=0.03:bs=-0.07:rm=0.05:bm=-0.05,noise=alls=12:allf=t,vignette=PI/5",
    theme: { bg: "#efe6d2", ink: "#2a2018", muted: "rgba(42,32,24,.68)", accent: "#a33a1c", display: "PlayfairDisplay", body: "Inter", light: true },
  },
  {
    id: "blue-minimal",
    name: "Blue minimal",
    detail: "Cool and clean. Tech, science, explainers",
    swatch: "linear-gradient(135deg,#1d3a5f,#0b1422)",
    filter: "eq=saturation=0.7:contrast=1.05,colorbalance=rs=-0.06:bs=0.1:rm=-0.03:bm=0.06,vignette=PI/6",
    theme: { bg: "#0e1a2b", ink: "#eaf2ff", muted: "rgba(234,242,255,.7)", accent: "#5aa9ff", display: "Montserrat", body: "Inter" },
  },
  {
    id: "red-glow",
    name: "Red glow",
    detail: "Hot highlights and bloom. Crime, exposés, drama",
    swatch: "radial-gradient(circle at 40% 40%,#ff4a3d,#3a0807)",
    filter: "colorbalance=rs=0.14:rm=0.08:bs=-0.06,eq=contrast=1.1:saturation=1.08,split[a][b];[b]gblur=sigma=16[g];[a][g]blend=all_mode=screen:all_opacity=0.32,vignette=PI/4",
    theme: { bg: "#120607", ink: "#ffffff", muted: "rgba(255,255,255,.72)", accent: "#ff3b30", display: "Anton", body: "Inter" },
  },
  {
    id: "red-grid",
    name: "Red grid",
    detail: "A faint investigation-board grid",
    swatch: "repeating-linear-gradient(0deg,#ff2d2d66 0 1px,transparent 1px 9px),repeating-linear-gradient(90deg,#ff2d2d66 0 1px,#161010 1px 9px)",
    filter: "colorbalance=rs=0.06:bs=-0.03,drawgrid=w=iw/12:h=iw/12:t=1:c=red@0.22,vignette=PI/4.5",
    theme: { bg: "#0d0d0d", ink: "#ffffff", muted: "rgba(255,255,255,.7)", accent: "#ff2d2d", display: "Anton", body: "Inter", grid: true },
  },
  {
    id: "deep-black",
    name: "Deep black",
    detail: "Crushed shadows, high contrast. Mystery and true crime",
    swatch: "radial-gradient(circle at 50% 45%,#4b4b4b,#000)",
    filter: "eq=contrast=1.2:brightness=-0.05:saturation=0.88,vignette=PI/3.5",
    theme: { bg: "#000000", ink: "#ffffff", muted: "rgba(255,255,255,.66)", accent: "#f9dc0b", display: "Anton", body: "Inter" },
  },
  {
    id: "gradient",
    name: "Cinematic gradient",
    detail: "Teal shadows, warm highlights, a soft falloff",
    swatch: "linear-gradient(160deg,#2c5364,#203a43 45%,#7a4a1f)",
    filter: "colorbalance=rs=-0.04:bs=0.06:rh=0.07:bh=-0.07,vignette=a=PI/4:x0=w/2:y0=h*0.65",
    theme: { bg: "#101828", ink: "#ffffff", muted: "rgba(255,255,255,.72)", accent: "#ffb547", display: "Montserrat", body: "Inter" },
  },
];

export const findLook = (id) => VIDEO_LOOKS.find((look) => look.id === id) || VIDEO_LOOKS[0];

/** The ffmpeg chain for a look, or "" for none. */
export const lookFilter = (id) => findLook(id).filter;

// Transitions run inside each scene's own clip (no overlap), so they never shift
// the narration: the cut lands where the scene starts and the effect plays on it.
export const VIDEO_TRANSITIONS = [
  { id: "cut", name: "Hard cut" },
  { id: "fade", name: "Fade through black" },
  { id: "flash", name: "White flash" },
  { id: "glitch", name: "Glitch" },
  { id: "zoom", name: "Punch zoom" },
];
export const TRANSITION_IDS = VIDEO_TRANSITIONS.map((t) => t.id);

/**
 * The tail of a scene's filter chain for its transition. `first` scenes get no
 * entrance effect; `seconds` is the scene length. `size` is [w, h] of the clip.
 *
 * @param {string} id
 * @param {{ seconds?: number, first?: boolean, size?: number[] }} [options]
 */
export function transitionFilter(id, { seconds = 0, first = false, size = [1280, 720] } = {}) {
  if (!(seconds > 0.8)) return "";
  const s = (n) => n.toFixed(2);
  switch (id) {
    case "fade":
      return `,fade=t=in:st=0:d=0.25,fade=t=out:st=${s(seconds - 0.25)}:d=0.25`;
    case "flash":
      return first ? "" : ",fade=t=in:st=0:d=0.22:color=white";
    case "glitch":
      return first ? "" : ",rgbashift=rh=-14:bh=14:enable='lt(t,0.14)',noise=alls=34:allf=t:enable='lt(t,0.14)'";
    case "zoom": {
      if (first) return "";
      // Starts 8% in and settles to the frame over the first 0.35s.
      const [w, h] = size;
      return `,scale=w='${w}*(1+0.08*max(0,1-t/0.35))':h='${h}*(1+0.08*max(0,1-t/0.35))':eval=frame,crop=${w}:${h}`;
    }
    default:
      return "";
  }
}
