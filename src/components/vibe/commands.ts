// Editor commands shared by the panels and the assistant. Each one edits the
// project through the store (so it lands as one undo step) and throws a
// readable error on failure.
import {
  addAsset,
  addText,
  assetById,
  clipEnd,
  DUCK_DEFAULT,
  deleteItems,
  freeLane,
  moveItem,
  placeAsset,
  projectDuration,
  retimeCues,
  rippleDelete,
  scriptToLines,
  setCaptionLook,
  setCaptions,
  splitAt,
  updateItem,
  vibeId,
  wordsToCues,
  type VibeAspect,
  type VibeAsset,
  type VibeCue,
  type VibeProject,
  type VibeWord,
} from "../../utils/vibeEdit";
import type { VoiceProfile } from "../../utils/voiceProfiles";
import { findBroll, renderMotionTitle, generateMedia, importAudioUrl, searchMusic, synthesizeVoiceover, transcribeFile, voiceAsset, type ChatAction } from "./api";
import { brollMoments, COLOR_BOOST, gradeClips, punchInCuts, rippleRanges, speechCuts, type SpeechCuts } from "../../utils/vibeAutoEdit";
import { vibe, withTask } from "./store";

// The voice list, loaded once by the editor shell.
let voices: VoiceProfile[] = [];
export const setVoices = (list: VoiceProfile[]) => {
  voices = list;
};
export const getVoices = () => voices;

export function resolveVoice(wanted?: string): VoiceProfile | undefined {
  const w = String(wanted || "").trim().toLowerCase();
  const ready = voices.filter((v) => v.voiceType !== "cloned" || Number(v.sampleCount || 0) > 0);
  if (!w) return ready.find((v) => v.id === readVoicePref()) || ready[0];
  return ready.find((v) => v.id.toLowerCase() === w) || ready.find((v) => v.name.toLowerCase() === w) || ready.find((v) => v.name.toLowerCase().includes(w)) || ready[0];
}

const VOICE_KEY = "vibe-edit-voice";
export function readVoicePref(): string {
  try {
    return window.localStorage.getItem(VOICE_KEY) || "";
  } catch {
    return "";
  }
}
export function writeVoicePref(id: string) {
  try {
    window.localStorage.setItem(VOICE_KEY, id);
  } catch {
    // Preference only.
  }
}

const commit = (fn: (p: VibeProject) => VibeProject) => vibe.commit(fn);
const project = () => vibe.get().project;

/** Add media to the library and lay it on the timeline. */
export function addAndPlace(asset: VibeAsset, opts: { at?: number; track?: number; lane?: number; duck?: number; volume?: number; place?: boolean } = {}): string {
  let placed = "";
  commit((p) => {
    const next = addAsset(p, asset);
    if (opts.place === false) return next;
    const at = asset.kind === "audio" ? opts.at ?? vibe.get().playhead : opts.at;
    const r = placeAsset(next, asset.id, { ...opts, at });
    placed = r.id;
    return r.project;
  });
  return placed;
}

// ---------- Captions ----------
const transcripts = new Map<string, Promise<VibeWord[]>>();
function wordsOf(file: string) {
  if (!transcripts.has(file)) {
    const p = transcribeFile(file).then((r) => r.words);
    p.catch(() => transcripts.delete(file));
    transcripts.set(file, p);
  }
  return transcripts.get(file)!;
}

