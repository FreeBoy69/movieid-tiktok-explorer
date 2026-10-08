// The one YouTube publish form: title, description, tags, Short, visibility, made for kids
// and playlist. Hosts keep their own submit logic and chrome; this renders the fields.
import { type KeyboardEvent, type ReactNode, useId, useRef } from "react";
import { CalendarClock, Check, Globe2, Link2, ListPlus, ListVideo, Loader2, Lock, RefreshCw, Sparkles, X } from "lucide-react";
import "./YouTubePublishForm.css";

export type PublishTheme = "light" | "dark" | "studio";
export type PlaylistMode = "none" | "existing" | "create" | "auto";

export type PublishOption = { value: string; label: string; hint: string; icon: ReactNode };

export const VISIBILITY_OPTIONS: PublishOption[] = [
  { value: "private", label: "Private", hint: "Only you can see it until you publish it on YouTube.", icon: <Lock aria-hidden="true" /> },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the link can watch; it stays off your channel page.", icon: <Link2 aria-hidden="true" /> },
  { value: "public", label: "Public", hint: "Goes live on your channel as soon as the upload finishes.", icon: <Globe2 aria-hidden="true" /> },
];

// Automations publish on a schedule instead of straight to public.
export const SCHEDULED_VISIBILITY_OPTIONS: PublishOption[] = [
  { value: "schedule", label: "Scheduled", hint: "Uploads go public at the release times.", icon: <CalendarClock aria-hidden="true" /> },
  { value: "private", label: "Private", hint: "Uploads stay private; you publish them yourself.", icon: <Lock aria-hidden="true" /> },
  { value: "unlisted", label: "Unlisted", hint: "Uploads are watchable by link only.", icon: <Link2 aria-hidden="true" /> },
];

const PLAYLIST_MODES: Record<PlaylistMode, { label: string; hint: string }> = {
  auto: { label: "Auto", hint: "AutoYT picks the playlist that fits each video's niche." },
  existing: { label: "Existing", hint: "Add uploads to one of this channel's playlists." },
  create: { label: "New", hint: "Creates a new playlist with the first upload." },
  none: { label: "None", hint: "Uploads are not added to a playlist." },
};

export type PlaylistSummary = { id: string; title: string; videoCount?: number };

function SegmentedChoice({ label, value, options, onChange, hint }: { label: string; value: string; options: Array<{ value: string; label: string; icon?: ReactNode }>; onChange: (value: string) => void; hint?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const active = Math.max(0, options.findIndex((option) => option.value === value));
  const move = (event: KeyboardEvent, index: number) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div className="ytp-field ytp-choice">
      <span className="ytp-label" id={labelId}>{label}</span>
      <div className="ytp-segments" role="radiogroup" aria-labelledby={labelId} data-count={options.length}>
        {options.map((option, index) => (
          <button
            key={option.value}
            ref={(node) => { refs.current[index] = node; }}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            tabIndex={index === active ? 0 : -1}
            className="ytp-segment"
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            {option.icon}
            <span>{option.label}</span>
          </button>
        ))}
      </div>
      {hint ? <span className="ytp-hint">{hint}</span> : null}
    </div>
  );
}

export function VisibilityControl({ value, onChange, options = VISIBILITY_OPTIONS, label = "Visibility", theme }: { value: string; onChange: (value: string) => void; options?: PublishOption[]; label?: string; theme?: PublishTheme }) {
  const current = options.find((option) => option.value === value) || options[0];
  const body = <SegmentedChoice label={label} value={current.value} options={options} onChange={onChange} hint={current.hint} />;
  return theme ? <div className="ytp" data-theme={theme}>{body}</div> : body;
}

