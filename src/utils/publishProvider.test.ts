import { describe, expect, it } from "vitest";
import { shouldUploadViaZernio } from "./publishProvider.js";

describe("publish provider selection", () => {
  it("prefers direct YouTube upload when Google OAuth and Zernio are both connected", () => {
    expect(shouldUploadViaZernio({
      platform: "youtube",
      accessToken: "google-access-token",
      zernioApiKey: "zernio-key",
      zernioAccountId: "zernio-account",
    })).toBe(false);
  });

  it("uses Zernio for a YouTube channel without Google OAuth", () => {
    expect(shouldUploadViaZernio({
      platform: "youtube",
      accessToken: "zernio",
      zernioApiKey: "zernio-key",
      zernioAccountId: "zernio-account",
    })).toBe(true);
  });

  it("always uses Zernio for TikTok publishing", () => {
    expect(shouldUploadViaZernio({
      platform: "tiktok",
      accessToken: "",
      zernioApiKey: "zernio-key",
      zernioAccountId: "zernio-account",
    })).toBe(true);
  });
});
