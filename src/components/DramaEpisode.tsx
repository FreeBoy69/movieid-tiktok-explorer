// Create Drama, episode editor: Screenplay -> Scenes -> Final cut.
// Each scene is one continuous moment that becomes one video clip: its
// storyboard grid, its voiced dialogue track, then the Seedance render.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Empty, Modal, creatorApi } from "./CreatorWorkspace";
import { PlayButton } from "./DramaCast";
import { Lightbox } from "./studio/studioShared";
import { FILM_FORMATS } from "../utils/filmFormats.js";
import { CameraPicker, clock, filmLink, formatOfRoute, type LyricLine } from "./FilmParts";
import { DRAMA_MODELS, estimateSceneSeconds, fmtClock, sceneWords } from "../utils/dramaProduction";
import { toast } from "../utils/toast";
import { VideoPlayer } from "./VideoPlayer";
import { ProductionPreflight, type ProductionReview } from "./ProductionPreflight";
import { usdToCredits } from "../utils/credits";
import { confirm as confirmDialog } from "./ui/Dialog";
import { Segmented } from "./ui/controls";

type Beat = { id: string; cam: string; shot?: string; angle?: string; perspective?: string; motion?: string; move: string; speaker: string; emotion: string; line: string };
type Scene = { id: string; title: string; locationId: string; summary: string; beats: Beat[]; start?: number; end?: number; bars?: number; lyrics?: LyricLine[] };
type Step = { status?: string; error?: string; progress?: string; asset?: string; stale?: boolean; seconds?: number; timeline?: any[]; quality?: string; cost?: number | null; captions?: string; references?: string; silent?: boolean; music?: boolean };
type Episode = {
  id: string;
  title: string;
  version: number;
  seriesId: string;
  seriesTitle: string;
  format?: string;
  song?: { asset: string; duration: number; bpm?: number };
  n: number;
  plan: { title: string; hook: string; goal: string; turn: string; payoff: string; cliffhanger: string } | null;
  settings: { quality: "final" | "draft"; subtitles: boolean; titleCards?: boolean; aspect?: string };
  script: { status?: string; error?: string; scenes: Scene[] };
  scenes: Record<string, { board: Step | null; voice: Step | null; clip: Step | null }>;
  final: Step | null;
  qualityReview?: ProductionReview | null;
  cast: Array<{ id: string; name: string; speaker: string; sheet: string; voiceId: string }>;
  locations: Array<{ id: string; name: string; sheet: string }>;
  estimate: Array<{ id: string; cost: number }>;
};
type Tab = "script" | "scenes" | "final";

const running = (step?: Step | null) => step?.status === "running";
const newId = (prefix: string) => `${prefix}${Math.random().toString(36).slice(2, 8)}`;

