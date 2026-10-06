// Voice treatment presets for Vibe Edit, ported from Donkey Cut's effects kit
// (Apache-2.0, github.com/donkeycut/donkey). One description drives both the
// browser preview (Web Audio biquads + compressor) and the export (ffmpeg
// equalizer/acompressor/alimiter), so what you hear while editing is what the
// render writes. Shared by the client and server, so plain JS.

/** Fixed band layout: a shelf at each end and peaks where speech lives. */
export const SOUND_EQ_BANDS = [
  { hz: 100, type: "lowshelf" },
  { hz: 200, type: "peaking" },
  { hz: 400, type: "peaking" },
  { hz: 1000, type: "peaking" },
  { hz: 3000, type: "peaking" },
  { hz: 5000, type: "peaking" },
  { hz: 10000, type: "highshelf" },
];

const dynamics = (ratio, threshold) => ({
  compressor: { threshold, ratio, attack: 10, release: 80 },
  limiter: { ceiling: -1 },
});

export const SOUND_PRESETS = [
  { id: "flat", name: "Flat", character: "Untouched", sound: null },
  // Rough phone or room audio: rumble filtered, steady noise reduced on export, then the studio voice.
  { id: "cleanup", name: "Clean up", character: "Cuts rumble and background hiss, then evens the voice", sound: { highpass: 85, denoise: true, eq: [1, 1, -2, -1, 1.5, 1.5, 0], ...dynamics(3, -18) } },
  { id: "studio", name: "Studio", character: "Warm, clear, controlled. The talking-head default", sound: { eq: [1.5, 1, -2, -1, 1, 2, 0.5], ...dynamics(3, -18) } },
  { id: "clear-voice", name: "Clear voice", character: "Warm, clear podcast voice", sound: { eq: [2, 1, -2, -1, 1.5, 1, -1], ...dynamics(3, -18) } },
  { id: "broadcast", name: "Broadcast", character: "Polished radio voice, more compressed", sound: { eq: [1.5, 2, -2, -1, 1, 2, -0.5], ...dynamics(4, -20) } },
  { id: "warm-rich", name: "Warm & rich", character: "Deep, smooth, expensive-sounding", sound: { eq: [2, 1, -2, -1, 0.5, 1, -1], ...dynamics(3, -18) } },
  { id: "crisp-clear", name: "Crisp", character: "Bright, clean, highly intelligible", sound: { eq: [-1.5, -1, -2, 0, 2, 3, 1], ...dynamics(2.5, -18) } },
  { id: "natural", name: "Natural", character: "Balanced, close to the real voice", sound: { eq: [0.5, 0, -1, 0, 1, 1, 0], ...dynamics(2, -18) } },
  { id: "deep-voice", name: "Deep", character: "Darker and heavier without turning muddy", sound: { eq: [3, 2, -2, -1, 0, 1, -2], ...dynamics(3, -18) } },
  { id: "airy", name: "Airy", character: "Bright, open, modern creator voice", sound: { eq: [-0.5, -1, -1, 0, 1, 2, 2.5], ...dynamics(2.5, -18) } },
  { id: "cinematic", name: "Cinematic", character: "Warm, dark, intimate storytelling", sound: { eq: [2.5, 1, -2, -1, 0.5, 0, -2.5], ...dynamics(3, -20) } },
  { id: "close-asmr", name: "Close", character: "Intimate, close, detailed", sound: { eq: [2.5, 2, -1, 0, 1, 1, 1.5], ...dynamics(3, -20) } },
  { id: "phone", name: "Phone", character: "Narrow and mid-heavy, for skits and flashbacks", sound: { eq: [-10, -3, 1, 2, 3, 2, -9] } },
];

export const soundPreset = (id) => SOUND_PRESETS.find((p) => p.id === id) || null;

const fmt = (n) => String(Math.round(n * 10000) / 10000);
const linear = (db) => Math.pow(10, db / 20);

/** A preset as one ffmpeg audio filter chain, or "" when it is neutral. */
export function soundFilters(presetId) {
  const sound = soundPreset(presetId)?.sound;
  if (!sound) return "";
  const steps = [];
  if (sound.highpass) steps.push(`highpass=f=${fmt(sound.highpass)}`);
  // Spectral noise reduction is export-only; the preview plays the rest of the chain.
  if (sound.denoise) steps.push("afftdn=nr=12:nf=-30:tn=1");
  (sound.eq || []).forEach((db, i) => {
    if (Math.abs(db) < 1e-3) return;
    const band = SOUND_EQ_BANDS[i];
    if (band.type === "lowshelf") steps.push(`bass=g=${fmt(db)}:f=${band.hz}`);
    else if (band.type === "highshelf") steps.push(`treble=g=${fmt(db)}:f=${band.hz}`);
    else steps.push(`equalizer=f=${band.hz}:t=q:w=1:g=${fmt(db)}`);
  });
  if (sound.compressor) {
    const c = sound.compressor;
    steps.push(`acompressor=threshold=${fmt(linear(c.threshold))}:ratio=${fmt(c.ratio)}:attack=${fmt(c.attack)}:release=${fmt(c.release)}:makeup=${fmt(linear(-c.threshold * (1 - 1 / c.ratio) * 0.5))}`);
  }
  if (sound.limiter) steps.push(`alimiter=limit=${fmt(linear(sound.limiter.ceiling))}:attack=5:release=50:level=false`);
  return steps.join(",");
}

/** Build the same chain in Web Audio. Returns { input, output } nodes, or
 * null when the preset is neutral. */
export function buildSoundChain(ctx, presetId) {
  const sound = soundPreset(presetId)?.sound;
  if (!sound) return null;
  const nodes = [];
  if (sound.highpass) {
    const f = ctx.createBiquadFilter();
    f.type = "highpass";
    f.frequency.value = sound.highpass;
    nodes.push(f);
  }
  (sound.eq || []).forEach((db, i) => {
    if (Math.abs(db) < 1e-3) return;
    const band = SOUND_EQ_BANDS[i];
    const f = ctx.createBiquadFilter();
    f.type = band.type;
    f.frequency.value = band.hz;
    f.gain.value = db;
    if (band.type === "peaking") f.Q.value = 1;
    nodes.push(f);
  });
  if (sound.compressor) {
    const c = ctx.createDynamicsCompressor();
    c.threshold.value = sound.compressor.threshold;
    c.ratio.value = sound.compressor.ratio;
    c.attack.value = sound.compressor.attack / 1000;
    c.release.value = sound.compressor.release / 1000;
    c.knee.value = 2;
    nodes.push(c);
    const makeup = ctx.createGain();
    makeup.gain.value = linear(-sound.compressor.threshold * (1 - 1 / sound.compressor.ratio) * 0.5);
    nodes.push(makeup);
  }
  if (sound.limiter) {
    const l = ctx.createDynamicsCompressor();
    l.threshold.value = sound.limiter.ceiling;
    l.ratio.value = 20;
    l.knee.value = 0;
    l.attack.value = 0.005;
    l.release.value = 0.05;
    nodes.push(l);
  }
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return { input: nodes[0], output: nodes[nodes.length - 1] };
}