/** Every spoken word on the timeline, in timeline time, plus the span the speech sources cover. */
async function timelineWords(label = "Transcribing speech"): Promise<{ words: VibeWord[]; start: number; end: number }> {
  const p = project();
  const sources = [
    ...p.clips.filter((c) => !c.muted && c.track === 0 && assetById(p, c.assetId)?.kind === "video"),
    ...p.clips.filter((c) => !c.muted && c.track > 0 && assetById(p, c.assetId)?.kind === "video" && assetById(p, c.assetId)?.origin !== "generated" && (c.volume ?? 1) > 0),
    ...p.audio.filter((c) => assetById(p, c.assetId)?.origin !== "music"),
  ];
  const withFiles = sources.map((c) => ({ c, file: assetById(p, c.assetId)?.file })).filter((s): s is { c: (typeof sources)[number]; file: string } => Boolean(s.file));
  if (!withFiles.length) throw new Error("Add a clip with speech, or a voiceover, first.");
  const words = await withTask(label, async () => {
    const all: VibeWord[] = [];
    for (const { c, file } of withFiles) {
      const list = await wordsOf(file);
      for (const w of list) {
        if (w.t0 < c.in - 0.05 || w.t1 > c.out + 0.05) continue;
        all.push({ t0: c.start + (w.t0 - c.in), t1: c.start + (w.t1 - c.in), w: w.w });
      }
    }
    return all.sort((a, b) => a.t0 - b.t0);
  });
  if (!words.length) throw new Error("No speech was found on the timeline.");
  return { words, start: Math.min(...withFiles.map((s) => s.c.start)), end: Math.max(...withFiles.map((s) => clipEnd(s.c))) };
}

/** Transcribe every spoken source on the timeline into word-timed captions. */
export async function generateCaptions(): Promise<number> {
  const { words } = await timelineWords();
  const cues = wordsToCues(words);
  commit((q) => setCaptionLook(setCaptions(q, cues), { show: true }));
  return cues.length;
}

/** Cues for lines spoken back to back, words spread evenly over each line. */
function cuesFromLayout(layout: { start: number; duration: number; text: string }[], offset: number): VibeCue[] {
  return layout.flatMap((l) => {
    const words = l.text.split(/\s+/).filter(Boolean);
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += 7) chunks.push(words.slice(i, i + 7));
    const per = l.duration / Math.max(1, words.length);
    let k = 0;
    return chunks.map((chunk) => {
      const start = offset + l.start + k * per;
      const ws = chunk.map((w, j) => ({ w, t0: start + j * per, t1: start + (j + 1) * per }));
      k += chunk.length;
      return { id: vibeId("q"), start: ws[0].t0, end: ws[ws.length - 1].t1, text: chunk.join(" "), words: ws };
    });
  });
}

// ---------- Voiceover ----------
export interface VoiceoverOptions {
  script?: string;
  fromCaptions?: boolean;
  voice?: string;
  direction?: string;
  language?: string;
  at?: number;
  duck?: number;
  preset?: string;
  captions?: boolean;
}

export async function voiceover(o: VoiceoverOptions): Promise<string> {
  const voice = resolveVoice(o.voice);
  if (!voice) throw new Error("No voices are available right now.");
  const p = project();
  const duck = o.duck ?? DUCK_DEFAULT;
  if (o.fromCaptions || !o.script?.trim()) {
    const cues = p.captions.cues;
    if (!cues.length) throw new Error("Write a script, or add captions to read aloud.");
    const result = await withTask(`Voicing ${cues.length} lines as ${voice.name}`, () =>
      synthesizeVoiceover({ voiceId: voice.id, lines: cues.map((c) => ({ id: c.id, text: c.text, at: c.start })), direction: o.direction, language: o.language }),
    );
    const asset = voiceAsset(result, `${voice.name} reading captions`);
    commit((q) => {
      const r = placeAsset(addAsset(q, asset), asset.id, { at: result.start, duck: duck < 1 ? duck : undefined });
      const withPreset = o.preset ? updateItem(r.project, r.id, { preset: o.preset }) : r.project;
      // The spoken pace differs from the original, so the captions follow the new audio.
      const retimed = retimeCues(withPreset, result.layout.map((l) => ({ id: l.id, start: l.start, duration: l.duration })));
      // A translated read rewrites the captions in the spoken language.
      if (!result.language) return retimed;
      const byId = new Map(result.layout.map((l) => [l.id, l.text]));
      return { ...retimed, captions: { ...retimed.captions, cues: retimed.captions.cues.map((c) => (byId.get(c.id) && byId.get(c.id) !== c.text ? { ...c, text: byId.get(c.id)!, words: undefined } : c)) } };
    });
    return `${voice.name} read ${cues.length} caption lines`;
  }
  const lines = scriptToLines(o.script);
  const at = Math.max(0, o.at ?? vibe.get().playhead);
  const result = await withTask(`Voicing script as ${voice.name}`, () =>
    synthesizeVoiceover({ voiceId: voice.id, lines: lines.map((text, i) => ({ id: `l${i}`, text })), direction: o.direction, language: o.language }),
  );
  const asset = voiceAsset(result, `${voice.name} voiceover`);
  commit((q) => {
    const r = placeAsset(addAsset(q, asset), asset.id, { at, duck: duck < 1 ? duck : undefined });
    let next = o.preset ? updateItem(r.project, r.id, { preset: o.preset }) : r.project;
    if (o.captions !== false && !next.captions.cues.length) next = setCaptionLook(setCaptions(next, cuesFromLayout(result.layout, at)), { show: true });
    return next;
  });
  return `${voice.name} voiced ${lines.length} lines (${result.duration.toFixed(1)}s)`;
}