export function DramaEpisode({ accountId, seriesId, episodeId, onError }: { accountId: string; seriesId: string; episodeId: string; onError: (e: string) => void }) {
  const [episode, setEpisode] = useState<Episode | null>(null),
    [pricing, setPricing] = useState({ tokensPerUsd: 1_000_000 }),
    [missing, setMissing] = useState(false),
    [tab, setTab] = useState<Tab>("script"),
    [draft, setDraft] = useState<Scene[] | null>(null),
    [saving, setSaving] = useState(false),
    [busy, setBusy] = useState(""),
    [confirm, setConfirm] = useState<{ scene: Scene | null; count: number; seconds: number; cost: number } | null>(null),
    [note, setNote] = useState(""),
    [rewrite, setRewrite] = useState(false),
    [zoom, setZoom] = useState(""),
    [qualityBusy, setQualityBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const firstLoad = useRef(true);
  const url = `/api/drama/episodes/${encodeURIComponent(episodeId)}`;

  async function load() {
    try {
      const data = await creatorApi(`${url}?accountId=${encodeURIComponent(accountId)}`);
      const next: Episode = data.episode;
      setEpisode(next);
      if (firstLoad.current) {
        firstLoad.current = false;
        const scenes = next.script.scenes || [];
        setTab(!scenes.length ? "script" : next.final?.asset || scenes.every((scene) => next.scenes[scene.id]?.clip?.asset) ? "final" : "scenes");
      }
      const busyNow =
        running(next.script) ||
        running(next.final) ||
        Object.values(next.scenes).some((state) => running(state.board) || running(state.voice) || running(state.clip));
      clearTimeout(timer.current);
      if (busyNow) timer.current = setTimeout(load, 4000);
    } catch (e) {
      if ((e as { status?: number }).status === 404) setMissing(true);
      else onError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    void fetch("/api/billing/me", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((data) => {
      if (data?.pricing?.tokensPerUsd) setPricing({ tokensPerUsd: Number(data.pricing.tokensPerUsd) || 1_000_000 });
    }).catch(() => {});
    return () => clearTimeout(timer.current);
  }, [episodeId, accountId]);

  const scenes = draft || episode?.script.scenes || [];
  const sceneAspect = (episode?.settings.aspect || "9:16").replace(":", " / ");
  const dirty = draft !== null;
  const speakers = useMemo(() => (episode?.cast || []).map((character) => character.speaker), [episode]);

  async function post(label: string, path: string, body: Record<string, unknown> = {}) {
    setBusy(label);
    try {
      const data = await creatorApi(`${url}${path}`, { accountId, ...body });
      await load();
      return data || true;
    } catch (e) {
      onError((e as Error).message);
      return null;
    } finally {
      setBusy("");
    }
  }
  async function saveScript() {
    if (!episode || !draft) return true;
    setSaving(true);
    try {
      const data = await creatorApi(url, { accountId, scenes: draft, expectedVersion: episode.version }, "PATCH");
      setEpisode(data.episode);
      setDraft(null);
      return true;
    } catch (e) {
      onError((e as Error).message);
      if ((e as { status?: number }).status === 409) void load();
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function setSetting(settings: Partial<Episode["settings"]>) {
    if (!episode) return;
    try {
      const data = await creatorApi(url, { accountId, settings }, "PATCH");
      setEpisode(data.episode);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  async function runQualityReview() {
    setQualityBusy(true);
    try {
      const data = await creatorApi(`${url}/quality-review`, { accountId, aspect: episode?.settings.aspect || "9:16" });
      if (data.episode) setEpisode(data.episode);
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setQualityBusy(false);
    }
  }
  const edit = (next: Scene[]) => setDraft(next);
  const editScene = (id: string, patch: Partial<Scene>) => edit(scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene)));
  const editBeat = (sceneId: string, beatId: string, patch: Partial<Beat>) =>
    editScene(sceneId, { beats: scenes.find((scene) => scene.id === sceneId)!.beats.map((beat) => (beat.id === beatId ? { ...beat, ...patch } : beat)) });

  if (missing)
    return (
      <div className="maker-scroll">
        <div className="maker-page">
          <Empty title="Episode not found" text="It may have been deleted, or it belongs to another channel.">
            <button className="maker-primary" onClick={() => filmLink({ seriesId })}>
              Back to the series
            </button>
          </Empty>
        </div>
      </div>
    );
  if (!episode)
    return (
      <div className="maker-scroll">
        <div className="maker-loading">
          <Loader2 className="animate-spin" />
          Loading episode
        </div>
      </div>
    );

  const quality = episode.settings.quality;
  const tier = DRAMA_MODELS.video[quality];
  const format = formatOfRoute(episode.format);
  const kind = FILM_FORMATS[format];
  const music = format === "music";
  const sceneSpan = (scene: Scene) => (scene.end !== undefined && scene.start !== undefined ? scene.end - scene.start : 0);
  const sceneSeconds = (scene: Scene) => (music ? Math.ceil(sceneSpan(scene)) : Math.ceil(estimateSceneSeconds(scene)));
  const stateOf = (scene: Scene) => episode.scenes[scene.id] || { board: null, voice: null, clip: null };
  const boardsDone = scenes.filter((scene) => stateOf(scene).board?.asset).length;
  const voicesDone = scenes.filter((scene) => stateOf(scene).voice?.asset).length;
  const clipsDone = scenes.filter((scene) => stateOf(scene).clip?.asset).length;
  // Scenes ready to render whose clip is missing or out of date.
  const toRender = scenes.filter((scene) => {
    const state = stateOf(scene);
    return state.board?.asset && state.voice?.asset && !running(state.clip) && (!state.clip?.asset || state.clip.stale);
  });
  const costOf = (scene: Scene) => episode.estimate.find((item) => item.id === scene.id)?.cost || 0;
  const creditsOf = (usd: number) => usdToCredits(usd, pricing.tokensPerUsd);
  const missingLooks = episode.cast.filter((character) => !character.sheet);
  // Only characters who speak in this screenplay need a voice; a music video needs none.
  const speaking = new Set(scenes.flatMap((scene) => scene.beats.filter((beat) => beat.line).map((beat) => beat.speaker)));
  const missingVoices = kind.dialogue ? episode.cast.filter((character) => !character.voiceId && speaking.has(character.speaker)) : [];
  const totalSeconds = scenes.reduce((sum, scene) => sum + (stateOf(scene).voice?.seconds || sceneSeconds(scene)), 0);
  const tabs: Array<[Tab, string, string]> = [
    ["script", "Screenplay", scenes.length ? `${scenes.length} scenes` : "Not written"],
    ["scenes", "Scenes", scenes.length ? `${clipsDone} of ${scenes.length} rendered` : "After the screenplay"],
    ["final", "Final cut", episode.final?.asset ? "Rendered" : clipsDone === scenes.length && scenes.length ? "Ready to cut" : "After the scenes"],
  ];
  const go = async (next: Tab) => {
    if (dirty && !(await saveScript())) return;
    setTab(next);
  };

  return (
    <>
      <div className="maker-topbar">
        <div className="maker-topbar-left">
          <button
            className="maker-ghost"
            onClick={async () => {
              if (!dirty || (await confirmDialog({ title: "Leave without saving?", body: "Your screenplay edits will be lost.", confirmLabel: "Leave", danger: true }))) filmLink({ seriesId }, formatOfRoute(episode?.format));
            }}
          >
            <ArrowLeft size={16} />
            {episode.seriesTitle}
          </button>
        </div>
        <div className="maker-actions">
          <Segmented
            label="Render quality"
            className="dr-quality"
            value={quality}
            onChange={(next) => void setSetting({ quality: next as typeof quality })}
            options={(["draft", "final"] as const).map((key) => ({ value: key, label: key === "draft" ? "Draft" : "Final", hint: DRAMA_MODELS.video[key].resolution, title: DRAMA_MODELS.video[key].label }))}
          />
        </div>
      </div>
      <div className="maker-scroll">
        <div className="maker-page is-wide dr-page">
          <header className="dr-ep-head">
            <span className="dr-ep-n">{kind.count.max > 1 ? `${kind.unit} ${episode.n}` : kind.label}</span>
            <h1>{episode.title}</h1>
            {episode.plan?.hook && <p className="dr-logline">{episode.plan.hook}</p>}
          </header>
          <nav className="dr-steps" aria-label="Episode steps">
            {tabs.map(([key, label, caption], index) => (
              <button key={key} type="button" aria-current={tab === key ? "step" : undefined} onClick={() => void go(key)}>
                <span className="dr-step-n">{index + 1}</span>
                <span>
                  <strong>{label}</strong>
                  <small>{caption}</small>
                </span>
              </button>
            ))}
          </nav>

          {(missingLooks.length > 0 || missingVoices.length > 0) && (
            <div className="dr-notice" role="status">
              <AlertCircle size={16} aria-hidden="true" />
              <span>
                {missingLooks.length > 0 && `Lock a look for ${missingLooks.map((c) => c.name.split(" ")[0]).join(", ")}. `}
                {missingVoices.length > 0 && `Choose a voice for ${missingVoices.map((c) => c.name.split(" ")[0]).join(", ")}. `}
                {kind.dialogue ? "Storyboards and voices use the cast." : "Storyboards and clips use the cast."}
              </span>
              <button type="button" className="maker-outline dr-small" onClick={() => filmLink({ seriesId }, formatOfRoute(episode?.format))}>
                Open cast
              </button>
            </div>
          )}

          {tab === "script" && (
            <section aria-label="Screenplay">
              {running(episode.script) ? (
                <div className="dr-writing" aria-live="polite">
                  <Loader2 className="animate-spin" size={20} />
                  <div>
                    <strong>{music ? "Writing the shot list" : "Writing the screenplay"}</strong>
                    <p>{music ? `Cutting the song into scenes on ${episode.song?.bpm ? "its bars" : "the lyrics"} and directing each shot, with the camera for every one. About a minute.` : `Breaking the ${kind.unit.toLowerCase()} into scenes, shots, and lines, with the camera for every shot. About a minute.`}</p>
                  </div>
                </div>
              ) : !scenes.length ? (
                <div className="dr-start">
                  <Clapperboard size={22} aria-hidden="true" />
                  <h2>{music ? "Write the shot list" : `Write the ${kind.unit.toLowerCase()}'s screenplay`}</h2>
                  <p>
                    {music
                      ? episode.song?.bpm
                        ? `The song is cut into scenes on its bar lines at ${episode.song.bpm} BPM, favouring the bars where lyric lines begin (up to 12 seconds each, one clip per scene). Shots change on the beat, and the singer lip-syncs the lines that fall in each scene. You can edit every shot afterwards.`
                        : `The song is cut into scenes on its lyric lines (up to 12 seconds each, one clip per scene), and each scene gets performance and story shots, with the singer lip-syncing the lines that fall in it. You can edit every shot afterwards.`
                      : `AI turns the plan into scenes. Each scene is one continuous moment in one location, told in short shots with a camera angle, framing, and move for each, and a line per character or none at all. You can edit every shot and line afterwards.`}
                  </p>
                  {episode.plan && (
                    <dl className="dr-beats dr-plan">
                      {(
                        [
                          [kind.plan.hook, episode.plan.hook],
                          [kind.plan.goal, episode.plan.goal],
                          [kind.plan.turn, episode.plan.turn],
                          [kind.plan.payoff, episode.plan.payoff],
                          [kind.plan.cliffhanger, episode.plan.cliffhanger],
                        ] as const
                      ).map(([label, text]) =>
                        text ? (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{text}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  )}
                  <label className="maker-field">
                    Notes for the writer (optional)
                    <textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. More tension in the second scene; end on Claire's face." />
                  </label>
                  {episode.script.status === "failed" && (
                    <p className="dr-error" role="alert">
                      <AlertCircle size={14} /> {episode.script.error}
                    </p>
                  )}
                  <button className="maker-primary maker-lg" disabled={Boolean(busy)} onClick={() => void post("script", "/script", { note })}>
                    {busy === "script" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    {music ? "Write shot list" : "Write screenplay"}
                  </button>
                </div>
              ) : (
                <>
                  <div className="dr-toolbar">
                    <span className="dr-count">
                      {scenes.length} scenes · about {fmtClock(totalSeconds)}{music ? "" : ` · ${scenes.reduce((sum, scene) => sum + sceneWords(scene), 0)} spoken words`}
                    </span>
                    <div className="maker-actions">
                      <button type="button" className="maker-outline" onClick={() => setRewrite(true)}>
                        <RotateCcw size={15} />
                        Rewrite
                      </button>
                      {dirty && (
                        <button type="button" className="maker-outline" onClick={() => setDraft(null)}>
                          Discard
                        </button>
                      )}
                      <button type="button" className="maker-primary" disabled={!dirty || saving} onClick={() => void saveScript()}>
                        {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        {dirty ? "Save screenplay" : "Saved"}
                      </button>
                    </div>
                  </div>
                  <ol className="dr-script">
                    {scenes.map((scene, sceneIndex) => {
                      const seconds = sceneSeconds(scene);
                      const over = seconds > tier.maxSeconds;
                      return (
                        <li key={scene.id} className="dr-script-scene">
                          <div className="dr-scene-top">
                            <span className="dr-episode-n">{String(sceneIndex + 1).padStart(2, "0")}</span>
                            <input className="dr-scene-title" aria-label="Scene title" value={scene.title} maxLength={80} onChange={(e) => editScene(scene.id, { title: e.target.value })} />
                            <select aria-label="Location" value={scene.locationId} onChange={(e) => editScene(scene.id, { locationId: e.target.value })}>
                              {episode.locations.map((location) => (
                                <option key={location.id} value={location.id}>
                                  {location.name}
                                </option>
                              ))}
                              {!episode.locations.length && <option value="">No locations</option>}
                            </select>
                            <span className={`dr-time ${over ? "is-over" : ""}`} title={music ? scene.bars ? "Where this scene sits in the song; it starts and ends on a bar line" : "Where this scene sits in the song" : over ? `One clip holds ${tier.maxSeconds}s at this quality. Split the scene or trim lines.` : "Estimated clip length"}>
                              {music && scene.start !== undefined ? `${clock(scene.start)}–${clock(scene.end || 0)}${scene.bars ? ` · ${scene.bars} bar${scene.bars === 1 ? "" : "s"}` : ""}` : `~${seconds}s`}{over ? ` · over ${tier.maxSeconds}s` : ""}
                            </span>
                            <button
                              type="button"
                              className="maker-icon"
                              aria-label={`Delete scene ${sceneIndex + 1}`}
                              title="Delete scene"
                              onClick={async () => (await confirmDialog({ title: `Delete scene ${sceneIndex + 1}?`, confirmLabel: "Delete scene", danger: true })) && edit(scenes.filter((item) => item.id !== scene.id))}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                          <input className="dr-scene-summary" aria-label="What changes in this scene" value={scene.summary} maxLength={300} placeholder="What changes in this scene" onChange={(e) => editScene(scene.id, { summary: e.target.value })} />
                          <div className="dr-beat-head" aria-hidden="true">
                            <span>Camera</span>
                            <span>Action</span>
                            <span>{music ? "Performer · lyric" : "Line"}</span>
                          </div>
                          <ol className="dr-beat-list">
                            {scene.beats.map((beat, beatIndex) => (
                              <li key={beat.id} className="dr-beat">
                                <CameraPicker value={beat} onChange={(patch) => editBeat(scene.id, beat.id, patch)} />
                                <input aria-label="Action" value={beat.move} maxLength={160} placeholder="What happens in frame" onChange={(e) => editBeat(scene.id, beat.id, { move: e.target.value })} />
                                <div className="dr-beat-line">
                                  <select aria-label="Speaker" value={beat.speaker} onChange={(e) => editBeat(scene.id, beat.id, { speaker: e.target.value, ...(e.target.value ? {} : { line: "" }) })}>
                                    <option value="">{music ? "Nobody sings" : "Silent"}</option>
                                    {speakers.map((speaker) => (
                                      <option key={speaker} value={speaker}>
                                        {speaker}
                                      </option>
                                    ))}
                                    {beat.speaker && !speakers.includes(beat.speaker) && <option value={beat.speaker}>{beat.speaker}</option>}
                                  </select>
                                  <input aria-label="Delivery" className="dr-emotion" value={beat.emotion} maxLength={60} placeholder={music ? "energy" : "delivery"} onChange={(e) => editBeat(scene.id, beat.id, { emotion: e.target.value })} disabled={!beat.speaker} />
                                  {music ? (
                                    <select aria-label="Lyric sung in this shot" value={beat.line} disabled={!beat.speaker} onChange={(e) => editBeat(scene.id, beat.id, { line: e.target.value })}>
                                      <option value="">(no singing)</option>
                                      {(scene.lyrics || []).map((line) => (
                                        <option key={line.id} value={line.text}>{line.text}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <input aria-label="Line" value={beat.line} maxLength={240} placeholder={beat.speaker ? "What they say" : "(no words)"} disabled={!beat.speaker} onChange={(e) => editBeat(scene.id, beat.id, { line: e.target.value })} />
                                  )}
                                </div>
                                <div className="dr-beat-tools">
                                  <button type="button" className="maker-icon" aria-label="Move up" disabled={beatIndex === 0} onClick={() => {
                                    const beats = [...scene.beats];
                                    [beats[beatIndex - 1], beats[beatIndex]] = [beats[beatIndex], beats[beatIndex - 1]];
                                    editScene(scene.id, { beats });
                                  }}>
                                    <ArrowUp size={14} />
                                  </button>
                                  <button type="button" className="maker-icon" aria-label="Move down" disabled={beatIndex === scene.beats.length - 1} onClick={() => {
                                    const beats = [...scene.beats];
                                    [beats[beatIndex + 1], beats[beatIndex]] = [beats[beatIndex], beats[beatIndex + 1]];
                                    editScene(scene.id, { beats });
                                  }}>
                                    <ArrowDown size={14} />
                                  </button>
                                  <button type="button" className="maker-icon" aria-label="Delete shot" onClick={() => editScene(scene.id, { beats: scene.beats.filter((item) => item.id !== beat.id) })}>
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </li>
                            ))}
                          </ol>
                          {music && scene.lyrics?.length ? (
                            <p className="fl-scene-lyrics"><span>Lyrics in this scene:</span> {scene.lyrics.map((line) => line.text).join(" / ")}</p>
                          ) : music ? <p className="fl-scene-lyrics"><span>Instrumental</span></p> : null}
                          {scene.beats.length < Math.max(kind.maxBeats, 6) && (
                            <button type="button" className="maker-ghost dr-small" onClick={() => editScene(scene.id, { beats: [...scene.beats, { id: newId("b"), cam: "", move: "", speaker: "", emotion: "", line: "" }] })}>
                              <Plus size={14} /> Add shot
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <div className="dr-row dr-row-end">
                    {!music && scenes.length < kind.maxScenes && (
                      <button type="button" className="maker-outline" onClick={() => edit([...scenes, { id: newId("s"), title: `Scene ${scenes.length + 1}`, locationId: episode.locations[0]?.id || "", summary: "", beats: [{ id: newId("b"), cam: "Wide", move: "", speaker: "", emotion: "", line: "" }] }])}>
                        <Plus size={15} /> Add scene
                      </button>
                    )}
                    <button type="button" className="maker-primary" onClick={() => void go("scenes")}>
                      Continue to scenes
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === "scenes" && (
            <section aria-label="Scenes">
              {!scenes.length ? (
                <div className="dr-empty-inline">
                  <Film size={18} aria-hidden="true" />
                  <span>Write the screenplay first.</span>
                </div>
              ) : (
                <>
                  <div className="dr-toolbar">
                    <span className="dr-count">
                      Storyboards {boardsDone}/{scenes.length} · {music ? "Song" : "Voices"} {voicesDone}/{scenes.length} · Clips {clipsDone}/{scenes.length}
                    </span>
                    <div className="maker-actions">
                      <button
                        type="button"
                        className="maker-primary"
                        disabled={Boolean(busy) || (boardsDone === scenes.length && voicesDone === scenes.length)}
                        onClick={async () => {
                          const data: any = await post("prepare", "/prepare");
                          if (data?.errors?.length) onError(data.errors[0]);
                        }}
                        title={music ? "Draws every missing storyboard and cuts every scene's slice of the song" : "Draws every missing storyboard and voices every missing scene, and gets the video references ready"}
                      >
                        {busy === "prepare" ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
                        {music ? "Storyboard and cut all scenes" : "Storyboard and voice all scenes"}
                      </button>
                      <button
                        type="button"
                        className="maker-outline"
                        disabled={Boolean(busy) || !toRender.length}
                        onClick={() =>
                          setConfirm({
                            scene: null,
                            count: toRender.length,
                            seconds: toRender.reduce((sum, scene) => sum + (stateOf(scene).voice?.seconds || 0), 0),
                            cost: toRender.reduce((sum, scene) => sum + costOf(scene), 0),
                          })
                        }
                        title="Renders every scene that has a storyboard and voice but no up-to-date clip, all at the same time"
                      >
                        {busy === "render-all" ? <Loader2 size={15} className="animate-spin" /> : <Film size={15} />}
                        Render {toRender.length || "all"} clips
                      </button>
                    </div>
                  </div>
                  <ol className="dr-scene-list">
                    {scenes.map((scene, index) => {
                      const state = stateOf(scene);
                      const estimate = episode.estimate.find((item) => item.id === scene.id)?.cost || 0;
                      return (
                        <li key={scene.id} className="dr-scene-card">
                          <header>
                            <span className="dr-episode-n">{String(index + 1).padStart(2, "0")}</span>
                            <div>
                              <h3>{scene.title}</h3>
                              <p>
                                {music && scene.start !== undefined ? `${clock(scene.start)}–${clock(scene.end || 0)} · ` : ""}{episode.locations.find((location) => location.id === scene.locationId)?.name || "No location"} · {scene.beats.length} shots
                                {state.voice?.seconds ? ` · ${state.voice.seconds}s` : ""}
                              </p>
                            </div>
                          </header>
                          <div className="dr-scene-grid">
                            <StageCell
                              title="Storyboard"
                              icon={<ImageIcon size={15} />}
                              step={state.board}
                              busy={busy === `${scene.id}:board`}
                              action={state.board?.asset ? "Redraw" : "Draw storyboard"}
                              onRun={() => void post(`${scene.id}:board`, `/scenes/${scene.id}/board`)}
                            >
                              {state.board?.asset && (
                                <button type="button" className="dr-board" style={{ aspectRatio: sceneAspect }} onClick={() => setZoom(state.board!.asset!)} aria-label="View storyboard">
                                  <img src={state.board.asset} alt="" loading="lazy" />
                                </button>
                              )}
                            </StageCell>
                            <StageCell
                              title={music ? "Song" : "Voices"}
                              icon={<Mic size={15} />}
                              step={state.voice}
                              busy={busy === `${scene.id}:voice`}
                              action={music ? (state.voice?.asset ? "Recut" : "Cut the song") : state.voice?.asset ? "Re-voice" : scene.beats.some((beat) => beat.line) ? "Voice the scene" : "Make the silent track"}
                              onRun={() => void post(`${scene.id}:voice`, `/scenes/${scene.id}/voice`)}
                            >
                              <ul className="dr-lines">
                                {scene.beats
                                  .filter((beat) => beat.line)
                                  .map((beat) => (
                                    <li key={beat.id}>
                                      <b>{beat.speaker}</b>
                                      {beat.emotion && <i> ({beat.emotion})</i>} {beat.line}
                                    </li>
                                  ))}
                              </ul>
                              {state.voice?.asset && (
                                <div className="dr-track">
                                  <PlayButton src={state.voice.asset} label={music ? "the scene's part of the song" : "the scene's dialogue"} />
                                  <span>{state.voice.music ? "Song slice" : state.voice.silent ? "Silent scene" : "Dialogue track"} · {state.voice.seconds}s</span>
                                </div>
                              )}
                            </StageCell>
                            <StageCell
                              title="Clip"
                              icon={<Film size={15} />}
                              step={state.clip}
                              busy={busy === `${scene.id}:clip`}
                              action={state.clip?.asset ? "Re-render" : `Render · ~${creditsOf(estimate).toLocaleString()} credits`}
                              disabled={!state.board?.asset || !state.voice?.asset}
                              disabledReason={music ? "Storyboard and cut this scene first" : "Storyboard and voice this scene first"}
                              onRun={() => setConfirm({ scene, count: 1, seconds: state.voice?.seconds || 0, cost: estimate })}
                            >
                              {state.clip?.asset && (
                                <VideoPlayer className="dr-clip" src={state.clip.asset} label={`${scene.title} clip`} aspect={sceneAspect} />
                              )}
                              {state.clip?.asset && state.clip.quality && <small className="dr-tag">{state.clip.quality === "draft" ? "Draft" : "Final"}</small>}
                              {state.clip?.asset && state.clip.references === "text" && (
                                <small className="dr-tag" title="The video model refused the reference images, so this clip was made from the character descriptions">
                                  From descriptions · faces may vary
                                </small>
                              )}
                            </StageCell>
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="dr-row dr-row-end">
                    <button type="button" className="maker-primary" disabled={clipsDone < scenes.length} onClick={() => setTab("final")}>
                      Continue to final cut
                    </button>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === "final" && (
            <section aria-label="Final cut" className="dr-final">
              <div className="dr-final-stage" style={{ aspectRatio: sceneAspect }}>
                {episode.final?.asset ? (
                  <VideoPlayer className="dr-final-video" src={episode.final.asset} label={`${episode.title} final cut`} />
                ) : (
                  <div className="dr-final-empty">
                    {running(episode.final) ? <Loader2 className="animate-spin" size={22} /> : <Film size={22} />}
                    <span>{running(episode.final) ? episode.final?.progress || "Cutting…" : `Your ${kind.unit.toLowerCase()} appears here`}</span>
                  </div>
                )}
              </div>
              <div className="dr-final-side">
                <h2>Final cut</h2>
                <ProductionPreflight review={episode.qualityReview} busy={qualityBusy} onCheck={() => void runQualityReview()} />
                <ul className="dr-checks">
                  <li className={scenes.length ? "is-ok" : ""}>
                    <Check size={14} /> Screenplay ({scenes.length} scenes)
                  </li>
                  <li className={clipsDone === scenes.length && scenes.length ? "is-ok" : ""}>
                    <Check size={14} /> Every scene rendered ({clipsDone}/{scenes.length})
                  </li>
                  <li className="is-ok">
                    <Check size={14} /> {music ? "The song itself, in stereo, never the video model's audio" : "Voices from the cast, not the video model"}
                  </li>
                </ul>
                <label className="maker-check">
                  <input type="checkbox" checked={episode.settings.subtitles} onChange={(e) => void setSetting({ subtitles: e.target.checked })} />
                  {music ? "Burn in lyrics" : "Burn in subtitles"}
                </label>
                <label className="maker-check">
                  <input type="checkbox" checked={episode.settings.titleCards !== false} onChange={(e) => void setSetting({ titleCards: e.target.checked })} />
                  {music ? "Animated title card" : `Animated title card${kind.unit === "Episode" || kind.unit === "Part" ? ` and a next-${kind.unit.toLowerCase()} teaser` : ""}`}
                </label>
                {episode.final?.status === "failed" && (
                  <p className="dr-error" role="alert">
                    <AlertCircle size={14} /> {episode.final.error}
                  </p>
                )}
                <button
                  type="button"
                  className="maker-primary maker-lg"
                  disabled={clipsDone < scenes.length || !scenes.length || running(episode.final) || Boolean(busy)}
                  onClick={() => void post("final", "/final", { subtitles: episode.settings.subtitles, titleCards: episode.settings.titleCards !== false })}
                >
                  {running(episode.final) || busy === "final" ? <Loader2 size={16} className="animate-spin" /> : <Clapperboard size={16} />}
                  {episode.final?.asset ? "Cut again" : `Cut the ${kind.unit.toLowerCase()}`}
                </button>
                {episode.final?.asset && (
                  <div className="dr-row">
                    <a className="maker-outline mk-btn" href={episode.final.asset} download={`${episode.title}.mp4`}>
                      <Download size={15} /> Video
                    </a>
                    {episode.final.captions && (
                      <a className="maker-outline mk-btn" href={episode.final.captions} download={`${episode.title}.srt`}>
                        <Download size={15} /> Subtitles
                      </a>
                    )}
                  </div>
                )}
                <p className="dr-hint">{music ? "Scenes are joined in order over the song, so the music plays straight through." : "Scenes are joined in order with each character's locked voice."} Nothing is re-rendered, so cutting is quick and free.</p>
              </div>
            </section>
          )}
        </div>
      </div>
      {confirm && (
        <Modal
          title={confirm.scene ? `Render “${confirm.scene.title}”` : `Render ${confirm.count} clips`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="maker-outline" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className="maker-primary"
                onClick={async () => {
                  const scene = confirm.scene;
                  setConfirm(null);
                  if (!scene) {
                    const data: any = await post("render-all", "/render-all", { confirmed: true, quality });
                    if (data?.errors?.length) onError(data.errors[0]);
                    if (data?.started?.length) toast.success(`Rendering ${data.started.length} clips at once. You can keep working.`);
                    return;
                  }
                  const ok = await post(`${scene.id}:clip`, `/scenes/${scene.id}/clip`, { confirmed: true, quality });
                  if (ok) toast.success("Rendering. Clips take 2 to 5 minutes; you can keep working.");
                }}
              >
                <Film size={15} /> {confirm.scene ? "Render clip" : `Render ${confirm.count} clips`}
              </button>
            </>
          }
        >
          <p>
            {confirm.scene
              ? `${tier.label}, ${confirm.seconds}s, driven by the storyboard, the locked sheets, the cinema look, and this scene's ${music ? "slice of the song" : "dialogue track"}. Estimated charge: about ${creditsOf(confirm.cost).toLocaleString()} credits.`
              : `${tier.label}, ${confirm.count} scenes (${confirm.seconds}s in total), rendered at the same time. Estimated charge: about ${creditsOf(confirm.cost).toLocaleString()} credits.`}
            {quality === "final" ? " Switch to Draft at the top for a cheaper preview." : ""}
          </p>
        </Modal>
      )}
      {rewrite && (
        <Modal
          title="Rewrite the screenplay"
          wide
          onClose={() => setRewrite(false)}
          footer={
            <>
              <button className="maker-outline" onClick={() => setRewrite(false)}>
                Cancel
              </button>
              <button
                className="maker-primary"
                onClick={async () => {
                  setRewrite(false);
                  setDraft(null);
                  await post("script", "/script", { note });
                }}
              >
                <RotateCcw size={15} /> Rewrite
              </button>
            </>
          }
        >
          <div className="maker-stack">
            <label className="maker-field">
              What should change?
              <textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fewer scenes, and give Adrian the last line." />
            </label>
            <p className="dr-hint">This replaces every scene. Storyboards, voices, and clips already made stay until you redo those scenes.</p>
          </div>
        </Modal>
      )}
      {zoom && <Lightbox src={zoom} onClose={() => setZoom("")} />}
    </>
  );
}

function StageCell({
  title,
  icon,
  step,
  busy,
  action,
  onRun,
  disabled,
  disabledReason,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  step: Step | null;
  busy: boolean;
  action: string;
  onRun: () => void;
  disabled?: boolean;
  disabledReason?: string;
  children?: React.ReactNode;
}) {
  const active = running(step);
  return (
    <div className={`dr-cell ${step?.asset ? "has-asset" : ""}`}>
      <div className="dr-cell-head">
        {icon}
        <strong>{title}</strong>
        {step?.asset && !active && (step.stale ? <span className="dr-badge is-warn">Out of date</span> : <span className="dr-badge is-ok"><Check size={12} /> Done</span>)}
      </div>
      <div className="dr-cell-body">
        {children}
        {active && (
          <p className="dr-progress" aria-live="polite">
            <Loader2 size={14} className="animate-spin" /> {step?.progress || "Working…"}
          </p>
        )}
        {step?.status === "failed" && (
          <p className="dr-error" role="alert">
            <AlertCircle size={14} /> {step.error}
          </p>
        )}
      </div>
      <button type="button" className={step?.asset && !step.stale ? "maker-outline" : "maker-primary"} disabled={active || busy || disabled} title={disabled ? disabledReason : undefined} onClick={onRun}>
        {busy || active ? <Loader2 size={15} className="animate-spin" /> : step?.asset ? <RotateCcw size={15} /> : <Sparkles size={15} />}
        {action}
      </button>
    </div>
  );
}
