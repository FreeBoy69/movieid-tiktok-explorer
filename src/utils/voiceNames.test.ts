import { describe, expect, it } from "vitest";
import { generateVoiceName, humanVoiceName, isHumanVoiceName } from "./voiceNames.js";

describe("voice names", () => {
  it("recognises first-and-last names only", () => {
    expect(isHumanVoiceName("Lily Hart")).toBe(true);
    expect(isHumanVoiceName("Seo-yeon O’Neil")).toBe(true);
    expect(isHumanVoiceName("Bricomedy corner narrator")).toBe(false);
    expect(isHumanVoiceName("Contract Bride: Lily Hart")).toBe(false);
    expect(isHumanVoiceName("Video narrator")).toBe(false);
    expect(isHumanVoiceName("Maya")).toBe(false);
  });

  it("generates two capitalised names and avoids taken ones", () => {
    const first = generateVoiceName([], () => 0);
    expect(isHumanVoiceName(first)).toBe(true);
    const values = [0, 0, 0.5, 0.5];
    const next = generateVoiceName([first], () => values.shift() ?? 0.9);
    expect(next).not.toBe(first);
    expect(isHumanVoiceName(next)).toBe(true);
  });

  it("keeps a real name and replaces a label", () => {
    expect(humanVoiceName("  Nora   Whitfield ")).toBe("Nora Whitfield");
    expect(isHumanVoiceName(humanVoiceName("Heist narrator"))).toBe(true);
    expect(isHumanVoiceName(humanVoiceName(""))).toBe(true);
  });
});
