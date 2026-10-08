// Cinema Studio's camera pickers, shared with Create Film: the virtual rig (camera
// body, lens, focal length, aperture, with saved and recommended setups) and the
// look pickers (genre, palette, lighting, and the camera catalogue with sprite
// previews). Outside Cinema Studio wrap them in .cns-kit for the theme tokens.
import { type PointerEvent as ReactPointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { Check, RotateCcw, Save, Sparkles, Sun } from "lucide-react";
import { cinemaPreview } from "../../utils/cinemaPresets";
import { cameraOptions } from "../../utils/cameraShots.js";
import { cameraSprite } from "../../utils/cameraPreviews.js";
import { usePopover } from "./studioShared";
import "./CinemaStudioPage.css";

// Camera angle, shot size, perspective, and movement from the shared catalogue, each with "Auto".
export const CAMERA_PICKS = Object.fromEntries(
  (["angle", "shot", "perspective", "motion"] as const).map((group) => [
    group,
    [{ id: "auto", name: "Auto", text: "" }, ...cameraOptions(group).map((option: { id: string; label: string; description: string }) => ({ id: option.id, name: option.label, text: option.description }))],
  ]),
) as Record<"angle" | "shot" | "perspective" | "motion", Array<{ id: string; name: string; text: string }>>;

export type Rig = { camera: string; lens: string; focalLength: number; aperture: string };

export const CAMERAS = [
  { name: "Premium Large Format Digital", kind: "Digital" },
  { name: "Modular 8K Digital", kind: "Digital" },
  { name: "Full-Frame Cine Digital", kind: "Digital" },
  { name: "Studio Digital S35", kind: "Digital" },
  { name: "Grand Format 70mm Film", kind: "Film" },
  { name: "Classic 16mm Film", kind: "Film" },
];
export const LENSES = [
  { name: "Clinical Sharp Prime", kind: "Spherical" },
  { name: "Premium Modern Prime", kind: "Spherical" },
  { name: "Warm Cinema Prime", kind: "Spherical" },
  { name: "Vintage Prime", kind: "Spherical" },
  { name: "70s Cinema Prime", kind: "Spherical" },
  { name: "Swirl Bokeh Portrait", kind: "Spherical" },
  { name: "Classic Anamorphic", kind: "Anamorphic" },
  { name: "Compact Anamorphic", kind: "Anamorphic" },
  { name: "Halation Diffusion", kind: "Filter" },
  { name: "Creative Tilt Lens", kind: "Specialty" },
  { name: "Extreme Macro", kind: "Specialty" },
];
export const FOCALS = [8, 14, 24, 35, 50, 85];
export const APERTURES = ["f/1.4", "f/4", "f/11"];
const RECOMMENDED: Array<{ name: string; rig: Rig }> = [
  { name: "Epic widescreen", rig: { camera: "Grand Format 70mm Film", lens: "Classic Anamorphic", focalLength: 35, aperture: "f/4" } },
  { name: "Intimate portrait", rig: { camera: "Full-Frame Cine Digital", lens: "Swirl Bokeh Portrait", focalLength: 85, aperture: "f/1.4" } },
  { name: "Indie grain", rig: { camera: "Classic 16mm Film", lens: "Vintage Prime", focalLength: 24, aperture: "f/4" } },
  { name: "Crisp commercial", rig: { camera: "Premium Large Format Digital", lens: "Clinical Sharp Prime", focalLength: 50, aperture: "f/11" } },
  { name: "Dream sequence", rig: { camera: "Studio Digital S35", lens: "Halation Diffusion", focalLength: 35, aperture: "f/1.4" } },
];
const gear = (name: string) => `/assets/cinema/${name.toLowerCase().replace("/", "_").replace(/\./g, "_").replace(/[^a-z0-9_]+/g, "_")}.webp`;

const SAVED_KEY = "autoyt-cinema-saved-rigs";

/** One camera option's tile from its group's sprite (see utils/cameraPreviews.js). */
export function CameraFrame({ group, id }: { group: string; id: string }) {
  const tile = cameraSprite(group, id);
  if (!tile) return null;
  const at = (index: number, count: number) => (count > 1 ? (index / (count - 1)) * 100 : 0);
  return (
    <span
      className="cns-cam"
      aria-hidden="true"
      style={{ backgroundImage: `url(${tile.url})`, backgroundSize: `${tile.columns * 100}% ${tile.rows * 100}%`, backgroundPosition: `${at(tile.column, tile.columns)}% ${at(tile.row, tile.rows)}%` }}
    />
  );
}

export function Preview({ src, alt, fallback }: { src: string; alt: string; fallback: ReactNode }) {
  const [broken, setBroken] = useState(false);
  return broken ? <span className="cns-fallback">{fallback}</span> : <img src={src} alt={alt} loading="lazy" onError={() => setBroken(true)} />;
}

export type LookOption = { id: string; name: string; text?: string };

/** The art and list half of a look picker, for use in a popover or inline. */
export function LookPanel({ label, kind, value, options, onPick, wide, className = "" }: { label: string; kind: string; value: string; options: LookOption[]; onPick: (id: string) => void; wide?: boolean; className?: string }) {
  const [hover, setHover] = useState(value);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setHover(value), [value]);
  // Open on the current pick: scroll the list (not the page) so it is in view.
  useEffect(() => {
    const box = list.current;
    const picked = box?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (box && picked) box.scrollTop = Math.max(0, picked.offsetTop - box.offsetTop - box.clientHeight / 2 + picked.offsetHeight / 2);
  }, []);
  const current = options.find((o) => o.id === value) || options[0];
  const shown = options.find((o) => o.id === hover) || current;
  return (
    <div className={`cns-lookpanel${wide ? " is-wide" : ""} ${className}`.trim()} role="dialog" aria-label={label}>
      {wide ? (
        <figure className="cns-lookpanel-shot">
          <div className="cns-lookpanel-art" data-move={kind === "motion" ? shown.id : undefined} key={shown.id}>
            {shown.id === "auto" ? <span className="cns-fallback"><Sparkles className="h-6 w-6" />Auto</span> : <CameraFrame group={kind} id={shown.id} />}
          </div>
          <figcaption>
            <strong>{shown.name}</strong>
            <span>{shown.id === "auto" ? "Let the model choose." : shown.text}</span>
          </figcaption>
        </figure>
      ) : (
        <div className="cns-lookpanel-art">
          {shown.id === "auto" ? <span className="cns-fallback"><Sparkles className="h-6 w-6" />Auto</span> : <Preview src={cinemaPreview(kind, shown.id)} alt="" fallback={<><Sun className="h-6 w-6" />{shown.name}</>} />}
        </div>
      )}
      <div className="cns-lookpanel-list" role="listbox" aria-label={label} ref={list}>
        <p>{label}</p>
        {options.map((option) => (
          <button key={option.id} type="button" role="option" aria-selected={option.id === value} onMouseEnter={() => setHover(option.id)} onFocus={() => setHover(option.id)} onClick={() => onPick(option.id)}>
            <span className="cns-dot-thumb">{option.id === "auto" ? <Sparkles className="h-3 w-3" /> : wide ? <CameraFrame group={kind} id={option.id} /> : <Preview src={cinemaPreview(kind, option.id)} alt="" fallback={null} />}</span>
            {option.name}
            {option.id === value ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

// Genre, palette, and lighting show a tall arch of art. Camera pickers (wide) show the frame at 16:9 with what
// the choice does underneath, and Movement plays the move over its still.
export function CinemaLookPicker({ label, icon, value, options, kind, onChange, wide }: { label: string; icon: ReactNode; value: string; options: LookOption[]; kind: string; onChange: (id: string) => void; wide?: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const current = options.find((o) => o.id === value) || options[0];
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-look" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}
        <span className="cns-look-label">{label}:</span>
        <span>{current.name}</span>
      </button>
      {open ? <LookPanel className="cns-panel" label={label} kind={kind} value={value} options={options} wide={wide} onPick={(id) => { onChange(id); setOpen(false); }} /> : null}
    </div>
  );
}

const APERTURE_FEEL: Record<string, string> = { "f/1.4": "Shallow", "f/4": "Balanced", "f/11": "Deep" };

/**
 * The camera rig: cards for body, lens, focal length (drag or arrow keys), and aperture,
 * plus recommended and saved setups. With `auto`, any part may be left unset ("Auto")
 * and Reset clears the whole rig, for projects that let each scene decide.
 */
export function RigPicker({ rig, onChange, auto = false }: { rig: Partial<Rig>; onChange: (rig: Partial<Rig>) => void; auto?: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const [tab, setTab] = useState<"all" | "recommended" | "saved">("all");
  const [part, setPart] = useState<"" | "camera" | "lens" | "aperture">("");
  const [saved, setSaved] = useState<Rig[]>(() => {
    try {
      return JSON.parse(window.localStorage.getItem(SAVED_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const drag = useRef<{ x: number; index: number } | null>(null);
  const camera = CAMERAS.find((c) => c.name === rig.camera);
  const lens = LENSES.find((l) => l.name === rig.lens);
  const hasFocal = FOCALS.includes(Number(rig.focalLength));
  const focalIndex = hasFocal ? FOCALS.indexOf(Number(rig.focalLength)) : FOCALS.indexOf(35);
  const empty = !rig.camera && !rig.lens && !hasFocal && !rig.aperture;
  const setFocal = (index: number) => onChange({ ...rig, focalLength: FOCALS[Math.min(FOCALS.length - 1, Math.max(0, index))] });
  const complete = (r: Partial<Rig>): r is Rig => Boolean(r.camera && r.lens && FOCALS.includes(Number(r.focalLength)) && r.aperture);
  const saveSetup = () => {
    if (!complete(rig)) return;
    const next = [rig, ...saved.filter((s) => JSON.stringify(s) !== JSON.stringify(rig))].slice(0, 8);
    setSaved(next);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(next));
    } catch {}
    setTab("saved");
  };
  const onFocalDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    drag.current = { x: event.clientX, index: focalIndex };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onFocalMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    setFocal(drag.current.index + Math.round((event.clientX - drag.current.x) / 28));
  };
  const setups = tab === "recommended" ? RECOMMENDED : tab === "saved" ? saved.map((r, i) => ({ name: `Setup ${i + 1}`, rig: r })) : [];
  const summary = [rig.lens, hasFocal ? `${rig.focalLength}mm` : "", rig.aperture].filter(Boolean).join(", ");
  const gearArt = (name?: string) => (name ? <img src={gear(name)} alt="" /> : <span className="cns-rig-auto" aria-hidden="true"><Sparkles className="h-5 w-5" /></span>);
  const choices = part === "camera" ? CAMERAS.map((c) => c.name) : part === "lens" ? LENSES.map((l) => l.name) : APERTURES;
  return (
    <div className="cns-pop" ref={ref}>
      <button type="button" className="cns-rig" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        {gearArt(rig.camera)}
        <span>
          <strong>{rig.camera || (empty ? "Auto rig" : "Auto camera")}</strong>
          <small>{summary || "Each scene picks its own camera"}</small>
        </span>
      </button>
      {open ? (
        <div className="cns-panel cns-rigpanel" role="dialog" aria-label="Camera rig">
          <div className="cns-rig-tabs" role="tablist" aria-label="Setups">
            {(["all", "recommended", "saved"] as const).map((value) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => { setTab(value); setPart(""); }}>
                {value === "all" ? "All" : value === "recommended" ? "Recommended" : "Saved"}
              </button>
            ))}
          </div>
          {tab === "all" ? (
            <>
              <div className="cns-rig-cards">
                <button type="button" className="cns-rig-card" aria-pressed={part === "camera"} onClick={() => setPart(part === "camera" ? "" : "camera")}>
                  <em>Camera</em>
                  {gearArt(rig.camera)}
                  <small>{camera?.kind || "Auto"}</small>
                  <strong>{rig.camera || "Auto"}</strong>
                </button>
                <button type="button" className="cns-rig-card" aria-pressed={part === "lens"} onClick={() => setPart(part === "lens" ? "" : "lens")}>
                  <em>Lens</em>
                  {gearArt(rig.lens)}
                  <small>{lens?.kind || "Auto"}</small>
                  <strong>{rig.lens || "Auto"}</strong>
                </button>
                <button
                  type="button"
                  className="cns-rig-card is-focal"
                  aria-label={`Focal length ${hasFocal ? `${rig.focalLength}mm` : "Auto"}. Drag sideways or use arrow keys to change.`}
                  onPointerDown={onFocalDown}
                  onPointerMove={onFocalMove}
                  onPointerUp={() => (drag.current = null)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" || event.key === "ArrowUp") setFocal(hasFocal ? focalIndex + 1 : focalIndex);
                    if (event.key === "ArrowLeft" || event.key === "ArrowDown") setFocal(hasFocal ? focalIndex - 1 : focalIndex);
                  }}
                >
                  <em>Focal length</em>
                  <span className="cns-focal">{hasFocal ? rig.focalLength : "Auto"}</span>
                  <span className="cns-ruler" aria-hidden="true">
                    {FOCALS.map((f) => <i key={f} data-on={(hasFocal && f === Number(rig.focalLength)) || undefined} />)}
                  </span>
                  <strong>{hasFocal ? "mm · drag" : "drag to set"}</strong>
                </button>
                <button type="button" className="cns-rig-card" aria-pressed={part === "aperture"} onClick={() => setPart(part === "aperture" ? "" : "aperture")}>
                  <em>Aperture</em>
                  {gearArt(rig.aperture)}
                  <small>{(rig.aperture && APERTURE_FEEL[rig.aperture]) || "Auto"}</small>
                  <strong>{rig.aperture || "Auto"}</strong>
                </button>
              </div>
              {part ? (
                <div className="cns-rig-options" role="listbox" aria-label={part}>
                  {auto ? (
                    <button type="button" role="option" aria-selected={!rig[part]} onClick={() => { const next = { ...rig }; delete next[part]; onChange(next); }}>
                      <span className="cns-rig-auto" aria-hidden="true"><Sparkles className="h-5 w-5" /></span>
                      {!rig[part] ? <i className="cns-rig-check" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></i> : null}
                      <span>Auto</span>
                    </button>
                  ) : null}
                  {choices.map((name) => {
                    const selected = rig[part] === name;
                    return (
                      <button key={name} type="button" role="option" aria-selected={selected} onClick={() => onChange({ ...rig, [part]: name })}>
                        <img src={gear(name)} alt="" loading="lazy" />
                        {selected ? <i className="cns-rig-check" aria-hidden="true"><Check className="h-3 w-3" strokeWidth={3} /></i> : null}
                        <span>{name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className="cns-rig-foot">
                {auto && !empty ? <button type="button" className="cns-save" onClick={() => { onChange({}); setPart(""); }}><RotateCcw className="h-3.5 w-3.5" />Reset to Auto</button> : null}
                <button type="button" className="cns-save" onClick={saveSetup} disabled={!complete(rig)} title={complete(rig) ? undefined : "Pick all four parts to save a setup"}><Save className="h-3.5 w-3.5" />Save setup</button>
              </div>
            </>
          ) : (
            <div className="cns-setups">
              {setups.length ? setups.map((setup) => (
                <button key={setup.name + JSON.stringify(setup.rig)} type="button" onClick={() => { onChange(setup.rig); setTab("all"); }}>
                  <img src={gear(setup.rig.camera)} alt="" />
                  <span>
                    <strong>{setup.name}</strong>
                    <small>{setup.rig.camera} · {setup.rig.lens} · {setup.rig.focalLength}mm {setup.rig.aperture}</small>
                  </span>
                </button>
              )) : <p className="cns-empty">No saved setups yet. Build a rig in All and choose Save setup.</p>}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