// ---------- Music ----------
export async function addMusic(query: string, volume = 0.25): Promise<string> {
  const tracks = await withTask(`Finding music: ${query}`, () => searchMusic(query));
  const track = tracks[0];
  if (!track) throw new Error(`No royalty-free music matched "${query}".`);
  const asset = await withTask(`Adding "${track.title}"`, () => importAudioUrl(track.url, track.title));
  placeMusic(asset, volume);
  return `Added "${track.title}"${track.creator ? ` by ${track.creator}` : ""} (${track.license || "royalty-free"})`;
}

export function placeMusic(asset: VibeAsset, volume = 0.25) {
  commit((p) => {
    const length = projectDuration(p);
    const next = addAsset(p, asset);
    const lane = freeLane(next, 0, Math.max(1, length));
    const r = placeAsset(next, asset.id, { at: 0, lane, volume });
    const out = length > 1 && asset.duration && asset.duration > length ? length : asset.duration || length;
    return updateItem(r.project, r.id, { out, fadeIn: 0.5, fadeOut: Math.min(2, out / 4) });
  });
}

// ---------- Generation ----------
export async function generate(kind: "image" | "video", prompt: string, opts: { at?: number; seconds?: number } = {}): Promise<string> {
  const aspect: VibeAspect = project().aspect;
  const asset = await withTask(kind === "video" ? "Generating a video shot" : "Generating an image", () => generateMedia(kind, prompt, aspect, opts.seconds));
  addAndPlace(asset, opts.at !== undefined ? { at: opts.at } : {});
  return `Generated ${kind === "video" ? "a shot" : "an image"}: ${prompt.slice(0, 60)}`;
}

// ---------- Auto edit ----------
/** Cut dead air, filler words, and retakes out of the whole timeline. */
export async function removePauses(kinds: { silences?: boolean; fillers?: boolean; retakes?: boolean } = {}): Promise<SpeechCuts> {
  const { words, start, end } = await timelineWords("Listening for pauses");
  const cuts = speechCuts(words, kinds, { start, end });
  if (cuts.ranges.length) commit((p) => rippleRanges(p, cuts.ranges));
  return cuts;
}

const videoClips = (p: VibeProject) => p.clips.filter((c) => assetById(p, c.assetId)?.kind === "video");

const sources = (clips: { assetId: string }[]) => new Set(clips.map((c) => c.assetId)).size;

/** Put the clean-up voice treatment on every clip that carries its own sound. Returns how many videos. */
export function cleanAudio(on = true): number {
  const clips = videoClips(project()).filter((c) => !c.muted && (c.volume ?? 1) > 0);
  if (clips.length) commit((p) => clips.reduce((q, c) => updateItem(q, c.id, { preset: on ? "cleanup" : null }), p));
  return sources(clips);
}

/** A quick contrast and saturation lift on the footage (b-roll included). Returns how many videos. */
export function colorBoost(on = true): number {
  const clips = videoClips(project());
  if (clips.length) commit((p) => gradeClips(p, on ? COLOR_BOOST : undefined, clips.map((c) => c.id)));
  return sources(clips);
}

