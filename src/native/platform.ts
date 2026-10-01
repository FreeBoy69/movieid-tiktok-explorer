import { Capacitor } from "@capacitor/core";

export type NativePlatform = "ios" | "android";

/** The iOS or Android app shell (capacitor.config.ts), or null in a browser. */
export function nativePlatform(): NativePlatform | null {
  try {
    if (Capacitor.isNativePlatform()) {
      const platform = Capacitor.getPlatform();
      if (platform === "ios" || platform === "android") return platform;
    }
  } catch {
    /* Capacitor bridge unavailable */
  }
  // The shell appends this to the user agent, which also covers the offline page.
  if (typeof navigator !== "undefined" && /\bAutoYTApp\//.test(navigator.userAgent)) {
    return /Android/i.test(navigator.userAgent) ? "android" : "ios";
  }
  return null;
}

export function isNativeApp(): boolean {
  return nativePlatform() !== null;
}

/**
 * App Store and Google Play require their own billing for digital purchases, so
 * the native apps never show plans, checkout, or prompts to buy.
 */
export function purchasesAllowed(): boolean {
  return !isNativeApp();
}
