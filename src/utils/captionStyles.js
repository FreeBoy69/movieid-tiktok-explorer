// Burned-in caption styles for rendered videos: a catalog of looks, a word
// chunker that follows the narrator's timing, and an ASS (SubStation Alpha)
// writer that libass burns in with ffmpeg's `ass` filter. Fonts are embedded
// in the ASS file so the render worker needs nothing installed.
//
// Styles are adapted from open-source caption projects, credited per entry:
// - nicolaigaina/ai-video-captions (MIT): hormozi, mrbeast, karaoke, minimal, bounce, classic
// - vshukla7/remotion-captions-themes (MIT): podcast, one-word, pill, soft, grape
// - muneebkhan08/Capite (MIT): crimson-pop, swiss, amber, ali-abdaal, vox, luxury, cyberpunk,
//   cinema-noir, terminal, creator-pop, warm-pastel, urban-rebel, nordic, podcast-viral,
//   wealth, dark-documentary, storyteller, dark-psychology, kapwing, neon-cyber, retro-glitch,
//   cinema-gold, tiktok-hype
// - the GitHub Signals TikTok format: signal
// - AutoYT house looks (from Vibe Edit): clean, bubble

export const CAPTION_SOURCES = [
  { id: "ai-video-captions", name: "ai-video-captions", author: "nicolaigaina", license: "MIT", url: "https://github.com/nicolaigaina/ai-video-captions" },
  { id: "remotion-captions-themes", name: "remotion-captions-themes", author: "vshukla7", license: "MIT", url: "https://github.com/vshukla7/remotion-captions-themes" },
  { id: "capite", name: "Capite", author: "muneebkhan08", license: "MIT", url: "https://github.com/muneebkhan08/Capite" },
  { id: "github-signals", name: "GitHub Signals repo spotlights", author: "github.signals", license: "format reference only", url: "https://www.tiktok.com/@github.signals" },
  { id: "autoyt", name: "AutoYT house looks", author: "AutoYT", license: "original", url: "https://autoyt.cc" },
];

// Fonts shipped in public/fonts/captions (SIL Open Font License) and embedded per render.
export const CAPTION_FONTS = {
  Montserrat: "Montserrat.ttf",
  "Bebas Neue": "BebasNeue.ttf",
  Anton: "Anton.ttf",
  Bangers: "Bangers.ttf",
  Outfit: "Outfit.ttf",
  Inter: "Inter.ttf",
  "Plus Jakarta Sans": "PlusJakartaSans.ttf",
  Syne: "Syne.ttf",
  "Playfair Display": "PlayfairDisplay.ttf",
  Orbitron: "Orbitron.ttf",
  Cinzel: "Cinzel.ttf",
  "JetBrains Mono": "JetBrainsMono.ttf",
  Poppins: "Poppins.ttf",
  "Permanent Marker": "PermanentMarker.ttf",
};
// libass matches the family name inside the font file; a few static files name
// the weight in the family, so the ASS style has to ask for that exact name.
export const CAPTION_FONT_FAMILY = { Poppins: "Poppins ExtraBold" };
export const assFontFamily = (font) => CAPTION_FONT_FAMILY[font] || font;

