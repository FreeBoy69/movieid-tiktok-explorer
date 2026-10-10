// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { holdReload, isChunkLoadError, reloadOnce } from "./lazyPage";

describe("reloading for a new deploy", () => {
  it("knows a stale page file from other errors", () => {
    expect(isChunkLoadError(new Error("Failed to fetch dynamically imported module: /assets/VibeEdit-abc.js"))).toBe(true);
    expect(isChunkLoadError(new Error("x is not a function"))).toBe(false);
  });

  it("waits while live mode holds it, then reloads once released", () => {
    let reloads = 0;
    const reload = () => reloads++;
    const release = holdReload(reload);
    expect(reloadOnce(reload)).toBe(false);
    expect(reloadOnce(reload)).toBe(false);
    expect(reloads).toBe(0);
    release();
    expect(reloads).toBe(1);
    // Releasing twice is harmless, and nothing is pending any more.
    release();
    expect(reloads).toBe(1);
  });

  it("releasing with nothing wanted doesn't reload", () => {
    let reloads = 0;
    holdReload(() => reloads++)();
    expect(reloads).toBe(0);
  });
});
