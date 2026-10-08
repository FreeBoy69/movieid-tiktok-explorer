// PostDetailPage, one of ChannelManagement's screens.
import { ArrowLeft, CheckCircle2, Download, ExternalLink, FileText, Film, ImageUp, Loader2, MessageCircle, PlaySquare, RefreshCw, Send, Sparkles, Trash2, UploadCloud, Wand2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ChannelStyleProfile, CreatorProject, MovieResult, YouTubeCaptionTrack, YouTubeCommentsResponse, YouTubeDashboardVideo, YouTubeVideoAnalytics, YouTubeVideoOptimization } from "../../types";
import { cn } from "../../lib/utils";
import { toast, useErrorToast } from "../../utils/toast";
import { confirm } from "../ui/Dialog";
import { FileDrop } from "../FileDrop";
import { SourcePicker } from "../SourcePicker";
import { GOOGLE_READ_CONNECT_URL, InlineStatus, Notice, TagScoreChip, buildTagSuggestions, cleanMetadataTag, compactNumber, dateAge, formatDuration, keywordLabel, plainNumber, sharpYouTubeThumbnail, uniqueTags } from "./shared";

export function PostDetailPage({
  video,
  tabs,
  activeTab,
  onTabChange,
  onBack,
  onRefresh,
  onUpload,
  loadingAnalytics,
  analytics,
  optimization,
  loadingOptimization,
  canReadAnalytics,
  canReadRevenue,
  canReply,
  canManageYouTube,
  accountId,
  channelId,
  comments,
  loadingComments,
  replyText,
  replyingTo,
  onReplyTextChange,
  onReply,
  onRefreshComments,
  newCommentText,
  commentActionBusy,
  onNewCommentTextChange,
  onPostComment,
  onUpdateComment,
  onDeleteComment,
  onModerateComment,
  onUploadThumbnail,
  onDeleteVideo,
  platformActionBusy,
  platformActionNotice,
  movieCheck,
  checkingMovie,
  onCheckMovie,
  projects,
  activeProject,
  styles,
  projectBusy,
  projectNotice,
  metadataBusy,
  metadataNotice,
  onCreateProject,
  onGenerateProjectStage,
  onArchiveProject,
  onSelectProject,
  onPublishMetadata,
  isDark,
  isTikTok = false,
}: {
  video: YouTubeDashboardVideo;
  tabs: string[];
  activeTab: string;
  onTabChange: (tab: string) => void;
  onBack: () => void;
  onRefresh: () => void;
  onUpload: () => void;
  loadingAnalytics: boolean;
  analytics: YouTubeVideoAnalytics | null;
  optimization: YouTubeVideoOptimization | null;
  loadingOptimization: boolean;
  canReadAnalytics: boolean;
  canReadRevenue: boolean;
  canReply: boolean;
  canManageYouTube: boolean;
  accountId: string;
  channelId: string;
  comments: YouTubeCommentsResponse | null;
  loadingComments: boolean;
  replyText: Record<string, string>;
  replyingTo: string;
  onReplyTextChange: (id: string, value: string) => void;
  onReply: (id: string) => void;
  onRefreshComments: () => void;
  newCommentText: string;
  commentActionBusy: string;
  onNewCommentTextChange: (value: string) => void;
  onPostComment: () => void;
  onUpdateComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  onModerateComment: (id: string, status: "heldForReview" | "published" | "rejected") => void;
  onUploadThumbnail: (file: File) => void;
  onDeleteVideo: () => void;
  platformActionBusy: string;
  platformActionNotice: string;
  movieCheck: MovieResult | null;
  checkingMovie: boolean;
  onCheckMovie: () => void;
  projects: CreatorProject[];
  activeProject: CreatorProject | null;
  styles: ChannelStyleProfile[];
  projectBusy: boolean;
  projectNotice: string;
  metadataBusy: string;
  metadataNotice: string;
  onCreateProject: () => void;
  onGenerateProjectStage: (stage: string) => void;
  onArchiveProject: () => void;
  onSelectProject: (project: CreatorProject) => void;
  onPublishMetadata: (input: { title?: string; description?: string; tags?: string[]; appendTags?: boolean }, label: string) => void;
  isDark: boolean;
  isTikTok?: boolean;
}) {
  const isShort = (video.durationSeconds || 0) <= 180;
  const analyticsReady = Boolean(analytics?.analytics && (analytics.title !== "TikTok post" || video.title));
  const displayTitle = analyticsReady ? analytics!.title : video.title;
  const displayDuration = analyticsReady ? (analytics?.durationSeconds ?? video.durationSeconds) : video.durationSeconds;
  const titleScoreValue = Math.max(58, Math.min(99, Math.round(42 + video.title.length / 2)));
  const thumbnailScore = Math.min(99, titleScoreValue + 3);
  return (
    <section className={cn("flex h-full min-h-0 flex-col overflow-hidden border shadow-sm", isDark ? "border-white/10 bg-[var(--ui-panel)] text-white" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]")}>
      <div className={cn("flex flex-col gap-3 border-b px-3 py-3 lg:flex-row lg:items-center lg:justify-between", isDark ? "border-white/10 bg-[var(--ui-panel)]" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}>
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={onBack} className={cn("inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-xs font-black", isDark ? "border-white/10 text-white/65 hover:bg-white/8" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]/60 hover:text-[var(--ui-text)]")}>
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">Videos</span>
          </button>
          <div className="flex min-w-0 gap-4 overflow-x-auto overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {tabs.map((tab) => (
              <button key={tab} type="button" onClick={() => onTabChange(tab)} className={cn("shrink-0 border-b-2 px-0.5 py-2 text-sm font-black", activeTab === tab ? "border-[var(--ui-accent)]" : "border-transparent", activeTab === tab ? isDark ? "text-white" : "text-[var(--ui-text)]" : isDark ? "text-white/42" : "text-[var(--ui-text)]/42")}>
                {tab}{tab === "Title" ? ` ${titleScoreValue}` : tab === "Thumbnail" ? ` ${thumbnailScore}` : tab === "Review" ? " 85" : ""}
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onCreateProject} disabled={projectBusy} className={cn("inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-black transition disabled:opacity-45", activeProject ? "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)]" : "bg-[var(--ui-accent)] text-[var(--ui-accent-ink)] hover:bg-[var(--ui-text)] hover:text-[var(--ui-panel)]")}>
            {projectBusy ? <Loader2 className="h-4 w-4 ui-spin" /> : <Sparkles className="h-4 w-4" />}
            {activeProject ? "Project saved" : "Save project"}
          </button>
          <button type="button" onClick={onCheckMovie} disabled={!analytics?.url || checkingMovie} className="ui-btn is-primary">
            {checkingMovie ? <Loader2 className="h-4 w-4 ui-spin" /> : <Film className="h-4 w-4" />}
            Movie ID
          </button>
          <button type="button" onClick={onUpload} className="ui-btn is-ink">
            <UploadCloud className="h-4 w-4" />
            Upload
          </button>
          {!isTikTok && canManageYouTube ? <button type="button" onClick={onDeleteVideo} disabled={platformActionBusy === "delete-video"} className={cn("grid h-10 w-10 place-items-center rounded-xl border transition disabled:opacity-45 border-[var(--ui-line)]", isDark ? "border-red-400/25 text-red-300 hover:bg-red-400/10" : "border-red-500/20 text-red-600 hover:bg-red-50")} aria-label="Delete video from YouTube" title="Delete video from YouTube">
            {platformActionBusy === "delete-video" ? <Loader2 className="h-4 w-4 ui-spin" /> : <Trash2 className="h-4 w-4" />}
          </button> : null}
          <button type="button" onClick={onRefresh} className={cn("grid h-10 w-10 place-items-center rounded-xl border", isDark ? "border-white/10 text-white/55 hover:text-white" : "border-[var(--ui-line)] text-[var(--ui-text)]/50 hover:text-[var(--ui-text)]")} aria-label="Refresh analytics">
            {loadingAnalytics ? <Loader2 className="h-4 w-4 ui-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn("grid gap-4 border-b p-4 lg:grid-cols-[minmax(130px,190px)_minmax(0,1fr)] lg:items-center", isDark ? "border-white/10 bg-white/5" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}>
          <div className={cn("relative mx-auto w-full max-w-[170px] overflow-hidden rounded-2xl bg-[var(--ui-text)] lg:mx-0", isShort ? "aspect-[9/16] max-h-[260px]" : "aspect-video lg:max-w-[190px]")}>
            <VideoThumb video={video} />
            <span className="absolute bottom-3 right-3 rounded-lg bg-black/75 px-2 py-1 text-xs font-black text-white">{formatDuration(video.durationSeconds)}</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-accent-text)]">{isShort ? "Short" : "Video"} post page</p>
            <h1 className="mt-2 max-w-4xl text-xl font-black leading-tight md:text-2xl">{displayTitle}</h1>
            <p className={cn("mt-3 inline-flex rounded-lg px-3 py-1.5 text-xs font-black", isDark ? "bg-white/8 text-white/60" : "bg-[var(--ui-text)]/5 text-[var(--ui-text)]/55")}>Duration {formatDuration(displayDuration)}</p>
          </div>
        </div>

        <div className="p-4 md:p-5">
        <ProjectCommandBar
          project={activeProject}
          projects={projects}
          styles={styles}
          notice={projectNotice}
          busy={projectBusy}
          activeTab={activeTab}
          onGenerate={onGenerateProjectStage}
          onArchive={onArchiveProject}
          onSelect={onSelectProject}
          isDark={isDark}
        />
        {!canReadAnalytics ? <Notice className="mb-3" tone="warn" title="Google read access needed" body="Connect Google read access to load existing videos, comments, and YouTube analytics. Publishing keeps working without it." action={<a href={GOOGLE_READ_CONNECT_URL} className="ui-btn is-primary is-sm">Connect Google</a>} /> : null}
        {!isTikTok && canReadAnalytics && !canReadRevenue ? <Notice className="mb-3" tone="warn" title="Revenue permission needed" body="Reconnect Google once to approve YouTube Analytics monetary access. AutoYT will then show estimated revenue, ad revenue, monetized playbacks, and CPM." action={<a href={GOOGLE_READ_CONNECT_URL} className="ui-btn is-primary is-sm">Reconnect Google</a>} /> : null}
        {platformActionNotice ? <Notice className="mb-3" tone={platformActionNotice.toLowerCase().includes("could not") ? "error" : "warn"} title="YouTube update" body={platformActionNotice} /> : null}
        {activeTab === "Overview" ? (
          <>
            {metadataNotice ? <Notice className="mb-3" tone={metadataNotice.toLowerCase().includes("could not") ? "error" : "warn"} title="YouTube metadata" body={metadataNotice} /> : null}
            {analytics ? <AnalyticsPanel analytics={analytics} isTikTok={isTikTok} /> : loadingAnalytics ? <InlineStatus message="Loading post analytics" /> : null}
            {analytics?.url ? <a href={analytics.url} target="_blank" rel="noreferrer" className={cn("mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border px-4 text-xs font-black", isDark ? "border-white/10 text-white/60 hover:text-white" : "border-[var(--ui-line)] text-[var(--ui-text)]/60 hover:text-[var(--ui-text)]")}>Open on YouTube <ExternalLink className="h-4 w-4" /></a> : null}
            {movieCheck ? <MovieIdentityPanel result={movieCheck} /> : null}
          </>
        ) : activeTab === "Title" ? (
          <TitleOptimizationPanel video={video} optimization={optimization} loading={loadingOptimization} fallbackScore={titleScoreValue} publishing={metadataBusy === `${video.id}:Title`} onPublishTitle={(title) => onPublishMetadata({ title }, "Title")} />
        ) : activeTab === "Thumbnail" ? (
          <ThumbnailManagementPanel video={video} canManage={canManageYouTube} busy={platformActionBusy === "thumbnail"} notice={platformActionNotice} onUpload={onUploadThumbnail} />
        ) : activeTab === "Captions" ? (
          <CaptionTracksPanel videoId={video.id} accountId={accountId} canManage={canManageYouTube} isDark={isDark} />
        ) : activeTab === "SEO" ? (
          <SeoOptimizationPanel video={video} optimization={optimization} loading={loadingOptimization} publishing={metadataBusy} onPublishDescription={(description) => onPublishMetadata({ description }, "Description")} onPublishTags={(tags) => onPublishMetadata({ tags: uniqueTags([...(optimization?.current?.tags || video.tags || []), ...tags]) }, "Tags")} />
        ) : activeTab === "Script/Hook" ? (
          <ProjectStagePanel project={activeProject} stage="script" fallbackTitle={video.title} onGenerate={() => onGenerateProjectStage("script")} busy={projectBusy} />
        ) : activeTab === "Visual Plan" ? (
          <ProjectStagePanel project={activeProject} stage="visualPlan" fallbackTitle={video.title} onGenerate={() => onGenerateProjectStage("visualPlan")} busy={projectBusy} />
        ) : activeTab === "Review" ? (
          <ReviewPanel video={video} />
        ) : activeTab === "Preview" ? (
          <div className="grid gap-5 md:grid-cols-[minmax(0,420px)_minmax(0,1fr)]"><ThumbPreview video={video} /><div><p className="text-xl font-black">{video.title}</p><p className={cn("mt-2 text-sm font-semibold", isDark ? "text-white/45" : "text-[var(--ui-text)]/45")}>{compactNumber(video.viewCount)} views - {dateAge(video.publishedAt)}</p></div></div>
        ) : activeTab === "Publishing Plan" ? (
          <ProjectStagePanel project={activeProject} stage="publishingPlan" fallbackTitle={video.title} onGenerate={() => onGenerateProjectStage("publishingPlan")} busy={projectBusy} />
        ) : activeTab === "Performance" ? (
          analytics ? <AnalyticsPanel analytics={analytics} isTikTok={isTikTok} /> : <InlineStatus message="Loading performance" />
        ) : (
          <>
            {!isTikTok && !canReply ? <Notice className="mb-3" tone="warn" title="Comments need Google access" body="Connect Google read access and approve YouTube force-ssl to view and reply to comments inside AutoYT." action={<a href={GOOGLE_READ_CONNECT_URL} className="ui-btn is-primary is-sm">Connect Google</a>} /> : null}
            <CommentsPanel comments={comments} loading={loadingComments} canReply={canReply} canManage={canManageYouTube} readOnlyLabel={isTikTok ? "TikTok comments are read-only in AutoYT." : undefined} ownChannelId={channelId} replyText={replyText} replyingTo={replyingTo} newCommentText={newCommentText} commentActionBusy={commentActionBusy} onReplyTextChange={onReplyTextChange} onReply={onReply} onRefresh={onRefreshComments} onNewCommentTextChange={onNewCommentTextChange} onPostComment={onPostComment} onUpdateComment={onUpdateComment} onDeleteComment={onDeleteComment} onModerateComment={onModerateComment} />
          </>
        )}
        </div>
      </div>
    </section>
  );
}

function ProjectCommandBar({
  project,
  projects,
  styles,
  notice,
  busy,
  activeTab,
  onGenerate,
  onArchive,
  onSelect,
  isDark,
}: {
  project: CreatorProject | null;
  projects: CreatorProject[];
  styles: ChannelStyleProfile[];
  notice: string;
  busy: boolean;
  activeTab: string;
  onGenerate: (stage: string) => void;
  onArchive: () => void;
  onSelect: (project: CreatorProject) => void;
  isDark: boolean;
}) {
  const stage = tabToProjectStage(activeTab);
  return (
    <div className={cn("mb-4 rounded-2xl border p-3", isDark ? "border-white/10 bg-white/5" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-accent-text)]">Creator project</p>
          <p className={cn("mt-1 truncate text-sm font-black", isDark ? "text-white" : "text-[var(--ui-text)]")}>{project?.title || "Save this video as a reusable project to keep title, SEO, script, visuals, thumbnail, and publishing notes together."}</p>
          <p className={cn("mt-1 text-xs font-semibold", isDark ? "text-white/45" : "text-[var(--ui-text)]/45")}>{styles.length ? `${styles.length} copied styles available` : "Copy a competitor style from Feed Research to guide future projects."}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {projects.length > 1 ? (
            <SourcePicker
              compact
              label="Project"
              ariaLabel="Creator project"
              placeholder="Choose project"
              sourcesTabLabel="Projects"
              theme={isDark ? "dark" : "light"}
              value={project?.id || ""}
              options={projects.map((item) => ({ value: item.id, label: item.title, kind: "collection" as const }))}
              onChange={(id) => {
                const picked = projects.find((item) => item.id === id);
                if (picked) onSelect(picked);
              }}
            />
          ) : null}
          {stage ? (
            <button type="button" onClick={() => onGenerate(stage)} disabled={!project || busy} className="ui-btn is-primary">
              {busy ? <Loader2 className="h-4 w-4 ui-spin" /> : <Wand2 className="h-4 w-4" />}
              Generate tab
            </button>
          ) : null}
          <button type="button" onClick={onArchive} disabled={!project || busy} className={cn("inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-black transition disabled:opacity-45", isDark ? "border-white/10 text-white/60 hover:text-white" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]/55 hover:text-[var(--ui-text)]")}>
            Archive
          </button>
        </div>
      </div>
      {notice ? <p className={cn("mt-3 rounded-xl px-3 py-2 text-xs font-bold", notice.toLowerCase().includes("could not") ? "bg-[var(--ui-accent-soft)] text-[var(--ui-accent-text)]" : "bg-[var(--ui-accent-soft)] text-[var(--ui-accent-text)]")}>{notice}</p> : null}
    </div>
  );
}

function tabToProjectStage(tab: string): string {
  if (tab === "Title") return "title";
  if (tab === "SEO") return "seo";
  if (tab === "Script/Hook") return "script";
  if (tab === "Visual Plan") return "visualPlan";
  if (tab === "Thumbnail") return "thumbnail";
  if (tab === "Publishing Plan") return "publishingPlan";
  return "";
}

function ProjectStagePanel({ project, stage, fallbackTitle, onGenerate, busy }: { project: CreatorProject | null; stage: string; fallbackTitle: string; onGenerate: () => void; busy: boolean }) {
  const output = project?.outputs?.[stage];
  return (
    <div className="space-y-4 text-[var(--ui-text)]">
      {!project ? (
        <Notice tone="warn" title="Save a creator project first" body="Project tabs persist only after this video is saved as a creator project." />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--ui-bg)] p-4">
        <div>
          <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-accent-text)]">{stage.replace(/([A-Z])/g, " $1").trim()}</p>
          <h3 className="mt-1 text-lg font-black">{project?.title || fallbackTitle}</h3>
        </div>
        <button type="button" onClick={onGenerate} disabled={!project || busy} className="ui-btn is-primary">
          {busy ? <Loader2 className="h-4 w-4 ui-spin" /> : <Wand2 className="h-4 w-4" />}
          Generate
        </button>
      </div>
      {output ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Object.entries(output).map(([key, value]) => (
            <div key={key} className="rounded-2xl bg-[var(--ui-bg)] p-4">
              <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-text)]/40">{key.replace(/([A-Z])/g, " $1")}</p>
              <ProjectValue value={value} />
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--ui-line-strong)] bg-[var(--ui-bg)] p-5 text-sm font-semibold text-[var(--ui-text)]/55">No saved output for this tab yet.</p>
      )}
    </div>
  );
}

