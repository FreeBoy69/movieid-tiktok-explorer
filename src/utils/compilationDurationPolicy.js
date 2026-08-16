// Keep the final clip trim tight. Platforms can still report source durations
// slightly differently from the media we actually downloaded, so successful
// long-form compilations get a bounded acceptance window after every clip has
// been exhausted.
export const COMPILATION_DURATION_TOLERANCE_SECONDS = 10;
export const COMPILATION_NEAR_TARGET_TOLERANCE_CAP_SECONDS = 60;

function positiveSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}

export function compilationTargetSeconds(minSeconds, maxSeconds) {
  const minimum = positiveSeconds(minSeconds);
  const maximum = positiveSeconds(maxSeconds);
  if (minimum > 0 && maximum > 0 && minimum > maximum) {
    throw new Error("Compilation minimum length cannot exceed its maximum length.");
  }
  return minimum || maximum;
}

export function compilationRemainingSeconds(stitchedSeconds, targetSeconds) {
  const target = positiveSeconds(targetSeconds);
  if (!target) return 0;
  return Math.max(target - positiveSeconds(stitchedSeconds), 0);
}

export function compilationDurationMeetsTarget(actualSeconds, targetSeconds, toleranceSeconds = COMPILATION_DURATION_TOLERANCE_SECONDS) {
  const target = positiveSeconds(targetSeconds);
  if (!target) return true;
  return positiveSeconds(actualSeconds) + Math.max(Number(toleranceSeconds) || 0, 0) >= target;
}

export function compilationNearTargetToleranceSeconds(targetSeconds) {
  const target = positiveSeconds(targetSeconds);
  if (!target) return COMPILATION_DURATION_TOLERANCE_SECONDS;
  return Math.min(
    COMPILATION_NEAR_TARGET_TOLERANCE_CAP_SECONDS,
    Math.max(COMPILATION_DURATION_TOLERANCE_SECONDS, Math.round(target * 0.02)),
  );
}