export function PublishSwitch({ title, body, checked, onChange, theme }: { title: string; body?: string; checked: boolean; onChange: (next: boolean) => void; theme?: PublishTheme }) {
  const row = (
    <label className="ytp-switch">
      <span className="ytp-switch-copy">
        <span className="ytp-switch-title">{title}</span>
        {body ? <span className="ytp-hint">{body}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="ytp-switch-track" aria-hidden="true"><span /></span>
    </label>
  );
  return theme ? <div className="ytp" data-theme={theme}>{row}</div> : row;
}

export type PlaylistControlProps = {
  modes?: PlaylistMode[];
  mode: PlaylistMode;
  onModeChange: (mode: PlaylistMode) => void;
  playlists: PlaylistSummary[];
  playlistId: string;
  onPlaylistIdChange: (id: string, playlist?: PlaylistSummary) => void;
  newTitle: string;
  onNewTitleChange: (title: string) => void;
  newTitlePlaceholder?: string;
  loading?: boolean;
  onRefresh?: () => void;
  children?: ReactNode;
  theme?: PublishTheme;
};

export function PlaylistControl({ modes = ["none", "existing", "create"], mode, onModeChange, playlists, playlistId, onPlaylistIdChange, newTitle, onNewTitleChange, newTitlePlaceholder, loading, onRefresh, children, theme }: PlaylistControlProps) {
  const listId = useId();
  const body = (
    <div className="ytp-playlist">
      <div className="ytp-playlist-head">
        <SegmentedChoice
          label="Playlist"
          value={mode}
          options={modes.map((value) => ({ value, label: PLAYLIST_MODES[value].label, icon: value === "auto" ? <Sparkles aria-hidden="true" /> : value === "existing" ? <ListVideo aria-hidden="true" /> : value === "create" ? <ListPlus aria-hidden="true" /> : <X aria-hidden="true" /> }))}
          onChange={(value) => onModeChange(value as PlaylistMode)}
          hint={PLAYLIST_MODES[mode]?.hint}
        />
      </div>
      {mode === "existing" ? (
        <div className="ytp-field">
          <div className="ytp-label-row">
            <span className="ytp-label" id={listId}>Your playlists</span>
            {onRefresh ? (
              <button type="button" className="ytp-text-button" onClick={onRefresh} disabled={loading}>
                {loading ? <Loader2 className="ytp-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
                {loading ? "Loading" : "Refresh"}
              </button>
            ) : null}
          </div>
          {playlists.length ? (
            <div className="ytp-list" role="radiogroup" aria-labelledby={listId}>
              {playlists.map((playlist) => {
                const selected = playlist.id === playlistId;
                return (
                  <button key={playlist.id} type="button" role="radio" aria-checked={selected} className="ytp-list-row" onClick={() => onPlaylistIdChange(playlist.id, playlist)}>
                    <span className="ytp-list-mark" aria-hidden="true">{selected ? <Check /> : null}</span>
                    {/* strong + span keeps the app's global pill-button rule off these rows. */}
                    <strong className="ytp-list-title">{playlist.title}</strong>
                    <span className="ytp-list-count">{playlist.videoCount !== undefined ? `${playlist.videoCount} ${playlist.videoCount === 1 ? "video" : "videos"}` : ""}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="ytp-empty">{loading ? "Loading this channel's playlists" : "No playlists found on this channel. Refresh, or create a new one."}</p>
          )}
        </div>
      ) : null}
      {mode === "create" || mode === "auto" ? (
        <label className="ytp-field">
          <span className="ytp-label">{mode === "auto" ? "Fallback playlist name" : "New playlist name"}</span>
          <input className="ytp-input" value={newTitle} onChange={(event) => onNewTitleChange(event.target.value)} maxLength={150} placeholder={newTitlePlaceholder || (mode === "auto" ? "AutoYT Picks" : "Movie Recaps")} />
        </label>
      ) : null}
      {children}
    </div>
  );
  return theme ? <div className="ytp" data-theme={theme}>{body}</div> : body;
}

export type YouTubePublishFieldsProps = {
  theme?: PublishTheme;
  title: string;
  onTitleChange: (value: string) => void;
  titlePlaceholder?: string;
  description?: string;
  onDescriptionChange?: (value: string) => void;
  tags?: string;
  onTagsChange?: (value: string) => void;
  privacyStatus?: string;
  onPrivacyStatusChange?: (value: string) => void;
  visibilityOptions?: PublishOption[];
  postAsShort?: boolean;
  onPostAsShortChange?: (value: boolean) => void;
  madeForKids?: boolean;
  onMadeForKidsChange?: (value: boolean) => void;
  playlist?: Omit<PlaylistControlProps, "theme">;
  // Rendered above the text fields: a file picker, a drafting note, a channel card.
  before?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function YouTubePublishFields({ theme = "light", title, onTitleChange, titlePlaceholder = "Video title", description, onDescriptionChange, tags, onTagsChange, privacyStatus, onPrivacyStatusChange, visibilityOptions, postAsShort, onPostAsShortChange, madeForKids, onMadeForKidsChange, playlist, before, children, className }: YouTubePublishFieldsProps) {
  return (
    <div className={className ? `ytp ytp-form ${className}` : "ytp ytp-form"} data-theme={theme}>
      {before}
      <label className="ytp-field">
        <span className="ytp-label-row"><span className="ytp-label">Title</span><span className="ytp-count" data-full={title.length >= 100 || undefined}>{title.length}/100</span></span>
        <input className="ytp-input" value={title} maxLength={100} onChange={(event) => onTitleChange(event.target.value.slice(0, 100))} placeholder={titlePlaceholder} />
      </label>
      {onDescriptionChange ? (
        <label className="ytp-field">
          <span className="ytp-label">Description</span>
          <textarea className="ytp-input ytp-textarea" rows={5} value={description || ""} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Description, links, credits" />
        </label>
      ) : null}
      {onTagsChange ? (
        <label className="ytp-field">
          <span className="ytp-label-row"><span className="ytp-label">Tags</span><span className="ytp-count">Comma separated</span></span>
          <input className="ytp-input" value={tags || ""} onChange={(event) => onTagsChange(event.target.value)} placeholder="movie recap, sci fi, explained" />
        </label>
      ) : null}
      {onPostAsShortChange ? (
        <PublishSwitch title="Post as a YouTube Short" body="Trims long clips to a 1–3 minute story beat before upload. Turn off for long-form." checked={Boolean(postAsShort)} onChange={onPostAsShortChange} />
      ) : null}
      {onPrivacyStatusChange ? <VisibilityControl value={privacyStatus || "private"} onChange={onPrivacyStatusChange} options={visibilityOptions} /> : null}
      {onMadeForKidsChange ? (
        <PublishSwitch title="Made for kids" body="Required by YouTube for content aimed at children; it turns off comments and personalized ads." checked={Boolean(madeForKids)} onChange={onMadeForKidsChange} />
      ) : null}
      {playlist ? <PlaylistControl {...playlist} /> : null}
      {children}
    </div>
  );
}

// Hosts that store an existing playlist id and a new playlist title side by side
// (no explicit mode) derive the mode from which one is set.
export function playlistModeOf(playlistId: string, newTitle: string): PlaylistMode {
  return newTitle.trim() ? "create" : playlistId ? "existing" : "none";
}
