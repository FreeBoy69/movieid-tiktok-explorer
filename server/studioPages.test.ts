import { describe, expect, it } from "vitest";
import { cinemaVideoPrompt, extractProductPage, nearestDuration, normalizeRequest, safePublicFetch } from "./creatorStudio.js";
import { cinemaLookText } from "../src/utils/cinemaPresets.js";
import { AD_AVATARS, AD_FORMATS, findFormat, findHook } from "../src/utils/marketingPresets.js";

describe("marketing studio", () => {
  it("reads product name, description, and images from a product page", () => {
    const html = `<html><head><title>Shop</title><meta property="og:title" content="Fallback &amp; Co"><meta property="og:image" content="/img/og.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"Trail Runner","description":"Light shoe","brand":{"name":"Acme"},"image":["https://cdn.acme.com/a.jpg","/b.jpg"]}</script></head><body><h1>Trail</h1></body></html>`;
    const page = extractProductPage(html, new URL("https://acme.com/p/1"));
    expect(page).toMatchObject({ name: "Trail Runner", description: "Light shoe", brand: "Acme" });
    expect(page.images).toEqual(["https://cdn.acme.com/a.jpg", "https://acme.com/b.jpg", "https://acme.com/img/og.jpg"]);
  });

  it("refuses to import from private or non-http addresses", async () => {
    await expect(safePublicFetch("http://localhost:3000/admin")).rejects.toThrow(/public/);
    await expect(safePublicFetch("http://127.0.0.1/")).rejects.toThrow(/public/);
    await expect(safePublicFetch("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(safePublicFetch("https://user:pw@example.com/")).rejects.toThrow(/http/);
  });

  it("picks the longest supported duration that fits", () => {
    expect(nearestDuration([4, 6, 8], 10)).toBe(8);
    expect(nearestDuration([5, 10, 15], 10)).toBe(10);
    expect(nearestDuration([8, 12], 5)).toBe(8);
  });

  it("keeps presets consistent and validates marketing requests", () => {
    expect(new Set(AD_FORMATS.map((f) => f.id)).size).toBe(AD_FORMATS.length);
    expect(AD_AVATARS.every((a) => a.image.startsWith("/assets/marketing/avatar-"))).toBe(true);
    expect(findFormat("nope").id).toBe("ugc");
    expect(findHook("nope")).toBeNull();
    const request = normalizeRequest({ tab: "marketing", settings: { productId: "prod-abc", avatarId: "maya", format: "hyper-motion", hook: "blizzard", setting: "../x", mode: "product" } });
    expect(request.settings).toMatchObject({ productId: "prod-abc", avatarId: "maya", format: "hyper-motion", hook: "blizzard", mode: "product" });
    expect(request.settings.setting).toBeUndefined();
    expect(() => normalizeRequest({ tab: "marketing", settings: { mode: "app" } })).toThrow(/Describe/);
  });
});

describe("cinema studio", () => {
  it("adds only chosen looks, and move set and speed only for video", () => {
    expect(cinemaLookText({ genre: "general", palette: "auto" })).toBe("");
    expect(cinemaLookText({ genre: "noir", moveset: "one-take" })).toContain("film noir");
    expect(cinemaLookText({ genre: "noir", moveset: "one-take" })).not.toContain("single-take");
    expect(cinemaLookText({ moveset: "one-take", speed: "bullet-time" }, true)).toContain("single-take");
  });

  it("writes a filming brief from the rig and look", () => {
    const prompt = cinemaVideoPrompt("A chase across rooftops", { camera: "Classic 16mm Film", lens: "Classic Anamorphic", focalLength: 24, aperture: "f/4" }, { genre: "action", speed: "impact" });
    expect(prompt).toContain("Filmed on a classic 16mm film camera with a classic anamorphic lens at 24mm");
    expect(prompt).toContain("slow motion at the moment of impact");
    expect(() => cinemaVideoPrompt("x", { camera: "Nope", lens: "Classic Anamorphic", focalLength: 24, aperture: "f/4" })).toThrow(/camera/);
  });
});