function ProjectValue({ value }: { value: any }) {
  if (Array.isArray(value)) {
    return <div className="mt-3 space-y-2">{value.map((item, index) => <p key={index} className="rounded-xl bg-[var(--ui-panel)] px-3 py-2 text-sm font-bold leading-6 text-[var(--ui-text)]/68">{typeof item === "string" ? item : JSON.stringify(item)}</p>)}</div>;
  }
  if (value && typeof value === "object") {
    return <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-[var(--ui-panel)] p-3 text-xs font-semibold leading-5 text-[var(--ui-text)]/65">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-[var(--ui-text)]/65">{String(value || "")}</p>;
}

function ThumbnailManagementPanel({ video, canManage, busy, notice, onUpload }: { video: YouTubeDashboardVideo; canManage: boolean; busy: boolean; notice: string; onUpload: (file: File) => void }) {
  const [file, setFile] = useState<File | null>(null);
  useEffect(() => setFile(null), [video.id]);
  return <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
    <div className="overflow-hidden rounded-xl border border-[var(--ui-line)] bg-[var(--ui-bg)] p-3"><ThumbPreview video={video} /><p className="mt-3 text-xs font-bold text-[var(--ui-text)]/55">Current YouTube thumbnail</p></div>
    <div className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-4">
      <div className="flex items-center gap-2"><ImageUp className="h-4 w-4 text-[var(--ui-accent-text)]" /><h3 className="text-sm font-bold text-[var(--ui-text)]">Replace thumbnail</h3></div>
      <p className="mt-1 text-xs leading-5 text-[var(--ui-text)]/50">Upload a JPEG or PNG, up to 2MB. YouTube replaces the live thumbnail immediately.</p>
      {canManage ? <>
        <div className="ui-inherit mt-4">
          <FileDrop
            accept="image/jpeg,image/png"
            maxBytes={2 * 1024 * 1024}
            onError={(message) => toast.error(message)}
            onFiles={([next]) => setFile(next)}
            title="Drop a thumbnail image"
            hint="JPEG or PNG · 2MB maximum"
            icon={<ImageUp className="h-5 w-5" />}
            file={file}
            onClear={() => setFile(null)}
          />
        </div>
        <button type="button" onClick={() => file && onUpload(file)} disabled={!file || busy} className="ui-btn is-primary mt-3">{busy ? <Loader2 className="h-4 w-4 ui-spin" /> : <UploadCloud className="h-4 w-4" />}{busy ? "Publishing thumbnail" : "Publish thumbnail"}</button>
      </> : <Notice className="mt-4" tone="warn" title="Direct Google access needed" body="Reconnect this channel with Google to upload a custom YouTube thumbnail." action={<a href={GOOGLE_READ_CONNECT_URL} className="ui-btn is-primary is-sm">Reconnect Google</a>} />}
      {notice ? <p className="mt-3 text-xs font-semibold leading-5 text-[var(--ui-accent-text)]">{notice}</p> : null}
    </div>
  </div>;
}

function CaptionTracksPanel({ videoId, accountId, canManage, isDark }: { videoId: string; accountId: string; canManage: boolean; isDark: boolean }) {
  const [captions, setCaptions] = useState<YouTubeCaptionTrack[]>([]);
  const [captionEdits, setCaptionEdits] = useState<Record<string, { name: string; language: string; isDraft: boolean }>>({});
  const [replacementFiles, setReplacementFiles] = useState<Record<string, File | null>>({});
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [isDraft, setIsDraft] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  useErrorToast(error, () => setError(""));
  const loadCaptions = useCallback(async () => {
    if (!videoId || !accountId || !canManage) { setCaptions([]); return; }
    setBusy("load");
    setError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(videoId)}/captions?accountId=${encodeURIComponent(accountId)}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load caption tracks");
      const next = Array.isArray(data.captions) ? data.captions as YouTubeCaptionTrack[] : [];
      setCaptions(next);
      setCaptionEdits(Object.fromEntries(next.map((caption) => [caption.id, { name: caption.name, language: caption.language || "en", isDraft: caption.isDraft }])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load caption tracks");
    } finally { setBusy(""); }
  }, [accountId, canManage, videoId]);
  useEffect(() => { void loadCaptions(); }, [loadCaptions]);
  useEffect(() => { setFile(null); setName(""); setLanguage("en"); setIsDraft(false); }, [videoId]);
  async function uploadCaption() {
    if (!file || !accountId) return;
    setBusy("upload"); setError("");
    try {
      const contentBase64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read caption file")); reader.onload = () => resolve(String(reader.result || "").split(",").pop() || ""); reader.readAsDataURL(file); });
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(videoId)}/captions?accountId=${encodeURIComponent(accountId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentBase64, mimeType: file.type || "application/octet-stream", name: name.trim() || file.name.replace(/\.[^.]+$/, ""), language, isDraft }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not upload caption track");
      setFile(null); setName(""); await loadCaptions();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not upload caption track"); } finally { setBusy(""); }
  }
  async function saveCaption(caption: YouTubeCaptionTrack) {
    const edit = captionEdits[caption.id] || { name: caption.name, language: caption.language || "en", isDraft: caption.isDraft };
    setBusy(`save:${caption.id}`); setError("");
    try {
      const replacement = replacementFiles[caption.id];
      const contentBase64 = replacement ? await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error("Could not read replacement caption file")); reader.onload = () => resolve(String(reader.result || "").split(",").pop() || ""); reader.readAsDataURL(replacement); }) : "";
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(caption.id)}?accountId=${encodeURIComponent(accountId)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...edit, ...(contentBase64 ? { contentBase64, mimeType: replacement?.type || "application/octet-stream" } : {}) }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update caption track");
      setReplacementFiles((current) => ({ ...current, [caption.id]: null }));
      await loadCaptions();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update caption track"); } finally { setBusy(""); }
  }
  async function deleteCaption(caption: YouTubeCaptionTrack) {
    if (!(await confirm({ title: `Delete the ${caption.language || ""} caption track?`.replace("  ", " "), body: "The track is deleted from YouTube permanently.", confirmLabel: "Delete track", danger: true }))) return;
    setBusy(`delete:${caption.id}`); setError("");
    try {
      const response = await fetch(`/api/youtube/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(caption.id)}?accountId=${encodeURIComponent(accountId)}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete caption track");
      await loadCaptions();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not delete caption track"); } finally { setBusy(""); }
  }
  if (!canManage) return <Notice tone="warn" title="Direct Google access needed" body="Reconnect this channel with Google to manage YouTube caption tracks." action={<a href={GOOGLE_READ_CONNECT_URL} className="ui-btn is-primary is-sm">Reconnect Google</a>} />;
  return <div className={cn("overflow-hidden rounded-xl border", isDark ? "border-white/10 bg-[var(--ui-panel)]" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}>
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b p-4", isDark ? "border-white/10" : "border-[var(--ui-line)]")}><div><div className="flex items-center gap-2"><FileText className="h-4 w-4 text-[var(--ui-accent-text)]" /><h3 className="text-sm font-bold">Caption tracks</h3></div><p className={cn("mt-1 text-xs", isDark ? "text-white/45" : "text-[var(--ui-text)]/45")}>Upload, publish, download, or retire caption files for this video.</p></div><button type="button" onClick={() => void loadCaptions()} className={cn("grid h-9 w-9 place-items-center rounded-lg border", isDark ? "border-white/10 text-white/60" : "border-[var(--ui-line)] text-[var(--ui-text)]/55")} aria-label="Refresh caption tracks">{busy === "load" ? <Loader2 className="h-4 w-4 ui-spin" /> : <RefreshCw className="h-4 w-4" />}</button></div>
    <div className={cn("space-y-3 p-4", isDark ? "text-white" : "text-[var(--ui-text)]")}>
      <div className={cn("grid gap-2 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_130px_120px_auto]", isDark ? "border-white/10 bg-white/5" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}>
        <label className="flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[var(--ui-line-strong)] bg-[var(--ui-panel)] px-3 text-xs font-bold text-[var(--ui-text)]/60"><UploadCloud className="h-4 w-4 text-[var(--ui-accent-text)]" /><span className="truncate">{file ? file.name : "Choose .srt, .vtt, .sbv, or .ttml"}</span><input type="file" accept=".srt,.vtt,.sbv,.ttml,text/vtt,text/plain,application/x-subrip,application/ttml+xml" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>
        <input value={language} onChange={(event) => setLanguage(event.target.value)} className="h-10 rounded-lg border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 text-sm text-[var(--ui-text)] outline-none" placeholder="en" aria-label="Caption language" />
        <input value={name} onChange={(event) => setName(event.target.value)} className="h-10 rounded-lg border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 text-sm text-[var(--ui-text)] outline-none" placeholder="Track name" aria-label="Caption track name" />
        <button type="button" onClick={() => void uploadCaption()} disabled={!file || busy === "upload"} className="ui-btn is-primary">{busy === "upload" ? <Loader2 className="h-4 w-4 ui-spin" /> : <UploadCloud className="h-4 w-4" />}Upload</button>
        <label className="flex items-center gap-2 text-xs font-semibold md:col-span-4"><input type="checkbox" checked={isDraft} onChange={(event) => setIsDraft(event.target.checked)} className="ui-check" />Keep this new track as a draft</label>
      </div>
      {captions.length ? <div className="space-y-2">{captions.map((caption) => { const edit = captionEdits[caption.id] || { name: caption.name, language: caption.language || "en", isDraft: caption.isDraft }; const replacement = replacementFiles[caption.id]; return <div key={caption.id} className={cn("grid gap-2 rounded-xl border p-3 md:grid-cols-[minmax(0,1fr)_110px_auto_auto]", isDark ? "border-white/10 bg-white/5" : "border-[var(--ui-line)] bg-[var(--ui-panel)]")}><div className="min-w-0"><input value={edit.name} onChange={(event) => setCaptionEdits((current) => ({ ...current, [caption.id]: { ...edit, name: event.target.value } }))} className={cn("h-9 w-full rounded-lg border px-3 text-sm font-bold outline-none", isDark ? "border-white/10 bg-[var(--ui-panel)] text-white" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]")} placeholder="Caption track name" /><p className={cn("mt-1 text-[11px] font-semibold", isDark ? "text-white/40" : "text-[var(--ui-text)]/42")}>{caption.status || "processing"}{caption.failureReason ? ` · ${caption.failureReason}` : ""}{caption.isAutoSynced ? " · auto-synced" : ""}</p></div><input value={edit.language} onChange={(event) => setCaptionEdits((current) => ({ ...current, [caption.id]: { ...edit, language: event.target.value } }))} className={cn("h-9 rounded-lg border px-3 text-sm outline-none", isDark ? "border-white/10 bg-[var(--ui-panel)] text-white" : "border-[var(--ui-line)] bg-[var(--ui-panel)] text-[var(--ui-text)]")} aria-label="Caption language" /><div className="flex items-center gap-2"><label className="flex items-center gap-1.5 text-[11px] font-bold"><input type="checkbox" checked={edit.isDraft} onChange={(event) => setCaptionEdits((current) => ({ ...current, [caption.id]: { ...edit, isDraft: event.target.checked } }))} className="ui-check" />Draft</label><button type="button" onClick={() => void saveCaption(caption)} disabled={busy === `save:${caption.id}`} className="h-9 rounded-lg border border-[var(--ui-line)] px-2.5 text-[11px] font-bold disabled:opacity-45">{busy === `save:${caption.id}` ? "Saving" : "Save"}</button></div><div className="flex items-center justify-end gap-1"><label className={cn("grid h-9 w-9 cursor-pointer place-items-center rounded-lg border", isDark ? "border-white/10 text-white/65" : "border-[var(--ui-line)] text-[var(--ui-text)]/55")} title={replacement ? `Replace with ${replacement.name}` : "Replace caption file"}><FileText className="h-4 w-4" /><input type="file" accept=".srt,.vtt,.sbv,.ttml,text/vtt,text/plain,application/x-subrip,application/ttml+xml" className="sr-only" onChange={(event) => setReplacementFiles((current) => ({ ...current, [caption.id]: event.target.files?.[0] || null }))} /></label><a href={`/api/youtube/videos/${encodeURIComponent(videoId)}/captions/${encodeURIComponent(caption.id)}/download?accountId=${encodeURIComponent(accountId)}&format=srt`} className={cn("grid h-9 w-9 place-items-center rounded-lg border", isDark ? "border-white/10 text-white/65" : "border-[var(--ui-line)] text-[var(--ui-text)]/55")} title="Download SRT"><Download className="h-4 w-4" /></a><button type="button" onClick={() => void deleteCaption(caption)} disabled={busy === `delete:${caption.id}`} className="grid h-9 w-9 place-items-center rounded-lg border border-red-500/20 text-red-600 disabled:opacity-45" aria-label="Delete caption track">{busy === `delete:${caption.id}` ? <Loader2 className="h-4 w-4 ui-spin" /> : <Trash2 className="h-4 w-4" />}</button></div></div>; })}</div> : busy !== "load" ? <p className={cn("rounded-lg px-3 py-4 text-sm font-semibold", isDark ? "bg-white/5 text-white/45" : "bg-[var(--ui-bg)] text-[var(--ui-text)]/45")}>No caption tracks are attached to this video.</p> : null}
    </div>
  </div>;
}

function AnalyticsPanel({ analytics, isTikTok = false }: { analytics: YouTubeVideoAnalytics; isTikTok?: boolean }) {
  const totals = analytics.analytics?.totals || {};
  const warning = typeof totals.warning === "string" ? totals.warning : "";
  const monetization = analytics.analytics?.monetization || null;
  const revenueWarning = typeof monetization?.warning === "string" ? monetization.warning : "";
  const warnings = (analytics.analytics?.warnings || []).filter(Boolean);
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--ui-line)] bg-[var(--ui-bg)]">
      <div className="flex gap-3 border-b border-[var(--ui-line)] bg-[var(--ui-panel)] p-3">
        <div className="h-16 w-24 overflow-hidden rounded-lg bg-[var(--ui-text)]/5">{analytics.thumbnailUrl ? <img src={analytics.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}</div>
        <div className="min-w-0 flex-1"><p className="line-clamp-2 text-sm font-bold text-[var(--ui-text)]">{analytics.title}</p><a href={analytics.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-[var(--ui-accent-text)]">Open post <ExternalLink className="h-3 w-3" /></a></div>
      </div>
      <div className={cn("grid gap-2 p-3", isTikTok ? "grid-cols-3" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6")}>
        <Stat label="Views" value={compactNumber(Number(totals.views ?? analytics.publicStats?.viewCount ?? 0))} />
        <Stat label="Likes" value={compactNumber(Number(totals.likes ?? analytics.publicStats?.likeCount ?? 0))} />
        <Stat label="Comments" value={compactNumber(Number(totals.comments ?? analytics.publicStats?.commentCount ?? 0))} />
        {!isTikTok ? (
          <>
            <Stat label="Watch min" value={plainNumber(totals.estimatedMinutesWatched)} />
            <Stat label="Avg view" value={`${plainNumber(totals.averageViewDuration)}s`} />
            <Stat label="Subs gained" value={plainNumber(totals.subscribersGained)} />
            <Stat label="Avg watched" value={totals.averageViewPercentage === undefined ? "-" : `${Number(totals.averageViewPercentage || 0).toFixed(1)}%`} />
            <Stat label="Impressions" value={compactNumber(Number(totals.impressions || 0))} />
            <Stat label="Impression CTR" value={totals.impressionsClickThroughRate === undefined ? "-" : `${Number(totals.impressionsClickThroughRate || 0).toFixed(1)}%`} />
          </>
        ) : null}
      </div>
      {!isTikTok ? <div className="grid gap-px border-t border-[var(--ui-line)] bg-[var(--ui-text)]/8 lg:grid-cols-2">
        <AnalyticsBreakdown title="Traffic sources" rows={analytics.analytics?.trafficSources || []} labelKey="insightTrafficSourceType" />
        <AnalyticsBreakdown title="Audience devices" rows={analytics.analytics?.devices || []} labelKey="deviceType" />
        <AnalyticsBreakdown title="Top countries" rows={analytics.analytics?.countries || []} labelKey="country" />
        <div className="bg-[var(--ui-panel)] p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">Monetization</p>
          {revenueWarning ? <p className="mt-2 text-xs font-semibold leading-5 text-[var(--ui-accent-text)]">{revenueWarning}</p> : <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Stat label="Est. revenue" value={formatCurrency(monetization?.estimatedRevenue)} />
            <Stat label="Ad revenue" value={formatCurrency(monetization?.estimatedAdRevenue)} />
            <Stat label="Monetized plays" value={compactNumber(Number(monetization?.monetizedPlaybacks || 0))} />
            <Stat label="Ad impressions" value={compactNumber(Number(monetization?.adImpressions || 0))} />
            <Stat label="Playback CPM" value={formatCurrency(monetization?.playbackBasedCpm)} />
            <Stat label="Gross revenue" value={formatCurrency(monetization?.grossRevenue)} />
          </div>}
        </div>
      </div> : null}
      {warning ? <p className="border-t border-[var(--ui-line)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--ui-accent-text)]">{warning}</p> : null}
      {warnings.length ? <p className="border-t border-[var(--ui-line)] px-3 py-2 text-[11px] font-semibold leading-5 text-[var(--ui-text)]/42">Some optional breakdowns could not load: {warnings.slice(0, 2).join(" · ")}</p> : null}
    </div>
  );
}

function formatCurrency(value: number | string | null | undefined): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: amount < 10 ? 2 : 0 }).format(amount);
}

function AnalyticsBreakdown({ title, rows, labelKey }: { title: string; rows: Array<Record<string, number | string>>; labelKey: string }) {
  const totalViews = Math.max(1, rows.reduce((sum, row) => sum + Number(row.views || 0), 0));
  return <div className="bg-[var(--ui-panel)] p-3">
    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{title}</p>
    {rows.length ? <div className="mt-3 space-y-2.5">{rows.slice(0, 5).map((row, index) => {
      const label = String(row[labelKey] || "Unknown").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
      const views = Number(row.views || 0);
      return <div key={`${label}-${index}`}>
        <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-semibold text-[var(--ui-text)]/65">{label}</span><span className="shrink-0 font-bold text-[var(--ui-text)]">{compactNumber(views)}</span></div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--ui-text)]/7"><div className="h-full rounded-full bg-[var(--ui-accent)]" style={{ width: `${Math.max(3, Math.round((views / totalViews) * 100))}%` }} /></div>
      </div>;
    })}</div> : <p className="mt-2 text-xs font-semibold leading-5 text-[var(--ui-text)]/42">No reportable data in this date range.</p>}
  </div>;
}

function MovieIdentityPanel({ result }: { result: MovieResult }) {
  return (
    <div className="mt-4 overflow-hidden rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)]">
      <div className="flex flex-col gap-4 border-b border-[var(--ui-line)] bg-[var(--ui-panel)] p-4 md:flex-row md:items-start">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-lg bg-[var(--ui-text)]/5">{result.posterUrl ? <img src={result.posterUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" /> : <Film className="m-auto mt-9 h-8 w-8 text-[var(--ui-accent-text)]/35" />}</div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--ui-accent-text)]">Detected movie</p>
          <h3 className="mt-1 font-serif text-2xl font-bold text-[var(--ui-text)]">{result.title || "Unknown title"} {result.year ? <span className="text-[var(--ui-text)]/45">({result.year})</span> : null}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--ui-text)]/62">{result.summary || result.tmdb?.overview || result.mal?.synopsis || "Movie ID returned a title match without a summary."}</p>
        </div>
      </div>
    </div>
  );
}

function CommentsPanel({ comments, loading, canReply, canManage, readOnlyLabel, ownChannelId, replyText, replyingTo, newCommentText, commentActionBusy, onReplyTextChange, onReply, onRefresh, onNewCommentTextChange, onPostComment, onUpdateComment, onDeleteComment, onModerateComment }: {
  comments: YouTubeCommentsResponse | null;
  loading: boolean;
  canReply: boolean;
  canManage: boolean;
  readOnlyLabel?: string;
  ownChannelId: string;
  replyText: Record<string, string>;
  replyingTo: string;
  newCommentText: string;
  commentActionBusy: string;
  onReplyTextChange: (id: string, value: string) => void;
  onReply: (id: string) => void;
  onRefresh: () => void;
  onNewCommentTextChange: (value: string) => void;
  onPostComment: () => void;
  onUpdateComment: (id: string, text: string) => void;
  onDeleteComment: (id: string) => void;
  onModerateComment: (id: string, status: "heldForReview" | "published" | "rejected") => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)]">
      <div className="flex items-center justify-between border-b border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 py-3">
        <div className="flex items-center gap-2"><MessageCircle className="h-4 w-4 text-[var(--ui-accent-text)]" /><p className="text-sm font-bold text-[var(--ui-text)]">Recent comments</p></div>
        <button type="button" onClick={onRefresh} className="ui-icon-btn is-bordered" aria-label="Refresh comments">{loading ? <Loader2 className="h-4 w-4 ui-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
      </div>
      <div className="max-h-[620px] space-y-2 overflow-y-auto bg-[var(--ui-bg)] p-3">
        {canManage ? <div className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-3">
          <label className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">Comment as your channel</label>
          <div className="mt-2 flex gap-2">
            <input value={newCommentText} onChange={(event) => onNewCommentTextChange(event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 text-sm outline-none transition" placeholder="Add a public comment" />
            <button type="button" onClick={onPostComment} disabled={!newCommentText.trim() || commentActionBusy === "post"} className="ui-btn is-ink">{commentActionBusy === "post" ? <Loader2 className="h-4 w-4 ui-spin" /> : <Send className="h-4 w-4" />}Post</button>
          </div>
        </div> : null}
        {loading && !comments ? (
          <p className="rounded-lg bg-[var(--ui-panel)] px-3 py-4 text-sm font-semibold text-[var(--ui-text)]/45">Loading comments</p>
        ) : comments?.comments?.length ? (
          comments.comments.map((thread) => {
            const parent = thread.topLevelComment;
            return (
              <div key={thread.threadId} className="rounded-xl border border-[var(--ui-line)] bg-[var(--ui-panel)] p-3">
                <ManagedCommentBody comment={parent} canManage={canManage} ownChannelId={ownChannelId} busy={commentActionBusy} onUpdate={onUpdateComment} onDelete={onDeleteComment} onModerate={onModerateComment} />
                {thread.totalReplyCount ? <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{thread.repliesLoaded ?? thread.replies.length} of {thread.totalReplyCount} replies loaded{thread.nextRepliesPageToken ? " (more available)" : ""}</p> : null}
                {thread.replies.length ? <div className="mt-3 space-y-2 border-l border-[var(--ui-line)] pl-3">{thread.replies.map((reply) => <ManagedCommentBody key={reply.id} comment={reply} compact canManage={canManage} ownChannelId={ownChannelId} busy={commentActionBusy} onUpdate={onUpdateComment} onDelete={onDeleteComment} onModerate={onModerateComment} />)}</div> : null}
                {canReply && thread.canReply ? (
                  <div className="mt-3 flex gap-2">
                    <input value={replyText[parent.id] || ""} onChange={(event) => onReplyTextChange(parent.id, event.target.value)} className="h-10 min-w-0 flex-1 rounded-lg border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 text-sm outline-none transition" placeholder="Reply as your channel" />
                    <button type="button" onClick={() => onReply(parent.id)} disabled={!replyText[parent.id]?.trim() || replyingTo === parent.id} className="ui-btn is-primary">{replyingTo === parent.id ? <Loader2 className="h-4 w-4 ui-spin" /> : <Send className="h-4 w-4" />}Reply</button>
                  </div>
                ) : <p className="mt-3 rounded-lg bg-[var(--ui-bg)] px-3 py-2 text-xs font-semibold text-[var(--ui-text)]/45">{canReply ? "Replies are disabled for this thread." : (readOnlyLabel || "Reconnect Google to enable replies.")}</p>}
              </div>
            );
          })
        ) : <p className="rounded-lg bg-[var(--ui-panel)] px-3 py-4 text-sm font-semibold text-[var(--ui-text)]/45">No recent comments returned for this video.</p>}
      </div>
    </div>
  );
}

function ManagedCommentBody({ comment, compact = false, canManage, ownChannelId, busy, onUpdate, onDelete, onModerate }: { comment: YouTubeCommentsResponse["comments"][number]["topLevelComment"]; compact?: boolean; canManage: boolean; ownChannelId: string; busy: string; onUpdate: (id: string, text: string) => void; onDelete: (id: string) => void; onModerate: (id: string, status: "heldForReview" | "published" | "rejected") => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(comment.textOriginal || comment.textDisplay || "");
  const isOwn = Boolean(ownChannelId && comment.authorChannelId && ownChannelId === comment.authorChannelId);
  useEffect(() => setText(comment.textOriginal || comment.textDisplay || ""), [comment.id, comment.textDisplay, comment.textOriginal]);
  if (editing) {
    return <div className="rounded-lg bg-[var(--ui-bg)] p-2.5">
      <textarea value={text} onChange={(event) => setText(event.target.value)} rows={compact ? 2 : 3} className="w-full resize-y rounded-lg border border-[var(--ui-line)] bg-[var(--ui-panel)] px-3 py-2 text-sm outline-none transition" />
      <div className="mt-2 flex justify-end gap-2"><button type="button" onClick={() => { setEditing(false); setText(comment.textOriginal || comment.textDisplay || ""); }} className="h-8 rounded-lg border border-[var(--ui-line)] px-2.5 text-[11px] font-bold text-[var(--ui-text)]/55">Cancel</button><button type="button" onClick={() => { onUpdate(comment.id, text); setEditing(false); }} disabled={!text.trim() || busy === `edit:${comment.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ui-accent)] px-2.5 text-[11px] font-bold text-[var(--ui-accent-ink)] disabled:opacity-45">{busy === `edit:${comment.id}` ? <Loader2 className="h-3.5 w-3.5 ui-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Save</button></div>
    </div>;
  }
  return (
    <div className="flex gap-3">
      {comment.authorProfileImageUrl ? <img src={comment.authorProfileImageUrl} alt="" className={cn("rounded-full object-cover", compact ? "h-7 w-7" : "h-9 w-9")} referrerPolicy="no-referrer" /> : <div className={cn("grid rounded-full bg-[var(--ui-accent)]/10 text-[var(--ui-accent-text)]", compact ? "h-7 w-7" : "h-9 w-9")}><MessageCircle className="m-auto h-3.5 w-3.5" /></div>}
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-bold text-[var(--ui-text)]">{comment.authorDisplayName || "YouTube user"}</p><p className="text-[11px] font-semibold text-[var(--ui-text)]/35">{comment.likeCount ? `${compactNumber(comment.likeCount)} likes` : ""}</p>{comment.moderationStatus ? <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{comment.moderationStatus}</p> : null}</div><p className={cn("mt-1 whitespace-pre-wrap text-sm leading-6 text-[var(--ui-text)]/70", compact && "text-xs leading-5")}>{comment.textDisplay}</p>
      {canManage ? <div className="mt-2 flex flex-wrap gap-1.5">{isOwn ? <><button type="button" onClick={() => setEditing(true)} className="h-7 rounded-md border border-[var(--ui-line)] px-2 text-[10px] font-bold text-[var(--ui-text)]/55">Edit</button><button type="button" onClick={() => onDelete(comment.id)} disabled={busy === `delete:${comment.id}`} className="inline-flex h-7 items-center gap-1 rounded-md border border-red-500/20 px-2 text-[10px] font-bold text-red-600 disabled:opacity-45">{busy === `delete:${comment.id}` ? <Loader2 className="h-3 w-3 ui-spin" /> : <Trash2 className="h-3 w-3" />}Delete</button></> : <><button type="button" onClick={() => onModerate(comment.id, "heldForReview")} disabled={busy === `hold:${comment.id}`} className="h-7 rounded-md border border-[var(--ui-line)] px-2 text-[10px] font-bold text-[var(--ui-text)]/55 disabled:opacity-45">Hold</button><button type="button" onClick={() => onModerate(comment.id, "published")} disabled={busy === `publish:${comment.id}`} className="h-7 rounded-md border border-[var(--ui-line)] px-2 text-[10px] font-bold text-[var(--ui-text)]/55 disabled:opacity-45">Approve</button><button type="button" onClick={() => onModerate(comment.id, "rejected")} disabled={busy === `remove:${comment.id}`} className="h-7 rounded-md border border-red-500/20 px-2 text-[10px] font-bold text-red-600 disabled:opacity-45">Remove</button></>}</div> : null}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-[var(--ui-panel)] px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{label}</p><p className="mt-1 truncate text-sm font-bold text-[var(--ui-text)]">{value}</p></div>;
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-[var(--ui-bg)] px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--ui-text)]/35">{label}</p>
      <p className="mt-0.5 text-sm font-black text-[var(--ui-text)]">{value}</p>
    </div>
  );
}

