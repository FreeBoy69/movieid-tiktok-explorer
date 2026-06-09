import { describe, expect, it } from "vitest";
import {
  movieIdShouldUseQwenFallback,
  qwenMovieIdNeedsCompactLocalVideo,
  qwenMovieIdVideoReference,
} from "./movieIdProviderPolicy.js";

describe("Movie ID provider fallback policy", () => {
  it("uses Qwen when Gemini is temporarily unavailable", () => {
    expect(movieIdShouldUseQwenFallback({
      message: '{"error":{"code":503,"status":"UNAVAILABLE"}}',
    })).toBe(true);
  });

  it("does not use Qwen for unrelated Movie ID errors", () => {
    expect(movieIdShouldUseQwenFallback(new Error("video download failed"))).toBe(false);
  });

  it("requires a compact local video instead of returning an inaccessible remote URL", () => {
    expect(qwenMovieIdNeedsCompactLocalVideo(Buffer.alloc(12), "video/mp4", 10)).toBe(true);
    expect(qwenMovieIdVideoReference(
      Buffer.alloc(12),
      "video/mp4",
      { normalizedUrl: "https://youtube.com/watch?v=abc123" },
      10,
    )).toBe("");
  });
});
