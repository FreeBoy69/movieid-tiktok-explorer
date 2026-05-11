export interface MovieResult {
  title: string;
  year?: string;
  director?: string;
  mediaType?: string;
  confidence: number;
  evidence: {
    audio: string;
    visual: string;
    reasoning: string;
  };
  imdbUrl?: string;
  posterUrl?: string;
  transcript?: {
    excerpt?: string;
    fullText?: string;
    hooks?: string[];
    contentStyle?: string[];
    structure?: string[];
  };
  contentNiche?: {
    primary?: string;
    secondary?: string[];
    platforms?: string[];
    rationale?: string;
    audience?: string;
    opportunities?: string[];
  };
  videoAnalysis?: {
    framework?: {
      climaxLine?: {
        name?: string;
        description?: string;
        phases?: Array<{
          timeRange: string;
          label: string;
          explanation: string;
        }>;
      };
      scriptStandards?: {
        followsRules?: boolean;
        notes?: string;
        draftScript?: string;
        finalScript?: string;
      };
    };
    visualStyle?: {
      editingPacing?: string;
      visualIdentity?: string;
      productionStyle?: string;
    };
    formula?: {
      pillars?: string[];
      whyFactor?: string;
    };
  };
  tmdb?: {
    id: number;
    mediaType?: "movie" | "tv";
    title: string;
    originalTitle?: string;
    overview?: string;
    tagline?: string;
    releaseDate?: string;
    runtime?: number;
    genres?: string[];
    rating?: number;
    voteCount?: number;
    status?: string;
    language?: string;
    countries?: string[];
    tmdbUrl?: string;
    backdropUrl?: string;
    cast?: Array<{
      name: string;
      character?: string;
      profileUrl?: string;
    }>;
    director?: string;
  };
  mal?: {
    id: number;
    type?: "anime" | "manga" | string;
    mediaType?: string;
    title: string;
    originalTitle?: string;
    englishTitle?: string;
    synonyms?: string[];
    synopsis?: string;
    genres?: string[];
    startDate?: string;
    score?: number | null;
    status?: string;
    episodes?: number | null;
    chapters?: number | null;
    volumes?: number | null;
    url?: string;
    imageUrl?: string;
  };
  summary: string;
}

export interface ExtractionState {
  status: 'idle' | 'processing' | 'done' | 'error';
  progress: number;
  message: string;
  result?: MovieResult;
  error?: string;
}

export interface YouTubeRadarVideo {
  id: string;
  url: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  channelId: string;
  channelTitle: string;
  channelUrl: string;
  /** YouTube `snippet.categoryId` (see Data API v3). */
  categoryId?: string;
  /** YouTube’s category list label (e.g. Entertainment, Science & Technology). */
  categoryName?: string;
  publishedAt: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  subscriberCount: number;
  viewsPerHour: number;
  outlierScore: number;
  opportunityScore: number;
  facelessScore: number;
  facelessSignals: string[];
  niche: string;
  durationSeconds: number;
  rpmEstimate: string;
}

export interface YouTubeRadarNiche {
  name: string;
  opportunityScore: number;
  competition: "Low" | "Medium" | "High" | string;
  estimatedRpm: string;
  outlierCount: number;
  medianSubscribers: number;
  viewsPerHour: number;
  topVideos: string[];
  angles: string[];
}

export interface YouTubeRadarResult {
  query: string;
  /** `trending` = regional `chart=mostPopular` (filters applied); `search` = keyword `search.list`. */
  scanMode?: "search" | "trending";
  generatedAt: string;
  videos: YouTubeRadarVideo[];
  niches: YouTubeRadarNiche[];
  summary: {
    videoCount: number;
    avgOpportunity: number;
    avgViewsPerHour: number;
    bestNiche: string;
    apiMode: string;
  };
}

export interface ConnectedYouTubeAccount {
  id: string;
  email: string;
  googleSub?: string;
  channelId: string;
  channelTitle: string;
  channelHandle?: string;
  thumbnailUrl?: string;
  uploadsPlaylistId?: string;
  scope?: string;
  connectedAt?: number;
}

export interface YouTubePlaylistSummary {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  privacyStatus?: string;
  videoCount?: number;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
}

export interface AuthSessionPayload {
  user: AuthUser | null;
  accounts: ConnectedYouTubeAccount[];
  activeAccount: ConnectedYouTubeAccount | null;
  googleConfigured: boolean;
  dbConfigured?: boolean;
  error?: string;
}

export interface YouTubeDashboardVideo {
  id: string;
  url: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  privacyStatus?: string;
  uploadStatus?: string;
  embeddable?: boolean;
  madeForKids?: boolean;
  categoryId?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  durationSeconds: number;
}

export interface YouTubeChannelDashboard {
  account: ConnectedYouTubeAccount & {
    url?: string;
  };
  stats: {
    subscriberCount: number;
    viewCount: number;
    videoCount: number;
    recentVideoCount: number;
    recentViews: number;
    averageViewsPerVideo: number;
  };
  recentVideos: YouTubeDashboardVideo[];
  nextPageToken?: string;
  publish: {
    studioUploadUrl: string;
    note: string;
  };
  growthInsights?: GrowthInsights | null;
}

export interface YouTubeUploadResult {
  id: string;
  url: string;
  title: string;
  privacyStatus: string;
  playlistItem?: {
    id?: string;
    playlistId?: string;
    videoId?: string;
    duplicate?: boolean;
  } | null;
}