export function punchIns(): number {
  let count = 0;
  commit((p) => {
    const r = punchInCuts(p);
    count = r.count;
    return r.project;
  });
  return count;
}

/** Stock b-roll over a few spoken moments, on the track above, voice still running under it. */
export async function addBroll(count = 4): Promise<number> {
  const p = project();
  const cues = p.captions.cues.length ? p.captions.cues : wordsToCues((await timelineWords()).words);
  const moments = brollMoments(cues, { count });
  if (!moments.length) throw new Error("The video is too short for b-roll. Add more speech first.");
  const clips = await withTask("Finding b-roll", () => findBroll(moments, p.aspect, p.name));
  commit((q) => {
    let next = q;
    // Its own track, above everything already there.
    const track = Math.max(0, ...q.clips.map((c) => c.track)) + 1;
    for (const clip of clips) {
      const asset: VibeAsset = { id: vibeId("as"), kind: "video", name: `B-roll: ${clip.term}`, url: clip.url, file: clip.file, duration: clip.duration, width: clip.width, height: clip.height, origin: "generated" };
      next = addAsset(next, asset);
      const placed = placeAsset(next, asset.id, { at: clip.start, track });
      next = updateItem(placed.project, placed.id, { out: Math.min(clip.duration, clip.seconds), muted: true, fit: "fill" });
    }
    return next;
  });
  return clips.length;
}

// ---------- Motion titles ----------
/** Animate a name tag, place, number, keyword, or countdown tag and lay it over the picture at the playhead. */
export async function addMotionTitle(kind: string, vars: Record<string, string>, look = "none", at = vibe.get().playhead): Promise<string> {
  const p = project();
  const made = await withTask("Animating the title", () => renderMotionTitle(kind, vars, look, p.aspect));
  const asset: VibeAsset = { id: vibeId("as"), kind: "video", name: `Motion: ${Object.values(vars)[0] || kind}`, url: made.url, file: made.file, duration: made.seconds, width: made.width, height: made.height, origin: "generated" };
  let placed = "";
  commit((q) => {
    // Above every picture track, so it plays over whatever is there.
    const track = Math.max(0, ...q.clips.map((c) => c.track)) + 1;
    const r = placeAsset(addAsset(q, asset), asset.id, { at, track });
    placed = r.id;
    return updateItem(r.project, r.id, { muted: true, fit: "fit" });
  });
  vibe.select([placed]);
  return "Added a motion title";
}

