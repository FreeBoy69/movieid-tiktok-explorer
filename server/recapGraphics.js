// Motion graphics for the long recap, rendered with HyperFrames (the same composition runtime Vibe Motion
// renders with): lower-thirds the way recap channels finish a video.
//   title      when the narrator names the film ("This is the 2026 movie..."): poster, title, year,
//              genres, runtime, and TMDB rating, from TMDB (server/movieInfo.js)
//   name       the first time each main character is named, with their alias ("Spider-Man")
//   subscribe  when the outro asks viewers to like and subscribe: the button clicks, the bell rings,
//              the like fills
// Each is a HyperFrames composition with variables; the media worker renders each moment once with
// `hyperframes render --batch` to a transparent ProRes 4444 clip and lays it over the cut picture
// (scripts/movie_recap.py), so the Vibe Edit picture carries them too. Times come from the narration's
// caption timings, so every graphic lands on the words it illustrates.

export const GRAPHIC_SECONDS = { title: 4.8, name: 2.9, subscribe: 5.4 };
const NAME_GAP = 4;
const MAX_NAMES = 8;
const STOP = new Set(["the", "and", "his", "her", "mrs", "mr", "dr", "detective", "agent", "officer", "captain", "doctor", "professor", "young", "old", "man", "woman", "girl", "boy", "lady", "sir", "aunt", "uncle", "bill", "will"]);