export interface YouTubeVideoAnalytics {
  id: string;
  url: string;
  title: string;
  thumbnailUrl: string;
  publishedAt: string;
  privacyStatus: string;
  durationSeconds: number;
  publicStats: {
    viewCount: number;
    likeCount: number;
    commentCount: number;
  };
  analytics: {
    days: number;
    startDate: string;
    endDate: string;
    totals: Record<string, number | string | null> | null;
    daily: Array<Record<string, number | string>>;
  };
}

export interface YouTubeComment {
  id: string;
  authorDisplayName: string;
  authorProfileImageUrl: string;
  authorChannelUrl: string;
  textDisplay: string;
  textOriginal: string;
  likeCount: number;
  publishedAt: string;
  updatedAt: string;
}

export interface YouTubeCommentThread {
  threadId: string;
  canReply: boolean;
  totalReplyCount: number;
  topLevelComment: YouTubeComment;
  replies: YouTubeComment[];
}

export interface AutomationSourceSummary {
  key: string;
  slug: string;
  analyzedUrl: string;
  title: string;
  videoCount: number;
  savedAt: number;
  thumb?: string;
}

export interface AutomationAgentSettings {
  maxPostsPerDay: number;
  scheduleTimes: string[];
  timezone: string;
  publishMode: "schedule" | "private" | "unlisted" | string;
  searchDepth: number;
  sourcePriority?: "views" | "oldest" | string;
  movieIdEnabled?: boolean;
  includeSideChannels: boolean;
  sideChannels: string[];
  microNicheGoal: string;
  genreFocus: string;
  titleStyle: string;
  madeForKids: boolean;
  categoryId: string;
  targetPlaylistMode?: "none" | "existing" | "create" | "auto" | string;
  targetPlaylistId?: string;
  targetPlaylistTitle?: string;
  createTargetPlaylist?: boolean;
  autoCreatePlaylists?: boolean;
  avoidMovieRepeats: boolean;
  performanceCheckHours: number;
  stagnationWindowHours: number;
  minViewDeltaPercent: number;
  scheduleLeadMinutes?: number;
  communityManagementEnabled?: boolean;
  aiEngagementRepliesEnabled?: boolean;
  maxCommentRepliesPerCheck?: number;
  commentReplyTone?: string;
  commentReplyInstructions?: string;
  compilationEnabled?: boolean;
  compilationMinMinutes?: number;
  compilationMaxMinutes?: number;
  compilationMaxClips?: number;
  compilationTitle?: string;
  compilationDescription?: string;
  compilationLayout?: "vertical" | "landscape" | string;
  rightsConfirmed: boolean;
}

export interface AutomationAgent {
  id: string;
  slug?: string;
  youtubeAccountId: string;
  name: string;
  status: "active" | "paused" | string;
  sourceType: "saved_playlist" | "saved_channel" | "custom_url" | string;
  sourceKey: string;
  sourceUrl: string;
  settings: AutomationAgentSettings;
  lastRunAt?: number | null;
  nextRunAt?: number | null;
  createdAt?: number;
  channelTitle?: string;
  channelHandle?: string;
  channelThumbnailUrl?: string;
  uploadCount?: number;
  lastUpload?: {
    title: string;
    movieTitle: string;
    youtubeUrl: string;
    createdAt: number;
  } | null;
}

export interface AgentLearningProfile {
  profile?: {
    samples?: number;
    totalViews?: number;
    bestSignals?: any[];
    bestGenres?: any[];
    bestMicroNiches?: any[];
    bestSources?: any[];
    bestHooks?: any[];
    bestDurations?: any[];
    bestHours?: any[];
    exploreRate?: number;
  };
  summary?: string;
  recommendation?: string;
  confidence?: number;
  updatedAt?: number;
}

export interface GrowthInsights {
  profiles: Array<AgentLearningProfile & { agentId?: string; agentName?: string }>;
  niches: Array<{
    id?: string;
    agentId?: string;
    microNiche: string;
    macroNiche?: string;
    subNiche?: string;
    uploads: number;
    totalViews: number;
    bestViews: number;
    confidence: number;
    status: string;
    evidence?: any;
  }>;
  competitors: Array<{
    id: string;
    sourceType: string;
    title: string;
    url: string;
    handle?: string;
    niche?: string;
    reason?: string;
    metrics?: any;
    updatedAt?: number;
  }>;
  competitorVideos: Array<{
    competitorId: string;
    competitorTitle: string;
    competitorHandle?: string;
    niche?: string;
    title: string;
    url: string;
    thumbnailUrl?: string;
    views: number;
    likes: number;
    comments: number;
    durationSeconds: number;
    hookPattern: string;
    velocity: number;
    publishedAt: number;
  }>;
  playbook: {
    bestNiche?: string;
    bestHook?: string;
    bestDuration?: string;
    bestSource?: string;
    monetizationFocus?: string;
    actions: string[];
  };
}

export interface AutomationRun {
  id: string;
  status: string;
  message: string;
  details?: Record<string, unknown>;
  startedAt: number;
  finishedAt?: number | null;
}

export interface AutomationUpload {
  id: string;
  youtubeVideoId: string;
  youtubeUrl: string;
  sourceUrl: string;
  sourceVideoId: string;
  sourceAuthor: string;
  movieTitle: string;
  movieYear: string;
  genre: string;
  microNiche: string;
  title: string;
  description?: string;
  scheduleAt?: number | null;
  status: string;
  metrics?: Record<string, any>;
  commentReplyStats?: {
    total?: number;
    movieName?: number;
    aiEngagement?: number;
    lastReplyAt?: number | null;
  };
  createdAt: number;
}

export interface YouTubeCommentsResponse {
  videoId: string;
  nextPageToken: string;
  comments: YouTubeCommentThread[];
}
