// UploadModal, one of ChannelManagement's screens.
import { CheckCircle2, ExternalLink, FileVideo, Loader2, UploadCloud } from "lucide-react";
import { FormEvent, useId, useState } from "react";
import { YouTubePlaylistSummary, YouTubeUploadResult } from "../../types";
import { type PlaylistMode, playlistModeOf, YouTubePublishFields } from "../YouTubePublishForm";
import { Dialog } from "../ui/Dialog";
import { FileDrop } from "../FileDrop";

export function UploadModal({
  canUpload,
  file,
  selectedFileLabel,
  title,
  description,
  tags,
  privacyStatus,
  postAsShort,
  madeForKids,
  playlists,
  playlistId,
  newPlaylistTitle,
  loadingPlaylists,
  uploading,
  uploadResult,
  onClose,
  onFileChange,
  onTitleChange,
  onDescriptionChange,
  onTagsChange,
  onPrivacyStatusChange,
  onPostAsShortChange,
  onMadeForKidsChange,
  onPlaylistIdChange,
  onNewPlaylistTitleChange,
  onRefreshPlaylists,
  onSubmit,
}: {
  canUpload: boolean;
  file: File | null;
  selectedFileLabel: string;
  title: string;
  description: string;
  tags: string;
  privacyStatus: string;
  postAsShort: boolean;
  madeForKids: boolean;
  playlists: YouTubePlaylistSummary[];
  playlistId: string;
  newPlaylistTitle: string;
  loadingPlaylists: boolean;
  uploading: boolean;
  uploadResult: YouTubeUploadResult | null;
  onClose: () => void;
  onFileChange: (file: File | null) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onPrivacyStatusChange: (value: string) => void;
  onPostAsShortChange: (value: boolean) => void;
  onMadeForKidsChange: (value: boolean) => void;
  onPlaylistIdChange: (value: string) => void;
  onNewPlaylistTitleChange: (value: string) => void;
  onRefreshPlaylists: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const [playlistMode, setPlaylistMode] = useState<PlaylistMode>(() => playlistModeOf(playlistId, newPlaylistTitle));
  const formId = useId();
  const rootTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  return (
    <Dialog
      title="Upload video"
      description="Choose a file, add the details, then publish to the selected channel."
      size="lg"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="ui-btn" onClick={onClose}>Cancel</button>
          <button type="submit" form={formId} className="ui-btn is-primary" disabled={!canUpload || !file || !title.trim() || uploading}>
            {uploading ? <Loader2 className="h-4 w-4 ui-spin" /> : <UploadCloud className="h-4 w-4" />}
            {uploading ? "Uploading" : "Upload"}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={onSubmit}>
        <FileDrop
          accept="video/*"
          onFiles={([next]) => onFileChange(next)}
          title="Drop a video here"
          hint="MP4, MOV, WebM, or any YouTube-supported video."
          icon={<FileVideo className="h-7 w-7" />}
          file={file}
          onClear={() => onFileChange(null)}
          size="roomy"
        />
          <YouTubePublishFields
            className="mt-5"
            theme={rootTheme}
            title={title}
            onTitleChange={onTitleChange}
            description={description}
            onDescriptionChange={onDescriptionChange}
            tags={tags}
            onTagsChange={onTagsChange}
            postAsShort={postAsShort}
            onPostAsShortChange={onPostAsShortChange}
            privacyStatus={privacyStatus}
            onPrivacyStatusChange={onPrivacyStatusChange}
            madeForKids={madeForKids}
            onMadeForKidsChange={onMadeForKidsChange}
            playlist={{
              mode: playlistMode,
              onModeChange: (mode) => {
                setPlaylistMode(mode);
                if (mode !== "existing") onPlaylistIdChange("");
                if (mode !== "create") onNewPlaylistTitleChange("");
                if (mode === "existing" && !playlists.length) onRefreshPlaylists();
              },
              playlists,
              playlistId,
              onPlaylistIdChange,
              newTitle: newPlaylistTitle,
              onNewTitleChange: onNewPlaylistTitleChange,
              newTitlePlaceholder: "New playlist for this upload",
              loading: loadingPlaylists,
              onRefresh: onRefreshPlaylists,
            }}
          />
          {uploadResult ? <div className="mt-4 rounded-xl border border-[var(--ui-accent)]/35 bg-[var(--ui-accent-soft)] p-4 text-sm text-[var(--ui-accent-text)]"><div className="flex items-center gap-2 font-bold"><CheckCircle2 className="h-4 w-4" /> Uploaded successfully</div><a href={uploadResult.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[var(--ui-accent-text)] underline">Open on YouTube <ExternalLink className="h-3.5 w-3.5" /></a></div> : null}
      </form>
    </Dialog>
  );
}