function ThumbPreview({ video }: { video: YouTubeDashboardVideo }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return <div className="aspect-video overflow-hidden rounded-2xl bg-[var(--ui-text)]/5">{thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center"><PlaySquare className="h-8 w-8 text-[var(--ui-text)]/25" /></div>}</div>;
}

function VideoThumb({ video }: { video: YouTubeDashboardVideo }) {
  const thumbnailUrl = sharpYouTubeThumbnail(video.thumbnailUrl);
  return thumbnailUrl ? <img src={thumbnailUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" loading="lazy" /> : <div className="grid h-full place-items-center bg-[var(--ui-accent)]/10"><PlaySquare className="h-8 w-8 text-[var(--ui-accent-text)]" /></div>;
}

function ScorePanel({ label, value }: { label: string; value: number }) {
  return <div className="rounded-2xl bg-[var(--ui-bg)] p-4"><div className="flex items-center justify-between"><p className="text-sm font-black">{label}</p><span className="rounded-xl bg-[var(--ui-accent-soft)] px-3 py-1 text-sm font-black text-[var(--ui-accent-text)]">{value}</span></div><div className="mt-4 h-2 rounded-full bg-[var(--ui-panel)]"><div className="h-full rounded-full bg-[var(--ui-accent)]" style={{ width: `${value}%` }} /></div></div>;
}

function TitleOptimizationPanel({ video, optimization, loading, fallbackScore, publishing, onPublishTitle }: { video: YouTubeDashboardVideo; optimization: YouTubeVideoOptimization | null; loading: boolean; fallbackScore: number; publishing: boolean; onPublishTitle: (title: string) => void }) {
  const ideas = optimization?.titleIdeas?.length ? optimization.titleIdeas : [
    { title: video.title, score: fallbackScore, reason: "Current title" },
  ];
  const [selectedTitle, setSelectedTitle] = useState(ideas[0]?.title || video.title);
  useEffect(() => {
    setSelectedTitle(ideas[0]?.title || video.title);
  }, [video.id, optimization?.generatedAt]);
  return (
    <div className="space-y-5 text-[var(--ui-text)]">
      {loading ? <InlineStatus message="Loading viral title suggestions" /> : null}
      <ScorePanel label="Title score" value={optimization?.titleScore || fallbackScore} />
      <div className="rounded-2xl bg-[var(--ui-bg)] p-5">
        <p className="text-xs font-black uppercase tracking-widest text-[var(--ui-text)]/42">Current title</p>
        <p className="mt-3 text-lg font-black">{optimization?.current?.title || video.title}</p>
        <p className="mt-6 text-xs font-bold text-[var(--ui-text)]/45">{(optimization?.current?.title || video.title).length} of 100</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {ideas.slice(0, 3).map((idea) => (
          <button type="button" key={idea.title} onClick={() => setSelectedTitle(idea.title)} className={cn("rounded-2xl border p-3 text-left transition", selectedTitle === idea.title ? "border-[var(--ui-accent)] bg-[var(--ui-accent-soft)]" : "border-transparent bg-[var(--ui-bg)] hover:border-[var(--ui-accent)]/35")}>
            <ThumbPreview video={video} />
            <p className="mt-3 text-sm font-black leading-6">{idea.title}</p>
            <p className="mt-2 text-xs font-bold text-[var(--ui-accent-text)]">Score {Math.round(Number(idea.score || 0)) || 78}</p>
            <p className="mt-2 text-xs font-semibold leading-5 text-[var(--ui-text)]/55">{idea.reason}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-3 rounded-2xl bg-[var(--ui-bg)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="min-w-0 text-sm font-black leading-6">{selectedTitle}</p>
        <button type="button" onClick={() => onPublishTitle(selectedTitle)} disabled={publishing || !selectedTitle.trim()} className="ui-btn is-primary shrink-0">
          {publishing ? <Loader2 className="h-4 w-4 ui-spin" /> : <Send className="h-4 w-4" />}
          Publish title
        </button>
      </div>
      {optimization?.taxonomy ? (
        <div className="grid gap-3 md:grid-cols-4">
          <Mini label="Niche" value={optimization.taxonomy.primary || "Learning"} />
          <Mini label="Sub-niche" value={optimization.taxonomy.subNiche || "Unknown"} />
          <Mini label="Micro" value={optimization.taxonomy.microSubNiche || optimization.learnedContext.bestNiche || "Unknown"} />
          <Mini label="Hook" value={(optimization.taxonomy.hookPattern || optimization.learnedContext.bestHook || "curiosity").replace(/-/g, " ")} />
        </div>
      ) : null}
    </div>
  );
}

function SeoOptimizationPanel({ video, optimization, loading, publishing, onPublishDescription, onPublishTags }: { video: YouTubeDashboardVideo; optimization: YouTubeVideoOptimization | null; loading: boolean; publishing: string; onPublishDescription: (description: string) => void; onPublishTags: (tags: string[]) => void }) {
  const [expanded, setExpanded] = useState(false);
  const description = optimization?.description || "";
  const tagScores = (optimization?.tags?.length ? optimization.tags : buildTagSuggestions(video, null).map((tag) => tag.label)).map((tag, index) => ({
    label: keywordLabel(cleanMetadataTag(tag).toLowerCase()),
    score: Math.max(52, 82 - index * 3),
  }));
  const visibleTags = expanded ? tagScores : tagScores.slice(0, 8);
  const publishableTags = uniqueTags(visibleTags.map((tag) => tag.label));
  return (
    <div className="space-y-5 text-[var(--ui-text)]">
      {loading ? <InlineStatus message="Loading SEO and monetization suggestions" /> : null}
      <div className="rounded-2xl bg-[var(--ui-bg)] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-black">Optimized description</p>
          <button type="button" onClick={() => onPublishDescription(description)} disabled={publishing === `${video.id}:Description` || !description.trim()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 text-xs font-black text-[var(--ui-accent-ink)] transition hover:bg-[var(--ui-text)] hover:text-[var(--ui-panel)] disabled:opacity-45">
            {publishing === `${video.id}:Description` ? <Loader2 className="h-4 w-4 ui-spin" /> : <Send className="h-4 w-4" />}
            Publish description
          </button>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm font-semibold leading-7 text-[var(--ui-text)]/70">{optimization?.description || "Suggestions will appear after the optimization check finishes."}</p>
      </div>
      <div>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-black">Tags for niche, search, and common misspellings</p>
            <p className="mt-1 text-xs font-semibold text-[var(--ui-text)]/50">Scores are guidance only. AutoYT publishes only the tag text.</p>
          </div>
          <button type="button" onClick={() => onPublishTags(publishableTags)} disabled={publishing === `${video.id}:Tags` || !publishableTags.length} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-[var(--ui-accent)] px-4 text-xs font-black text-[var(--ui-accent-ink)] transition hover:bg-[var(--ui-text)] hover:text-[var(--ui-panel)] disabled:opacity-45">
            {publishing === `${video.id}:Tags` ? <Loader2 className="h-4 w-4 ui-spin" /> : <Send className="h-4 w-4" />}
            Publish tags
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {visibleTags.map((tag) => <TagScoreChip key={`${tag.label}-${tag.score}`} tag={tag} />)}
        </div>
        {tagScores.length > 8 ? <button type="button" onClick={() => setExpanded((value) => !value)} className="mt-3 h-10 rounded-full bg-[var(--ui-bg)] px-5 text-sm font-black text-[var(--ui-text)] hover:bg-[var(--ui-bg)]">{expanded ? "Show fewer tags" : "Show more tags"}</button> : null}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-[var(--ui-bg)] p-4">
          <p className="font-black">Action cards</p>
          <div className="mt-3 space-y-2">
            {(optimization?.actionCards || []).map((item) => <p key={item} className="rounded-xl bg-[var(--ui-panel)] px-3 py-2 text-sm font-bold leading-6 text-[var(--ui-text)]/68">{item}</p>)}
            {!optimization?.actionCards?.length ? <p className="text-sm font-semibold text-[var(--ui-text)]/55">Run more performance checks to unlock channel-specific actions.</p> : null}
          </div>
        </div>
        <div className="rounded-2xl bg-[var(--ui-bg)] p-4">
          <p className="font-black">Monetization notes</p>
          <div className="mt-3 space-y-2">
            {(optimization?.monetizationNotes || []).map((item) => <p key={item} className="rounded-xl bg-[var(--ui-panel)] px-3 py-2 text-sm font-bold leading-6 text-[var(--ui-text)]/68">{item}</p>)}
            {!optimization?.monetizationNotes?.length ? <p className="text-sm font-semibold text-[var(--ui-text)]/55">Recommendations will become sharper as this channel builds a performance history.</p> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewPanel({ video }: { video: YouTubeDashboardVideo }) {
  return <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]"><ThumbPreview video={video} /><div className="space-y-3"><ReviewNote title="The Hook" body="The first seconds need a sharp curiosity promise and a clear reason to keep watching." /><ReviewNote title="Pacing" body="Shorts need fast transitions. Long videos need clearer chapters and topic continuity." /><ReviewNote title="Packaging" body="Title and thumbnail should agree on one emotional promise." /></div></div>;
}

function ReviewNote({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl bg-[var(--ui-bg)] p-4"><p className="font-black">{title}</p><p className="mt-2 text-sm font-semibold leading-6 text-[var(--ui-text)]/58">{body}</p></div>;
}
