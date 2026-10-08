import { describe, expect, it } from "vitest";
import { dueCompilationSlot, normalizeCompilationSchedule, optionalAutomationCatchUpDate } from "./automationSchedulePolicy.js";

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


describe("scheduled compilations", () => {
  // Sunday 11 October 2026, 18:30 in Nairobi (UTC+3) is 15:30 UTC.
  const sunday = new Date(Date.UTC(2026, 9, 11, 15, 30));
  it("is due on a scheduled day once its time has passed, once per slot", () => {
    const schedule = { enabled: true, days: ["sun"], time: "18:00" };
    expect(dueCompilationSlot(schedule, { now: sunday, timeZone: "Africa/Nairobi" })).toBe("2026-10-11@18:00");
    expect(dueCompilationSlot({ ...schedule, lastSlot: "2026-10-11@18:00" }, { now: sunday, timeZone: "Africa/Nairobi" })).toBe("");
  });
  it("waits for its time, its day, and the switch", () => {
    expect(dueCompilationSlot({ enabled: true, days: ["sun"], time: "19:00" }, { now: sunday, timeZone: "Africa/Nairobi" })).toBe("");
    expect(dueCompilationSlot({ enabled: true, days: ["mon"], time: "18:00" }, { now: sunday, timeZone: "Africa/Nairobi" })).toBe("");
    expect(dueCompilationSlot({ enabled: false, days: ["sun"], time: "18:00" }, { now: sunday, timeZone: "Africa/Nairobi" })).toBe("");
  });
  it("skips a slot missed by more than the grace window", () => {
    expect(dueCompilationSlot({ enabled: true, days: ["sun"], time: "08:00" }, { now: sunday, timeZone: "Africa/Nairobi" })).toBe("");
  });
  it("cleans up what it's given", () => {
    expect(normalizeCompilationSchedule({ enabled: true, days: ["Friday", "xyz", "mon"], time: "7pm" })).toEqual({ enabled: true, days: ["mon", "fri"], time: "18:00", lastSlot: "" });
  });
});
