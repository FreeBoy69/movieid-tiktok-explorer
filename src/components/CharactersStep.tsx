// Create Video → Visuals → Characters: lock every recurring character before the
// storyboard. Each character gets AI character sheets (close-up + turnaround); the
// locked sheet is the identity reference for every scene they appear in.
import { useState } from "react";
import { Check, ChevronLeft, Clapperboard, Loader2, Lock, Plus, Save, Sparkles, Upload, Users, WandSparkles, X } from "lucide-react";
import "./CharactersStep.css";

export type CastMember = { id: string; name: string; role?: string; appearance: string; outfit: string; approvedReferences: string[] };
export type CastSheetState = { status?: string; candidates?: string[]; error?: string; count?: number; startedAt?: number };
export type Framing = "character" | "cinematic";

// A run that never reported back (a server restart) stops showing as busy.
const STALE_MS = 8 * 60 * 1000;
const SHEET_COUNTS = [1, 2, 4];

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
  const blocked =
    generateBlocked ||
    (consistency && unlocked.length
      ? `Lock a character sheet for ${unlocked.map((character) => character.name).join(", ")}, or remove ${unlocked.length === 1 ? "them" : "those characters"}.`
      : "");
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
            <p>
              {cast.length
                ? `${cast.length - unlocked.length} of ${cast.length} locked · every scene is drawn from these sheets`
                : "Lock the people in your story before the storyboard, so every scene shows the same faces"}
            </p>
          </div>
          <div className="maker-actions">
            {dirty && (
              <button className="maker-outline" disabled={busy} onClick={onSave}>
                <Save size={15} />
                Save
              </button>
            )}
            <button className="maker-outline" disabled={busy || suggesting} onClick={onSuggest}>
              {suggesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {suggesting ? "Reading the script" : "Cast from script"}
            </button>
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

      <section className="chs-framing" aria-label="Framing">
        <div className="chs-framing-options" role="radiogroup" aria-label="Scene framing">
          {([
            ["character", "Character-led", "Recommended. Your cast is in about 80% of scenes: close-ups for key moments, medium shots for talking, full-body long shots for movement. No tiny figures, aerial views, or crowds; B-roll only for short inserts."],
            ["cinematic", "Cinematic mix", "Wider establishing shots and more B-roll. Characters appear when the story needs them, but faces drift more in wide shots."],
          ] as const).map(([key, label, text]) => (
            <button key={key} type="button" role="radio" aria-checked={framing === key} className="chs-framing-option" onClick={() => onFraming(key)}>
              <span className="chs-radio" aria-hidden="true" />
              <strong>{label}</strong>
              <span>{text}</span>
            </button>
          ))}
        </div>
        <div className="chs-mix" aria-label="Shot mix">
          {framing === "character" ? (
            <>
              <span><b>40%</b> Close-up</span>
              <span><b>40%</b> Medium</span>
              <span><b>20%</b> Long + B-roll</span>
              <span>Max 2 per scene</span>
            </>
          ) : (
            <span>Shot sizes vary freely</span>
          )}
          <label className="maker-switch chs-consistency" title="Send each character's locked sheet with every scene they appear in">
            <input type="checkbox" checked={consistency} onChange={(e) => onConsistency(e.target.checked)} />
            Keep faces consistent
          </label>
        </div>
      </section>

      {cast.length ? (
        <div className="chs-grid">
          {cast.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              sheet={sheets[character.id] || {}}
              busy={busy}
              onEdit={(patch) => onEdit(character.id, patch)}
              onRemove={() => onRemove(character.id)}
              onSheets={(count) => onSheets(character.id, count)}
              onApprove={(asset) => onApprove(character.id, asset)}
              onUpload={(file) => onUpload(character.id, file)}
            />
          ))}
          <button type="button" className="chs-add" onClick={onAdd}>
            <Plus size={22} />
            <strong>Add a character</strong>
            <span>Name them, describe their look, then generate sheets</span>
          </button>
        </div>
      ) : (
        <div className="chs-empty">
          <Users size={28} />
          <h3>No characters yet</h3>
          <p>Let the AI read your script and cast the recurring characters, or add them yourself. Videos without people can skip this step.</p>
          <div className="maker-actions">
            <button className="maker-primary" disabled={busy || suggesting} onClick={onSuggest}>
              {suggesting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              Cast from script
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

function CharacterCard({
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
  const running = sheet.status === "running" && Date.now() - (sheet.startedAt || 0) < STALE_MS;
  const shown = preview || locked || candidates[0] || "";
  const showingCandidate = Boolean(shown && shown !== locked);
  return (
    <article className="chs-card" data-locked={locked ? "true" : undefined}>
      <div className="chs-stage">
        {shown ? (
          <img src={shown} alt={`${character.name} character sheet`} />
        ) : running ? (
          <span className="chs-stage-empty is-busy">
            <Loader2 size={24} className="animate-spin" />
            Drawing {sheet.count || count} character {(sheet.count || count) === 1 ? "sheet" : "sheets"}
            <small>Usually under a minute. New sheets appear here as they finish.</small>
          </span>
        ) : (
          <span className="chs-stage-empty">
            <Users size={26} />
            No sheet yet
            <small>Describe {character.name || "this character"}, then generate sheets: a close-up portrait plus front, three-quarter, side, and back views.</small>
          </span>
        )}
        {locked && !showingCandidate ? (
          <em className="chs-badge is-locked">
            <Lock size={12} />
            Locked
          </em>
        ) : showingCandidate ? (
          <button type="button" className="chs-lock" disabled={busy} onClick={() => onApprove(shown)}>
            <Check size={15} />
            Lock this sheet
          </button>
        ) : null}
        {running && shown ? (
          <em className="chs-badge is-busy">
            <Loader2 size={12} className="animate-spin" />
            Generating
          </em>
        ) : null}
      </div>
      {candidates.length > 0 && (
        <div className="chs-candidates" role="listbox" aria-label={`${character.name} sheets`}>
          {candidates.map((asset) => (
            <button
              key={asset}
              type="button"
              role="option"
              aria-selected={shown === asset}
              className={asset === locked ? "is-locked" : undefined}
              title={asset === locked ? "Locked sheet" : "Preview this sheet"}
              onClick={() => setPreview(asset)}
            >
              <img src={asset} alt="" loading="lazy" />
              {asset === locked ? <Lock size={11} /> : null}
            </button>
          ))}
          {running ? (
            <span className="chs-candidate-busy" aria-label="Generating">
              <Loader2 size={14} className="animate-spin" />
            </span>
          ) : null}
        </div>
      )}
      <div className="chs-fields">
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
          <textarea rows={3} value={character.appearance} placeholder="Age, skin tone, face shape, distinctive features, hairstyle and color, build" onChange={(e) => onEdit({ appearance: e.target.value })} />
        </label>
        <label className="maker-field">
          Outfit
          <textarea rows={2} value={character.outfit} placeholder="One locked outfit: colors, materials, accessories" onChange={(e) => onEdit({ outfit: e.target.value })} />
        </label>
      </div>
      <footer className="chs-actions">
        <div className="chs-count" role="radiogroup" aria-label="Sheets to generate">
          {SHEET_COUNTS.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={count === n} onClick={() => setCount(n)}>
              ×{n}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="maker-primary"
          disabled={busy || running || !character.appearance.trim()}
          title={character.appearance.trim() ? "" : "Describe the appearance first"}
          onClick={() => {
            setPreview("");
            onSheets(count);
          }}
        >
          {running ? <Loader2 size={15} className="animate-spin" /> : <WandSparkles size={15} />}
          {candidates.length ? "More sheets" : "Generate sheets"}
        </button>
        <label className="mk-btn maker-outline chs-upload" title="Upload a photo or drawing of this character. New sheets will match its face.">
          <Upload size={15} />
          Photo
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
        <button type="button" className="maker-icon chs-remove" aria-label={`Remove ${character.name}`} title="Remove character" onClick={onRemove}>
          <X size={16} />
        </button>
      </footer>
      {sheet.status === "failed" && sheet.error ? <p className="chs-error">{sheet.error}</p> : null}
    </article>
  );
}
