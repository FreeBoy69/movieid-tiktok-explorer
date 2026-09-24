// Create Drama, series level: lock each character's look and voice, and each
// location's look, once. Every episode draws its storyboards and clips from
// these locked sheets and voices.
import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Image as ImageIcon, Loader2, Lock, MapPin, Mic, Pause, Play, RotateCcw, Sparkles, Upload, Wand2 } from "lucide-react";
import { creatorApi } from "./CreatorWorkspace";
import { VoicePicker } from "./VoicePicker";
import { speakerName } from "../utils/dramaTemplates";
import { toast } from "../utils/toast";
import { VideoPlayer } from "./VideoPlayer";

export type DramaCharacter = { id: string; name: string; role: string; appearance: string; outfit: string; voice?: string };
export type DramaLocation = { id: string; name: string; description: string };
type Step = { status?: string; error?: string; progress?: string; candidates?: any[]; locked?: string; photo?: string; description?: string; selected?: string; profileId?: string };
export type SeriesProduction = { characters: Record<string, Step>; locations: Record<string, Step>; voices: Record<string, Step> };

const running = (step?: Step) => step?.status === "running";

export function useSeriesProduction(seriesId: string, onError: (e: string) => void) {
  const [production, setProduction] = useState<SeriesProduction>({ characters: {}, locations: {}, voices: {} });
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  async function refresh() {
    try {
      const data = await creatorApi(`/api/drama/series/${encodeURIComponent(seriesId)}/production`);
      setProduction(data.production);
      setLoaded(true);
      const busy = [data.production.characters, data.production.locations, data.production.voices].some((map: Record<string, Step>) => Object.values(map || {}).some(running));
      clearTimeout(timer.current);
      if (busy) timer.current = setTimeout(refresh, 3500);
    } catch (e) {
      onError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    return () => clearTimeout(timer.current);
  }, [seriesId]);
  return { production, loaded, refresh };
}

// One shared <audio> so previews never talk over each other.
let player: HTMLAudioElement | null = null;
export function PlayButton({ src, label }: { src: string; label: string }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => {
    if (playing) player?.pause();
  }, [playing]);
  return (
    <button
      type="button"
      className="maker-icon dr-play"
      aria-label={playing ? `Stop ${label}` : `Play ${label}`}
      title={playing ? "Stop" : "Play"}
      onClick={() => {
        if (playing) {
          player?.pause();
          setPlaying(false);
          return;
        }
        player?.pause();
        player = new Audio(src);
        player.onended = () => setPlaying(false);
        player.onpause = () => setPlaying(false);
        void player.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
      }}
    >
      {playing ? <Pause size={15} /> : <Play size={15} />}
    </button>
  );
}

async function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

export function CastPanel({
  seriesId,
  accountId,
  cast,
  voices,
  voiceProfiles,
  voicesLoading,
  production,
  onChanged,
  onEdit,
  onError,
}: {
  seriesId: string;
  accountId: string;
  cast: DramaCharacter[];
  voices: Record<string, string>;
  voiceProfiles: any[];
  voicesLoading: boolean;
  production: SeriesProduction;
  onChanged: () => void;
  onEdit: (character: DramaCharacter) => void;
  onError: (e: string) => void;
}) {
  const locked = cast.filter((character) => production.characters[character.id]?.locked).length;
  const voiced = cast.filter((character) => voices[speakerName(character.name)]).length;
  return (
    <section aria-labelledby="dr-cast-title">
      <div className="maker-section-title">
        <h2 id="dr-cast-title">Cast</h2>
        <small className="dr-count">
          {locked} of {cast.length} looks locked · {voiced} of {cast.length} voices set
        </small>
      </div>
      <p className="dr-hint dr-hint-top">
        Lock each character's sheet and voice once. Every storyboard, clip, and line in every episode uses them, so faces and voices match from the first episode to the last.
      </p>
      <ul className="dr-roster">
        {cast.map((character) => (
          <CharacterCard
            key={character.id}
            seriesId={seriesId}
            accountId={accountId}
            character={character}
            voiceId={voices[speakerName(character.name)] || ""}
            voiceProfiles={voiceProfiles}
            voicesLoading={voicesLoading}
            sheet={production.characters[character.id] || {}}
            voice={production.voices[character.id] || {}}
            onChanged={onChanged}
            onEdit={() => onEdit(character)}
            onError={onError}
          />
        ))}
      </ul>
    </section>
  );
}

