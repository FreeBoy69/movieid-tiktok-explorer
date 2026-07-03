import type { AutomationRun, AutomationUpload } from "../types";

const TIME_ZONE = "Africa/Nairobi";

type AgentMetricKey = "viewCount" | "likeCount" | "commentCount";

const METRIC_ALIASES: Record<AgentMetricKey, string[]> = {
  viewCount: ["viewCount", "views", "playCount", "plays"],
  likeCount: ["likeCount", "likes", "diggCount"],
  commentCount: ["commentCount", "comments"],
};

export function readAgentUploadMetric(upload: AutomationUpload | null, key: AgentMetricKey): number {
  if (!upload) return 0;
  const metrics = upload.metrics || {};
  const aliases = METRIC_ALIASES[key];
  const containers = [
    metrics.publicStats,
    metrics.analytics?.totals,
    metrics.latest,
    metrics.stats,
    metrics,
  ];
  const values = containers.flatMap((container) =>
    aliases.map((alias) => Number(container?.[alias])),
  ).filter((value) => Number.isFinite(value) && value >= 0);
  return values.length ? Math.max(...values) : 0;
}

function mediaForUpload(upload: AutomationUpload) {
  const metrics = upload.metrics || {};
  const thumbnailUrl = String(
    metrics.sourceThumbnailUrl
    || metrics.thumbnailUrl
    || metrics.movie?.tmdb?.posterUrl
    || metrics.movie?.mal?.imageUrl
    || "",
  ).trim();
  const youtubeId = String(upload.youtubeVideoId || "").trim();
  const sourceVideoId = String(upload.sourceVideoId || "").trim();
  return {
    thumbnailUrl,
    playbackUrl: youtubeId
      ? `https://www.youtube.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0`
      : sourceVideoId
        ? `https://www.tiktok.com/player/v1/${encodeURIComponent(sourceVideoId)}?autoplay=1`
        : "",
    externalUrl: upload.youtubeUrl || upload.sourceUrl || "",
  };
}

function dateParts(value: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday"));
  return {
    day: weekday,
    hour: Number(read("hour") || 0),
    label: `${read("month")} ${read("day")}`,
  };
}

export function buildAgentAnalyticsViz(uploads: AutomationUpload[], runs: AutomationRun[]) {
  const chronological = [...uploads].sort((a, b) => a.createdAt - b.createdAt);
  let cumulativeViews = 0;
  let cumulativeEngagement = 0;
  const momentum = chronological.map((upload) => {
    const views = readAgentUploadMetric(upload, "viewCount");
    const likes = readAgentUploadMetric(upload, "likeCount");
    const comments = readAgentUploadMetric(upload, "commentCount");
    cumulativeViews += views;
    cumulativeEngagement += likes + comments;
    return {
      id: upload.id,
      label: dateParts(upload.createdAt).label,
      views,
      engagement: likes + comments,
      cumulativeViews,
      cumulativeEngagement,
    };
  });

  const heatmap = new Map<string, { day: number; hour: number; uploads: number; views: number; averageViews: number }>();
  uploads.forEach((upload) => {
    const { day, hour } = dateParts(upload.scheduleAt || upload.createdAt);
    const key = `${day}:${hour}`;
    const cell = heatmap.get(key) || { day, hour, uploads: 0, views: 0, averageViews: 0 };
    cell.uploads += 1;
    cell.views += readAgentUploadMetric(upload, "viewCount");
    cell.averageViews = Math.round(cell.views / cell.uploads);
    heatmap.set(key, cell);
  });

  const rankedUploads = uploads
    .map((upload) => {
      const views = readAgentUploadMetric(upload, "viewCount");
      const likes = readAgentUploadMetric(upload, "likeCount");
      const comments = readAgentUploadMetric(upload, "commentCount");
      const media = mediaForUpload(upload);
      return {
        id: upload.id,
        title: upload.title,
        movie: upload.movieTitle || "Unverified title",
        genre: upload.genre || "Unknown",
        microNiche: upload.microNiche || "Unknown",
        status: upload.status,
        views,
        likes,
        comments,
        engagementRate: views ? Number((((likes + comments) / views) * 100).toFixed(1)) : 0,
        publishedAt: upload.scheduleAt || upload.createdAt,
        ...media,
      };
    })
    .sort((a, b) => b.views - a.views || b.engagementRate - a.engagementRate);

  const portfolio = rankedUploads.slice(0, 18).map((upload, index) => ({
    ...upload,
    index,
    reachScore: Math.max(8, Math.sqrt(upload.views || 1)),
  }));

  const success = runs.filter((run) => String(run.status).toLowerCase() === "success").length;
  const failed = runs.filter((run) => ["failed", "error"].includes(String(run.status).toLowerCase())).length;
  const running = runs.filter((run) => String(run.status).toLowerCase() === "running").length;
  const total = runs.length;

  return {
    momentum,
    releaseHeatmap: [...heatmap.values()],
    rankedUploads,
    portfolio,
    reliability: {
      success,
      failed,
      running,
      total,
      successRate: total ? Math.round((success / total) * 100) : 0,
    },
  };
}
