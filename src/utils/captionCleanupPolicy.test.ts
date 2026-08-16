import { describe, expect, it } from "vitest";
import { captionCleanupQualityGate, planCaptionCleanupSegments, resolveCaptionCleanupCrop, resolveCaptionCleanupZone } from "./captionCleanupPolicy.js";

describe("caption cleanup policy", () => {
  it("uses the lower-third caption zone by default", () => {
    expect(resolveCaptionCleanupZone()).toMatchObject({ id: "lower", x: 0.04, y: 0.54 });
    expect(resolveCaptionCleanupZone("UPPER")).toMatchObject({ id: "upper", y: 0.06 });
  });

  it("requires duration, detection, and residual-text checks", () => {
    expect(captionCleanupQualityGate({
      sourceDurationSeconds: 63.533,
      outputDurationSeconds: 63.533,
      detectedFrameRatio: 0.74,
      inputCaptionPixels: 81000,
      remainingCaptionPixels: 2400,
    })).toMatchObject({ passed: true, durationPassed: true, detectionPassed: true, residualPassed: true });

    expect(captionCleanupQualityGate({
      sourceDurationSeconds: 63.533,
      outputDurationSeconds: 63.533,
      detectedFrameRatio: 0.74,
      inputCaptionPixels: 81000,
      remainingCaptionPixels: 52000,
    })).toMatchObject({ passed: false, residualPassed: false });
  });

  it("uses an even pixel crop that fully covers the selected caption zone", () => {
    expect(resolveCaptionCleanupCrop({ width: 608, height: 1080 }, "lower")).toEqual({ x: 24, y: 582, width: 560, height: 412 });
  });

  it("splits long sources into valid provider inputs with temporal context", () => {
    const segments = planCaptionCleanupSegments(63.533);
    expect(segments).toHaveLength(3);
    expect(segments.every((segment) => segment.inputDurationSeconds >= 2 && segment.inputDurationSeconds <= 30)).toBe(true);
    expect(segments[0]).toMatchObject({ coreStartSeconds: 0, inputStartSeconds: 0, trimStartSeconds: 0 });
    expect(segments.at(-1)!.coreStartSeconds + segments.at(-1)!.coreDurationSeconds).toBeCloseTo(63.533, 5);
    expect(segments.slice(1).every((segment) => segment.trimStartSeconds > 0)).toBe(true);
  });

  it("rejects output that changes dimensions, alignment, or too much of a frame", () => {
    expect(captionCleanupQualityGate({
      sourceDurationSeconds: 3,
      outputDurationSeconds: 3,
      detectedFrameRatio: 1,
      inputCaptionPixels: 1000,
      remainingCaptionPixels: 0,
      maskedPixelRatio: 0.2,
      sourceWidth: 608,
      sourceHeight: 1080,
      outputWidth: 608,
      outputHeight: 1080,
      sourceFrameCount: 90,
      outputFrameCount: 90,
    })).toMatchObject({ passed: false, maskAreaPassed: false });

    expect(captionCleanupQualityGate({
      sourceDurationSeconds: 3,
      outputDurationSeconds: 3,
      detectedFrameRatio: 1,
      inputCaptionPixels: 1000,
      remainingCaptionPixels: 0,
      maskedPixelRatio: 0.01,
      sourceWidth: 608,
      sourceHeight: 1080,
      outputWidth: 608,
      outputHeight: 1080,
      sourceFrameCount: 90,
      outputFrameCount: 90,
      candidateTimingPassed: false,
    })).toMatchObject({ passed: false, candidateTimingPassed: false });
  });
});
