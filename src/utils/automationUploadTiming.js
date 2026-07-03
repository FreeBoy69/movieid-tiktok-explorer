function stableNumber(value = "") {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableRange(value, min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return lower + (stableNumber(value) % (upper - lower + 1));
}

export function automationUploadLeadMinutes(seed, publishAt, options = {}) {
  const release = new Date(publishAt);
  if (Number.isNaN(release.getTime()))
    throw new Error("A valid public release time is required.");
  const minMinutes = Math.max(Number(options.minMinutes) || 90, 15);
  const maxMinutes = Math.max(Number(options.maxMinutes) || 240, minMinutes);
  return stableRange(`${seed}:${release.toISOString()}`, minMinutes, maxMinutes);
}

export function automationChannelSpacingMinutes(seed, options = {}) {
  const minMinutes = Math.max(Number(options.minMinutes) || 8, 1);
  const maxMinutes = Math.max(Number(options.maxMinutes) || 20, minMinutes);
  return stableRange(seed, minMinutes, maxMinutes);
}

export function staggeredAutomationRunAt(publishAt, seed, options = {}) {
  const release = new Date(publishAt);
  const leadMinutes = automationUploadLeadMinutes(seed, release, options);
  return new Date(release.getTime() - leadMinutes * 60_000);
}

export function availableStaggeredAutomationRunAt(publishAt, seed, occupiedRunTimes = [], options = {}) {
  const release = new Date(publishAt);
  if (Number.isNaN(release.getTime()))
    throw new Error("A valid public release time is required.");
  const minMinutes = Math.max(Number(options.minMinutes) || 90, 15);
  const maxMinutes = Math.max(Number(options.maxMinutes) || 240, minMinutes);
  const spacingMinutes = automationChannelSpacingMinutes(`${seed}:${release.toISOString()}`, {
    minMinutes: options.spacingMinMinutes,
    maxMinutes: options.spacingMaxMinutes,
  });
  const spacingMs = spacingMinutes * 60_000;
  const earliest = release.getTime() - maxMinutes * 60_000;
  const latest = release.getTime() - minMinutes * 60_000;
  const occupied = occupiedRunTimes
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  let candidate = staggeredAutomationRunAt(release, seed, { minMinutes, maxMinutes }).getTime();
  const attempts = Math.max(Math.floor((latest - earliest) / spacingMs) + 1, 1);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (occupied.every((time) => Math.abs(time - candidate) >= spacingMs))
      return new Date(candidate);
    candidate -= spacingMs;
    if (candidate < earliest)
      candidate = latest;
  }
  return new Date(candidate);
}

export function nextFutureStaggeredAutomationSlot(publishTimes = [], seed, fromDate = new Date(), options = {}) {
  const after = new Date(fromDate).getTime() + (Number(options.minimumFutureMinutes) || 1) * 60_000;
  for (const value of publishTimes) {
    const publishAt = new Date(value);
    if (Number.isNaN(publishAt.getTime()))
      continue;
    const runAt = availableStaggeredAutomationRunAt(publishAt, seed, options.occupiedRunTimes || [], options);
    if (runAt.getTime() > after)
      return { publishAt, runAt };
  }
  return null;
}

export function sameDayCatchUpPublishAt(settings = {}, fromDate = new Date(), options = {}) {
  if (String(settings.publishMode || "") !== "schedule")
    return "";
  const now = new Date(fromDate);
  if (Number.isNaN(now.getTime()))
    return "";
  const scheduleTimes = Array.isArray(settings.scheduleTimes) ? settings.scheduleTimes.slice().sort() : [];
  const catchUpWindowMs = Math.max(Number(options.catchUpWindowMinutes) || 180, 1) * 60_000;
  const catchUpLeadMs = Math.max(Number(options.catchUpLeadMinutes) || 20, 1) * 60_000;
  const leadMs = Math.max(Number(settings.scheduleLeadMinutes) || 0, Number(options.minimumScheduleLeadMinutes) || 240) * 60_000;
  const offsetMs = Number(options.timezoneOffsetHours ?? 3) * 3600_000;
  const localNow = new Date(now.getTime() + offsetMs);
  const year = localNow.getUTCFullYear();
  const month = localNow.getUTCMonth();
  const date = localNow.getUTCDate();
  let latestMissed = null;
  let latestUpcomingInsideLead = null;

  for (const time of scheduleTimes) {
    const [hour, minute] = String(time).split(":").map(Number);
    if (!Number.isFinite(hour) || !Number.isFinite(minute))
      continue;
    const candidate = new Date(Date.UTC(year, month, date, hour, minute, 0, 0) - offsetMs);
    if (candidate.getTime() <= now.getTime() && candidate.getTime() >= now.getTime() - catchUpWindowMs)
      latestMissed = candidate;
    else if (candidate.getTime() > now.getTime() && candidate.getTime() <= now.getTime() + leadMs)
      latestUpcomingInsideLead = candidate;
  }

  const target = latestMissed || latestUpcomingInsideLead;
  if (!target)
    return "";
  return new Date(Math.max(target.getTime(), now.getTime() + catchUpLeadMs)).toISOString();
}

export function selectRunnableDueAgents(due = [], activeIds = new Set(), limit = 3) {
  const active = activeIds instanceof Set ? activeIds : new Set(activeIds || []);
  return due
    .filter((item) => item?.id && !active.has(item.id))
    .slice(0, Math.max(Number(limit) || 0, 0));
}
