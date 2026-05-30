import { describe, expect, it } from "vitest";
import { recoverCompactMovieIdJson } from "./movieIdJsonRecovery.js";

describe("compact Movie ID JSON recovery", () => {
  it("recovers the usable title fields when Gemini returns a clipped compact JSON object", () => {
    const result = recoverCompactMovieIdJson(`{
      "title": "Noble Reincarnation",
      "year": "2025",
      "mediaType": "anime",
      "confidence": 0.97,
      "summary": "A prince uses impossible magic to protect his family
    `);

    expect(result).toMatchObject({
      title: "Noble Reincarnation",
      year: "2025",
      mediaType: "anime",
      confidence: 0.97,
    });
  });
});