// size, outline and shadow are percentages of the frame width; y is the
// vertical centre of the caption block as a percentage of the frame height.
export const CAPTION_STYLES = [
  {
    id: "signal",
    name: "Signal",
    description: "Two or three words at a time, white with the spoken word in yellow.",
    bestFor: "Repo spotlights and tech explainers",
    source: "github-signals",
    font: "Montserrat",
    uppercase: true,
    size: 6.8,
    maxWords: 3,
    maxChars: 20,
    colors: { text: "#FFFFFF", active: "#FFE600", outline: "#000000", shadow: "#000000" },
    outline: 0.55,
    shadow: 0.18,
    y: 60,
    animation: "highlight",
  },
  {
    id: "hormozi",
    name: "Hormozi",
    description: "Bold cyan highlights with a thick outline.",
    bestFor: "Business and motivation",
    source: "ai-video-captions",
    font: "Montserrat",
    uppercase: true,
    size: 7.6,
    maxWords: 4,
    maxChars: 24,
    colors: { text: "#FFFFFF", active: "#00FFFF", outline: "#000000", shadow: "#000000" },
    outline: 0.46,
    shadow: 0.4,
    y: 70,
    animation: "highlight",
  },
  {
    id: "mrbeast",
    name: "MrBeast",
    description: "Yellow text, orange pop on the spoken word, extra thick outline.",
    bestFor: "Gaming and entertainment",
    source: "ai-video-captions",
    font: "Bebas Neue",
    uppercase: true,
    size: 10.5,
    maxWords: 4,
    maxChars: 24,
    colors: { text: "#FFFF00", active: "#FF6600", outline: "#000000", shadow: "#000000" },
    outline: 0.74,
    shadow: 0.55,
    y: 70,
    animation: "pop",
  },
  {
    id: "karaoke",
    name: "Karaoke",
    description: "A colour wipe sweeps left to right as each word is spoken.",
    bestFor: "Music and sing-alongs",
    source: "ai-video-captions",
    font: "Montserrat",
    uppercase: true,
    size: 7.2,
    maxWords: 5,
    maxChars: 28,
    colors: { text: "#FFFFFF", active: "#0080FF", outline: "#000000", shadow: "#000000" },
    outline: 0.37,
    shadow: 0.28,
    y: 72,
    animation: "karaoke",
  },
  {
    id: "minimal",
    name: "Minimal",
    description: "Tall italic capitals with a subtle lift on the spoken word.",
    bestFor: "Professional and clean",
    source: "ai-video-captions",
    font: "Bebas Neue",
    uppercase: true,
    italic: true,
    spacing: 0.25,
    size: 9.5,
    maxWords: 5,
    maxChars: 28,
    colors: { text: "#FFFFFF", active: "#F5F5F5", outline: "#000000", shadow: "#000000" },
    outline: 0.37,
    shadow: 0.28,
    y: 74,
    animation: "scale",
  },
  {
    id: "bounce",
    name: "Bounce",
    description: "Comic lettering in green with a magenta bounce on every word.",
    bestFor: "Fun and energetic",
    source: "ai-video-captions",
    font: "Bangers",
    uppercase: true,
    size: 9.2,
    maxWords: 4,
    maxChars: 22,
    colors: { text: "#00FF88", active: "#FF00FF", outline: "#000000", shadow: "#000000" },
    outline: 0.46,
    shadow: 0.46,
    y: 70,
    animation: "bounce",
  },
  {
    id: "classic",
    name: "Classic",
    description: "Condensed white capitals with the familiar yellow highlight.",
    bestFor: "Viral and attention-grabbing",
    source: "ai-video-captions",
    font: "Anton",
    uppercase: true,
    size: 8.6,
    maxWords: 4,
    maxChars: 24,
    colors: { text: "#FFFFFF", active: "#FFFF00", outline: "#000000", shadow: "#000000" },
    outline: 0.55,
    shadow: 0.28,
    y: 70,
    animation: "highlight",
  },
  {
    id: "podcast",
    name: "Podcast",
    description: "Whole phrases on a soft dark band, no word highlighting.",
    bestFor: "Interviews and long-form talk",
    source: "remotion-captions-themes",
    font: "Outfit",
    uppercase: false,
    size: 4.6,
    maxWords: 8,
    maxChars: 44,
    colors: { text: "#FFFFFF", active: "#FFFFFF", outline: "#0B0C10", shadow: "#000000" },
    band: "#0B0C10",
    bandAlpha: 0.72,
    outline: 0,
    shadow: 0,
    y: 84,
    animation: "none",
  },
  {
    id: "one-word",
    name: "One word",
    description: "A single large word at a time, snapping in with each beat.",
    bestFor: "Punchy hooks and short clips",
    source: "remotion-captions-themes",
    font: "Outfit",
    uppercase: true,
    size: 12,
    maxWords: 1,
    maxChars: 16,
    colors: { text: "#FFFFFF", active: "#FFFFFF", outline: "#000000", shadow: "#000000" },
    outline: 0.5,
    shadow: 0.3,
    y: 50,
    animation: "pop",
  },
  {
    id: "pill",
    name: "Pill",
    description: "White words with the spoken one wrapped in a violet pill.",
    bestFor: "Educational and lifestyle",
    source: "remotion-captions-themes",
    font: "Outfit",
    uppercase: false,
    size: 5.8,
    maxWords: 5,
    maxChars: 30,
    colors: { text: "#FFFFFF", active: "#FFFFFF", outline: "#000000", shadow: "#000000", box: "#7C3AED" },
    outline: 0.3,
    shadow: 0.2,
    y: 76,
    animation: "box",
  },
  {"id":"crimson-pop","name":"Crimson Pop","description":"Crisp white type with the spoken word in a red box.","bestFor":"High-impact hooks and story reels","source":"capite","font":"Montserrat","uppercase":true,"size":7.6,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#FFFFFF","outline":"#000000","shadow":"#000000","box":"#E11D48"},"outline":0.28,"shadow":0,"y":70,"animation":"box"},
  {"id":"swiss","name":"Swiss","description":"Mature Swiss minimalism with a subtle platinum lift.","bestFor":"Professional and executive","source":"capite","font":"Inter","uppercase":true,"size":7.6,"maxWords":5,"maxChars":28,"colors":{"text":"#F8FAFC","active":"#FFFFFF","outline":"#0F172A","shadow":"#000000"},"outline":0.32,"shadow":0.28,"y":70,"animation":"scale"},
  {"id":"amber","name":"Amber","description":"Executive grotesque with warm amber highlights.","bestFor":"Modern viral and brand reels","source":"capite","font":"Plus Jakarta Sans","uppercase":true,"size":7.6,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#F59E0B","outline":"#18181B","shadow":"#000000"},"outline":0.46,"shadow":0.32,"y":70,"animation":"highlight"},
  {"id":"ali-abdaal","name":"Ali Abdaal","description":"Clean neo-grotesque with a highlighter-yellow pop.","bestFor":"Productivity, podcasts and tech","source":"capite","font":"Inter","uppercase":true,"size":7.2,"maxWords":4,"maxChars":24,"colors":{"text":"#F8FAFC","active":"#FFDE59","outline":"#0F172A","shadow":"#000000"},"outline":0.37,"shadow":0.32,"y":70,"animation":"pop"},
  {"id":"vox","name":"Vox Explainer","description":"Punchy structural sans with bold gold contrast.","bestFor":"Video essays and documentaries","source":"capite","font":"Syne","uppercase":true,"size":7.6,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#FFE600","outline":"#000000","shadow":"#000000"},"outline":0.51,"shadow":0.37,"y":70,"animation":"highlight"},
  {"id":"luxury","name":"Iman Luxury","description":"Editorial serif in champagne with warm gold highlights.","bestFor":"Luxury, finance and mindset","source":"capite","font":"Playfair Display","uppercase":false,"size":7.4,"maxWords":5,"maxChars":28,"colors":{"text":"#FBF7F0","active":"#E5B869","outline":"#1A1A1A","shadow":"#000000"},"outline":0.37,"shadow":0.32,"y":70,"animation":"scale"},
  {"id":"cyberpunk","name":"Cyberpunk Neon","description":"Futuristic techno sans glowing cyan and hot pink.","bestFor":"AI, tech, crypto and gaming","source":"capite","font":"Orbitron","uppercase":true,"size":6.9,"maxWords":4,"maxChars":24,"colors":{"text":"#00F0FF","active":"#FF007F","outline":"#050515","shadow":"#000000"},"outline":0.46,"shadow":0.56,"y":70,"animation":"glow"},
  {"id":"cinema-noir","name":"Cinema Noir","description":"Majestic Roman serif with a crimson flame highlight.","bestFor":"True crime, history and drama","source":"capite","font":"Cinzel","uppercase":true,"size":7.1,"maxWords":4,"maxChars":24,"colors":{"text":"#E2E8F0","active":"#E11D48","outline":"#0A0A0A","shadow":"#000000"},"outline":0.42,"shadow":0.46,"y":70,"animation":"highlight"},
  {"id":"terminal","name":"Code Terminal","description":"Crisp monospace with a matrix-green pop.","bestFor":"Coding tutorials and dev content","source":"capite","font":"JetBrains Mono","uppercase":true,"size":6.6,"maxWords":4,"maxChars":24,"colors":{"text":"#CBD5E1","active":"#22C55E","outline":"#020617","shadow":"#000000"},"outline":0.37,"shadow":0.37,"y":70,"animation":"pop"},
  {"id":"creator-pop","name":"Creator Pop","description":"Rounded bold sans with electric purple accents.","bestFor":"High-retention shorts and comedy","source":"capite","font":"Poppins","uppercase":true,"size":7.6,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#A855F7","outline":"#000000","shadow":"#000000"},"outline":0.56,"shadow":0.42,"y":70,"animation":"pop"},
  {"id":"warm-pastel","name":"Warm Pastel","description":"Gentle oat and coral tones with a soft diffuse shadow.","bestFor":"Vlogs, wellness, food and ASMR","source":"capite","font":"Outfit","uppercase":false,"size":7.4,"maxWords":5,"maxChars":28,"colors":{"text":"#FFFBF5","active":"#FF8A65","outline":"#2D2321","shadow":"#000000"},"outline":0.32,"shadow":0.37,"y":70,"animation":"scale"},
  {"id":"urban-rebel","name":"Urban Rebel","description":"Raw marker handwriting with a caution-yellow bounce.","bestFor":"Fitness, sports and motivation","source":"capite","font":"Permanent Marker","uppercase":true,"size":6.9,"maxWords":4,"maxChars":24,"colors":{"text":"#F8FAFC","active":"#FACC15","outline":"#000000","shadow":"#000000"},"outline":0.56,"shadow":0.46,"y":70,"animation":"bounce"},
  {"id":"nordic","name":"Nordic Clean","description":"Dimmed words that turn white as they are spoken.","bestFor":"SaaS launches and keynotes","source":"capite","font":"Inter","uppercase":true,"size":7.5,"maxWords":4,"maxChars":24,"colors":{"text":"#94A3B8","active":"#FFFFFF","outline":"#000000","shadow":"#000000"},"outline":0.37,"shadow":0.28,"y":70,"animation":"highlight"},
  {"id":"podcast-viral","name":"Podcast Viral","description":"Electric lime pop on a modern grotesque.","bestFor":"Podcasts, interviews and founder stories","source":"capite","font":"Plus Jakarta Sans","uppercase":true,"size":7.8,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#D4FF00","outline":"#0F172A","shadow":"#000000"},"outline":0.51,"shadow":0.42,"y":70,"animation":"pop"},
  {"id":"wealth","name":"Fintech & Wealth","description":"Pure white type with a cash-green lift.","bestFor":"Finance, crypto and business mindset","source":"capite","font":"Montserrat","uppercase":true,"size":7.9,"maxWords":5,"maxChars":28,"colors":{"text":"#FFFFFF","active":"#00E676","outline":"#000000","shadow":"#000000"},"outline":0.6,"shadow":0.46,"y":70,"animation":"scale"},
  {"id":"dark-documentary","name":"Dark Documentary","description":"Dramatic high-contrast serif with dossier-gold highlights.","bestFor":"Investigations, mysteries and true crime","source":"capite","font":"Cinzel","uppercase":true,"size":7.4,"maxWords":4,"maxChars":24,"colors":{"text":"#F8F6F0","active":"#F59E0B","outline":"#0A0A0A","shadow":"#000000"},"outline":0.42,"shadow":0.56,"y":70,"animation":"highlight"},
  {"id":"storyteller","name":"Submagic Storyteller","description":"Typewriter rhythm with a warm coral wipe.","bestFor":"Storytelling, BookTok and poetry","source":"capite","font":"JetBrains Mono","uppercase":false,"size":7.1,"maxWords":5,"maxChars":28,"colors":{"text":"#FFFDF7","active":"#FB7185","outline":"#292524","shadow":"#000000"},"outline":0.37,"shadow":0.28,"y":70,"animation":"karaoke"},
  {"id":"dark-psychology","name":"Dark Psychology","description":"Cold technical type with a blood-red glow.","bestFor":"Stoic philosophy and thriller hooks","source":"capite","font":"Orbitron","uppercase":true,"size":6.9,"maxWords":4,"maxChars":24,"colors":{"text":"#F1F5F9","active":"#DC2626","outline":"#050505","shadow":"#000000"},"outline":0.51,"shadow":0.65,"y":70,"animation":"glow"},
  {"id":"kapwing","name":"Kapwing Viral","description":"Bright yellow highlights with a springy pop.","bestFor":"Viral shorts and high-energy hooks","source":"capite","font":"Montserrat","uppercase":true,"size":7.9,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#FACC15","outline":"#000000","shadow":"#000000"},"outline":0.6,"shadow":0.37,"y":70,"animation":"pop"},
  {"id":"neon-cyber","name":"Neon Cyber","description":"Electric cyan with a radioactive-green pulse.","bestFor":"AI demos, tech tutorials and gaming","source":"capite","font":"Orbitron","uppercase":true,"size":7.2,"maxWords":4,"maxChars":24,"colors":{"text":"#00F0FF","active":"#39FF14","outline":"#0A0A1A","shadow":"#000000"},"outline":0.46,"shadow":0.56,"y":70,"animation":"glow"},
  {"id":"retro-glitch","name":"Retro Glitch","description":"Hot magenta and electric yellow with a spring bounce.","bestFor":"Entertainment, memes and fast pacing","source":"capite","font":"Bebas Neue","uppercase":true,"size":8.3,"maxWords":4,"maxChars":24,"colors":{"text":"#FF007F","active":"#FFE600","outline":"#050510","shadow":"#000000"},"outline":0.65,"shadow":0.46,"y":70,"animation":"bounce"},
  {"id":"cinema-gold","name":"Cinema Gold","description":"Crisp white serif with a metallic gold zoom.","bestFor":"Documentary, finance and luxury","source":"capite","font":"Playfair Display","uppercase":false,"size":7.1,"maxWords":5,"maxChars":28,"colors":{"text":"#F8FAFC","active":"#FFD700","outline":"#0B0C10","shadow":"#000000"},"outline":0.37,"shadow":0.42,"y":70,"animation":"scale"},
  {"id":"tiktok-hype","name":"TikTok Hype","description":"Bold white type with the spoken word in a red pill.","bestFor":"Trending challenges and retention hooks","source":"capite","font":"Poppins","uppercase":true,"size":7.6,"maxWords":4,"maxChars":24,"colors":{"text":"#FFFFFF","active":"#FFFFFF","outline":"#000000","shadow":"#000000","box":"#EF4444"},"outline":0.28,"shadow":0,"y":70,"animation":"box"},
  {"id":"soft","name":"Soft","description":"Rounded mixed-case words with a soft shadow and an indigo highlight.","bestFor":"AI products and calm explainers","source":"remotion-captions-themes","font":"Outfit","uppercase":false,"size":6.4,"maxWords":5,"maxChars":30,"colors":{"text":"#FFFFFF","active":"#A5B4FC","outline":"#000000","shadow":"#000000"},"outline":0,"shadow":0.45,"y":74,"animation":"highlight"},
  {"id":"grape","name":"Grape","description":"Capitals on a solid violet band, the spoken word in yellow.","bestFor":"Lifestyle, education and lists","source":"remotion-captions-themes","font":"Outfit","uppercase":true,"size":5.8,"maxWords":5,"maxChars":28,"colors":{"text":"#FFFFFF","active":"#FDE047","outline":"#5B21B6","shadow":"#000000"},"band":"#5B21B6","bandAlpha":1,"outline":0,"shadow":0,"y":78,"animation":"highlight"},
  {
    id: "clean",
    name: "Clean",
    description: "Sentence-case white words with a soft shadow and a yellow spoken word.",
    bestFor: "Talking heads and everyday edits",
    source: "autoyt",
    font: "Inter",
    uppercase: false,
    size: 5.8,
    maxWords: 6,
    maxChars: 34,
    colors: { text: "#FFFFFF", active: "#F9DC0B", outline: "#000000", shadow: "#000000" },
    outline: 0,
    shadow: 0.22,
    y: 80,
    animation: "highlight",
  },
  {
    id: "bubble",
    name: "Bubble",
    description: "Dark words on a white card, the spoken word in raspberry.",
    bestFor: "Bright, friendly social clips",
    source: "autoyt",
    font: "Inter",
    uppercase: false,
    size: 5.6,
    maxWords: 5,
    maxChars: 30,
    colors: { text: "#14110A", active: "#B02A6B", outline: "#FFFFFF", shadow: "#000000" },
    band: "#FFFFFF",
    bandAlpha: 0.95,
    outline: 0,
    shadow: 0,
    y: 78,
    animation: "highlight",
  },
];

export const findCaptionStyle = (id) => CAPTION_STYLES.find((style) => style.id === id) || null;
export function normalizeCaptionStyle(value) {
  return findCaptionStyle(String(value || "")) ? String(value) : "none";
}

// ---- Chunking ----------------------------------------------------------------

const wordsFromSegments = (segments, duration) => {
  const words = [];
  for (const segment of segments || []) {
    if (Array.isArray(segment.words) && segment.words.length) {
      for (const w of segment.words) {
        const text = String(w.word ?? w.text ?? "").replace(/[\r\n]+/g, " ").trim();
        if (text) words.push({ text, start: Number(w.start), end: Number(w.end) });
      }
    } else {
      const tokens = String(segment.text || "").trim().split(/\s+/).filter(Boolean);
      const start = Number(segment.start), span = Number(segment.end) - start;
      tokens.forEach((text, i) => words.push({ text, start: start + (span * i) / tokens.length, end: start + (span * (i + 1)) / tokens.length }));
    }
  }
  return words
    .filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ ...w, start: Math.max(0, w.start), end: Math.min(duration || Infinity, Math.max(w.end, w.start + 0.05)) }))
    .filter((w) => w.end > w.start)
    .sort((a, b) => a.start - b.start);
};

// Groups the narrator's words into caption chunks of the style's size, breaking
// on sentence ends, long pauses, and length. Every chunk shows until the next
// one starts (held at most 1.2 s past its last word) so captions never flicker.
export function captionChunks(segments, duration, style) {
  const maxWords = Math.max(1, Number(style?.maxWords) || 3);
  const maxChars = Math.max(4, Number(style?.maxChars) || 20);
  const words = wordsFromSegments(segments, duration);
  const chunks = [];
  let current = null;
  const close = () => { if (current) chunks.push(current); current = null; };
  for (const word of words) {
    if (current) {
      const chars = current.words.reduce((n, w) => n + w.text.length + 1, 0) + word.text.length;
      const gap = word.start - current.words.at(-1).end;
      const last = current.words.at(-1).text;
      if (current.words.length >= maxWords || chars > maxChars || gap > 0.6 || /[.!?…]["'”’)]*$/.test(last) || word.end - current.start > 4) close();
    }
    if (!current) current = { start: word.start, end: word.end, words: [] };
    current.words.push(word);
    current.end = Math.max(current.end, word.end);
  }
  close();
  return chunks.map((chunk, i) => {
    const next = chunks[i + 1]?.start ?? (duration || chunk.end);
    return { ...chunk, end: Math.max(chunk.end, Math.min(next, chunk.end + 1.2)) };
  });
}

// ---- ASS writing -------------------------------------------------------------

// ASS colours are &HAABBGGRR (alpha 00 = opaque).
export function assColor(hex, alpha = 0) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || "").trim()) || ["", "FF", "FF", "FF"];
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `&H${a.toString(16).padStart(2, "0").toUpperCase()}${m[3].toUpperCase()}${m[2].toUpperCase()}${m[1].toUpperCase()}`;
}
// Inline override tags take the six-digit form with a closing ampersand: \c&HBBGGRR&.
export const inlineColor = (hex) => `&H${assColor(hex).slice(4)}&`;

const assTime = (seconds) => {
  const cs = Math.max(0, Math.round(Number(seconds) * 100));
  const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

// Narration is untrusted text: strip ASS override braces and backslashes.
const assText = (text, style) => {
  const clean = String(text || "").replace(/[{}]/g, "").replace(/\\/g, "＼").replace(/[\r\n]+/g, " ");
  return style?.uppercase ? clean.toUpperCase() : clean;
};

// The ASS [Fonts] section uses a uuencode variant: 3 bytes become 4 characters offset by 33.
export function encodeAssFont(bytes) {
  const out = [];
  let line = "";
  const push = (code) => {
    line += String.fromCharCode(code + 33);
    if (line.length === 80) { out.push(line); line = ""; }
  };
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    push(b0 >> 2); push(((b0 & 3) << 4) | (b1 >> 4)); push(((b1 & 15) << 2) | (b2 >> 6)); push(b2 & 63);
  }
  const rest = bytes.length - i;
  if (rest === 1) { const b0 = bytes[i]; push(b0 >> 2); push((b0 & 3) << 4); }
  else if (rest === 2) { const b0 = bytes[i], b1 = bytes[i + 1]; push(b0 >> 2); push(((b0 & 3) << 4) | (b1 >> 4)); push((b1 & 15) << 2); }
  if (line) out.push(line);
  return out.join("\n");
}

function activeTag(style, px) {
  const active = inlineColor(style.colors.active);
  switch (style.animation) {
    case "pop":
      return `{\\c${active}\\fscx112\\fscy112}`;
    case "bounce":
      return `{\\c${active}\\t(0,60,\\fscx120\\fscy120)\\t(60,140,\\fscx100\\fscy100)}`;
    case "scale":
      return `{\\c${active}\\fscx106\\fscy106}`;
    case "box":
      // A very thick outline in the box colour reads as a rounded pill around the word.
      return `{\\c${active}\\bord${Math.max(6, Math.round(px.width * 0.012))}\\3c${inlineColor(style.colors.box || style.colors.active)}\\shad0}`;
    case "glow":
      // The word and a blurred outline share the accent colour: a neon halo.
      return `{\\c${active}\\3c${active}\\bord${Math.max(2, Math.round(px.width * 0.004))}\\blur${Math.max(2, Math.round(px.width * 0.006))}\\shad0}`;
    default:
      return `{\\c${active}}`;
  }
}

// Writes a complete ASS document for the chunks. `fonts` is a list of
// { file, bytes } to embed, usually just the style's font.
export function captionsAss(chunks, style, { width, height }, { fonts = [] } = {}) {
  const w = Math.max(16, Math.floor(Number(width))), h = Math.max(16, Math.floor(Number(height)));
  const px = { width: w, height: h };
  const fontSize = Math.max(12, Math.round((w * Number(style.size)) / 100));
  const outline = Math.round((w * Number(style.outline || 0)) / 100 * 10) / 10;
  const shadow = Math.round((w * Number(style.shadow || 0)) / 100 * 10) / 10;
  // A band is an opaque box (BorderStyle 3) behind the whole line; its colour
  // rides in OutlineColour, so banded styles have no glyph outline.
  const boxed = Boolean(style.band);
  const bandAlpha = 1 - (style.bandAlpha ?? 0.7);
  const primary = style.animation === "karaoke" ? assColor(style.colors.active) : assColor(style.colors.text);
  const secondary = style.animation === "karaoke" ? assColor(style.colors.text) : assColor(style.colors.active);
  const outlineColor = boxed ? assColor(style.band, bandAlpha) : assColor(style.colors.outline);
  const back = boxed ? assColor(style.band, bandAlpha) : assColor(style.colors.shadow, 0.5);
  const margin = Math.round(w * 0.06);
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    ...(fonts.length ? ["[Fonts]", ...fonts.map((font) => `fontname: ${font.file}\n${encodeAssFont(font.bytes)}`), ""] : []),
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${assFontFamily(style.font)},${fontSize},${primary},${secondary},${outlineColor},${back},-1,${style.italic ? -1 : 0},0,0,100,100,${Math.round((w * Number(style.spacing || 0)) / 100)},0,${boxed ? 3 : 1},${boxed ? Math.max(4, Math.round(fontSize * 0.28)) : outline},${shadow},5,${margin},${margin},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const pos = `{\\an5\\pos(${Math.round(w / 2)},${Math.round((h * Number(style.y)) / 100)})}`;
  const line = (start, end, text) => `Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${pos}${text}`;
  const events = [];
  for (const chunk of chunks) {
    const words = chunk.words.map((word) => ({ ...word, text: assText(word.text, style) })).filter((word) => word.text);
    if (!words.length) continue;
    if (style.animation === "none") {
      events.push(line(chunk.start, chunk.end, words.map((word) => word.text).join(" ")));
      continue;
    }
    if (style.animation === "karaoke") {
      // \kf timings run back to back from the cue start, so each word's span
      // reaches to the next word's start and the last one to the chunk end.
      const parts = words.map((word, i) => {
        const until = i + 1 < words.length ? words[i + 1].start : Math.min(chunk.end, word.end + 0.3);
        return `{\\kf${Math.max(1, Math.round((until - word.start) * 100))}}${word.text}`;
      });
      events.push(line(chunk.start, chunk.end, parts.join(" ")));
      continue;
    }
    const tag = activeTag(style, px);
    words.forEach((word, i) => {
      const start = i === 0 ? chunk.start : word.start;
      const end = i + 1 < words.length ? Math.max(start + 0.05, words[i + 1].start) : chunk.end;
      if (end <= start) return;
      events.push(line(start, end, words.map((other, j) => (j === i ? `${tag}${other.text}{\\r}` : other.text)).join(" ")));
    });
  }
  return `${header.join("\n")}\n${events.join("\n")}\n`;
}

// ffmpeg filter that burns the ASS file in. Paths are escaped for the filter graph.
export function captionBurnFilter(assPath) {
  const escaped = String(assPath).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "'\\''");
  return `ass=filename='${escaped}'`;
}
