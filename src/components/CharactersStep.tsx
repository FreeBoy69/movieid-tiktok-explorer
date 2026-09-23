// Create Video → Visuals → Characters: lock every recurring character before the
// storyboard. A compact cast list on the left; the selected character opens beside
// it with their sheet, takes, and details. The locked sheet is the identity
// reference for every scene the character appears in.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, Clapperboard, Download, Loader2, Lock, Maximize2, Plus, Save, Sparkles, Trash2, Upload, Users, WandSparkles, X } from "lucide-react";
import "./CharactersStep.css";

export type CastMember = { id: string; name: string; role?: string; appearance: string; outfit: string; approvedReferences: string[] };
export type CastSheetState = { status?: string; candidates?: string[]; error?: string; count?: number; startedAt?: number };
export type Framing = "character" | "cinematic";

// A run that never reported back (a server restart) stops showing as busy.
const STALE_MS = 8 * 60 * 1000;
const SHEET_COUNTS = [1, 2, 4];
const isRunning = (sheet?: CastSheetState) => sheet?.status === "running" && Date.now() - (sheet.startedAt || 0) < STALE_MS;
// Generated sheets put the close-up portrait on the left, so avatars zoom into it.
const isSheet = (asset: string) => /-sheet-/.test(asset);

export function CharactersStep({
  cast,
  sheets,
  consistency,
  framing,
  busy,
  dirty,
  suggesting,
  generateLabel,
  generateBlocked,
  generating,
  reviewCount = 0,
  onReview,
  onBack,
  onSave,
  onSuggest,
  onAdd,
  onEdit,
  onRemove,
  onSheets,
  onApprove,
  onUpload,
  onConsistency,
  onFraming,
  onGenerate,
}: {
  cast: CastMember[];
  sheets: Record<string, CastSheetState>;
  consistency: boolean;
  framing: Framing;
  busy: boolean;
  dirty: boolean;
  suggesting: boolean;
  generateLabel: string;
  generateBlocked: string;
  generating: boolean;
  reviewCount?: number;
  onReview?: () => void;
  onBack: () => void;
  onSave: () => void;
  onSuggest: () => void;
  onAdd: () => void;
  onEdit: (id: string, patch: Partial<CastMember>) => void;
  onRemove: (id: string) => void;
  onSheets: (id: string, count: number) => void;
  onApprove: (id: string, asset: string) => void;
  onUpload: (id: string, file: File) => void;
  onConsistency: (on: boolean) => void;
  onFraming: (framing: Framing) => void;
  onGenerate: () => void;
}) {
  const unlocked = cast.filter((character) => !character.approvedReferences.length);
  const [selectedId, setSelectedId] = useState("");
  const selected = cast.find((character) => character.id === selectedId) || unlocked[0] || cast[0];
  // A newly added character opens straight away.
  const [known, setKnown] = useState(cast.length);
  useEffect(() => {
    if (cast.length > known) setSelectedId(cast[cast.length - 1].id);
    setKnown(cast.length);
  }, [cast.length]);
  const needs = consistency && unlocked.length ? `Lock ${unlocked.map((character) => character.name).join(", ")} to continue` : "";
  const blocked = generateBlocked || needs;

  return (
    <div className="chs">
      <div className="maker-scene-head">
        <button className="maker-link maker-focus-back" onClick={onBack}>
          <ChevronLeft size={16} />
          Back
          <span className="maker-focus-back-to">to settings</span>
        </button>
        <div className="maker-stage-head">
          <div>
            <h2>Characters</h2>
            <p>{cast.length ? `${cast.length - unlocked.length} of ${cast.length} locked` : "Lock the people in your story so every scene shows the same faces"}</p>
          </div>
          <div className="maker-actions">
            {needs && !generateBlocked ? <span className="chs-needs">{needs}</span> : null}
            {dirty && (
              <button className="maker-outline" disabled={busy} onClick={onSave}>
                <Save size={15} />
                Save
              </button>
            )}
            {reviewCount > 0 && onReview ? (
              <button className="maker-outline" onClick={onReview}>
                Review {reviewCount} scenes
              </button>
            ) : null}
            <button className="maker-primary" title={blocked || generateLabel} disabled={busy || generating || Boolean(blocked)} onClick={onGenerate}>
              <Clapperboard size={15} />
              {generateLabel}
            </button>
          </div>
        </div>
      </div>

      <div className="chs-bar">
        <div className="chs-seg" role="radiogroup" aria-label="Scene framing">
          {([
            ["character", "Character-led"],
            ["cinematic", "Cinematic mix"],
          ] as const).map(([key, label]) => (
            <button key={key} type="button" role="radio" aria-checked={framing === key} onClick={() => onFraming(key)}>
              {label}
            </button>
          ))}
        </div>
        <p className="chs-bar-note">
          {framing === "character"
            ? "Cast in most scenes · close-ups and medium shots lead · no wide or crowd shots · max 2 per scene"
            : "Wider shots and more B-roll · faces drift more in wide shots"}
        </p>
        <label className="maker-switch chs-consistency" title="Send each character's locked sheet with every scene they appear in">
          <input type="checkbox" checked={consistency} onChange={(e) => onConsistency(e.target.checked)} />
          Keep faces consistent
        </label>
      </div>

      {cast.length && selected ? (
        <div className="chs-layout">
          <nav className="chs-rail" aria-label="Characters">
            <ul>
              {cast.map((character) => {
                const sheet = sheets[character.id];
                const face = character.approvedReferences[0] || sheet?.candidates?.[0] || "";
                const running = isRunning(sheet);
                const state = running ? "busy" : character.approvedReferences.length ? "locked" : "open";
                return (
                  <li key={character.id}>
                    <button type="button" className="chs-person" aria-current={character.id === selected.id || undefined} onClick={() => setSelectedId(character.id)}>
                      <span className="chs-face">
                        {face ? <img src={face} alt="" className={isSheet(face) ? "is-sheet" : undefined} /> : <Users size={16} />}
                      </span>
                      <span className="chs-person-text">
                        <strong>{character.name || "Unnamed"}</strong>
                        <small>{state === "busy" ? "Generating…" : state === "locked" ? character.role || "Locked" : character.role || "Needs a sheet"}</small>
                      </span>
                      <span className="chs-state" data-state={state} aria-label={state === "busy" ? "Generating" : state === "locked" ? "Locked" : "Not locked"}>
                        {state === "busy" ? <Loader2 size={13} className="animate-spin" /> : state === "locked" ? <Lock size={12} /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="chs-rail-actions">
              <button type="button" className="chs-rail-btn" onClick={onAdd}>
                <Plus size={15} />
                Add
              </button>
              <button type="button" className="chs-rail-btn" disabled={busy || suggesting} onClick={onSuggest}>
                {suggesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                {suggesting ? "Reading…" : "From script"}
              </button>
            </div>
          </nav>
          <CharacterDetail
            key={selected.id}
            character={selected}
            sheet={sheets[selected.id] || {}}
            busy={busy}
            onEdit={(patch) => onEdit(selected.id, patch)}
            onRemove={() => onRemove(selected.id)}
            onSheets={(n) => onSheets(selected.id, n)}
            onApprove={(asset) => onApprove(selected.id, asset)}
            onUpload={(file) => onUpload(selected.id, file)}
          />
        </div>
      ) : (
        <div className="chs-empty">
          <span className="chs-empty-icon">
            <Users size={22} />
          </span>
          <h3>Who's in this story?</h3>
          <p>Let the AI read your script and cast its recurring characters, or add them yourself. Videos without people can skip straight to the storyboard.</p>
          <div className="maker-actions">
            <button className="maker-primary" disabled={busy || suggesting} onClick={onSuggest}>
              {suggesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {suggesting ? "Reading the script" : "Cast from script"}
            </button>
            <button className="maker-outline" onClick={onAdd}>
              <Plus size={15} />
              Add a character
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CharacterDetail({
  character,
  sheet,
  busy,
  onEdit,
  onRemove,
  onSheets,
  onApprove,
  onUpload,
}: {
  character: CastMember;
  sheet: CastSheetState;
  busy: boolean;
  onEdit: (patch: Partial<CastMember>) => void;
  onRemove: () => void;
  onSheets: (count: number) => void;
  onApprove: (asset: string) => void;
  onUpload: (file: File) => void;
}) {
  const [count, setCount] = useState(2);
  const [preview, setPreview] = useState("");
  const locked = character.approvedReferences[0] || "";
  const candidates = sheet.candidates || [];
  const running = isRunning(sheet);
  const shown = preview || locked || candidates[0] || "";
  const canLock = Boolean(shown && shown !== locked && candidates.includes(shown));
  const described = Boolean(character.appearance.trim());
  const step = locked ? 3 : candidates.length ? 2 : described ? 1 : 0;
  // Everything viewable full screen: generated takes, plus an uploaded photo that is locked.
  const gallery = locked && !candidates.includes(locked) ? [locked, ...candidates] : candidates;
  const [viewing, setViewing] = useState(-1);
  const face = locked || candidates[0] || "";

  return (
    <section className="chs-detail" aria-label={character.name}>
      <header className="chs-detail-head">
        <span className="chs-face is-lg">
          {face ? <img src={face} alt="" className={isSheet(face) ? "is-sheet" : undefined} /> : <Users size={20} />}
        </span>
        <div className="chs-detail-title">
          <h3>{character.name || "Unnamed character"}</h3>
          <p>{character.role || "No role yet"}</p>
        </div>
        <span className={`chs-status${locked ? " is-locked" : running ? " is-busy" : ""}`}>
          {locked ? <Lock size={12} /> : running ? <Loader2 size={12} className="animate-spin" /> : null}
          {locked ? "Locked" : running ? "Generating" : candidates.length ? "Pick a take" : "Not locked"}
        </span>
        <div className="chs-head-actions">
          <label className="chs-iconbtn" title="Use a photo of them. New sheets will match this face.">
            <Upload size={16} />
            <span className="sr-only">Use a photo of {character.name}</span>
            <input
              type="file"
              hidden
              disabled={busy}
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                if (e.target.files?.[0]) onUpload(e.target.files[0]);
                e.target.value = "";
              }}
            />
          </label>
          <button type="button" className="chs-iconbtn is-danger" title={`Remove ${character.name}`} aria-label={`Remove ${character.name}`} onClick={onRemove}>
            <Trash2 size={16} />
          </button>
        </div>
      </header>
      <div className="chs-viewer">
        <div className="chs-stage">
          {shown ? (
            <button type="button" className="chs-stage-open" aria-label="View full screen" onClick={() => setViewing(Math.max(0, gallery.indexOf(shown)))}>
              <img key={shown} src={shown} alt={`${character.name} character sheet`} />
              <span className="chs-expand" aria-hidden="true">
                <Maximize2 size={15} />
              </span>
            </button>
          ) : (
            <span className={`chs-stage-empty${running ? " is-busy" : ""}`}>
              {running ? <Loader2 size={22} className="animate-spin" /> : <WandSparkles size={22} />}
              <strong>{running ? `Drawing ${sheet.count || count} ${(sheet.count || count) === 1 ? "take" : "takes"}` : "No sheet yet"}</strong>
              <small>{running ? "Usually under a minute. Takes appear below as they finish." : "A sheet is a close-up portrait plus front, three-quarter, side, and back views."}</small>
            </span>
          )}
          {shown && shown === locked ? (
            <em className="chs-tag is-locked">
              <Lock size={12} />
              Locked
            </em>
          ) : null}
          {canLock ? (
            <button type="button" className="chs-lock" disabled={busy} onClick={() => onApprove(shown)}>
              <Check size={15} />
              Lock this take
            </button>
          ) : null}
        </div>
        <div className="chs-takes" role="listbox" aria-label="Takes">
          {candidates.map((asset, index) => (
            <button
              key={asset}
              type="button"
              role="option"
              aria-selected={shown === asset}
              className={asset === locked ? "is-locked" : undefined}
              title={asset === locked ? "Locked take" : `Take ${candidates.length - index}`}
              onClick={() => setPreview(asset)}
              onDoubleClick={() => setViewing(Math.max(0, gallery.indexOf(asset)))}
            >
              <img src={asset} alt="" loading="lazy" />
              <span className="chs-take-num">{candidates.length - index}</span>
              {asset === locked ? (
                <span className="chs-take-lock">
                  <Lock size={10} />
                </span>
              ) : null}
            </button>
          ))}
          {running ? (
            <span className="chs-take-busy" aria-label="Generating">
              <Loader2 size={14} className="animate-spin" />
            </span>
          ) : null}
          {!candidates.length && !running ? <span className="chs-takes-hint">Takes you generate show up here.</span> : null}
        </div>
      </div>

      <div className="chs-form">
        <ol className="chs-steps" aria-label="Progress">
          {["Describe", "Generate", "Lock"].map((label, index) => (
            <li key={label} data-done={step > index || undefined} data-current={step === index || undefined}>
              <span>{step > index ? <Check size={11} /> : index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
        <div className="chs-row">
          <label className="maker-field">
            Name
            <input value={character.name} placeholder="Character name" onChange={(e) => onEdit({ name: e.target.value })} />
          </label>
          <label className="maker-field">
            Role
            <input value={character.role || ""} placeholder="e.g. the investigator" onChange={(e) => onEdit({ role: e.target.value })} />
          </label>
        </div>
        <label className="maker-field">
          Appearance
          <textarea rows={3} value={character.appearance} placeholder="Age, skin tone, face, distinctive features, hair, build" onChange={(e) => onEdit({ appearance: e.target.value })} />
        </label>
        <label className="maker-field">
          Outfit
          <textarea rows={2} value={character.outfit} placeholder="One locked outfit: colors, materials, accessories" onChange={(e) => onEdit({ outfit: e.target.value })} />
        </label>
        <div className="chs-generate">
          <div className="chs-seg is-small" role="radiogroup" aria-label="Takes to generate">
            {SHEET_COUNTS.map((n) => (
              <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)}>
                {n} {n === 1 ? "take" : "takes"}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="maker-primary chs-go"
            disabled={busy || running || !described}
            onClick={() => {
              setPreview("");
              onSheets(count);
            }}
          >
            {running ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}
            {running ? "Generating" : candidates.length ? "Generate more takes" : "Generate character sheet"}
          </button>
          {!described ? <small className="chs-hint">Describe their appearance first.</small> : null}
        </div>
        {sheet.status === "failed" && sheet.error ? <p className="chs-error">{sheet.error}</p> : null}
      </div>
      {viewing >= 0 && gallery.length ? (
        <SheetViewer
          name={character.name}
          images={gallery}
          locked={locked}
          index={Math.min(viewing, gallery.length - 1)}
          busy={busy}
          onIndex={setViewing}
          onClose={() => setViewing(-1)}
          onLock={(asset) => {
            setPreview(asset);
            onApprove(asset);
          }}
        />
      ) : null}
    </section>
  );
}

// Full-screen sheet viewer: arrows or ←/→ step through takes, Esc closes.
function SheetViewer({
  name,
  images,
  locked,
  index,
  busy,
  onIndex,
  onClose,
  onLock,
}: {
  name: string;
  images: string[];
  locked: string;
  index: number;
  busy: boolean;
  onIndex: (index: number) => void;
  onClose: () => void;
  onLock: (asset: string) => void;
}) {
  const asset = images[index];
  const step = (delta: number) => onIndex((index + delta + images.length) % images.length);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  });
  return createPortal(
    <div className="chs-lightbox" role="dialog" aria-modal="true" aria-label={`${name} character sheets`} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <header className="chs-lb-bar">
        <div>
          <strong>{name}</strong>
          <span>
            {asset === locked ? "Locked sheet" : `Take ${images.length - index} of ${images.length}`}
          </span>
        </div>
        <div className="chs-lb-actions">
          {asset === locked ? (
            <span className="chs-status is-locked">
              <Lock size={12} />
              Locked
            </span>
          ) : (
            <button type="button" className="chs-lb-lock" disabled={busy} onClick={() => onLock(asset)}>
              <Check size={15} />
              Lock this take
            </button>
          )}
          <a className="chs-lb-icon" href={asset} download title="Download" aria-label="Download this sheet">
            <Download size={17} />
          </a>
          <button type="button" className="chs-lb-icon" aria-label="Close" autoFocus onClick={onClose}>
            <X size={18} />
          </button>
        </div>
      </header>
      <div className="chs-lb-stage" onClick={(e) => e.target === e.currentTarget && onClose()}>
        {images.length > 1 ? (
          <button type="button" className="chs-lb-nav is-prev" aria-label="Previous take" onClick={() => step(-1)}>
            <ChevronLeft size={22} />
          </button>
        ) : null}
        <img key={asset} src={asset} alt={`${name} character sheet`} />
        {images.length > 1 ? (
          <button type="button" className="chs-lb-nav is-next" aria-label="Next take" onClick={() => step(1)}>
            <ChevronRight size={22} />
          </button>
        ) : null}
      </div>
      {images.length > 1 ? (
        <div className="chs-lb-strip">
          {images.map((item, i) => (
            <button key={item} type="button" aria-current={i === index || undefined} aria-label={item === locked ? "Locked sheet" : `Take ${images.length - i}`} onClick={() => onIndex(i)}>
              <img src={item} alt="" />
              {item === locked ? (
                <span className="chs-take-lock">
                  <Lock size={10} />
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