const norm = (w) => String(w || "").toLowerCase().replace(/[’']s$/, "").replace(/[^a-z0-9-]/g, "");
/** Same word, or one edit apart for longer names ("DeWolfe" for "DeWolff": narration spells by sound). */
export function nameMatch(a, b) {
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Every caption word with its time on the recap timeline. */
export function timedWords(captions = []) {
  const out = [];
  for (const line of captions) {
    const words = String(line.text || "").split(/\s+/).filter(Boolean);
    const span = (Number(line.end) - Number(line.start)) / Math.max(1, words.length);
    words.forEach((word, k) => out.push({ word, w: norm(word), t: Number(line.start) + k * span }));
  }
  return out;
}

const round = (t) => Math.round(t * 100) / 100;
const runtimeText = (minutes) => (minutes ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m` : "");

/** When each graphic appears on the long recap, with the variables its template needs. */
export function planRecapGraphics({ captions = [], duration, movie = null, filmTitle = "", channelName = "" }) {
  const words = timedWords(captions);
  const events = [];
  const fits = (start, length) => start >= 0 && start + length <= duration - 0.3;
  const busy = (start, end) => events.some((e) => start < e.end + 0.4 && end > e.start - 0.4);

  // Title: "This is the [year] movie X" (the house opener), else the first mention of the title.
  const title = movie?.title || String(filmTitle).replace(/\s*\(\d{4}\)\s*$/, "");
  let titleAt = null;
  for (let k = 0; k + 2 < words.length && titleAt == null; k++)
    if (words[k].w === "this" && words[k + 1].w === "is" && words[k + 2].w === "the") titleAt = words[k].t;
  if (titleAt == null && title) {
    const head = norm(title.split(/[\s:]+/)[0]);
    titleAt = words.find((w, k) => k > 3 && w.w === head)?.t ?? null;
  }
  if (title && titleAt != null && fits(titleAt, GRAPHIC_SECONDS.title)) {
    events.push({
      type: "title",
      start: round(titleAt),
      end: round(titleAt + GRAPHIC_SECONDS.title),
      vars: {
        title,
        meta: [movie?.year, (movie?.genres || []).slice(0, 2).join(", "), runtimeText(movie?.runtime)].filter(Boolean).join("  ·  "),
        rating: movie?.rating ? `★ ${movie.rating.toFixed(1)}` : "",
        poster: movie?.poster ? "poster.jpg" : "",
      },
    });
  }

  // Subscribe: where the outro asks viewers to like and subscribe.
  const ask = words.findIndex((w, k) => k > words.length * 0.6 && (w.w === "subscribe" || (w.w === "like" && words.slice(k, k + 5).some((n) => n.w === "subscribe"))));
  if (ask >= 0) {
    const start = Math.max(0, words[ask].t - 0.3);
    const end = Math.min(duration - 0.2, start + GRAPHIC_SECONDS.subscribe);
    if (end - start > 3.5) events.push({ type: "subscribe", start: round(start), end: round(end), vars: { channel: String(channelName || "").trim().slice(0, 32) || "Recaps" } });
  }

  // Names: the first time each main character is named. A word two characters share ("Jean" Grey and
  // Jean DeWolff) can't tell them apart, so only words unique to one character count.
  const characters = (movie?.characters || []).slice(0, 12);
  const keys = characters.map((c) => [...new Set(`${c.name} ${c.alias}`.split(/[\s/]+/).map(norm).filter((w) => w.length >= 3 && !STOP.has(w)))]);
  const count = new Map();
  for (const list of keys) for (const w of list) count.set(w, (count.get(w) || 0) + 1);
  const intros = [];
  characters.forEach((character, n) => {
    const unique = keys[n].filter((w) => count.get(w) === 1);
    const hit = unique.length ? words.find((word) => unique.some((key) => nameMatch(word.w, key))) : null;
    if (hit) intros.push({ character, t: hit.t });
  });
  intros.sort((a, b) => a.t - b.t);
  let last = -Infinity;
  for (const { character, t } of intros) {
    if (events.filter((e) => e.type === "name").length >= MAX_NAMES) break;
    let start = Math.max(t, last + NAME_GAP);
    while (busy(start, start + GRAPHIC_SECONDS.name) && start - t <= 8) start += 0.5;
    if (start - t > 8 || !fits(start, GRAPHIC_SECONDS.name)) continue;
    events.push({ type: "name", start: round(start), end: round(start + GRAPHIC_SECONDS.name), vars: { name: character.name, alias: character.alias || "" } });
    last = start;
  }

  events.sort((a, b) => a.start - b.start);
  return { events, watermark: String(channelName || "").trim().slice(0, 40) };
}

// ---------- Templates ----------
// Lower-third family: a dark plate with an accent bar, Montserrat ExtraBold names, Inter details,
// Anton for the film title. Everything sits in the lower third, clear of the burned-in captions.
const BASE_CSS = `@font-face{font-family:Mont;src:url(fonts/Montserrat.ttf)}@font-face{font-family:Inter;src:url(fonts/Inter.ttf)}@font-face{font-family:Anton;src:url(fonts/Anton.ttf)}
html,body{margin:0;background:transparent}#root{position:relative;width:1920px;height:1080px;overflow:hidden;color:#fff;font-family:Inter,sans-serif}
.plate{position:absolute;inset:0;background:rgba(10,10,14,.74);border-radius:8px;transform-origin:left center;box-shadow:0 18px 50px rgba(0,0,0,.35)}
.bar{position:absolute;left:0;top:0;bottom:0;width:8px;border-radius:8px 0 0 8px;transform-origin:center top}`;
const vars = (list) => JSON.stringify(list).replace(/'/g, "&#39;");
const head = (declarations, css) => `<!doctype html><html data-composition-variables='${vars(declarations)}'><head><meta charset="utf-8"><style>${BASE_CSS}${css}</style></head><body>`;
const tail = (duration, body, script) => `<div id="root" data-composition-id="root" data-width="1920" data-height="1080" data-duration="${duration}">${body}</div><script src="gsap.min.js"></script><script>
const v = window.__hyperframes.getVariables();
const $ = (id) => document.getElementById(id);
const tl = gsap.timeline({ paused: true });
${script}
window.__timelines = window.__timelines || {}; window.__timelines["root"] = tl;
</script></body></html>`;
const ACCENT = { id: "accent", type: "color", label: "Accent", default: "#FFD23F" };

export const GRAPHIC_TEMPLATES = {
  name: head([{ id: "name", type: "string", label: "Name", default: "Peter Parker" }, { id: "alias", type: "string", label: "Alias", default: "" }, ACCENT],
    `.lt{position:absolute;left:120px;bottom:200px;padding:18px 36px 20px 32px}
.name{position:relative;font-family:Mont,sans-serif;font-size:58px;letter-spacing:2px;text-transform:uppercase;white-space:nowrap}
.alias{position:relative;font-size:28px;font-weight:600;letter-spacing:1px;margin-top:4px}`) +
    tail(GRAPHIC_SECONDS.name, `<div class="lt" id="lt"><div class="plate" id="plate"></div><div class="bar" id="bar"></div><div class="name" id="name"></div><div class="alias" id="alias"></div></div>`, `
$("name").textContent = v.name; $("alias").textContent = v.alias; $("alias").style.color = v.accent; $("bar").style.background = v.accent;
if (!v.alias) $("alias").style.display = "none";
tl.fromTo("#plate", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.out" }, 0)
  .fromTo("#bar", { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: "power2.out" }, 0.05)
  .fromTo("#name", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.45, ease: "power3.out" }, 0.18)
  .fromTo("#alias", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out" }, 0.38)
  .to("#lt", { opacity: 0, x: -24, duration: 0.35, ease: "power2.in" }, ${GRAPHIC_SECONDS.name - 0.4});`),

  title: head([{ id: "title", type: "string", label: "Title", default: "Film" }, { id: "meta", type: "string", label: "Year, genres, runtime", default: "" }, { id: "rating", type: "string", label: "Rating", default: "" }, { id: "poster", type: "string", label: "Poster file", default: "" }, ACCENT],
    `.lt{position:absolute;left:120px;bottom:170px;display:flex;align-items:flex-end;gap:30px;padding:22px 40px 22px 22px;max-width:1500px}
.poster{position:relative;width:150px;aspect-ratio:2/3;border-radius:8px;background:#222 center/cover no-repeat;box-shadow:0 14px 40px rgba(0,0,0,.5);flex:none}
.text{position:relative;display:flex;flex-direction:column;gap:10px;padding-bottom:6px;min-width:0}
.title{font-family:Anton,sans-serif;font-size:76px;line-height:1;text-transform:uppercase;letter-spacing:.5px}
.meta{font-size:28px;font-weight:500;color:rgba(255,255,255,.82);white-space:nowrap}
.rating{font-size:28px;font-weight:700;display:flex;gap:10px;align-items:baseline}
.rating small{font-size:20px;font-weight:600;color:rgba(255,255,255,.6);letter-spacing:1px}`) +
    tail(GRAPHIC_SECONDS.title, `<div class="lt" id="lt"><div class="plate" id="plate"></div><div class="bar" id="bar"></div><div class="poster" id="poster"></div><div class="text"><div class="title" id="title"></div><div class="meta" id="meta"></div><div class="rating" id="rating"><span id="stars"></span><small>TMDB</small></div></div></div>`, `
$("title").textContent = v.title; $("meta").textContent = v.meta; $("stars").textContent = v.rating; $("stars").style.color = v.accent; $("bar").style.background = v.accent;
if (v.poster) $("poster").style.backgroundImage = "url(" + v.poster + ")"; else $("poster").style.display = "none";
if (!v.meta) $("meta").style.display = "none";
if (!v.rating) $("rating").style.display = "none";
if (v.title.length > 22) $("title").style.fontSize = "60px";
tl.fromTo("#plate", { scaleX: 0 }, { scaleX: 1, duration: 0.5, ease: "power3.out" }, 0)
  .fromTo("#bar", { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: "power2.out" }, 0.05)
  .fromTo("#poster", { opacity: 0, y: 40, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: "back.out(1.4)" }, 0.15)
  .fromTo("#title", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.5, ease: "power3.out" }, 0.3)
  .fromTo("#meta", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0.55)
  .fromTo("#rating", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, ease: "power2.out" }, 0.75)
  .to("#lt", { opacity: 0, x: -30, duration: 0.4, ease: "power2.in" }, ${GRAPHIC_SECONDS.title - 0.45});`),

  subscribe: head([{ id: "channel", type: "string", label: "Channel", default: "Recaps" }, ACCENT],
    `.lt{position:absolute;left:120px;bottom:190px;display:flex;align-items:center;gap:22px;padding:16px 22px 16px 26px}
.avatar{position:relative;width:72px;height:72px;border-radius:50%;display:grid;place-items:center;font-family:Anton,sans-serif;font-size:40px;color:#111}
.channel{position:relative;font-family:Mont,sans-serif;font-size:34px;white-space:nowrap}
.btn{position:relative;padding:16px 32px;border-radius:999px;background:#E62117;font-weight:800;font-size:26px;letter-spacing:1px;white-space:nowrap}
.btn .on{position:absolute;inset:0;display:grid;place-items:center;border-radius:999px;background:#3a3a40;opacity:0}
.icon{position:relative;width:64px;height:64px;border-radius:50%;background:rgba(255,255,255,.14);display:grid;place-items:center}
.fill{position:absolute;inset:0;border-radius:50%;opacity:0}
.cursor{position:absolute;width:44px;height:44px;left:0;top:0}`) +
    tail(GRAPHIC_SECONDS.subscribe, `<div class="lt" id="lt"><div class="plate" id="plate"></div><div class="bar" id="bar"></div>
  <div class="avatar" id="avatar"></div><div class="channel" id="channel"></div>
  <div class="btn" id="btn">SUBSCRIBE<div class="on" id="on">SUBSCRIBED ✓</div></div>
  <div class="icon" id="bell"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></div>
  <div class="icon" id="like"><div class="fill" id="likefill"></div><svg style="position:relative" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/></svg></div>
  <svg class="cursor" id="cursor" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg></div>`, `
$("channel").textContent = v.channel; $("avatar").textContent = (v.channel.replace(/[^A-Za-z0-9]/g, "")[0] || "R").toUpperCase();
$("avatar").style.background = v.accent; $("bar").style.background = v.accent; $("likefill").style.background = v.accent;
const lt = $("lt").getBoundingClientRect(), b = $("btn").getBoundingClientRect(), k = $("like").getBoundingClientRect();
const bx = b.left - lt.left + b.width * 0.6, by = b.top - lt.top + b.height * 0.55, kx = k.left - lt.left + k.width * 0.5, ky = k.top - lt.top + k.height * 0.55;
tl.fromTo("#plate", { scaleX: 0 }, { scaleX: 1, duration: 0.45, ease: "power3.out" }, 0)
  .fromTo("#bar", { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: "power2.out" }, 0.05)
  .fromTo(["#avatar", "#channel", "#btn", "#bell", "#like"], { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.4, ease: "power2.out", stagger: 0.07 }, 0.15)
  .fromTo("#cursor", { opacity: 0, x: bx + 220, y: by + 140 }, { opacity: 1, x: bx, y: by, duration: 0.8, ease: "power2.inOut" }, 0.7)
  .to("#cursor", { scale: 0.82, duration: 0.08 }, 1.5).to("#btn", { scale: 0.94, duration: 0.08 }, 1.5)
  .to("#cursor", { scale: 1, duration: 0.12 }, 1.58).to("#btn", { scale: 1, duration: 0.15 }, 1.58)
  .to("#on", { opacity: 1, duration: 0.15 }, 1.58)
  .to("#bell", { rotation: 18, duration: 0.07 }, 1.85).to("#bell", { rotation: -16, duration: 0.09 }, 1.92).to("#bell", { rotation: 12, duration: 0.09 }, 2.01).to("#bell", { rotation: -8, duration: 0.09 }, 2.1).to("#bell", { rotation: 0, duration: 0.1 }, 2.19)
  .to("#cursor", { x: kx, y: ky, duration: 0.6, ease: "power2.inOut" }, 2.3)
  .to("#cursor", { scale: 0.82, duration: 0.08 }, 2.95).to("#cursor", { scale: 1, duration: 0.12 }, 3.03)
  .to("#likefill", { opacity: 1, duration: 0.15 }, 3.03).fromTo("#like", { scale: 1 }, { scale: 1.22, duration: 0.15, ease: "power2.out", yoyo: true, repeat: 1 }, 3.03)
  .to("#cursor", { opacity: 0, duration: 0.3 }, 3.6)
  .to("#lt", { opacity: 0, y: 20, duration: 0.4, ease: "power2.in" }, ${GRAPHIC_SECONDS.subscribe - 0.45});`),
};

/** Rows for `hyperframes render --batch`, one file per template: [{ template, rows: [vars...], events }]. */
export function graphicsBatches(plan, { accent = "#FFD23F" } = {}) {
  const out = [];
  for (const type of Object.keys(GRAPHIC_TEMPLATES)) {
    const events = plan.events.filter((e) => e.type === type);
    if (events.length) out.push({ type, rows: events.map((e) => ({ ...e.vars, accent })), events: events.map(({ start, end }) => ({ start, end })) });
  }
  return out;
}
