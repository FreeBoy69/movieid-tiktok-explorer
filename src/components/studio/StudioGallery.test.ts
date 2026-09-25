import { describe, expect, it } from "vitest";
import { generationFailureMessage } from "./StudioGallery";

describe("Video Studio generation errors", () => {
  it("distinguishes rights, likeness, and general safety failures", () => {
    expect(generationFailureMessage("copyrighted character blocked")).toMatch(/copyrighted character/i);
    expect(generationFailureMessage("real person likeness blocked")).toMatch(/likeness/i);
    expect(generationFailureMessage("moderation rejected the prompt")).toMatch(/safety checks/i);
  });
});
