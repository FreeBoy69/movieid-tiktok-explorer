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

  it("never promotes a hashtag-only source caption into a YouTube title", () => {
    const repaired = repairAutomationMetadata(
      {
        title: "#anime #fyp #tiktok #animerecommendations",
        description: "A quick anime recap.",
        tags: ["anime"],
        genre: "Anime recaps",
      },
      {
        sourceTitle: "#anime #fyp #tiktok #animerecommendations",
        transcript: "This girl never could have imagined it. They kicked her out of the party, but a stranger begged her to join his team. He promised she would become the strongest knight in the kingdom.",
      },
    );

    expect(repaired.title).toContain("kicked her out of the party");
    expect(repaired.title).not.toContain("#");
    expect(repaired.metadataTitleOrigin).toBe("transcript");
  });

  it("replaces vague source-title wording with the most concrete transcript beat", () => {
    const repaired = repairAutomationMetadata(
      {
        title: "Barbados Is More Amazing Than You Think! #Barbados #Geography",
        description: "Geography facts.",
        tags: ["geography"],
      },
      {
        sourceTitle: "Barbados Is More Amazing Than You Think! #Barbados #Geography",
        transcript: "Barbados is hiding facts most people will never believe. This island spent 340 uninterrupted years under British rule before becoming a republic in 2021. Rihanna was born on this tiny island.",
      },
    );

    expect(repaired.title).toContain("340 uninterrupted years");
    expect(repaired.title).not.toMatch(/more amazing|#/i);
    expect(repaired.metadataTitleOrigin).toBe("transcript");
  });

  it("keeps a real short title while removing its source-caption hashtags", () => {
    const repaired = repairAutomationMetadata(
      {
        title: "Iphonita and Samsungioni #sadstory #aistory #ai #story",
        description: "A short story.",
      },
      { sourceTitle: "Iphonita and Samsungioni #sadstory #aistory #ai #story" },
    );

    expect(repaired.title).toBe("Iphonita and Samsungioni");
    expect(repaired.title).not.toContain("#");
  });
});
