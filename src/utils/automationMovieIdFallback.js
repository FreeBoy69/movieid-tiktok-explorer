function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function buildAutomationMovieIdFallback({ video = {}, settings = {}, transcript = "", error = null } = {}) {
  const sourceTitle = clean(video.title) || "Untitled source clip";
  const primary = clean(settings.genreFocus) || "Faceless short-form content";
  const microSubNiche = clean(settings.microNicheGoal);
  const fullText = String(transcript || "").trim();
  const reason = clean(error?.message || error).slice(0, 500);

  return {
    title: sourceTitle,
    year: "",
    mediaType: "unverified-source",
    genre: primary,
    confidence: 0.25,
    summary: fullText.slice(0, 1200) || sourceTitle,
    transcript: {
      excerpt: fullText.slice(0, 1200),
      fullText,
      hooks: [],
      contentStyle: [],
      structure: [],
    },
    contentNiche: {
      primary,
      subNiche: primary,
      microSubNiche,
      hookPattern: "curiosity-recap",
      contentFormat: "short-form faceless clip",
      audience: "",
      rationale: "Movie ID was unavailable, so publishing continued from the local transcript and source context.",
      opportunities: [],
      platforms: ["YouTube Shorts", "TikTok"],
    },
    evidence: {
      audio: fullText.slice(0, 1200),
      visual: "",
      reasoning: reason || "Movie ID providers were unavailable.",
    },
    movieIdStatus: "failed",
    movieIdError: reason,
    publishable: true,
    sourceAuthor: clean(video.authorHandle || video.author),
    durationSeconds: Number(video.durationSeconds || video.duration || 0),
  };
}