// ---------- Assistant actions ----------
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Run the assistant's actions in order. Returns one line per action. */
export async function runActions(actions: ChatAction[]): Promise<{ done: string[]; failed: string[] }> {
  const done: string[] = [];
  const failed: string[] = [];
  for (const { type, args } of actions) {
    try {
      switch (type) {
        case "remove_pauses": {
          const c = await removePauses({ silences: args.silences !== false, fillers: args.fillers !== false, retakes: args.retakes !== false });
          done.push(c.ranges.length ? `Cut ${c.seconds.toFixed(1)}s: ${c.silences.length} pauses, ${c.fillers.length} filler words, ${c.retakes.length} retakes` : "Nothing to cut");
          break;
        }
        case "clean_audio":
          done.push(`Cleaned the sound of ${cleanAudio(args.on !== false)} video(s)`);
          break;
        case "color_boost":
          done.push(`Graded ${colorBoost(args.on !== false)} video(s)`);
          break;
        case "punch_in":
          done.push(`${punchIns()} punch-ins`);
          break;
        case "add_broll":
          done.push(`Added ${await addBroll(Math.min(6, Math.max(1, num(args.count) ?? 4)))} b-roll clips`);
          break;
        case "add_text": {
          const at = num(args.start) ?? vibe.get().playhead;
          commit((p) => addText(p, { text: str(args.text) || "Title", start: at, end: num(args.end) ?? at + 3, ...(num(args.y) !== undefined ? { y: num(args.y) } : {}), ...(num(args.size) ? { size: num(args.size) } : {}), ...(str(args.color) ? { color: str(args.color) } : {}), ...(str(args.look) ? { look: str(args.look) as "plain" } : {}) }, at).project);
          done.push(`Added title "${str(args.text)}"`);
          break;
        }
        case "update_item": {
          const id = str(args.id);
          if (!id) throw new Error("No item id");
          const { id: _id, ...patch } = args;
          commit((p) => updateItem(p, id, patch as never));
          done.push("Updated an item");
          break;
        }
        case "move_item":
          commit((p) => moveItem(p, String(args.id), num(args.start) ?? 0, num(args.row)));
          done.push("Moved an item");
          break;
        case "delete_items":
          commit((p) => deleteItems(p, (Array.isArray(args.ids) ? args.ids : []).map(String)));
          done.push("Removed items");
          break;
        case "ripple_delete":
          commit((p) => rippleDelete(p, String(args.id)));
          done.push("Removed a clip and closed the gap");
          break;
        case "split_at":
          commit((p) => splitAt(p, num(args.time) ?? vibe.get().playhead, Array.isArray(args.ids) ? args.ids.map(String) : undefined));
          done.push("Split at the playhead");
          break;
        case "place_asset": {
          const asset = assetById(project(), String(args.assetId));
          if (!asset) throw new Error("That media isn't in the project");
          commit((p) => placeAsset(p, asset.id, { at: num(args.at), track: num(args.track) }).project);
          done.push(`Placed ${asset.name}`);
          break;
        }
        case "set_aspect":
          if (["16:9", "9:16", "1:1", "4:5"].includes(String(args.aspect))) commit((p) => ({ ...p, aspect: args.aspect as VibeAspect, updatedAt: Date.now() }));
          done.push(`Frame set to ${args.aspect}`);
          break;
        case "set_background":
          if (/^#[0-9a-f]{6}$/i.test(String(args.color))) commit((p) => ({ ...p, background: String(args.color), updatedAt: Date.now() }));
          done.push("Changed the background");
          break;
        case "rename":
          if (str(args.name)) commit((p) => ({ ...p, name: String(args.name).slice(0, 120), updatedAt: Date.now() }));
          done.push(`Renamed to ${args.name}`);
          break;
        case "caption_look": {
          const look: Record<string, unknown> = {};
          for (const k of ["style", "show", "wordHighlight", "size", "y"]) if (args[k] !== undefined) look[k] = args[k];
          commit((p) => setCaptionLook(p, look));
          done.push("Restyled captions");
          break;
        }
        case "generate_captions":
          done.push(`Captioned ${await generateCaptions()} lines`);
          break;
        case "edit_captions": {
          const edits = new Map((Array.isArray(args.cues) ? args.cues : []).map((c) => [String((c as { id: unknown }).id), String((c as { text: unknown }).text || "")]));
          commit((p) => [...edits].reduce((q, [id, text]) => (text ? updateItem(q, id, { text }) : q), p));
          done.push(`Edited ${edits.size} caption lines`);
          break;
        }
        case "voiceover":
          done.push(await voiceover({ script: str(args.script), fromCaptions: args.fromCaptions === true, voice: str(args.voice), direction: str(args.direction), language: str(args.language), at: num(args.at), duck: num(args.duck) }));
          break;
        case "add_music":
          done.push(await addMusic(str(args.query) || "calm instrumental", num(args.volume) ?? 0.25));
          break;
        case "generate_image":
          done.push(await generate("image", str(args.prompt) || "", { at: num(args.at) }));
          break;
        case "generate_video":
          done.push(await generate("video", str(args.prompt) || "", { at: num(args.at), seconds: num(args.seconds) }));
          break;
        case "seek":
          vibe.seek(num(args.time) ?? 0);
          break;
        default:
          break;
      }
    } catch (error) {
      failed.push(`${type.replace(/_/g, " ")}: ${(error as Error).message}`);
    }
  }
  return { done, failed };
}
