import { describe, expect, it } from "vitest";
import { evaluateDramaQuality } from "./productionQuality.js";

const asset = "/api/maker/projects/p/assets/scene.png";

describe("drama production preflight", () => {
  const series = {
    metadata: {
      drama: { cast: [{ id: "lily", name: "Lily Hart" }], voices: { LILY: "voice-1" } },
      production: { characters: { lily: { locked: asset } } },
    },
  };
  const episode = {
    metadata: {
      production: {
        settings: { subtitles: true },
        script: { scenes: [{ id: "s1" }] },
        scenes: { s1: { board: { asset }, voice: { asset }, clip: { asset } } },
      },
    },
  };

  it("recognizes locked sheets and voices keyed by screenplay speaker", () => {
    const review = evaluateDramaQuality(episode, series);
    expect(review.checks.find((item) => item.id === "cast")?.status).toBe("pass");
    expect(review.checks.find((item) => item.id === "voices")?.status).toBe("pass");
    expect(review.status).toBe("ready");
  });

  it("blocks stale boards and clips from the current episode view", () => {
    const view = { scenes: { s1: { board: { asset, stale: true }, voice: { asset }, clip: { asset, stale: true } } } };
    const review = evaluateDramaQuality(episode, series, "9:16", view);
    expect(review.checks.find((item) => item.id === "boards")?.status).toBe("blocked");
    expect(review.checks.find((item) => item.id === "clips")?.status).toBe("blocked");
  });
});
