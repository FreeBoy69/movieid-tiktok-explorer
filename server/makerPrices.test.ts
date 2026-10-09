import { describe, expect, it } from "vitest";
import { makerPrices, modelName, videoUsdPerSecond } from "./makerPrices.js";

describe("videoUsdPerSecond", () => {
  it("reads every pricing shape OpenRouter uses", () => {
    expect(videoUsdPerSecond({ cents_per_video_output_second_720p: "14" })).toBeCloseTo(0.14);
    expect(videoUsdPerSecond({ cents_per_second_output: "12" })).toBeCloseTo(0.12);
    expect(videoUsdPerSecond({ duration_seconds: "0.13" })).toBeCloseTo(0.13);
    expect(videoUsdPerSecond({ duration_seconds_720p: "0.1", duration_seconds_1080p: "0.2" })).toBeCloseTo(0.1);
    expect(videoUsdPerSecond({ video_tokens: "0.000007" })).toBeCloseTo(0.1512);
    expect(videoUsdPerSecond({})).toBeNull();
  });
});

describe("makerPrices", () => {
  it("prices the configured models and the image model", async () => {
    const request = async (path: string) =>
      path === "/videos/models"
        ? { data: [{ id: "minimax/hailuo-3", name: "MiniMax: H3", supported_durations: [10, 5], pricing_skus: { duration_seconds: "0.13" } }, { id: "other/model", pricing_skus: {} }] }
        : { endpoints: [{ pricing: [{ billable: "output_image", cost_usd: 0.04 }] }] };
    const prices = await makerPrices({ imageModel: "test/image", videoModels: ["minimax/hailuo-3"] }, request as any);
    expect(prices).toEqual({ imageUsd: 0.04, video: { "minimax/hailuo-3": { name: "Hailuo 3", usdPerSecond: 0.13, durations: [5, 10] } } });
    expect(modelName("x-ai/grok-imagine-video-1.5")).toBe("Grok Imagine Video 1.5");
  });
});
