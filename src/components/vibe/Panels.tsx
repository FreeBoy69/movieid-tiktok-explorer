// The left-panel tools: media library, voice, captions, titles, music, and
// generation, plus the inspector for whatever is selected.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AudioLines, Captions, Film, Image as ImageIcon, Link2, Loader2, Mic, Music2, Pause, Play, Plus, Sparkles, Type, Upload, Wand2 } from "lucide-react";
import { VoicePicker } from "../VoicePicker";
import { toast } from "../../utils/toast";
import {
  addText,
  assetById,
  clipEnd,
  formatTime,
  setCaptionLook,
  updateItem,
  type VibeAsset,
} from "../../utils/vibeEdit";
import { SOUND_PRESETS } from "../../utils/vibeSound.js";
import { importAudioUrl, importLink, searchMusic, uploadMedia, type MusicTrack } from "./api";
import { addAndPlace, generate, generateCaptions, getVoices, placeMusic, readVoicePref, resolveVoice, voiceover, writeVoicePref } from "./commands";
import { CAPTION_STYLES } from "./overlay";
import { useVibe, vibe, withTask } from "./store";

export type PanelId = "media" | "voice" | "captions" | "text" | "music" | "generate";
export const PANELS: { id: PanelId; label: string; icon: ReactNode }[] = [
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
export function Inspector() {
  const project = useVibe((s) => s.project);
  const selection = useVibe((s) => s.selection);
  const id = selection.length === 1 ? selection[0] : "";
  const clip = project.clips.find((c) => c.id === id);
  const sound = project.audio.find((c) => c.id === id);
  const text = project.texts.find((t) => t.id === id);
  if (!clip && !sound && !text) return null;
  const set = (patch: Parameters<typeof updateItem>[2]) => vibe.commit((p) => updateItem(p, id, patch), `inspect:${id}:${Object.keys(patch).join()}`);
  const asset = clip ? assetById(project, clip.assetId) : sound ? assetById(project, sound.assetId) : undefined;
  return (
    <div className="ve-inspector" aria-label="Selected item">
      <div className="ve-sec-head">
        <h3>{text ? "Title" : asset?.name || "Clip"}</h3>
        <span className="ve-count">
          {formatTime(clip?.start ?? sound?.start ?? text!.start, true)}–{formatTime(clip ? clipEnd(clip) : sound ? clipEnd(sound) : text!.end, true)}
        </span>
      </div>
      {text ? (
        <>
          <textarea className="ve-textarea" rows={2} value={text.text} onChange={(e) => set({ text: e.target.value })} aria-label="Title text" />
          <div className="ve-row2">
            <label className="ve-field">
              <span>Color</span>
              <input type="color" value={text.color} onChange={(e) => set({ color: e.target.value })} />
            </label>
            <label className="ve-field">
              <span>Look</span>
              <select value={text.look || "plain"} onChange={(e) => set({ look: e.target.value as "plain" })}>
                <option value="plain">Shadow</option>
                <option value="boxed">Boxed</option>
                <option value="outline">Outline</option>
              </select>
            </label>
          </div>
          <label className="ve-field">
            <span>Size</span>
            <input type="range" min={28} max={180} value={text.size} onChange={(e) => set({ size: Number(e.target.value) })} />
          </label>
          <label className="ve-field">
            <span>Height</span>
            <input type="range" min={0.05} max={0.95} step={0.01} value={text.y} onChange={(e) => set({ y: Number(e.target.value) })} />
          </label>
        </>
      ) : null}
      {clip && asset?.kind !== "image" ? (
        <>
          <label className="ve-field">
            <span>Volume {Math.round((clip.muted ? 0 : clip.volume ?? 1) * 100)}%</span>
            <input type="range" min={0} max={2} step={0.05} value={clip.muted ? 0 : clip.volume ?? 1} onChange={(e) => set({ volume: Number(e.target.value), muted: false })} />
          </label>
        </>
      ) : null}
      {clip ? (
        <div className="ve-seg" role="radiogroup" aria-label="Framing">
          {(["fit", "fill"] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={(clip.fit || "fit") === f} className={(clip.fit || "fit") === f ? "is-on" : ""} onClick={() => set({ fit: f })}>
              {f === "fit" ? "Fit whole frame" : "Fill and crop"}
            </button>
          ))}
        </div>
      ) : null}
      {sound ? (
        <>
          <label className="ve-field">
            <span>Volume {Math.round(sound.volume * 100)}%</span>
            <input type="range" min={0} max={2} step={0.05} value={sound.volume} onChange={(e) => set({ volume: Number(e.target.value) })} />
          </label>
          <div className="ve-row2">
            <label className="ve-field">
              <span>Fade in {(sound.fadeIn || 0).toFixed(1)}s</span>
              <input type="range" min={0} max={5} step={0.1} value={sound.fadeIn || 0} onChange={(e) => set({ fadeIn: Number(e.target.value) })} />
            </label>
            <label className="ve-field">
              <span>Fade out {(sound.fadeOut || 0).toFixed(1)}s</span>
              <input type="range" min={0} max={5} step={0.1} value={sound.fadeOut || 0} onChange={(e) => set({ fadeOut: Number(e.target.value) })} />
            </label>
          </div>
          <label className="ve-check">
            <input type="checkbox" checked={sound.duck !== undefined} onChange={(e) => set({ duck: e.target.checked ? 0.4 : null })} />
            <span>Lower everything else while this plays</span>
          </label>
          <label className="ve-field">
            <span>Treatment</span>
            <select value={sound.preset || "flat"} onChange={(e) => set({ preset: e.target.value === "flat" ? null : e.target.value })}>
              {SOUND_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}: {p.character}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}

export function PanelBody({ panel, voicesLoading }: { panel: PanelId; voicesLoading: boolean }) {
  switch (panel) {
    case "media":
      return <MediaPanel />;
    case "voice":
      return <VoicePanel voicesLoading={voicesLoading} />;
    case "captions":
      return <CaptionsPanel />;
    case "text":
      return <TextPanel />;
    case "music":
      return <MusicPanel />;
    default:
      return <GeneratePanel />;
  }
}
