import { describe, expect, it } from "vitest";
import { RECAP_STEPS, phaseEta, stepAt, stepEstimates, stepEta, stepFraction } from "./recapSteps";
import { tickClock } from "../../server/movieRecap.js";

describe("recap steps", () => {
  it("covers progress 0..1 without gaps", () => {
    for (let i = 1; i < RECAP_STEPS.length; i++) expect(RECAP_STEPS[i].from).toBe(RECAP_STEPS[i - 1].until);
    expect(stepAt(0).id).toBe("download");
    expect(stepAt(0.5).id).toBe("watch");
    expect(stepAt(0.75).id).toBe("narrate");
    expect(stepAt(1).id).toBe("deliver");
    expect(stepFraction(0.29)).toBeCloseTo(0.5, 2);
  });

  it("scales estimates with the film and recap length", () => {
    const short = stepEstimates({ filmSeconds: 3600, longMinutes: 5, formats: ["long"] });
    const long = stepEstimates({ filmSeconds: 9000, longMinutes: 12, formats: ["long", "short"] });
    expect(long.transcribe).toBeGreaterThan(short.transcribe);
    expect(long.cut).toBeGreaterThan(short.cut);
  });

  it("counts down from the estimate, then follows the step's own pace", () => {
    expect(stepEta(stepAt(0.2), 0.02, 10, 300)).toBe(290);
    // Half done after 100 s: the observed pace says ~100 s left, the plan 200; the blend sits between.
    const eta = stepEta(stepAt(0.29), 0.5, 100, 300);
    expect(eta).toBeGreaterThan(100);
    expect(eta).toBeLessThan(200);
    const estimates = stepEstimates({ filmSeconds: 6000 });
    // The rest of the analysis phase includes every later analysis step, and no render steps.
    expect(phaseEta(0.7, 0, estimates)).toBeCloseTo(estimates.write, 0);
  });
});

describe("recap clock", () => {
  it("counts working time only, and stamps steps", () => {
    const project: any = { status: "working", progress: 0.05 };
    tickClock(project, { message: "Downloading" }, 1000);
    project.progress = 0.2;
    tickClock(project, { message: "Transcribing" }, 61000);
    expect(project.clock.steps.download).toEqual({ start: 1000, end: 61000 });
    expect(project.clock.steps.transcribe.start).toBe(61000);
    project.status = "review";
    tickClock(project, {}, 121000);
    expect(project.clock.workMs).toBe(120000);
    expect(project.clock.since).toBeNull();
    // Waiting on review doesn't count; rendering picks the clock back up.
    project.status = "working";
    project.progress = 0.78;
    tickClock(project, { message: "Narrating" }, 500000);
    expect(project.clock.since).toBe(500000);
    expect(project.clock.log.map((e: any) => e.m)).toEqual(["Downloading", "Transcribing", "Narrating"]);
  });

  it("restarts a step run again", () => {
    const project: any = { status: "working", progress: 0.8 };
    tickClock(project, {}, 1000);
    project.progress = 0.9;
    tickClock(project, {}, 2000);
    project.progress = 0.8;
    tickClock(project, {}, 3000);
    expect(project.clock.steps.narrate).toEqual({ start: 3000 });
    expect(project.clock.steps.cut).toBeUndefined();
  });
});
