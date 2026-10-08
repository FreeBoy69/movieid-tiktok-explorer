// The left-panel tools: media library, voice, captions, titles, music, and
// generation, plus the inspector for whatever is selected.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Captions, Film, Flag, Image as ImageIcon, Link2, Loader2, Mic, Music2, Pause, Play, Plus, Sparkles, Trash2, Type, Upload, Wand2 } from "lucide-react";
import { VoicePicker } from "../VoicePicker";
import { toast } from "../../utils/toast";
import {
  recapSource,
  addText,
  assetById,
  clipEnd,
  deleteItems,
  formatTime,
  formatTimecode,
  isLocked,
  moveItem,
  projectDuration,
  setCaptionLook,
  updateItem,
  VIBE_ASPECTS,
  type VibeAsset,
} from "../../utils/vibeEdit";
import { SOUND_PRESETS } from "../../utils/vibeSound.js";
import { findBetterShot, rankShots, type RankedShot, importAudioUrl, importLink, searchMusic, uploadMedia, type MusicTrack } from "./api";
import { addAndPlace, addMotionTitle, generate, generateCaptions, getVoices, placeMusic, readVoicePref, resolveVoice, voiceover, writeVoicePref } from "./commands";
import { CAPTION_STYLES, loadCaptionFont } from "./overlay";
import CaptionStylePicker from "../CaptionStylePicker";
import { useVibe, vibe, withTask } from "./store";
import { AutoEditPanel } from "./AutoEditPanel";
import { normalizeOverlay, OVERLAY_KINDS, overlayExample } from "../../utils/videoOverlays.js";
import { VIDEO_LOOKS } from "../../utils/videoLooks.js";
import { COLOR_BOOST } from "../../utils/vibeAutoEdit";

export type PanelId = "auto" | "media" | "voice" | "captions" | "text" | "music" | "generate";
export const PANELS: { id: PanelId; label: string; short?: string; icon: ReactNode }[] = [
  { id: "auto", label: "Auto edit", short: "Auto", icon: <Wand2 size={18} /> },
  { id: "media", label: "Media", icon: <Film size={18} /> },
  { id: "voice", label: "Voice", icon: <Mic size={18} /> },
  { id: "captions", label: "Captions", icon: <Captions size={18} /> },
  { id: "text", label: "Text", icon: <Type size={18} /> },
  { id: "music", label: "Music", icon: <Music2 size={18} /> },
  { id: "generate", label: "Generate", icon: <Sparkles size={18} /> },
];

const fail = (error: unknown) => toast.error((error as Error)?.message || "Something went wrong");

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="ve-sec">
      <div className="ve-sec-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Busy({ on, children }: { on: boolean; children: ReactNode }) {
  return on ? (
    <>
      <Loader2 size={15} className="ve-spin" /> Working…
    </>
  ) : (
    <>{children}</>
  );
}

// ---------- Media ----------
export async function uploadFiles(files: File[]) {
  for (const file of files) {
    try {
      const asset = await withTask(`Uploading ${file.name}`, () => uploadMedia(file));
      if (asset.kind === "audio") placeMusic(asset, 1);
      else addAndPlace(asset);
    } catch (error) {
      fail(error);
    }
  }
}

function MediaPanel() {
  const assets = useVibe((s) => s.project.assets);
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState("");
  const [importing, setImporting] = useState(false);
  const [drag, setDrag] = useState(false);

  const onLink = async () => {
    const url = link.trim();
    if (!url) return;
    setImporting(true);
    try {
      const asset = await withTask("Importing link", () => importLink(url));
      addAndPlace(asset);
      setLink("");
    } catch (error) {
      fail(error);
    } finally {
      setImporting(false);
    }
  };

  const place = (a: VibeAsset) => {
    if (a.kind === "audio") placeMusic(a, a.origin === "voiceover" ? 1 : 0.6);
    else addAndPlace(a, { at: vibe.get().playhead });
  };

  return (
    <>
      <div
        className={`ve-drop${drag ? " is-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void uploadFiles([...e.dataTransfer.files]);
        }}
      >
        <Upload size={20} />
        <strong>Drop videos, photos, or audio</strong>
        <span>MP4, MOV, WebM up to 200 MB · images · MP3/WAV</span>
        <button type="button" className="ve-btn" onClick={() => input.current?.click()}>
          Choose files
        </button>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/mp4,audio/ogg"
          onChange={(e) => {
            void uploadFiles([...(e.target.files || [])]);
            e.target.value = "";
          }}
        />
      </div>
      <form
        className="ve-inline"
        onSubmit={(e) => {
          e.preventDefault();
          void onLink();
        }}
      >
        <Link2 size={15} className="ve-inline-icon" />
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste a TikTok, YouTube, or image link" aria-label="Import from a link" />
        <button type="submit" className="ve-btn ve-btn-quiet" disabled={!link.trim() || importing}>
          {importing ? <Loader2 size={14} className="ve-spin" /> : "Import"}
        </button>
      </form>
      <Section title="In this project" aside={<span className="ve-count">{assets.length}</span>}>
        {assets.length ? (
          <div className="ve-assets">
            {assets.map((a) => (
              <button key={a.id} type="button" className="ve-asset" onClick={() => place(a)} title={`Add ${a.name} at the playhead`}>
                <span className="ve-asset-thumb" data-kind={a.kind}>
                  {a.kind === "image" ? <img src={a.url} alt="" loading="lazy" /> : a.kind === "video" ? <video src={`${a.url}#t=0.5`} preload="metadata" muted /> : <AudioLines size={20} />}
                  {a.duration ? <span className="ve-asset-dur">{formatTime(a.duration)}</span> : null}
                </span>
                <span className="ve-asset-name">{a.name}</span>
                <Plus size={14} className="ve-asset-add" />
              </button>
            ))}
          </div>
        ) : (
          <p className="ve-empty">Nothing yet. Uploads, voiceovers, music, and generated shots collect here.</p>
        )}
      </Section>
    </>
  );
}

