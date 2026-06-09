import { describe, expect, it } from "vitest";
import { buildAutomationMovieIdFallback } from "./automationMovieIdFallback.js";

describe("automation Movie ID fallback", () => {
  it("keeps a candidate publishable using its transcript and source context", () => {
    const result = buildAutomationMovieIdFallback({
      video: {
        id: "clip-123",
        title: "A prince hides his power at the academy",
        authorHandle: "anime.source",
        durationSeconds: 142,
      },
      settings: {
        genreFocus: "Anime recaps",
        microNicheGoal: "academy power fantasy",
      },
      transcript: "The prince enters the academy and hides his forbidden power.",
      error: new Error("Missing Content-Length of multimodal url"),
    });

    expect(result.title).toBe("A prince hides his power at the academy");
    expect(result.transcript.fullText).toContain("forbidden power");
    expect(result.contentNiche.primary).toBe("Anime recaps");
    expect(result.contentNiche.microSubNiche).toBe("academy power fantasy");
    expect(result.movieIdStatus).toBe("failed");
    expect(result.publishable).toBe(true);
  });
});
