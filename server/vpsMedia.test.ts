import { describe, expect, it } from "vitest";
import { signedMediaUrl } from "./vpsMedia.js";

describe("media worker links", () => {
  const env = { WORKER_SCRIPT_TOKEN: "tok123" } as any;
  it("signs links the way the worker's nginx secure_link checks them", () => {
    // The vector is nginx's own formula, computed independently in Python.
    const url = signedMediaUrl("rcp_abc/recap-long.mp4", { now: (1791320000 - 3600) * 1000, ttl: 3600, base: "https://x.trycloudflare.com/", env });
    expect(url).toBe("https://x.trycloudflare.com/media/rcp_abc/recap-long.mp4?md5=KoahOzltBCCpFjBb93Rojg&expires=1791320000");
    expect(signedMediaUrl("rcp_abc/recap-long.mp4", { base: "https://x.trycloudflare.com", env, download: true })).toMatch(/&dl=1$/);
  });

  it("refuses paths that could leave the media folder, and works only when configured", () => {
    expect(signedMediaUrl("../etc/passwd", { base: "https://x", env })).toBe("");
    expect(signedMediaUrl("rcp_abc/../../x.mp4", { base: "https://x", env })).toBe("");
    expect(signedMediaUrl("rcp_abc/a.mp4", { base: "", env })).toBe("");
    expect(signedMediaUrl("rcp_abc/a.mp4", { base: "https://x", env: {} as any })).toBe("");
  });
});
