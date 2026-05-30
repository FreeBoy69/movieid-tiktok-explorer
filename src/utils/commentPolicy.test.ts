import { describe, expect, it } from "vitest";
import {
  classifyCommentReply,
  contentNameReply,
  contentReferenceLabel,
  sourceTitleSafeForPublicReply,
  sourceTitleVerifiedForPublicReply,
} from "./commentPolicy.js";

describe("comment reply policy", () => {
  it("uses cheap lightweight replies for generic praise instead of AI context", () => {
    const decision = classifyCommentReply("great video bro");
    expect(decision.action).toBe("quick_reply");
    expect(decision.reply).toMatch(/thank|appreciate|glad/i);
    expect(decision.useAi).toBe(false);
  });

  it("uses a single emoji for numeric-only reactions", () => {
    const decision = classifyCommentReply("67");
    expect(decision.action).toBe("quick_reply");
    expect(decision.reply).toMatch(/^\p{Emoji_Presentation}$/u);
    expect(decision.useAi).toBe(false);
  });

  it("allows AI context only when the viewer says something specific about the story", () => {
    const decision = classifyCommentReply("that ending where he betrayed his brother was crazy");
    expect(decision.action).toBe("ai_context");
    expect(decision.useAi).toBe(true);
  });

  it("does not spend an AI reply on rhetorical reaction questions", () => {
    const decision = classifyCommentReply("why would he touch it without gloves \u2620\ufe0f");
    expect(decision.action).toBe("skip");
    expect(decision.useAi).toBe(false);
  });

  it("labels direct title replies by actual media type", () => {
    expect(contentReferenceLabel({ mediaType: "tv", genre: "Drama" })).toBe("TV show");
    expect(contentReferenceLabel({ mediaType: "anime", genre: "Sports" })).toBe("Anime");
    expect(contentNameReply({ title: "Yowamushi Pedal", mediaType: "anime", year: "2013" })).toBe("Anime name: Yowamushi Pedal (2013)");
  });

  it("keeps uncertain or qwen-only source titles out of public name replies", () => {
    expect(sourceTitleSafeForPublicReply({
      title: "Noble Reincarnation",
      confidence: 0.96,
      sourceVerification: { verified: true },
    })).toBe(true);
    expect(sourceTitleSafeForPublicReply({ title: "Unverified Guess", confidence: 0.98 })).toBe(false);
    expect(sourceTitleSafeForPublicReply({ title: "Manual Fix", confidence: 1, manualCorrection: true })).toBe(true);
    expect(sourceTitleSafeForPublicReply({ title: "Guess", confidence: 0.42 })).toBe(false);
    expect(sourceTitleSafeForPublicReply({
      title: "The Beginning After the End",
      confidence: 0.96,
      qwenFallback: { used: true },
    })).toBe(false);
  });

  it("requires an independent source-title verification before an automation name reply", () => {
    expect(sourceTitleVerifiedForPublicReply(
      { title: "Noble Reincarnation", confidence: 0.98, sourceVerification: { verified: true } },
      { title: "Noble Reincarnation", confidence: 0.94, sourceVerification: { verified: true } },
    )).toBe(true);
    expect(sourceTitleVerifiedForPublicReply(
      { title: "Am I Actually the Strongest?", confidence: 0.98, sourceVerification: { verified: true } },
      { title: "The Iceblade Sorcerer Shall Rule the World", confidence: 0.96, sourceVerification: { verified: true } },
    )).toBe(false);
    expect(sourceTitleVerifiedForPublicReply(
      { title: "Noble Reincarnation", confidence: 0.98, sourceVerification: { verified: true } },
      { title: "", confidence: 0, error: "Movie ID retry failed" },
    )).toBe(false);
  });
});
