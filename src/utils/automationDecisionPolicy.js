function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(number, min), max) : fallback;
}

function stableUnit(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function profileValue(learning = {}) {
  return learning?.profile || learning || {};
}

function evidenceRows(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row && String(row.label || "").trim() && String(row.label).toLowerCase() !== "unknown")
    .map((row) => ({
      label: String(row.label).trim(),
      uploads: Number(row.uploads || 0),
      views: Number(row.views || 0),
      score: Number(row.score || 0),
    }))
    .filter((row) => row.uploads > 0 && row.views > 0)
    .sort((a, b) => (b.score - a.score) || (b.views - a.views) || (b.uploads - a.uploads));
}

function chooseEvidence(rows, phase, seed) {
  const candidates = evidenceRows(rows);
  if (!candidates.length) return null;
  if (phase === "exploit") return candidates[0];
  const pool = candidates.slice(0, Math.min(3, candidates.length));
  return pool[Math.floor(stableUnit(seed) * pool.length)] || pool[0];
}

function recentFailureMessages(report = {}) {
  const runs = Array.isArray(report.latestRuns) ? report.latestRuns : [];
  for (const run of runs) {
    const status = String(run?.status || "").toLowerCase();
    if (status === "success") return [];
    if (["error", "failed"].includes(status)) {
      const message = String(run?.message || run?.details?.failure?.error || "");
      return message ? [message] : [];
    }
  }
  return [];
}

export function classifyAutomationFailure(error = "") {
  const text = String(error instanceof Error ? error.message : error || "").toLowerCase();
  if (!text) return { category: "none", retryable: true, action: "continue" };
  if (/invalid_grant|oauth|access token|refresh token|unauthori[sz]ed|reconnect|permission denied|forbidden/.test(text)) {
    return { category: "authentication", retryable: false, action: "reconnect_publish_channel" };
  }
  if (/confirm.*rights|rights.*confirm|choose a publish channel|source url is missing|not fully connected|configuration/.test(text)) {
    return { category: "configuration", retryable: false, action: "fix_agent_settings" };
  }
  if (/no source videos|no unused source|source videos found|source collection|already uploaded|source exhausted|no fresh publishable candidate|no fresh candidate passed duplicate/.test(text)) {
    return { category: "source_exhausted", retryable: false, action: "refresh_or_expand_sources" };
  }
  if (/audio|ffmpeg|ffprobe|download|media|codec|corrupt|video file|playback/.test(text)) {
    return { category: "media", retryable: true, action: "redownload_and_repair" };
  }
  if (/quota|rate limit|too many requests|429/.test(text)) {
    return { category: "platform_limit", retryable: false, action: "wait_for_platform_limit" };
  }
  if (/upload|youtube|zernio|publish/.test(text)) {
    return { category: "publishing", retryable: true, action: "retry_upload" };
  }
  if (/timeout|timed out|network|socket|econn|fetch failed|temporar|503|502|504/.test(text)) {
    return { category: "transient", retryable: true, action: "retry_after_backoff" };
  }
  return { category: "unknown", retryable: true, action: "retry_once_then_review" };
}

