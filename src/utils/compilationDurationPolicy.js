export const COMPILATION_DURATION_TOLERANCE_SECONDS = 1.5;

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
