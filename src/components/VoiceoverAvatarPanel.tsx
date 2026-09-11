import { Clapperboard, UserRound } from "lucide-react";
import { AVATAR_PROVIDERS, DEFAULT_AVATAR_REMAKE } from "../utils/avatarRemake.js";

export type AvatarRemakeSettings = {
  layout: "split" | "full";
  provider: "preview" | "heygen" | "longcat";
  splitRatio: number;
  aspectRatio: "9:16" | "16:9";
  resolution: "720p" | "480p";
  faceName: string;
  prompt: string;
};

type ProviderStatus = Record<string, { available: boolean; label: string; env?: string }>;

type Props = {
  value: AvatarRemakeSettings;
  onChange: (next: AvatarRemakeSettings) => void;
  faceFile: File | null;
  onFaceFile: (file: File | null) => void;
  voices: Array<{ id: string; name: string }>;
  profileId: string;
  onProfileId: (id: string) => void;
  providers?: ProviderStatus;
  hasNarration: boolean;
  disabled?: boolean;
};

export function VoiceoverAvatarPanel({
  value,
  onChange,
  faceFile,
  onFaceFile,
  voices,
  profileId,
  onProfileId,
  providers,
  hasNarration,
  disabled,
}: Props) {
  const patch = (partial: Partial<AvatarRemakeSettings>) => onChange({ ...value, ...partial });
  const providerMeta = providers || Object.fromEntries(AVATAR_PROVIDERS.map((id) => [id, { available: id === "preview", label: id }]));

  return (
    <div className="vs-tool voice-avatar-panel" aria-label="Avatar remake">
      <header className="vs-tool-head">
        <h2><UserRound size={16} />Avatar</h2>
        <span className="vs-tool-meta">{hasNarration ? "Ready" : "Needs VO"}</span>
      </header>

      <div className="voice-avatar-layout-grid" role="group" aria-label="Layout">
        <button type="button" className={`voice-avatar-layout ${value.layout === "split" ? "is-selected" : ""}`} disabled={disabled} onClick={() => patch({ layout: "split" })}>
          <Clapperboard size={18} />
          <strong>Split</strong>
        </button>
        <button type="button" className={`voice-avatar-layout ${value.layout === "full" ? "is-selected" : ""}`} disabled={disabled} onClick={() => patch({ layout: "full" })}>
          <UserRound size={18} />
          <strong>Full</strong>
        </button>
      </div>

      {value.layout === "split" ? (
        <label className="voice-subtitle-range">
          <span>Split</span>
          <input type="range" min={0.35} max={0.6} step={0.01} value={value.splitRatio} disabled={disabled} aria-label="Top pane height" onChange={(e) => patch({ splitRatio: Number(e.target.value) })} />
          <output>{Math.round(value.splitRatio * 100)}%</output>
        </label>
      ) : null}

      <fieldset className="voice-avatar-fieldset" disabled={disabled}>
        <legend>Provider</legend>
        {AVATAR_PROVIDERS.map((id) => {
          const meta: { available: boolean; label: string; env?: string } = providerMeta[id] || { available: id === "preview", label: id };
          return (
            <label key={id} className={!meta.available ? "is-disabled" : undefined}>
              <input
                type="radio"
                name="avatar-provider"
                checked={value.provider === id}
                disabled={!meta.available}
                onChange={() => patch({ provider: id as AvatarRemakeSettings["provider"] })}
              />
              <span>{meta.label}{!meta.available && meta.env ? ` · ${meta.env}` : ""}</span>
            </label>
          );
        })}
      </fieldset>

      <div className="voice-avatar-placeholders">
        <label>
          <span>Face</span>
          <input type="file" accept="image/png,image/jpeg,image/webp" disabled={disabled} aria-label="Client face photo" onChange={(e) => onFaceFile(e.target.files?.[0] || null)} />
          <em>{faceFile?.name || value.faceName || "PNG / JPG · 12 MB max"}</em>
        </label>
        <label>
          <span>Voice</span>
          <select aria-label="Bound narrator voice" value={profileId} disabled={disabled} onChange={(e) => onProfileId(e.target.value)}>
            <option value="">Voiceover narrator</option>
            {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
          </select>
        </label>
        {value.provider !== "preview" ? (
          <label>
            <span>Prompt</span>
            <input type="text" value={value.prompt} disabled={disabled} onChange={(e) => patch({ prompt: e.target.value })} placeholder={DEFAULT_AVATAR_REMAKE.prompt} />
          </label>
        ) : null}
      </div>
    </div>
  );
}
