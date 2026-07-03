import { describe, expect, it } from "vitest";
import {
  isGenericAutomationTitle,
  repairAutomationMetadata,
  transcriptTitleFromContext,
} from "./automationMetadataPolicy.js";

describe("automation metadata policy", () => {
  it("detects generic shock-template titles", () => {
    expect(isGenericAutomationTitle("This Movie Twist Will Blow Your Mind 🤯")).toBe(true);
    expect(isGenericAutomationTitle("You won't believe what happens next")).toBe(true);
    expect(isGenericAutomationTitle("A Stranger Asked for Eggs - Then Things Got Dark")).toBe(false);
  });

  it("builds a fallback title from the transcript story beat instead of the channel niche", () => {
    const title = transcriptTitleFromContext({
      sourceTitle: "This Movie Twist Will Blow Your Mind",
      genre: "Movie recaps",
      transcript: "A surgeon wakes up inside a sealed lab with no memory of the experiment. The guards outside think he is already dead.",
    });

    expect(title).toContain("surgeon wakes up inside a sealed lab");
    expect(title).not.toMatch(/movie twist|blow your mind/i);
  });

  it("repairs generic AI metadata with transcript-specific copy", () => {
    const repaired = repairAutomationMetadata(
      {
        title: "This Movie Twist Will Blow Your Mind 🤯",
        description: "You won't believe what happens next. A quick recap of a thriller.",
        tags: ["thriller", "movie recap"],
        genre: "Movie recaps",
      },
      {
        sourceTitle: "Movie recap",
        transcript: "The detective finds a locked freezer full of missing passports. He realizes the hotel owner has been selling guests identities.",
      },
    );

    expect(repaired.metadataRepaired).toBe(true);
    expect(repaired.title).toContain("detective finds a locked freezer");
    expect(repaired.description).toContain("hotel owner");
    expect(repaired.description).toContain("#thriller");
  });
});