// ---------- Voice ----------
const DIRECTIONS = ["Warm and unhurried", "Hype announcer", "Calm documentary", "Whispered, close to the mic", "Upbeat, smiling", "In Spanish, friendly"];
const LANGUAGES: [string, string][] = [
  ["auto", "Match the script"],
  ["en-US", "English"],
  ["es-US", "Spanish"],
  ["fr-FR", "French"],
  ["de-DE", "German"],
  ["it-IT", "Italian"],
  ["pt-BR", "Portuguese"],
  ["ja-JP", "Japanese"],
  ["ko-KR", "Korean"],
  ["zh-CN", "Chinese"],
  ["hi-IN", "Hindi"],
  ["ar-EG", "Arabic"],
  ["id-ID", "Indonesian"],
  ["ru-RU", "Russian"],
  ["tr-TR", "Turkish"],
  ["vi-VN", "Vietnamese"],
  ["th-TH", "Thai"],
  ["nl-NL", "Dutch"],
  ["pl-PL", "Polish"],
];

function VoicePanel({ voicesLoading }: { voicesLoading: boolean }) {
  const cueCount = useVibe((s) => s.project.captions.cues.length);
  const [voiceId, setVoiceId] = useState(() => readVoicePref());
  const [script, setScript] = useState("");
  const [direction, setDirection] = useState("");
  const [language, setLanguage] = useState("auto");
  const [preset, setPreset] = useState("studio");
  const [duck, setDuck] = useState(true);
  const [captions, setCaptions] = useState(true);
  const [busy, setBusy] = useState<"" | "script" | "captions">("");
  const voices = getVoices();
  const chosen = resolveVoice(voiceId);

  const run = async (mode: "script" | "captions") => {
    if (!chosen) return toast.error("Pick a voice first.");
    setBusy(mode);
    try {
      const msg = await voiceover({
        script: mode === "script" ? script : undefined,
        fromCaptions: mode === "captions",
        voice: chosen.id,
        direction: direction.trim() || undefined,
        language: language === "auto" ? undefined : language,
        duck: duck ? 0.4 : 1,
        preset: preset === "flat" ? undefined : preset,
        captions,
      });
      toast.success(msg);
    } catch (error) {
      fail(error);
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <Section title="Speaker">
        <VoicePicker
          voices={voices}
          value={chosen?.id}
          loading={voicesLoading}
          onChange={(id) => {
            setVoiceId(id);
            writeVoicePref(id);
          }}
        />
      </Section>
      <Section title="Script" aside={<span className="ve-count">{script.trim() ? script.trim().split(/\s+/).length : 0} words</span>}>
        <textarea className="ve-textarea" rows={6} value={script} onChange={(e) => setScript(e.target.value)} placeholder="Write what the voice says. Each sentence becomes a caption line." />
      </Section>
      <Section title="Delivery">
        <input className="ve-input" value={direction} onChange={(e) => setDirection(e.target.value)} placeholder="How it's said, e.g. warm and unhurried" aria-label="Delivery direction" />
        <div className="ve-chips">
          {DIRECTIONS.map((d) => (
            <button key={d} type="button" className={`ve-chip${direction === d ? " is-on" : ""}`} onClick={() => setDirection(direction === d ? "" : d)}>
              {d}
            </button>
          ))}
        </div>
        <label className="ve-field">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <p className="ve-hint">Pick a language, or say it in the delivery ("in Korean"), and the lines are translated before they're spoken.</p>
      </Section>
      <Section title="Voice treatment">
        <div className="ve-presets">
          {SOUND_PRESETS.map((p) => (
            <button key={p.id} type="button" className={`ve-preset${preset === p.id ? " is-on" : ""}`} onClick={() => setPreset(p.id)} title={p.character}>
              <strong>{p.name}</strong>
              <span>{p.character}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Mix">
        <label className="ve-check">
          <input type="checkbox" checked={duck} onChange={(e) => setDuck(e.target.checked)} />
          <span>Lower music under the voice</span>
        </label>
        <label className="ve-check">
          <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} />
          <span>Make captions from the script</span>
        </label>
      </Section>
      <div className="ve-actions">
        <button type="button" className="ve-btn ve-btn-primary" disabled={!script.trim() || Boolean(busy) || !chosen} onClick={() => void run("script")}>
          <Busy on={busy === "script"}>
            <Mic size={15} /> Voice the script
          </Busy>
        </button>
        <button type="button" className="ve-btn" disabled={!cueCount || Boolean(busy) || !chosen} onClick={() => void run("captions")} title={cueCount ? "Speak each caption at its time" : "Add captions first"}>
          <Busy on={busy === "captions"}>
            <Captions size={15} /> Read captions aloud
          </Busy>
        </button>
      </div>
    </>
  );
}

// ---------- Captions ----------
function CaptionsPanel() {
  const captions = useVibe((s) => s.project.captions);
  const [busy, setBusy] = useState(false);
  const selection = useVibe((s) => s.selection);
  const run = async () => {
    setBusy(true);
    try {
      const n = await generateCaptions();
      toast.success(`Captioned ${n} lines`);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const look = (patch: Parameters<typeof setCaptionLook>[1]) => vibe.commit((p) => setCaptionLook(p, patch), "caption-look");
  const pickStyle = (style: string) => {
    void loadCaptionFont(style).then(() => vibe.commit((p) => p, "caption-font"));
    look({ style, wordHighlight: true });
  };
  return (
    <>
      <div className="ve-actions">
        <button type="button" className="ve-btn ve-btn-primary" onClick={() => void run()} disabled={busy}>
          <Busy on={busy}>
            <Wand2 size={15} /> {captions.cues.length ? "Re-caption from speech" : "Auto-caption from speech"}
          </Busy>
        </button>
      </div>
      <Section title="Style">
        <CaptionStylePicker value={CAPTION_STYLES.some((s) => s.id === captions.style) ? "none" : captions.style} onChange={pickStyle} hideNone />
        <p className="ve-hint">Editor looks</p>
        <div className="ve-styles">
          {CAPTION_STYLES.map((s) => (
            <button key={s.id} type="button" className={`ve-style${captions.style === s.id ? " is-on" : ""}`} onClick={() => look({ style: s.id })} data-style={s.id}>
              <span className="ve-style-sample">{s.upper ? "WORD BY WORD" : "Word by word"}</span>
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Display">
        <label className="ve-check">
          <input type="checkbox" checked={captions.show} onChange={(e) => look({ show: e.target.checked })} />
          <span>Show on video</span>
        </label>
        <label className="ve-check">
          <input type="checkbox" checked={captions.wordHighlight} onChange={(e) => look({ wordHighlight: e.target.checked })} />
          <span>Highlight each word as it's spoken</span>
        </label>
        <label className="ve-field">
          <span>Size</span>
          <input type="range" min={32} max={130} value={captions.size ?? CAPTION_STYLES.find((s) => s.id === captions.style)?.size ?? 62} onChange={(e) => look({ size: Number(e.target.value) })} />
        </label>
        <label className="ve-field">
          <span>Height</span>
          <input type="range" min={0.1} max={0.92} step={0.01} value={captions.y ?? CAPTION_STYLES.find((s) => s.id === captions.style)?.y ?? 0.8} onChange={(e) => look({ y: Number(e.target.value) })} />
        </label>
      </Section>
      <Section title="Lines" aside={<span className="ve-count">{captions.cues.length}</span>}>
        {captions.cues.length ? (
          <ol className="ve-cues">
            {captions.cues.map((c) => (
              <li key={c.id} className={selection.includes(c.id) ? "is-on" : ""}>
                <button type="button" className="ve-cue-time" onClick={() => vibe.seek(c.start)}>
                  {formatTime(c.start, true)}
                </button>
                <input
                  value={c.text}
                  onFocus={() => {
                    vibe.select([c.id]);
                    vibe.seek(c.start);
                  }}
                  onChange={(e) => vibe.commit((p) => updateItem(p, c.id, { text: e.target.value }), `cue:${c.id}`)}
                  aria-label={`Caption at ${formatTime(c.start, true)}`}
                />
              </li>
            ))}
          </ol>
        ) : (
          <p className="ve-empty">Captions come from the speech in your clips and voiceovers. Every word is timed, so they can highlight as they're spoken.</p>
        )}
      </Section>
    </>
  );
}

// ---------- Text ----------
const TEXT_PRESETS = [
  { name: "Headline", text: "Your headline", size: 96, y: 0.18, look: "plain" as const, color: "#ffffff" },
  { name: "Boxed label", text: "Chapter one", size: 58, y: 0.14, look: "boxed" as const, color: "#ffffff" },
  { name: "Outline", text: "WAIT FOR IT", size: 110, y: 0.42, look: "outline" as const, color: "#f9dc0b" },
  { name: "Lower third", text: "Name · Role", size: 48, y: 0.86, look: "boxed" as const, color: "#ffffff" },
];

function TextPanel() {
  const add = (p: (typeof TEXT_PRESETS)[number]) => {
    let id = "";
    vibe.commit((q) => {
      const r = addText(q, { text: p.text, size: p.size, y: p.y, look: p.look, color: p.color }, vibe.get().playhead);
      id = r.id;
      return r.project;
    });
    vibe.select([id]);
  };
  return (
    <Section title="Add a title">
      <div className="ve-text-presets">
        {TEXT_PRESETS.map((p) => (
          <button key={p.name} type="button" className={`ve-text-preset look-${p.look}`} onClick={() => add(p)}>
            <span style={{ color: p.color }}>{p.text}</span>
            <small>{p.name}</small>
          </button>
        ))}
      </div>
      <p className="ve-hint">Titles land at the playhead for 3 seconds. Drag their edges on the timeline to change how long they stay.</p>
    </Section>
  );
}

const MOTION_FIELDS: Record<string, Array<[string, string]>> = {
  "lower-third": [["title", "Name"], ["subtitle", "Who they are"]],
  location: [["place", "Place"], ["detail", "Detail (optional)"]],
  stamp: [["value", "Number or year"], ["label", "What it is"]],
  keyword: [["text", "Words to punch"]],
  progress: [["rank", "Rank"], ["total", "Out of"], ["title", "Entry"]],
  hook: [["text", "Hook headline"]],
  subscribe: [["channel", "Channel name"]],
};

/** Animated titles filmed with HyperFrames: they slide, pop, and count, then leave on their own. */
function MotionTitles() {
  const [kind, setKind] = useState("lower-third");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [look, setLook] = useState("none");
  const [busy, setBusy] = useState(false);
  const ready = MOTION_FIELDS[kind].some(([key]) => (vars[key] || "").trim()) && Boolean(normalizeOverlay({ kind, vars }));
  const add = async () => {
    setBusy(true);
    try {
      await addMotionTitle(kind, normalizeOverlay({ kind, vars })!.vars as Record<string, string>, look);
      toast.success("Motion title added at the playhead");
      setVars({});
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Motion titles">
      <div className="ve-chips" role="radiogroup" aria-label="Motion title type">
        {Object.keys(MOTION_FIELDS).map((id) => [id, OVERLAY_KINDS[id as keyof typeof OVERLAY_KINDS]] as const).map(([id, item]) => (
          <button key={id} type="button" role="radio" aria-checked={kind === id} className={`ve-chip${kind === id ? " is-on" : ""}`} onClick={() => { setKind(id); setVars({}); }}>
            {item.name}
          </button>
        ))}
      </div>
      {MOTION_FIELDS[kind].map(([key, label]) => (
        <label key={key} className="ve-field">
          <span>{label}</span>
          <input className="ve-input" value={vars[key] || ""} placeholder={String((overlayExample(kind) as Record<string, string>)[key] || "")} onChange={(e) => setVars((v) => ({ ...v, [key]: e.target.value }))} />
        </label>
      ))}
      <label className="ve-field">
        <span>Style</span>
        <select value={look} onChange={(e) => setLook(e.target.value)}>
          {VIDEO_LOOKS.map((item) => (
            <option key={item.id} value={item.id}>{item.id === "none" ? "Classic yellow" : item.name}</option>
          ))}
        </select>
      </label>
      <button type="button" className="ve-btn ve-btn-primary ve-btn-block" disabled={!ready || busy} onClick={() => void add()}>
        <Busy on={busy}>
          <Sparkles size={15} /> Animate and add at playhead
        </Busy>
      </button>
      <p className="ve-hint">Filmed on our render worker in about half a minute. It lands on its own track above the picture and plays out by itself.</p>
    </Section>
  );
}

// ---------- Music ----------
const MOODS = ["Lo-fi chill", "Cinematic", "Upbeat pop", "Piano", "Ambient", "Hip hop beat", "Acoustic", "Epic"];

function MusicPanel() {
  const [q, setQ] = useState("");
  const [tracks, setTracks] = useState<MusicTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState("");
  const [playing, setPlaying] = useState("");
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);

  const search = async (query: string) => {
    setQ(query);
    setLoading(true);
    try {
      setTracks(await searchMusic(query));
    } catch (error) {
      fail(error);
    } finally {
      setLoading(false);
    }
  };
  const preview = (t: MusicTrack) => {
    audio.current ??= new Audio();
    if (playing === t.id) {
      audio.current.pause();
      setPlaying("");
      return;
    }
    audio.current.src = t.url;
    audio.current.onended = () => setPlaying("");
    void audio.current.play().catch(() => setPlaying(""));
    setPlaying(t.id);
  };
  const add = async (t: MusicTrack) => {
    setAdding(t.id);
    try {
      const asset = await withTask(`Adding "${t.title}"`, () => importAudioUrl(t.url, t.title));
      placeMusic(asset, 0.25);
      toast.success(`Added "${t.title}" under your edit`);
    } catch (error) {
      fail(error);
    } finally {
      setAdding("");
    }
  };
  return (
    <>
      <form
        className="ve-inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void search(q.trim());
        }}
      >
        <Music2 size={15} className="ve-inline-icon" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search royalty-free music" aria-label="Search music" />
        <button type="submit" className="ve-btn ve-btn-quiet" disabled={!q.trim() || loading}>
          {loading ? <Loader2 size={14} className="ve-spin" /> : "Search"}
        </button>
      </form>
      <div className="ve-chips">
        {MOODS.map((m) => (
          <button key={m} type="button" className="ve-chip" onClick={() => void search(m)}>
            {m}
          </button>
        ))}
      </div>
      <Section title="Tracks" aside={<span className="ve-count">CC0 · CC BY</span>}>
        {tracks.length ? (
          <ul className="ve-tracks">
            {tracks.map((t) => (
              <li key={t.id}>
                <button type="button" className="ve-round" onClick={() => preview(t)} aria-label={playing === t.id ? `Stop ${t.title}` : `Play ${t.title}`}>
                  {playing === t.id ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <span className="ve-track-meta">
                  <strong>{t.title}</strong>
                  <small>
                    {t.creator}
                    {t.duration ? ` · ${formatTime(t.duration)}` : ""} · {t.license}
                  </small>
                </span>
                <button type="button" className="ve-btn ve-btn-quiet" onClick={() => void add(t)} disabled={Boolean(adding)}>
                  {adding === t.id ? <Loader2 size={14} className="ve-spin" /> : "Use"}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ve-empty">{loading ? "Searching…" : "Pick a mood or search. Music lands under the whole edit at a quarter volume and ducks under any voiceover."}</p>
        )}
      </Section>
    </>
  );
}

// ---------- Generate ----------
function GeneratePanel() {
  const aspect = useVibe((s) => s.project.aspect);
  const [kind, setKind] = useState<"image" | "video">("video");
  const [prompt, setPrompt] = useState("");
  const [seconds, setSeconds] = useState(5);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      toast.success(await generate(kind, prompt.trim(), { seconds, at: undefined }));
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="ve-seg" role="radiogroup" aria-label="What to generate">
        {(["video", "image"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? "is-on" : ""} onClick={() => setKind(k)}>
            {k === "video" ? <Film size={14} /> : <ImageIcon size={14} />} {k === "video" ? "Video shot" : "Image"}
          </button>
        ))}
      </div>
      <Section title="Describe the shot">
        <textarea className="ve-textarea" rows={6} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="A steam train races a cliffside railway at dusk, film grain, wide shot" />
      </Section>
      {kind === "video" ? (
        <label className="ve-field">
          <span>Length</span>
          <select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            <option value={5}>5 seconds</option>
            <option value={10}>10 seconds</option>
          </select>
        </label>
      ) : null}
      <p className="ve-hint">
        Framed {aspect} to match your edit. {kind === "video" ? "Shots take a minute or two; keep editing while it renders." : "Images take a few seconds."} It lands at the end of the video track.
      </p>
      <div className="ve-actions">
        <button type="button" className="ve-btn ve-btn-primary" disabled={!prompt.trim() || busy} onClick={() => void run()}>
          <Busy on={busy}>
            <Sparkles size={15} /> Generate {kind === "video" ? "shot" : "image"}
          </Busy>
        </button>
      </div>
    </>
  );
}

// ---------- Inspector ----------
function Num({ label, value, onChange, step = 0.1, min = 0, max, suffix = "s" }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  const [draft, setDraft] = useState(value.toFixed(2));
  useEffect(() => setDraft(value.toFixed(2)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (Number.isFinite(v)) onChange(Math.max(min, max !== undefined ? Math.min(max, v) : v));
    else setDraft(value.toFixed(2));
  };
  return (
    <label className="ve-num">
      <span>{label}</span>
      <span className="ve-num-box">
        <input inputMode="decimal" value={draft} step={step} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} aria-label={label} />
        <small>{suffix}</small>
      </span>
    </label>
  );
}

/** A recap cut ("cut12") in an edit made by Movie to Recap, which can ask for a better shot. */
const recapCut = (project: ReturnType<typeof vibe.get>["project"], clipId: string) =>
  recapSource(project) && /^cut\d+$/.test(clipId) ? Number(clipId.slice(3)) : null;

/** Swaps one recap cut for a better shot: the AI picks the frame, the media worker cuts it. */
async function replaceShot(clipId: string, t?: number) {
  const project = vibe.get().project;
  const clip = project.clips.find((c) => c.id === clipId);
  const index = recapCut(project, clipId);
  const source = recapSource(project);
  if (!clip || index == null || !source) return;
  const { asset, frame } = await findBetterShot(source.recapId, source.format, index, clip.note || "", t);
  vibe.commit((p) => ({
    ...p,
    assets: [...p.assets, asset],
    clips: p.clips.map((c) => (c.id === clipId ? { ...c, assetId: asset.id, in: 0, out: asset.duration || c.out - c.in, flagged: false, match: Number.isFinite(frame?.t) ? { film: frame.t } : undefined } : c)),
    updatedAt: Date.now(),
  }));
  return frame;
}

/** Better shot for a recap cut: a note for the AI (and the team), a flag, and the swap. */
function BetterShot({ clipId, note, flagged, set }: { clipId: string; note: string; flagged: boolean; set: (patch: { note?: string; flagged?: boolean }) => void }) {
  const project = useVibe((s) => s.project);
  const [busy, setBusy] = useState(false);
  const flaggedIds = project.clips.filter((c) => c.flagged && recapCut(project, c.id) != null).map((c) => c.id);
  const [ranked, setRanked] = useState<{ clipId: string; said: string; shots: RankedShot[] } | null>(null);
  const showRanked = async () => {
    const index = recapCut(project, clipId);
    const source = recapSource(project);
    if (index == null || !source) return;
    setBusy(true);
    try {
      const data = await withTask("Ranking shots for this narration", () => rankShots(source.recapId, source.format, index, note));
      setRanked({ clipId, said: data.said, shots: data.shots });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't rank shots");
    } finally {
      setBusy(false);
    }
  };
  const use = async (shot: RankedShot) => {
    setBusy(true);
    try {
      await withTask(`Cutting the shot at ${shot.filmTime}`, () => replaceShot(clipId, shot.t));
      toast.success("Swapped in the shot you chose");
      setRanked(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't use that shot");
    } finally {
      setBusy(false);
    }
  };
  const one = async () => {
    setBusy(true);
    try {
      const frame = await withTask("Finding a better shot", () => replaceShot(clipId));
      if (frame) toast.success(frame.why ? `New shot: ${frame.why}` : "Swapped in a better shot");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't find a better shot");
    } finally {
      setBusy(false);
    }
  };
  const all = async () => {
    setBusy(true);
    let done = 0;
    try {
      for (const id of flaggedIds) {
        await withTask(`Replacing flagged shots (${done + 1} of ${flaggedIds.length})`, () => replaceShot(id));
        done++;
      }
      toast.success(`Replaced ${done} flagged shot${done === 1 ? "" : "s"}`);
    } catch (error) {
      toast.error(`${done ? `Replaced ${done}, then: ` : ""}${error instanceof Error ? error.message : "Couldn't replace the shots"}`);
    } finally {
      setBusy(false);
    }
  };
  const clip = project.clips.find((c) => c.id === clipId);
  const end = clip ? clip.start + (clip.out - clip.in) : 0;
  // What the narration says over this cut, from the captions under it.
  const said = clip ? project.captions.cues.filter((c) => c.end > clip.start + 0.05 && c.start < end - 0.05).map((c) => c.text).join(" ") : "";
  const score = clip?.match?.score;
  const grade = score == null ? "" : score >= 87.5 ? "excellent" : score >= 62.5 ? "strong" : score >= 37.5 ? "plausible" : score >= 12.5 ? "weak" : "poor";
  const filmTime = (t: number) => { const s = Math.max(0, Math.round(t)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${r}` : `${m}:${r}`; };
  return (
    <Group title="Scene match">
      <div className="ve-match-now">
        {said ? <p className="ve-match-said">“{said}”</p> : null}
        <p className="ve-hint">
          {clip?.match?.film != null ? `Footage from ${filmTime(clip.match.film)} in the film` : "Footage from the film"}
          {grade ? <> · <span className={`ve-shot-match is-${grade}`}>{grade} {Math.round(score!)}</span></> : null}
          {clip?.note && /jump cut/i.test(clip.note) ? " · jump cut" : ""}
        </p>
      </div>
      <label className="ve-field">
        <span>What should this shot show?</span>
        <textarea className="ve-textarea" rows={2} value={note} maxLength={400} placeholder="Optional, e.g. Ned at the party, not the street" onChange={(e) => set({ note: e.target.value })} />
      </label>
      <label className="ve-prop-row">
        <span>Flag for a better shot</span>
        <input type="checkbox" checked={flagged} onChange={(e) => set({ flagged: e.target.checked })} />
      </label>
      <button type="button" className="ve-btn" disabled={busy} onClick={() => void one()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Find a better shot
      </button>
      <button type="button" className="ve-btn" disabled={busy} onClick={() => void showRanked()}>
        <Film size={14} /> Show the best shots
      </button>
      {ranked && ranked.clipId === clipId ? (
        <div className="ve-shots" role="list" aria-label="Best shots for this narration, ranked">
          <p className="ve-hint">For “{ranked.said}”</p>
          {ranked.shots.map((shot, k) => (
            <div key={shot.n} className="ve-shot" role="listitem">
              <span
                className="ve-shot-thumb"
                aria-hidden="true"
                style={{ backgroundImage: `url(/api/recaps/${encodeURIComponent(recapSource(project)!.recapId)}/sheets/${shot.sheet})`, backgroundPosition: `${(shot.col / 3) * 100}% ${(shot.row / 2) * 100}%` }}
              />
              <span className="ve-shot-body">
                <span className="ve-shot-head">
                  <b>{k + 1}</b>
                  <span className={`ve-shot-match is-${shot.match}`}>{shot.match}{shot.score != null ? ` ${shot.score}` : ""}</span>
                  <span className="ve-shot-time">{shot.filmTime}</span>
                  {shot.aiPick ? <span className="ve-shot-ai">AI pick</span> : null}
                </span>
                <span className="ve-shot-desc">{shot.description}</span>
              </span>
              <button type="button" className="ve-btn ve-shot-use" disabled={busy} onClick={() => void use(shot)}>Use</button>
            </div>
          ))}
        </div>
      ) : null}
      {flaggedIds.length ? (
        <button type="button" className="ve-btn" disabled={busy} onClick={() => void all()}>
          <Flag size={14} /> Replace all flagged shots ({flaggedIds.length})
        </button>
      ) : null}
      <p className="ve-hint">The AI looks near this point of the film for footage that matches the narration{note ? " and your note" : ""}, then cuts it with the same look.</p>
    </Group>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ve-group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Slider({ label, value, display, min, max, step, onChange }: { label: string; value: number; display: string; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <label className="ve-slider">
      <span>
        {label}
        <output>{display}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

function ProjectProps() {
  const project = useVibe((s) => s.project);
  const duration = projectDuration(project);
  const set = (patch: Partial<typeof project>, key: string) => vibe.commit((p) => ({ ...p, ...patch, updatedAt: Date.now() }), key);
  return (
    <div className="ve-props">
      <div className="ve-props-head">
        <span className="ve-kind">Project</span>
        <strong>{project.name}</strong>
      </div>
      <Group title="Frame">
        <div className="ve-seg ve-seg-block" role="radiogroup" aria-label="Frame">
          {VIBE_ASPECTS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={project.aspect === a.id} className={project.aspect === a.id ? "is-on" : ""} onClick={() => set({ aspect: a.id }, "aspect")}>
              <span className="ve-aspect-glyph" data-aspect={a.id} aria-hidden="true" />
              {a.id}
            </button>
          ))}
        </div>
        <label className="ve-prop-row">
          <span>Background</span>
          <span className="ve-color">
            <input type="color" value={project.background} onChange={(e) => set({ background: e.target.value }, "background")} aria-label="Background color" />
            <code>{project.background.toUpperCase()}</code>
          </span>
        </label>
        <label className="ve-prop-row">
          <span>Captions on video</span>
          <input type="checkbox" checked={project.captions.show} onChange={(e) => vibe.commit((p) => setCaptionLook(p, { show: e.target.checked }))} />
        </label>
      </Group>
      <Group title="Edit">
        <dl className="ve-stats">
          <div><dt>Length</dt><dd>{formatTimecode(duration)}</dd></div>
          <div><dt>Clips</dt><dd>{project.clips.length}</dd></div>
          <div><dt>Sounds</dt><dd>{project.audio.length}</dd></div>
          <div><dt>Captions</dt><dd>{project.captions.cues.length}</dd></div>
        </dl>
      </Group>
    </div>
  );
}

export function Inspector() {
  const project = useVibe((s) => s.project);
  const selection = useVibe((s) => s.selection);
  if (selection.length > 1) {
    return (
      <div className="ve-props">
        <div className="ve-props-head">
          <span className="ve-kind">Selection</span>
          <strong>{selection.length} items</strong>
        </div>
        <p className="ve-hint">Drag any of them on the timeline to move them together, or right-click one for more.</p>
        <button type="button" className="ve-btn" onClick={() => vibe.commit((p) => deleteItems(p, selection.filter((id) => !isLocked(p, id))))}>
          <Trash2 size={14} /> Delete {selection.length} items
        </button>
      </div>
    );
  }
  const id = selection[0] || "";
  const clip = project.clips.find((c) => c.id === id);
  const sound = project.audio.find((c) => c.id === id);
  const text = project.texts.find((t) => t.id === id);
  const cue = project.captions.cues.find((c) => c.id === id);
  if (!clip && !sound && !text && !cue) return <ProjectProps />;
  const set = (patch: Parameters<typeof updateItem>[2]) => vibe.commit((p) => updateItem(p, id, patch), `inspect:${id}:${Object.keys(patch).join()}`);
  const asset = clip ? assetById(project, clip.assetId) : sound ? assetById(project, sound.assetId) : undefined;
  const timed = clip || sound;
  const start = timed?.start ?? text?.start ?? cue!.start;
  const end = timed ? clipEnd(timed) : text?.end ?? cue!.end;
  const kind = clip ? (asset?.kind === "image" ? "Image" : "Video") : sound ? (asset?.origin === "voiceover" ? "Voiceover" : asset?.origin === "music" ? "Music" : "Audio") : text ? "Title" : "Caption";
  const locked = isLocked(project, id);
  return (
    <div className="ve-props">
      <div className="ve-props-head">
        <span className="ve-kind">{kind}{locked ? " · locked" : ""}</span>
        <strong>{text ? text.text || "Title" : cue ? cue.text : asset?.name || "Clip"}</strong>
        <button type="button" className="ve-tool" onClick={() => vibe.commit((p) => deleteItems(p, [id]))} disabled={locked} aria-label="Delete" title="Delete (⌫)">
          <Trash2 size={15} />
        </button>
      </div>
      <fieldset className="ve-props-body" disabled={locked}>
        <Group title="Timing">
          <div className="ve-num-grid">
            <Num label="Start" value={start} onChange={(v) => vibe.commit((p) => moveItem(p, id, v))} />
            <Num
              label="Length"
              value={end - start}
              min={0.1}
              onChange={(v) => (timed ? set({ out: timed.in + v }) : set({ end: start + v }))}
            />
            {timed && asset?.kind !== "image" ? <Num label="Source in" value={timed.in} max={asset?.duration} onChange={(v) => set({ in: v, out: v + (end - start) })} /> : null}
          </div>
        </Group>
        {text ? (
          <Group title="Text">
            <textarea className="ve-textarea" rows={2} value={text.text} onChange={(e) => set({ text: e.target.value })} aria-label="Title text" />
            <div className="ve-seg ve-seg-block" role="radiogroup" aria-label="Look">
              {(["plain", "boxed", "outline"] as const).map((l) => (
                <button key={l} type="button" role="radio" aria-checked={(text.look || "plain") === l} className={(text.look || "plain") === l ? "is-on" : ""} onClick={() => set({ look: l })}>
                  {l === "plain" ? "Shadow" : l === "boxed" ? "Boxed" : "Outline"}
                </button>
              ))}
            </div>
            <label className="ve-prop-row">
              <span>Color</span>
              <span className="ve-color">
                <input type="color" value={text.color} onChange={(e) => set({ color: e.target.value })} aria-label="Text color" />
                <code>{text.color.toUpperCase()}</code>
              </span>
            </label>
            <Slider label="Size" value={text.size} display={`${Math.round(text.size)}px`} min={28} max={180} step={1} onChange={(v) => set({ size: v })} />
            <Slider label="Horizontal" value={text.x} display={`${Math.round(text.x * 100)}%`} min={0.05} max={0.95} step={0.01} onChange={(v) => set({ x: v })} />
            <Slider label="Vertical" value={text.y} display={`${Math.round(text.y * 100)}%`} min={0.05} max={0.95} step={0.01} onChange={(v) => set({ y: v })} />
            <p className="ve-hint">Or drag the title on the preview.</p>
          </Group>
        ) : null}
        {cue ? (
          <Group title="Caption">
            <textarea className="ve-textarea" rows={3} value={cue.text} onChange={(e) => set({ text: e.target.value })} aria-label="Caption text" />
            <p className="ve-hint">Style every caption at once in the Captions panel.</p>
          </Group>
        ) : null}
        {clip && recapCut(project, clip.id) != null ? (
          <BetterShot clipId={clip.id} note={clip.note || ""} flagged={Boolean(clip.flagged)} set={set} />
        ) : null}
        {clip ? (
          <>
          <Group title="Picture">
            <div className="ve-seg ve-seg-block" role="radiogroup" aria-label="Framing">
              {(["fit", "fill"] as const).map((f) => (
                <button key={f} type="button" role="radio" aria-checked={(clip.fit || "fit") === f} className={(clip.fit || "fit") === f ? "is-on" : ""} onClick={() => set({ fit: f })}>
                  {f === "fit" ? "Fit" : "Fill & crop"}
                </button>
              ))}
            </div>
            <Slider label="Punch-in" value={clip.zoom || 1} display={`${Math.round((clip.zoom || 1) * 100)}%`} min={1} max={1.5} step={0.01} onChange={(v) => set({ zoom: v > 1.004 ? v : null })} />
          </Group>
          <Group title="Color">
            <label className="ve-prop-row">
              <span>Color boost</span>
              <input type="checkbox" checked={Boolean(clip.grade)} onChange={(e) => set({ grade: e.target.checked ? COLOR_BOOST : null })} />
            </label>
            {clip.grade ? (
              <>
                <Slider label="Contrast" value={clip.grade.contrast ?? 1} display={`${Math.round((clip.grade.contrast ?? 1) * 100)}%`} min={0.7} max={1.5} step={0.01} onChange={(v) => set({ grade: { ...clip.grade, contrast: v } })} />
                <Slider label="Saturation" value={clip.grade.saturation ?? 1} display={`${Math.round((clip.grade.saturation ?? 1) * 100)}%`} min={0} max={2} step={0.01} onChange={(v) => set({ grade: { ...clip.grade, saturation: v } })} />
                <Slider label="Brightness" value={clip.grade.brightness ?? 0} display={`${Math.round((clip.grade.brightness ?? 0) * 100)}`} min={-0.2} max={0.2} step={0.01} onChange={(v) => set({ grade: { ...clip.grade, brightness: v } })} />
              </>
            ) : null}
          </Group>
          </>
        ) : null}
        {clip && asset?.kind === "video" ? (
          <Group title="Clip audio">
            <label className="ve-prop-row">
              <span>Mute this clip</span>
              <input type="checkbox" checked={Boolean(clip.muted)} onChange={(e) => set({ muted: e.target.checked })} />
            </label>
            <Slider label="Volume" value={clip.volume ?? 1} display={`${Math.round((clip.volume ?? 1) * 100)}%`} min={0} max={2} step={0.05} onChange={(v) => set({ volume: v, muted: false })} />
            <label className="ve-field">
              <span>Voice treatment</span>
              <select value={clip.preset || "flat"} onChange={(e) => set({ preset: e.target.value === "flat" ? null : e.target.value })}>
                {SOUND_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}: {p.character}
                  </option>
                ))}
              </select>
            </label>
          </Group>
        ) : null}
        {sound ? (
          <>
            <Group title="Level">
              <Slider label="Volume" value={sound.volume} display={`${Math.round(sound.volume * 100)}%`} min={0} max={2} step={0.05} onChange={(v) => set({ volume: v })} />
              <Slider label="Fade in" value={sound.fadeIn || 0} display={`${(sound.fadeIn || 0).toFixed(1)}s`} min={0} max={5} step={0.1} onChange={(v) => set({ fadeIn: v })} />
              <Slider label="Fade out" value={sound.fadeOut || 0} display={`${(sound.fadeOut || 0).toFixed(1)}s`} min={0} max={5} step={0.1} onChange={(v) => set({ fadeOut: v })} />
            </Group>
            <Group title="Mix">
              <label className="ve-prop-row">
                <span>Duck other sound under this</span>
                <input type="checkbox" checked={sound.duck !== undefined} onChange={(e) => set({ duck: e.target.checked ? 0.4 : null })} />
              </label>
              {sound.duck !== undefined ? <Slider label="Others drop to" value={sound.duck} display={`${Math.round(sound.duck * 100)}%`} min={0} max={0.9} step={0.05} onChange={(v) => set({ duck: v })} /> : null}
              <label className="ve-field">
                <span>Voice treatment</span>
                <select value={sound.preset || "flat"} onChange={(e) => set({ preset: e.target.value === "flat" ? null : e.target.value })}>
                  {SOUND_PRESETS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}: {p.character}
                    </option>
                  ))}
                </select>
              </label>
            </Group>
          </>
        ) : null}
      </fieldset>
    </div>
  );
}

export function PanelBody({ panel, voicesLoading }: { panel: PanelId; voicesLoading: boolean }) {
  switch (panel) {
    case "auto":
      return <AutoEditPanel />;
    case "media":
      return <MediaPanel />;
    case "voice":
      return <VoicePanel voicesLoading={voicesLoading} />;
    case "captions":
      return <CaptionsPanel />;
    case "text":
      return (
        <>
          <TextPanel />
          <MotionTitles />
        </>
      );
    case "music":
      return <MusicPanel />;
    default:
      return <GeneratePanel />;
  }
}
