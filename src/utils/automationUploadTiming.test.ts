import { describe, expect, it } from "vitest";
import {
  automationChannelSpacingMinutes,
  automationUploadLeadMinutes,
  availableStaggeredAutomationRunAt,
  nextFutureStaggeredAutomationSlot,
  staggeredAutomationRunAt,
} from "./automationUploadTiming.js";

describe("automation upload staggering", () => {
  const publishAt = new Date("2026-06-10T12:00:00.000Z");

  it("uses a stable lead time between 90 and 240 minutes for the same agent and slot", () => {
    const first = automationUploadLeadMinutes("agent-1:channel-1", publishAt);
    const second = automationUploadLeadMinutes("agent-1:channel-1", publishAt);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(90);
    expect(first).toBeLessThanOrEqual(240);
  });

  it("varies upload lead time across release slots", () => {
    const leads = new Set(
      Array.from({ length: 8 }, (_, day) =>
        automationUploadLeadMinutes(
          "agent-1:channel-1",
          new Date(publishAt.getTime() + day * 24 * 60 * 60 * 1000),
        ),
      ),
    );

    expect(leads.size).toBeGreaterThan(1);
  });

  it("moves only the worker run time and leaves the public release unchanged", () => {
    const releaseIso = publishAt.toISOString();
    const runAt = staggeredAutomationRunAt(publishAt, "agent-1:channel-1");
    const leadMinutes = (publishAt.getTime() - runAt.getTime()) / 60_000;

    expect(publishAt.toISOString()).toBe(releaseIso);
    expect(leadMinutes).toBeGreaterThanOrEqual(90);
    expect(leadMinutes).toBeLessThanOrEqual(240);
  });

  it("uses a stable same-channel spacing value between 8 and 20 minutes", () => {
    const first = automationChannelSpacingMinutes("channel-1:2026-06-10T12:00:00.000Z");
    const second = automationChannelSpacingMinutes("channel-1:2026-06-10T12:00:00.000Z");

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(8);
    expect(first).toBeLessThanOrEqual(20);
  });

  it("moves a colliding same-channel run while preserving the public release window", () => {
    const seed = "agent-1:channel-1";
    const initial = staggeredAutomationRunAt(publishAt, seed);
    const available = availableStaggeredAutomationRunAt(publishAt, seed, [initial]);
    const leadMinutes = (publishAt.getTime() - available.getTime()) / 60_000;
    const spacingMinutes = Math.abs(available.getTime() - initial.getTime()) / 60_000;

    expect(available.toISOString()).not.toBe(initial.toISOString());
    expect(leadMinutes).toBeGreaterThanOrEqual(90);
    expect(leadMinutes).toBeLessThanOrEqual(240);
    expect(spacingMinutes).toBeGreaterThanOrEqual(8);
  });

  it("skips a release slot whose staggered upload time has already passed", () => {
    const now = new Date("2026-06-10T10:00:00.000Z");
    const slots = [
      new Date("2026-06-10T11:00:00.000Z"),
      new Date("2026-06-10T18:00:00.000Z"),
    ];
    const result = nextFutureStaggeredAutomationSlot(slots, "agent-1:channel-1", now);

    expect(result?.publishAt.toISOString()).toBe(slots[1].toISOString());
    expect(result?.runAt.getTime()).toBeGreaterThan(now.getTime());
  });
});
