// Promo Studio styles: the look of a film, chosen on top of a template (which sets structure and pacing).
// Adapted from the fifteen motion-design styles of github.com/Vincentwei1021/mg-styles-15 (MIT): each
// style's signature features and key techniques, rewritten for our renderer (one HTML page drawn by a pure
// seek(t), 2D canvas, SVG and CSS 3D, no WebGL) and for the user's own material instead of the demo's story.
// `sound` is the mgaudio recipe slug that scores it (scripts/promo_score.py); `bpm` drives the beat grid the
// film is cut to. `allows` lifts the Promo Studio bans this look depends on (see server/promoStudio.js).
// Shared by the page and the server.

export const PROMO_STYLE_SPRITE = { url: "/assets/promo/styles.webp", cols: 5, tile: [320, 180] };

export const PROMO_STYLES = [
  {
    id: "cel-boil",
    name: "Hand-drawn",
    blurb: "Frame-by-frame ink that boils, cel smoke and sparks on paper",
    sound: "05-cel-boil",
    bpm: 84,
    allows: ["bounce"],
    look: `Frame-by-frame cel animation with line boil, the Buck / Giant Ant hybrid: clean shapes with hand-drawn cel effects.
- Warm paper ground with a 10-15% paper-grain multiply; ink-black linework drawn as variable-width brush strokes (a centreline with pressure, filled as an outline polygon on canvas); fills slightly off-register like hand colouring. Palette of 3-4 colours: ink, the brand's accent, one warm second colour, paper.
- Line boil: every line keeps 3-4 slightly jittered variants and switches between them every 2 frames (pick the variant from Math.floor(t * 12) with M.hash, never from state), so the picture breathes even on holds.
- Timing on 2s: quantise motion time to 12 fps (tq = Math.floor(t * 12) / 12) for character and object motion; go to 1s (24 fps) only for fast actions and hold on 3s (8 fps) for still moments.
- Smear frames: on a fast move, one frame stretches the object 150-300% along its path.
- Cel effects drawn by hand around the subject: smoke puffs that curl, sparks, star bursts, speed lines, splashes. Title and key words are hand-lettered and keep boiling on their hold.
- Squash, stretch, anticipation and overshoot are part of the style here.`,
  },
  {
    id: "isometric",
    name: "Isometric",
    blurb: "A miniature 2.5D world that builds itself, tile by tile",
    sound: "03-isometric",
    bpm: 112,
    allows: ["bounce"],
    look: `Isometric 2.5D: the subject shown as a miniature world (a city, an office cut-away, a data campus, the product's features as little buildings).
- True isometric projection with no vanishing point: build faces with SVG transforms (scaleY 86.6%, skew ±30°, rotate ∓30°) or CSS 3D with rotateX(54.736deg) rotateZ(45deg) and no perspective. Depth order follows screen y.
- Soft pastel studio palette built from the brand's colours (a light ground, 3-4 tints, white), with soft drop shadows and a touch of ambient occlusion where blocks meet.
- Building grows: the base lands, walls rise with scaleY from 0 and a small overshoot, the roof caps 2-3 frames later; trees and props pop; windows light in sequence.
- Life loops: little cars along roads, packets travelling between buildings, a turbine or fan turning, data lines pulsing.
- Camera moves are parallel slides of the whole group (never rotation), with foreground, middle and background layers at 1 : 0.8 : 0.6 speed. End by pulling back to show the whole island as a composed poster.
- The product's real screens can sit on isometric panels inside the world; labels on leader lines.`,
  },
  {
    id: "flat-vector",
    name: "Flat vector",
    blurb: "Bold colour fields, geometric characters, springy explainer motion",
    sound: "01-flat-vector",
    bpm: 122,
    allows: ["bounce"],
    look: `Flat vector motion graphics, the classic Google / Motion Ocean explainer form at showreel polish.
- Solid colour fields and geometric shapes, no outlines or very thin ones, no gradients; a saturated palette from the brand's colours plus two or three bold companions; generous empty space.
- Geometric characters built from shapes, limbs rigged to rotate about anchor points (shoulder, elbow, neck), with blinks and head bobs.
- Elastic easing is the soul of the style: entrances go anticipation, push, overshoot, settle (cubic-bezier(0.34,1.56,0.64,1) or a lively spring) with about 10% squash and stretch on moves.
- Stagger entrances by 2-4 frames and let only one subject move at a time.
- Transitions are shape wipes (a colour block sweeps the frame) or elements flying out to carry the cut; one continuous camera through the film feels best.
- Icons burst in rhythm: a bar chart grows, a check mark draws, a heart pops.`,
  },
  {
    id: "line-art",
    name: "Line art",
    blurb: "One continuous line draws the whole story, then fills",
    sound: "02-line-art",
    bpm: 72,
    allows: ["glow"],
    look: `Line art: a single thin line is the only drawing tool, and it draws the whole film in one stroke.
- Deep near-black or deep brand-dark ground with ONE line colour (the brand accent or a champagne gold), constant width 2-4 px, round caps; a softly glowing pen tip leads the draw.
- Draw-on with SVG stroke-dasharray / stroke-dashoffset from the path length measured once at load; the draw slows into corners (cubic-bezier(0.65,0,0.35,1)).
- One-line narrative: the tail of each figure is the start of the next, so objects grow into each other (a seed into a tree into a building into a skyline into the logo).
- A virtual camera follows the pen tip with gentle drift and push, then dollies out at the end to show the whole drawing composed as a poster; older segments dim to about 35%.
- Line-to-fill moment: once the logo's outline closes, it fills from its anchor. Type is a thin, widely set serif or light sans, and appears last.
- Calm and luxurious: lots of negative space, no fast moves.`,
  },
  {
    id: "3d-render",
    name: "Soft 3D",
    blurb: "Candy-soft 3D shapes, cloner waves, jelly logo drop",
    sound: "04-3d-render",
    bpm: 118,
    allows: ["bounce"],
    look: `Soft 3D in the C4D / Octane pastel product-ident look, built with CSS 3D and canvas shading (no WebGL).
- An infinite pastel studio backdrop (a sweep with a soft floor-to-wall gradient), big soft light from one side, gentle contact shadows under every object.
- Objects read as soft, glossy materials: rounded pills, spheres and inflated letters shaded with layered radial gradients (a bright specular highlight, a soft core, a darker rim) so they look like candy rubber, glossy plastic, or frosted glass.
- A cloner field: a grid of identical rounded pills or spheres ripples with a wave effector (each element's height and scale from a sine of distance and time).
- The hero (the brand's wordmark or logo as inflated 3D letters, extruded with stacked layers) drops in with a damped-spring jiggle, squash on landing, and pushes the field aside.
- Long-tail camera ease: 80% of a move in its first 20%, then a very slow settle; shallow depth of field by blurring far layers. End on a clean hero composition.`,
  },
  {
    id: "morph",
    name: "Shape morph",
    blurb: "One shape keeps becoming the next idea, on the beat",
    sound: "08-morph",
    bpm: 140,
    allows: [],
    look: `Shape morphing, keynote grade: one hero shape continuously becomes the next meaningful shape, on the beat.
- A chain of 6-8 shapes that tell the subject's story (for example a cup becomes a sun becomes a pin becomes the logo); every change happens on a beat.
- Morph paths in code: give both shapes the same number of points by resampling each outline to N points (N around 120) with the first point at the same angle, then interpolate point by point; never let the outline knot or self-intersect.
- Complex A to B goes through a simple intermediate (circle or capsule): A to circle, circle to B, each about 8-12 frames, with a slight rotation and 10-15% squash and stretch.
- Speed curve fastest mid-morph (cubic-bezier(0.7,0,0.3,1)) with a 3-frame cushion at both ends; sub-parts morph in sync.
- Background colour fields change with each morph through clean colour-block wipes; a single bold shape, flat colour, plenty of space.
- The final morph lands on the brand's logo and wordmark.`,
  },
  {
    id: "sticker-explainer",
    name: "Sticker explainer",
    blurb: "Photo stickers, exact charts, one long camera over a big canvas",
    sound: "19-paperclip",
    bpm: 112,
    allows: [],
    look: `Bold-outline sticker explainer (the PaperClip knowledge-video look): serious, dense, precise.
- One huge canvas (about 4x the frame) with a camera transform that pans and zooms between information points on long eases; one continuous move through the film.
- Real images become stickers: cut-out or framed photos with an 8-12 px white outline and a soft shadow, so images from different sources look like one set.
- Calm cool ground (blue-grey or off-white) with 2-3 colours plus one accent from the brand; equal-weight sans typography, strict alignment.
- Flat icons and exact charts: bars grow to scale, numbers count up and settle on the real value, routes and paths draw on. Only real numbers from the material.
- Every beat introduces one new visual element with a leader-line label; finish by pulling out to a bold typographic title card (heavy sans, a huge number or name, a small caption).`,
  },
  {
    id: "hud",
    name: "Sci-fi HUD",
    blurb: "Film-grade interface: rings, radar, data, lock-on",
    sound: "22-hud",
    bpm: 110,
    allows: ["hud", "glow", "rgbSplit", "uppercase"],
    look: `Cyberpunk HUD / fictional UI at film-UI grade (Territory Studio density and restraint).
- Deep teal-black ground; cyan linework (or the brand's cool colour) with an orange or red alert state for the payoff moment.
- Layers that build in hierarchical, staggered order with stroke draw-on: a hex grid, concentric rings with ticks rotating at different speeds, a radar sweep (conic gradient) with blips, sparkline graphs, data columns.
- Monospace numbers jump through seeded values for 3-5 frames, then settle on the real figure; status lines type on with a blinking cursor.
- A central wireframe object (a globe or the product's shape) drawn as projected points and lines on a 2D canvas, slowly rotating, with scanlines.
- Lock-on: four corner brackets shrink from 1.4 to 1.0 onto the subject (fast out, slow in), then the palette flips to alert colour with a short status line.
- Finish: a tight glow on lines, slight chromatic aberration, scanlines, and rare restrained micro-glitches. Real facts from the material fill the data fields.`,
  },
  {
    id: "collage",
    name: "Collage",
    blurb: "Cut-out paper, halftone photos, stop-motion jitter",
    sound: "06-collage",
    bpm: 84,
    allows: ["shake", "uppercase"],
    look: `Collage / cut-out animation: surreal Dada and Monty Python cut-outs with a modern magazine finish.
- Newsprint or kraft paper ground; photos (the user's images) as cut-outs with a rough 2-4 px white scissor edge and a halftone dot texture (an SVG pattern or canvas dots); torn-paper strips, tape, hand-drawn doodles and stamps layered on top.
- Layer order: paper ground, big colour shapes, photo cut-outs, doodles and tape, then a grain layer.
- Puppet motion: parts hinge at shoulders, elbows and jaws; a mouth opens and closes with two or three replacement shapes.
- Stop-motion timing: quantise motion to 12 fps (6 fps for some holds) and add ±2 px seeded placement jitter per step, like hands moving paper.
- Bold constructivist type set on diagonals in black and one strong colour; hands slap elements onto the page; transitions are a page flip or a torn-paper reveal.`,
  },
  {
    id: "aurora-glass",
    name: "Aurora glass",
    blurb: "Slow drifting light, frosted glass cards, liquid lens",
    sound: "12-aurora-glass",
    bpm: 78,
    allows: ["aurora", "glass", "glow", "gradientType"],
    look: `Aurora gradients and glassmorphism, the 2025-26 AI product launch look: slow, translucent, expensive.
- A deep dark base with 4-5 large blurred colour blobs (filter: blur 80-150 px) drifting on slow curved paths and blending into a mesh gradient. Adjacent hues only, taken from the brand (for example violet, blue, cyan); never complementary colours. Add 3-5% noise to prevent banding.
- Frosted glass cards: backdrop-filter blur 20-40 px, 5-10% white fill, a 1 px 30% white inner highlight, large radius; they float in with parallax depth and a slight 3D tilt.
- The product's real interface lives inside the glass cards (messages, toggles, waveforms, numbers) and animates with opacity plus an 8 px rise only.
- One wow moment: a glass lens glides across and magnifies what is behind it (a scaled copy clipped to a circle with a bright rim).
- Sine and breathing easing everywhere; nothing fast. Light, elegant sans type.`,
  },
  {
    id: "bauhaus",
    name: "Bauhaus",
    blurb: "Primary shapes on a strict grid, one move per beat",
    sound: "09-bauhaus",
    bpm: 124,
    allows: ["uppercase"],
    look: `Geometric Bauhaus kinetic poster: mechanical, rational, musical.
- Cream paper ground (#F1E9DA) with red, yellow, blue and black (swap one primary for the brand's accent if it is close); a strict modular grid where every move is a whole number of modules and every landing is on a grid line.
- Basic shapes only: circles, quarter circles, semicircles, triangles, squares and bars.
- One action per beat: a quarter circle rotates 90° about its corner, a semicircle slides one module, a triangle flips, a square splits. Rotation pivots alternate between the shape's centre, a corner, and the frame's centre.
- Easing is restrained (ease-in-out quad or linear); no overshoot, ever. The mechanical feel is the point.
- A phase-shifted cascade wave runs across the grid on the drop; at the end everything freezes into a perfect poster with Swiss typography (a heavy geometric sans set vertically, a small caps line).
- Subtle paper tooth texture.`,
  },
  {
    id: "synthwave",
    name: "Synthwave",
    blurb: "Neon grid, striped sun, chrome title, VHS finish",
    sound: "10-synthwave",
    bpm: 100,
    allows: ["flare", "rgbSplit", "glow", "gradientType", "uppercase"],
    look: `80s synthwave and VHS: the outrun title sequence.
- Deep purple night sky gradient with stars; a striped retro sun (horizontal bands cut out, magenta to orange to yellow); wireframe mountains and palm silhouettes; a neon magenta and cyan perspective grid rushing toward the camera (draw it on a 2D canvas: horizontal lines spaced by perspective and scrolling with t, vertical lines converging to the vanishing point).
- Chrome title: the brand name in a multi-stop metallic gradient with a bevel highlight and a star glint sweeping across; it slams in with a lens flare on the drop. A second word writes on in pink neon script like a neon tube, with flicker.
- Double glow on neon: a tight 4 px glow plus a wide 30 px low-opacity glow.
- VHS finish: red and blue channels offset 1-2 px, scanlines (2 px apart at 10% black), one or two brief tracking glitches per second, chroma bleed; a PLAY ▶ on-screen display in the opening second.
- Product screens, if shown, sit in neon-edged frames riding the grid.`,
  },
  {
    id: "pixel",
    name: "Pixel art",
    blurb: "8-bit sprites, parallax layers, chiptune energy",
    sound: "20-pixel",
    bpm: 150,
    allows: [],
    look: `Pixel art / 8-bit: a retro side-scroller title sequence.
- Draw on a 2D canvas at 320x180 (or 180x320 for vertical) and scale it up by a whole number with image-rendering: pixelated and imageSmoothingEnabled = false. Everything sits on whole pixels.
- A limited palette of 16-32 colours (built around the brand's colours), with dithered gradients for the sky.
- 3-4 parallax layers (sky, far hills, mid ground, near tiles) moving by whole pixels at different speeds.
- Sprites authored as pixel arrays in code: a hero (the brand mascot or a character standing for the user) with a 6-8 frame run cycle at 10-12 fps, jumps, coins with sparkles, a chest that opens with a light burst.
- Stepped timing only: sprite motion uses steps, never smooth easing.
- A dialogue box that types the key message in a pixel font; a chunky pixel logo drops in with a shine sweep. Optional CRT pass (scanlines, slight vignette) that never blurs the pixels.`,
  },
  {
    id: "liquid",
    name: "Liquid",
    blurb: "Glossy blobs that merge, splash, and pour into the logo",
    sound: "07-liquid",
    bpm: 150,
    allows: ["bounce", "gradientType"],
    look: `Liquid motion: glossy, organic, high energy.
- A deep ground (plum, navy, or the brand's darkest colour) with glossy candy liquid in 2-3 adjacent brand hues, lit so it reads as thick 3D liquid: a specular highlight and a rim light on each blob.
- Metaballs: blobs drawn in an SVG group with a goo filter (feGaussianBlur around 20 px, then feColorMatrix to sharpen the alpha), so blobs that come close fuse with stretched necks; a highlight layer on top.
- Stretch, snap and rebound: when a blob leaves, a thin neck stretches, snaps, and both ends rebound for 2-3 frames; secondary droplets follow 2-3 frames late; drops squash flat on landing.
- Transitions are a liquid wave flooding the frame, its front shaped by 3-5 phase-offset bulges.
- Ease like a fling, never uniform (cubic-bezier(0.22,1,0.36,1)). The liquid finally coalesces into the brand's wordmark; a last drip falls and ripples.`,
  },
  {
    id: "variety-captions",
    name: "Variety captions",
    blurb: "Variety-show pop captions, bursts and stamps over the footage",
    sound: "18-hanazi",
    bpm: 128,
    allows: ["bounce", "captions", "shake", "rainbowType"],
    look: `Variety-show kinetic captions (花字): the reactive caption packaging of TV variety shows and vlogs.
- A base that feels like footage: the user's images fill the frame with slow Ken Burns moves, a subtle handheld drift, and snap punch-in zooms on key moments.
- Captions are the stars: chunky rounded heavy type in three layers (a gradient or bright fill, a thick white stroke, a coloured outer stroke and drop shadow), built with stacked text-shadow or SVG paint-order stroke.
- Pop entrance: scale 0 to 1.15 to 1.0 in about 8 frames, per-character bounce staggered by 2 frames, a slight rotation; while holding, a gentle wiggle.
- Emotion-matched decorations drawn in SVG: a radial burst frame with speed lines for surprise, sweat drops, sparkles, question marks that bounce, a rubber stamp for the payoff.
- High-saturation pink, yellow and cyan (or the brand's brightest colours) with white strokes; captions land 2-3 frames after the moment they react to.`,
  },
];

export const findPromoStyle = (id) => PROMO_STYLES.find((style) => style.id === id) || null;

/** Where a style's picker tile sits in the sprite (percentages for background-position), or null. */
export function promoStyleTile(id) {
  const index = PROMO_STYLES.findIndex((style) => style.id === id);
  if (index < 0) return null;
  const { cols } = PROMO_STYLE_SPRITE;
  const rows = Math.ceil(PROMO_STYLES.length / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: cols > 1 ? (col / (cols - 1)) * 100 : 0, y: rows > 1 ? (row / (rows - 1)) * 100 : 0, cols, rows };
}