function CharacterCard({
  seriesId,
  accountId,
  character,
  voiceId,
  voiceProfiles,
  voicesLoading,
  sheet,
  voice,
  onChanged,
  onEdit,
  onError,
}: {
  seriesId: string;
  accountId: string;
  character: DramaCharacter;
  voiceId: string;
  voiceProfiles: any[];
  voicesLoading: boolean;
  sheet: Step;
  voice: Step;
  onChanged: () => void;
  onEdit: () => void;
  onError: (e: string) => void;
}) {
  const base = `/api/drama/series/${encodeURIComponent(seriesId)}/characters/${encodeURIComponent(character.id)}`;
  const [busy, setBusy] = useState(""),
    [description, setDescription] = useState(voice.description || character.voice || ""),
    [pick, setPick] = useState(""),
    [preview, setPreview] = useState<{ voiceId: string; asset: string } | null>(null),
    [zoom, setZoom] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const voiceName = voiceProfiles.find((profile) => profile.id === voiceId)?.name || (voiceId ? "Custom voice" : "");
  async function call(label: string, url: string, body: Record<string, unknown> = {}) {
    setBusy(label);
    try {
      const data = await creatorApi(url, { accountId, ...body });
      onChanged();
      return data;
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const candidates: string[] = sheet.candidates || [];
  const designed: Array<{ asset: string; voice: string }> = voice.candidates || [];
  return (
    <li className="dr-member">
      <div className="dr-member-look">
        <div className="dr-member-head">
          <div>
            <h3>{character.name}</h3>
            <p>{character.role}</p>
          </div>
          <button type="button" className="maker-outline dr-small" onClick={onEdit}>
            Edit details
          </button>
        </div>
        <p className="dr-look">{[character.appearance, character.outfit].filter(Boolean).join(" · ")}</p>
        <div className="dr-sheet">
          {sheet.locked ? (
            <button type="button" className="dr-sheet-main" onClick={() => setZoom(sheet.locked!)} aria-label={`View ${character.name}'s locked sheet`}>
              <img src={sheet.locked} alt="" loading="lazy" />
              <span className="dr-badge is-ok">
                <Lock size={12} /> Locked
              </span>
            </button>
          ) : (
            <div className="dr-sheet-empty">
              {running(sheet) ? <Loader2 className="animate-spin" size={20} /> : <ImageIcon size={20} />}
              <span>{running(sheet) ? sheet.progress || "Drawing character sheets…" : "No sheet locked yet"}</span>
            </div>
          )}
          {candidates.length > 0 && (
            <div className="dr-takes" role="list" aria-label="Sheet options">
              {candidates.slice(0, 6).map((asset) => (
                <div role="listitem" key={asset} className={`dr-take ${asset === sheet.locked ? "is-on" : ""}`}>
                  <button type="button" onClick={() => setZoom(asset)} aria-label="View this sheet">
                    <img src={asset} alt="" loading="lazy" />
                  </button>
                  {asset !== sheet.locked && (
                    <button type="button" className="dr-take-use" disabled={Boolean(busy)} onClick={() => void call("lock", `${base}/lock`, { asset })}>
                      Use
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {sheet.status === "failed" && (
            <p className="dr-error" role="alert">
              <AlertCircle size={14} /> {sheet.error}
            </p>
          )}
          <div className="dr-row">
            <button type="button" className={sheet.locked ? "maker-outline" : "maker-primary"} disabled={running(sheet) || Boolean(busy)} onClick={() => void call("sheet", `${base}/sheet`, { count: 2 })}>
              {running(sheet) || busy === "sheet" ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {candidates.length ? "Draw 2 more" : "Draw 2 sheets"}
            </button>
            <button type="button" className="maker-outline" disabled={Boolean(busy)} onClick={() => upload.current?.click()} title="Use a photo of a real person you have permission to use">
              <Upload size={15} />
              {sheet.photo ? "Replace photo" : "From a photo"}
            </button>
            <input
              ref={upload}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                if (file.size > 12 * 1024 * 1024) return onError("Choose a photo smaller than 12 MB");
                const saved = await call("photo", `${base}/photo`, { image: await readFile(file), mediaType: file.type });
                if (saved) toast.success(`Photo added. Draw sheets to build ${character.name} from it.`);
              }}
            />
          </div>
          {sheet.photo && <p className="dr-hint">Sheets are drawn from the uploaded photo at 1:1 likeness.</p>}
        </div>
      </div>

      <div className="dr-member-voice">
        <div className="dr-voice-now">
          <Mic size={16} aria-hidden="true" />
          <div>
            <strong>{voiceName || "No voice yet"}</strong>
            <small>{voiceId ? `Speaks as ${speakerName(character.name)} in every episode` : "Design one from a description, or pick an existing voice"}</small>
          </div>
          {voiceId && <Check size={16} className="dr-ok" aria-label="Voice set" />}
        </div>
        <label className="maker-field">
          Design a voice
          <textarea
            rows={2}
            maxLength={600}
            value={description}
            placeholder="e.g. a cold, husky British woman in her early thirties; low, clipped, controlled"
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <button type="button" className="maker-outline" disabled={running(voice) || Boolean(busy) || description.trim().length < 8} onClick={() => void call("design", `${base}/voice-design`, { description })}>
          {running(voice) || busy === "design" ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
          {running(voice) ? voice.progress || "Designing voices…" : designed.length ? "Design 3 new takes" : "Design 3 voices"}
        </button>
        {voice.status === "failed" && (
          <p className="dr-error" role="alert">
            <AlertCircle size={14} /> {voice.error}
          </p>
        )}
        {designed.length > 0 && (
          <ul className="dr-voice-takes" aria-label="Designed voices">
            {designed.map((take, index) => (
              <li key={take.asset} className={voice.selected === take.asset ? "is-on" : ""}>
                <PlayButton src={take.asset} label={`voice ${index + 1}`} />
                <span>Take {index + 1}</span>
                {voice.selected === take.asset ? (
                  <span className="dr-badge is-ok">
                    <Check size={12} /> In use
                  </span>
                ) : (
                  <button type="button" className="maker-outline dr-small" disabled={Boolean(busy)} onClick={async () => {
                    const saved = await call(`use-${index}`, `${base}/voice-select`, { asset: take.asset });
                    if (saved) toast.success(`${character.name}'s voice is cloned and locked for the series.`);
                  }}>
                    {busy === `use-${index}` ? <Loader2 size={14} className="animate-spin" /> : null}
                    {busy === `use-${index}` ? "Cloning…" : "Use this voice"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="dr-voice-existing">
          <span id={`dr-existing-${character.id}`} className="dr-label">
            Or pick an existing voice
          </span>
          <div className="dr-row">
            <div className="dr-grow">
              <VoicePicker voices={voiceProfiles} value={pick || voiceId} labelledBy={`dr-existing-${character.id}`} loading={voicesLoading} placeholder="Choose a voice" noneLabel="None" onChange={(id) => setPick(id || "")} />
            </div>
            <button
              type="button"
              className="maker-icon"
              aria-label="Hear this voice say the character's line"
              title="Preview"
              disabled={!(pick || voiceId) || Boolean(busy)}
              onClick={async () => {
                const id = pick || voiceId;
                const data = await call("preview", `${base}/voice-preview`, { voiceId: id });
                if (data?.asset) {
                  setPreview({ voiceId: id, asset: data.asset });
                  player?.pause();
                  player = new Audio(data.asset);
                  void player.play().catch(() => {});
                }
              }}
            >
              {busy === "preview" ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            </button>
            <button type="button" className="maker-primary" disabled={!pick || pick === voiceId || Boolean(busy)} onClick={async () => {
              const saved = await call("select", `${base}/voice-select`, { voiceId: pick });
              if (saved) toast.success(`${character.name} now speaks with this voice.`);
            }}>
              Use
            </button>
          </div>
          {preview && preview.voiceId === (pick || voiceId) && <PlayButton src={preview.asset} label="the preview again" />}
        </div>
      </div>
      {zoom && <Zoom src={zoom} onClose={() => setZoom("")} />}
    </li>
  );
}

export function LocationsPanel({
  seriesId,
  accountId,
  locations,
  production,
  onChanged,
  onEdit,
  onError,
}: {
  seriesId: string;
  accountId: string;
  locations: DramaLocation[];
  production: SeriesProduction;
  onChanged: () => void;
  onEdit: (location: DramaLocation | null) => void;
  onError: (e: string) => void;
}) {
  const [busy, setBusy] = useState(""),
    [zoom, setZoom] = useState("");
  async function call(label: string, url: string, body: Record<string, unknown> = {}) {
    setBusy(label);
    try {
      await creatorApi(url, { accountId, ...body });
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section aria-labelledby="dr-loc-title">
      <div className="maker-section-title">
        <h2 id="dr-loc-title">Locations</h2>
        <button type="button" className="maker-outline dr-small" onClick={() => onEdit(null)}>
          Add location
        </button>
      </div>
      <p className="dr-hint dr-hint-top">A locked location sheet keeps the set, layout, and light the same whenever a scene returns to it.</p>
      {!locations.length ? (
        <div className="dr-empty-inline">
          <MapPin size={18} aria-hidden="true" />
          <span>No locations yet. Add the places your scenes return to.</span>
        </div>
      ) : (
        <ul className="dr-locations">
          {locations.map((location) => {
            const state = production.locations[location.id] || {};
            const base = `/api/drama/series/${encodeURIComponent(seriesId)}/locations/${encodeURIComponent(location.id)}`;
            return (
              <li key={location.id} className="dr-location">
                <button type="button" className="dr-location-art" onClick={() => state.locked && setZoom(state.locked)} disabled={!state.locked} aria-label={`View ${location.name}`}>
                  {state.locked ? <img src={state.locked} alt="" loading="lazy" /> : running(state) ? <Loader2 className="animate-spin" size={20} /> : <MapPin size={20} />}
                  {state.locked && (
                    <span className="dr-badge is-ok">
                      <Lock size={12} /> Locked
                    </span>
                  )}
                </button>
                <div className="dr-location-body">
                  <h3>{location.name}</h3>
                  <p>{location.description}</p>
                  {state.status === "failed" && (
                    <p className="dr-error" role="alert">
                      <AlertCircle size={14} /> {state.error}
                    </p>
                  )}
                  {(state.candidates || []).length > 1 && (
                    <div className="dr-takes is-wide" role="list" aria-label="Location options">
                      {(state.candidates || []).slice(0, 4).map((asset: string) => (
                        <div role="listitem" key={asset} className={`dr-take ${asset === state.locked ? "is-on" : ""}`}>
                          <button type="button" onClick={() => setZoom(asset)} aria-label="View this option">
                            <img src={asset} alt="" loading="lazy" />
                          </button>
                          {asset !== state.locked && (
                            <button type="button" className="dr-take-use" disabled={Boolean(busy)} onClick={() => void call("lock", `${base}/lock`, { asset })}>
                              Use
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="dr-row">
                    <button type="button" className={state.locked ? "maker-outline" : "maker-primary"} disabled={running(state) || Boolean(busy)} onClick={() => void call(location.id, `${base}/sheet`)}>
                      {running(state) || busy === location.id ? <Loader2 size={15} className="animate-spin" /> : state.locked ? <RotateCcw size={15} /> : <Sparkles size={15} />}
                      {running(state) ? "Drawing…" : state.locked ? "Draw another" : "Draw location"}
                    </button>
                    <button type="button" className="maker-outline" onClick={() => onEdit(location)}>
                      Edit
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {zoom && <Zoom src={zoom} onClose={() => setZoom("")} />}
    </section>
  );
}

export function Zoom({ src, onClose }: { src: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="maker-modal-backdrop dr-zoom" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Image preview">
      {/\.mp4($|\?)/.test(src) ? <div onMouseDown={(e) => e.stopPropagation()}><VideoPlayer src={src} autoPlay size="fit" label="Clip preview" /></div> : <img src={src} alt="" onMouseDown={(e) => e.stopPropagation()} />}
      <button type="button" className="dr-zoom-close" onClick={onClose}>
        Close
      </button>
    </div>
  );
}
