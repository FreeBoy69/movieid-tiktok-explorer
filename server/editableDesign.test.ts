import { describe, expect, it } from "vitest";
import {
  compactDesignHtml,
  DESIGN_CANVASES,
  designHtmlMessages,
  designPlanMessages,
  designSettings,
  extractDesignDocument,
  extractJsonObject,
  imageSize,
  inlineDesignAssets,
  listDesignLayers,
  normalizeDesignPlan,
  sanitizeDesignHtml,
  validateDesignHtml,
} from "./editableDesign.js";

const poster = (inner: string, w = 1200, h = 1600) => `<!doctype html><html><head><title>T</title><style>:root{--field:#fff}</style></head><body><div class="poster" data-canvas-width="${w}" data-canvas-height="${h}">${inner}</div></body></html>`;

describe("editable design", () => {
  it("trims settings to known canvases, directions, imagery, and image uploads", () => {
    const s = designSettings({ canvas: "9:16", direction: "weird", imagery: "rich", uploads: [{ file: "up-a-1.png", label: "logo" }, { file: "up-b-1.mp4" }, { file: "../x.png" }] }, { ref: (v) => (/^up-[a-z0-9-]+\.(png|jpg|webp|mp4)$/.test(String(v)) ? v : undefined) });
    expect(s).toMatchObject({ canvas: "9:16", aspectRatio: "9:16", direction: "auto", imagery: "rich" });
    expect(s.uploads).toEqual([{ file: "up-a-1.png", label: "logo" }]);
    expect(designSettings({ canvas: "a4" }).aspectRatio).toBe("3:4");
    expect(DESIGN_CANVASES.a4).toMatchObject({ width: 1240, height: 1754 });
  });

  it("writes planner and writer prompts that carry the canvas, the font stacks, and the assets", () => {
    const plan = designPlanMessages({ brief: "Tea launch", canvas: "3:4", direction: "luxury", imagery: "none", uploads: [{ id: "upload-1", label: "logo" }] });
    expect(plan[0].content).toContain("1200x1600");
    expect(plan[0].content).toContain("at most 0 generated assets");
    expect(plan[0].content).toContain("upload-1 (logo)");
    const html = designHtmlMessages({ brief: "Tea launch", canvas: "16:9", plan: { title: "x" }, assets: [{ id: "hero", width: 1536, height: 864, form: "backdrop", rect: { x: 0, y: 0, width: 1920, height: 1080 } }] });
    expect(html[0].content).toContain('data-canvas-width="1920"');
    expect(html[0].content).toContain("asset:hero (1536x864px source, backdrop) planned at x=0 y=0 w=1920 h=1080");
    expect(html[0].content).toContain("serif-display:");
    const revise = designHtmlMessages({ brief: "b", canvas: "1:1", plan: {}, assets: [], previous: "<html></html>", revision: "make it red" });
    expect(revise.at(-1)!.content).toContain("make it red");
  });

  it("normalizes a plan: hex colours, known font ids, capped and deduplicated assets", () => {
    const value = extractJsonObject('Sure:\n```json\n{"title":"Tea","palette":{"field":"#123","accent":"red"},"fonts":{"display":"serif-display","body":"nope"},"copy":["A","","B"],"assets":[{"id":"Hero Shot!","form":"backdrop","rect":{"x":-5,"y":0,"width":99999,"height":900},"aspect":"7:1","prompt":"fog"},{"id":"hero-shot","prompt":"dup"},{"id":"","prompt":"x"}]}\n```');
    const plan = normalizeDesignPlan(value, { canvas: "3:4" });
    expect(plan.palette).toMatchObject({ field: "#123", accent: "#d9480f" });
    expect(plan.fonts).toEqual({ display: "serif-display", body: "grotesk" });
    expect(plan.copy).toEqual(["A", "B"]);
    expect(plan.assets).toHaveLength(1);
    expect(plan.assets[0]).toMatchObject({ id: "hero-shot", form: "backdrop", rect: { x: 0, y: 0, width: 1200, height: 900 }, aspect: "3:4" });
    expect(normalizeDesignPlan(value, { canvas: "3:4", maxAssets: 0 }).assets).toEqual([]);
    expect(extractJsonObject("no json here")).toBeNull();
  });

  it("strips everything that could run or reach out, and keeps the poster", () => {
    const dirty = poster(`<h1 data-layer-id="headline" onclick="x()">Hi</h1><script>alert(1)</script><link rel="stylesheet" href="https://evil/x.css"><img data-layer-id="hero" src="asset:hero"><a href="javascript:alert(1)">x</a><div style="background:url(https://evil/bg.png)"></div><iframe src="https://evil"></iframe>`);
    const clean = sanitizeDesignHtml(dirty);
    expect(clean).not.toMatch(/<script|<link|<iframe|onclick|javascript:|https:\/\/evil/);
    expect(clean).toContain('data-layer-id="headline"');
    expect(clean).toContain('src="asset:hero"');
    expect(extractDesignDocument(`Here you go:\n\`\`\`html\n${dirty}\n\`\`\``)).toBe(dirty);
  });

  it("validates the canvas and repairs duplicate layer ids", () => {
    const ok = validateDesignHtml(poster('<p data-layer-id="a">x</p><p data-layer-id="a">y</p>'), "3:4");
    expect(ok.ok).toBe(true);
    expect(listDesignLayers(ok.html)).toEqual(["a", "a-2"]);
    expect(validateDesignHtml(poster("<p>x</p>"), "3:4").problems[0]).toMatch(/data-layer-id/);
    expect(validateDesignHtml(poster('<p data-layer-id="a">x</p>', 1000, 1000), "3:4").problems[0]).toMatch(/1000x1000/);
    expect(validateDesignHtml("<html><body><p data-layer-id='a'>x</p></body></html>", "3:4").problems[0]).toMatch(/canvas root/);
  });

  it("inlines known assets, drops unknown ones, and folds data URLs back for revisions", () => {
    const assets = [{ id: "hero", dataUrl: "data:image/png;base64,AAAA" }];
    const html = poster('<img data-layer-id="hero" src="asset:hero"><img data-layer-id="x" src="asset:missing"><div style="background:url(asset:hero)"></div>');
    const inlined = inlineDesignAssets(html, assets);
    expect(inlined).toContain('src="data:image/png;base64,AAAA"');
    expect(inlined).not.toContain("asset:missing");
    expect(inlined).toContain('url("data:image/png;base64,AAAA")');
    expect(compactDesignHtml(inlined, assets)).toContain('src="asset:hero"');
    expect(compactDesignHtml(`<img src="data:image/png;base64,${"B".repeat(300)}">`, [])).toContain("asset:unknown");
  });

  it("reads image sizes from PNG, JPEG, and WebP headers", () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.from([0, 0, 4, 0, 0, 0, 3, 0, 8, 6, 0, 0, 0])]);
    expect(imageSize(png)).toEqual({ width: 1024, height: 768 });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x02, 0x58, 0x03, 0x20, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600 });
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8X"), Buffer.from([10, 0, 0, 0, 0, 0, 0, 0]), Buffer.from([0xff, 0x03, 0x00, 0x1f, 0x02, 0x00]), Buffer.alloc(8)]);
    expect(imageSize(webp)).toEqual({ width: 1024, height: 544 });
    expect(imageSize(Buffer.from("nope"))).toBeNull();
  });
});
