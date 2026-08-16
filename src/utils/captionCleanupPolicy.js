export const CAPTION_CLEANUP_ZONES = {
  lower: {
    id: "lower",
    label: "Lower captions",
    x: 0.04,
    y: 0.54,
    width: 0.92,
    height: 0.38,
  },
  center: {
    id: "center",
    label: "Center captions",
    x: 0.04,
    y: 0.28,
    width: 0.92,
    height: 0.44,
  },
  upper: {
    id: "upper",
    label: "Upper captions",
    x: 0.04,
    y: 0.06,
    width: 0.92,
    height: 0.38,
  },
};

// Do not return an export with a partly readable subtitle. This deliberately
// errs on the side of rejecting a difficult reconstruction instead of hiding
// the problem behind a blurred or partially erased caption.
export const MAX_CAPTION_REMAINING_RATIO = 0.05;
export const MAX_CAPTION_MASKED_PIXEL_RATIO = 0.12;
export const CAPTION_CLEANUP_MAX_INPUT_SECONDS = 30;
export const CAPTION_CLEANUP_CONTEXT_SECONDS = 2;
export const CAPTION_CLEANUP_MIN_INPUT_SECONDS = 2;

export function resolveCaptionCleanupZone(value) {
  const requested = String(value || "").trim().toLowerCase();
  return CAPTION_CLEANUP_ZONES[requested] || CAPTION_CLEANUP_ZONES.lower;
}

function evenFloor(value) {
  const floored = Math.floor(value);
  return floored % 2 === 0 ? floored : floored - 1;
}

function evenCeil(value) {
  const ceiled = Math.ceil(value);
  return ceiled % 2 === 0 ? ceiled : ceiled + 1;
}

export function resolveCaptionCleanupCrop(dimensions = {}, zoneValue) {
  const width = Math.max(0, Math.round(Number(dimensions.width) || 0));
  const height = Math.max(0, Math.round(Number(dimensions.height) || 0));
  if (width < 2 || height < 2) return null;
  const zone = typeof zoneValue === "object" && zoneValue ? zoneValue : resolveCaptionCleanupZone(zoneValue);
  let left = Math.max(0, evenFloor(width * Number(zone.x || 0)));
  let top = Math.max(0, evenFloor(height * Number(zone.y || 0)));
  let right = Math.min(width, evenCeil(width * (Number(zone.x || 0) + Number(zone.width || 0))));
  let bottom = Math.min(height, evenCeil(height * (Number(zone.y || 0) + Number(zone.height || 0))));
  if (right - left < 2) right = Math.min(width, left + 2);
  if (bottom - top < 2) bottom = Math.min(height, top + 2);
  if ((right - left) % 2) right -= 1;
  if ((bottom - top) % 2) bottom -= 1;
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function planCaptionCleanupSegments(durationSeconds, options = {}) {
  const duration = Number(durationSeconds || 0);
  const maximumInputSeconds = Math.max(CAPTION_CLEANUP_MIN_INPUT_SECONDS, Number(options.maximumInputSeconds || CAPTION_CLEANUP_MAX_INPUT_SECONDS));
  const contextSeconds = Math.max(0, Math.min(Number(options.contextSeconds ?? CAPTION_CLEANUP_CONTEXT_SECONDS), (maximumInputSeconds - CAPTION_CLEANUP_MIN_INPUT_SECONDS) / 2));
  if (!Number.isFinite(duration) || duration < CAPTION_CLEANUP_MIN_INPUT_SECONDS) return [];
  const maximumCoreSeconds = Math.max(CAPTION_CLEANUP_MIN_INPUT_SECONDS, maximumInputSeconds - contextSeconds * 2);
  const count = Math.max(1, Math.ceil(duration / maximumCoreSeconds));
  const coreSeconds = duration / count;
  return Array.from({ length: count }, (_, index) => {
    const coreStart = coreSeconds * index;
    const coreEnd = index === count - 1 ? duration : coreSeconds * (index + 1);
    const inputStart = Math.max(0, coreStart - contextSeconds);
    const inputEnd = Math.min(duration, coreEnd + contextSeconds);
    return {
      index: index + 1,
      coreStartSeconds: Number(coreStart.toFixed(6)),
      coreDurationSeconds: Number((coreEnd - coreStart).toFixed(6)),
      inputStartSeconds: Number(inputStart.toFixed(6)),
      inputDurationSeconds: Number((inputEnd - inputStart).toFixed(6)),
      trimStartSeconds: Number((coreStart - inputStart).toFixed(6)),
    };
  });
}

export function captionCleanupQualityGate(metrics = {}) {
  const sourceDurationSeconds = Number(metrics.sourceDurationSeconds || 0);
  const outputDurationSeconds = Number(metrics.outputDurationSeconds || 0);
  const durationDeltaSeconds = Number.isFinite(Number(metrics.durationDeltaSeconds))
    ? Math.abs(Number(metrics.durationDeltaSeconds))
    : Math.abs(outputDurationSeconds - sourceDurationSeconds);
  const detectedFrameRatio = Number(metrics.detectedFrameRatio || 0);
  const inputCaptionPixels = Number(metrics.inputCaptionPixels || 0);
  const remainingCaptionPixels = Number(metrics.remainingCaptionPixels || 0);
  const maskedPixelRatio = Number(metrics.maskedPixelRatio);
  const sourceWidth = Number(metrics.sourceWidth || 0);
  const sourceHeight = Number(metrics.sourceHeight || 0);
  const outputWidth = Number(metrics.outputWidth || 0);
  const outputHeight = Number(metrics.outputHeight || 0);
  const sourceFrameCount = Number(metrics.sourceFrameCount || 0);
  const outputFrameCount = Number(metrics.outputFrameCount || 0);
  const remainingCaptionRatio = inputCaptionPixels > 0
    ? remainingCaptionPixels / inputCaptionPixels
    : 1;
  const durationPassed = sourceDurationSeconds > 0 && outputDurationSeconds > 0 && durationDeltaSeconds <= 0.15;
  const detectionPassed = detectedFrameRatio >= 0.03;
  const residualPassed = inputCaptionPixels > 0 && remainingCaptionRatio <= MAX_CAPTION_REMAINING_RATIO;
  const maskAreaPassed = !Number.isFinite(maskedPixelRatio) || (maskedPixelRatio > 0 && maskedPixelRatio <= MAX_CAPTION_MASKED_PIXEL_RATIO);
  const dimensionsPassed = !(sourceWidth && sourceHeight && outputWidth && outputHeight)
    || (sourceWidth === outputWidth && sourceHeight === outputHeight);
  const frameCountPassed = !(sourceFrameCount && outputFrameCount)
    || Math.abs(sourceFrameCount - outputFrameCount) <= 1;
  const candidateTimingPassed = metrics.candidateTimingPassed !== false;

  return {
    passed: durationPassed && detectionPassed && residualPassed && maskAreaPassed && dimensionsPassed && frameCountPassed && candidateTimingPassed,
    durationPassed,
    detectionPassed,
    residualPassed,
    maskAreaPassed,
    dimensionsPassed,
    frameCountPassed,
    candidateTimingPassed,
    durationDeltaSeconds: Number(durationDeltaSeconds.toFixed(3)),
    remainingCaptionRatio: Number(remainingCaptionRatio.toFixed(4)),
  };
}