function shiftedScheduleTime(time, offsetMinutes) {
  const match = String(time || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "";
  const total = Math.min(Math.max(Number(match[1]) * 60 + Number(match[2]) + offsetMinutes, 6 * 60), 23 * 60 + 45);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function learnedScheduleTimes(profile, settings, phase, seed) {
  const existing = Array.isArray(settings.scheduleTimes) ? settings.scheduleTimes : [];
  const desired = Math.max(1, Math.min(Number(settings.maxPostsPerDay) || existing.length || 1, 12));
  if (phase === "explore" && existing.length) {
    const offsets = [-90, -45, 45, 90];
    return existing.slice(0, desired).map((time, index) => {
      const offset = offsets[Math.floor(stableUnit(`${seed}:schedule:${time}:${index}`) * offsets.length)] || 45;
      return shiftedScheduleTime(time, offset) || time;
    }).filter(Boolean).sort();
  }
  const rows = evidenceRows(profile.bestHours)
    .filter((row) => Number.isInteger(Number(row.label)) && Number(row.label) >= 0 && Number(row.label) <= 23 && row.uploads >= 2);
  if (!rows.length) return [];
  const fallbackMinute = String(settings.scheduleTimes?.[0] || "00:00").split(":")[1] || "00";
  const learned = rows.slice(0, desired).map((row) => {
    const localHour = (Number(row.label) + 3) % 24;
    return `${String(localHour).padStart(2, "0")}:${fallbackMinute}`;
  });
  return [...new Set([...learned, ...existing])].slice(0, desired).sort();
}

export function buildAutomationDecisionPolicy(options = {}) {
  const settings = options.settings || {};
  const profile = profileValue(options.learning);
  const report = options.report || {};
  const seed = String(options.seed || "automation-decision");
  const enabled = settings.adaptiveStrategyEnabled !== false;
  const samples = Number(profile.samples || 0);
  const averageViews = samples > 0 ? Number(profile.totalViews || 0) / samples : Number(report.avgViews30d || 0);
  const failures = recentFailureMessages(report);
  const failure = classifyAutomationFailure(failures[0] || "");
  const effectiveFailureRetryable = settings.adaptiveRecoveryEnabled === false ? true : failure.retryable;
  const latestRuns = Array.isArray(report.latestRuns) ? report.latestRuns : [];
  const completedRuns = latestRuns.filter((run) => ["success", "error", "failed"].includes(String(run?.status || "").toLowerCase()));
  let failureStreak = 0;
  for (const run of completedRuns) {
    if (String(run?.status || "").toLowerCase() === "success") break;
    failureStreak += 1;
  }
  const threshold = clamp(settings.sourceUnderperformingViewThreshold, 100, 100000, 1000);
  const underperforming = samples >= 3 && averageViews < threshold;
  let phase = "manual";
  if (enabled) {
    if (settings.adaptiveRecoveryEnabled !== false && (failureStreak >= 2 || (failure.category !== "none" && !effectiveFailureRetryable))) phase = "recover";
    else if (samples < 4) phase = "learn";
    else if (underperforming) phase = "explore";
    else phase = "exploit";
  }
  const explorationRate = phase === "learn" ? 0.6 : phase === "explore" ? 0.45 : phase === "exploit" ? 0.15 : 0;
  const selectPhase = ["exploit", "recover"].includes(phase) ? "exploit" : "explore";
  const preferredHook = chooseEvidence(profile.bestHooks, selectPhase, `${seed}:hook`);
  const preferredNiche = chooseEvidence(profile.bestMicroNiches, selectPhase, `${seed}:niche`);
  const preferredDuration = chooseEvidence(profile.bestDurations, selectPhase, `${seed}:duration`);
  const preferredFormat = chooseEvidence(profile.bestFormats, selectPhase, `${seed}:format`);
  const preferredScheduleTimes = enabled && settings.adaptiveSchedulingEnabled !== false && samples >= 4
    ? learnedScheduleTimes(profile, settings, phase, seed)
    : [];
  const reasons = [];
  if (phase === "learn") reasons.push("Collecting enough outcome data to establish reliable patterns.");
  if (phase === "explore") reasons.push(`Average performance is below ${Math.round(threshold)} views, so the agent will test adjacent proven patterns.`);
  if (phase === "exploit") reasons.push("Performance has enough evidence to favor the strongest repeatable patterns.");
  if (phase === "recover") reasons.push(`Recent failures indicate ${failure.category.replace(/_/g, " ")}; recovery action is ${failure.action.replace(/_/g, " ")}.`);
  if (phase === "manual") reasons.push("Adaptive strategy is disabled; saved settings determine each run.");
  return {
    enabled,
    phase,
    samples,
    confidence: Math.min(0.95, Math.round((samples / 12) * 100) / 100),
    averageViews: Math.round(averageViews),
    underperforming,
    explorationRate,
    preferredHook: preferredHook?.label || "",
    preferredNiche: preferredNiche?.label || "",
    preferredDuration: preferredDuration?.label || "",
    preferredFormat: preferredFormat?.label || "",
    preferredScheduleTimes,
    recovery: {
      failureStreak,
      category: failure.category,
      retryable: effectiveFailureRetryable,
      action: failure.action,
    },
    reasons,
    seed,
  };
}

export function applyAutomationDecisionSettings(settings = {}, policy = {}) {
  const effective = { ...settings };
  if (settings.adaptiveStrategyEnabled === false || settings.adaptiveSchedulingEnabled === false) return effective;
  if (Array.isArray(policy.preferredScheduleTimes) && policy.preferredScheduleTimes.length) {
    effective.scheduleTimes = [...policy.preferredScheduleTimes];
  }
  return effective;
}

export function automationDecisionCandidateAdjustment(video = {}, policy = {}, context = {}) {
  if (!policy?.enabled) return 0;
  let score = 0;
  if (policy.preferredHook && context.hookPattern === policy.preferredHook) score += policy.phase === "exploit" ? 28 : 14;
  if (policy.preferredDuration && context.durationBucket === policy.preferredDuration) score += policy.phase === "exploit" ? 16 : 8;
  const text = `${video.title || ""} ${video.description || ""}`.toLowerCase();
  if (policy.preferredNiche && text.includes(String(policy.preferredNiche).toLowerCase())) score += 14;
  if (["learn", "explore"].includes(policy.phase)) {
    const identity = video.id || video.playUrl || video.sourceUrl || video.title || "candidate";
    score += stableUnit(`${policy.seed}:${identity}`) * 22;
  }
  return Math.round(score * 100) / 100;
}
