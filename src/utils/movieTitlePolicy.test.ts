import { describe, expect, it } from "vitest";

import { preferEnglishAnimeResultTitle, preferredMalDisplayTitle } from "./movieTitlePolicy.js";

describe("preferredMalDisplayTitle", () => {
  it("prefers the English MAL title for public anime display", () => {
    expect(preferredMalDisplayTitle({
      title: "Kimi no Na wa.",
      alternative_titles: {
        en: "Your Name.",
        ja: "君の名は。",
      },
    }, "Fallback title")).toBe("Your Name.");
  });

  it("falls back to the MAL canonical title when no English title exists", () => {
    expect(preferredMalDisplayTitle({
      title: "SK∞",
      alternative_titles: {
        en: "",
      },
    }, "Fallback title")).toBe("SK∞");
  });
});

describe("preferEnglishAnimeResultTitle", () => {
  it("uses a cached MAL English title for the visible anime result", () => {
    expect(preferEnglishAnimeResultTitle({
      title: "Shingeki no Kyojin: The Final Season",
      mediaType: "anime",
      mal: {
        title: "Shingeki no Kyojin: The Final Season",
        englishTitle: "Attack on Titan Final Season",
      },
    })).toMatchObject({
      title: "Attack on Titan Final Season",
    });
  });
});
