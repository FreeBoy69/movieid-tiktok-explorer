import { describe, expect, it } from "vitest";
import { optionalAutomationCatchUpDate } from "./automationSchedulePolicy.js";

describe("automation schedule policy", () => {
  it("does not turn a missing catch-up value into the Unix epoch", () => {
    expect(optionalAutomationCatchUpDate()).toBeNull();
    expect(optionalAutomationCatchUpDate("")).toBeNull();
    expect(optionalAutomationCatchUpDate(0)).toBeNull();
  });

  it("accepts an explicit valid catch-up time", () => {
    expect(optionalAutomationCatchUpDate("2026-09-03T15:00:00.000Z")?.toISOString()).toBe("2026-09-03T15:00:00.000Z");
    expect(optionalAutomationCatchUpDate("not-a-date")).toBeNull();
  });
});
